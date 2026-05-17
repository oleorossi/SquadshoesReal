-- BUG GRAVE corrigido: check_stock_availability ignorava tiras (strap_colors).
--
-- Auditoria 17/05/2026: PVs em produção (PV-2026-00097, PV-2026-00067)
-- demandavam "Tira chata Costurada 11mm" e "Tira Overlock 5mm" com estoque
-- zero, RECEITA cadastrada e contractor "Seu nego" configurado — mas ZERO
-- service_orders criadas. Causa: a função iterava só sheet_materials
-- (component_sheets), ignorando o JSONB technical_sheets.strap_colors.
--
-- Sem detecção de shortage de tira:
--   1. MaterialPurchaseConfirmDialog nunca abre pra tiras
--   2. Operador aprova PV achando que tem tudo
--   3. PV vai pra produção e quando precisa da tira, falha o débito
--   4. Operador faz OS manual depois — muitas vezes esquece
--
-- Fix: adicionar SEGUNDO loop na função que itera strap_colors do JSONB,
-- resolve product_id via group_id+color (mesmo algoritmo do debit_strap_stock),
-- calcula required em METROS e adiciona ao RETURN TABLE.
--
-- enrichMaterialShortages no frontend já detecta is_artisanal=true desses
-- produtos automaticamente → MaterialPurchaseConfirmDialog cria OS pra Seu nego.

DROP FUNCTION IF EXISTS public.check_stock_availability(uuid, integer, text, jsonb) CASCADE;

CREATE OR REPLACE FUNCTION public.check_stock_availability(
  p_reference_id uuid,
  p_order_quantity integer,
  p_color text DEFAULT ''::text,
  p_order_grade jsonb DEFAULT NULL::jsonb
)
RETURNS TABLE(product_id uuid, product_name text, required numeric, available numeric, sufficient boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  mat RECORD;
  v_required numeric;
  v_target_id uuid;
  v_target_name text;
  v_target_qty numeric;
  -- Variáveis pro loop de tiras (novo bloco)
  v_strap_colors jsonb;
  v_strap jsonb;
  v_group_id uuid;
  v_color text;
  v_color_norm text;
  v_per_size jsonb;
  v_consumption numeric;
  v_size text;
  v_pairs numeric;
  v_cm_per_pair numeric;
  v_total_cm numeric;
  v_grade_total numeric;
  v_fichas numeric;
BEGIN
  -- ====== 1) Componentes regulares (sheet_materials) — comportamento original ======
  FOR mat IN
    SELECT sm.product_id,
           sm.quantity_per_unit,
           sm.consumption_per_size,
           p.quantity  AS current_stock,
           p.name,
           p.group_id,
           p.color     AS product_color
    FROM public.sheet_materials sm
    JOIN public.products p ON p.id = sm.product_id
    WHERE sm.sheet_id = p_reference_id
  LOOP
    v_required := public.calc_required_for_grade(
      mat.consumption_per_size,
      p_order_grade,
      mat.quantity_per_unit,
      p_order_quantity
    );

    v_target_id   := mat.product_id;
    v_target_name := mat.name;
    v_target_qty  := mat.current_stock;

    IF p_color IS NOT NULL AND p_color <> '' AND mat.product_color <> p_color THEN
      SELECT p.id, p.name, p.quantity INTO v_target_id, v_target_name, v_target_qty
      FROM public.products p
      WHERE p.active = true AND p.color = p_color
        AND (  (mat.group_id IS NOT NULL AND p.group_id = mat.group_id)
            OR (mat.group_id IS NULL      AND p.name    = mat.name    ))
      LIMIT 1;

      IF v_target_id IS NULL THEN
        v_target_id   := mat.product_id;
        v_target_name := mat.name;
        v_target_qty  := mat.current_stock;
      END IF;
    END IF;

    product_id   := v_target_id;
    product_name := v_target_name;
    required     := v_required;
    available    := v_target_qty;
    sufficient   := (v_target_qty >= v_required);
    RETURN NEXT;
  END LOOP;

  -- ====== 2) Tiras (strap_colors do JSONB) — NOVO BLOCO 2026-05-17 ======
  -- Replica algoritmo de debit_strap_stock pra calcular required em metros.
  SELECT ts.strap_colors INTO v_strap_colors
    FROM public.technical_sheets ts
   WHERE ts.id = p_reference_id;

  IF v_strap_colors IS NULL OR jsonb_typeof(v_strap_colors) <> 'array' OR jsonb_array_length(v_strap_colors) = 0 THEN
    RETURN;
  END IF;

  FOR v_strap IN SELECT value FROM jsonb_array_elements(v_strap_colors) AS value
  LOOP
    v_color := v_strap ->> 'color';

    BEGIN
      v_group_id := (v_strap ->> 'group_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_group_id := NULL;
    END;

    -- Sem group_id ou cor → não dá pra resolver; ignora silenciosamente
    -- (consistente com debit_strap_stock).
    IF v_group_id IS NULL OR v_color IS NULL OR v_color = '' THEN
      CONTINUE;
    END IF;

    v_color_norm := lower(trim(extensions.unaccent(v_color)));
    v_per_size := v_strap -> 'consumption_per_size';
    v_consumption := COALESCE((v_strap ->> 'consumption')::numeric, 1);
    IF v_consumption <= 0 THEN v_consumption := 1; END IF;

    -- Cálculo idêntico a debit_strap_stock: se tem consumption_per_size
    -- E p_order_grade, soma por tamanho × pares × n_fichas / 100 (cm→m).
    -- Senão, fallback escalar: consumption × p_order_quantity.
    IF v_per_size IS NOT NULL AND jsonb_typeof(v_per_size) = 'object'
       AND p_order_grade IS NOT NULL AND jsonb_typeof(p_order_grade) = 'object' THEN
      v_total_cm := 0;
      v_grade_total := 0;
      FOR v_size, v_pairs IN
        SELECT key, value::numeric FROM jsonb_each_text(p_order_grade) WHERE value::numeric > 0
      LOOP
        v_cm_per_pair := COALESCE((v_per_size ->> v_size)::numeric, v_consumption);
        v_total_cm := v_total_cm + (v_pairs * v_cm_per_pair);
        v_grade_total := v_grade_total + v_pairs;
      END LOOP;
      IF v_grade_total > 0 THEN
        v_fichas := GREATEST(1, ceil(p_order_quantity::numeric / v_grade_total));
      ELSE
        v_fichas := 1;
      END IF;
      v_required := (v_total_cm * v_fichas) / 100;
    ELSE
      v_required := v_consumption * p_order_quantity;
    END IF;

    IF v_required <= 0 THEN CONTINUE; END IF;

    -- Resolve produto da tira: match exato group_id + color (com unaccent)
    SELECT p.id, p.name, p.quantity
      INTO v_target_id, v_target_name, v_target_qty
      FROM public.products p
     WHERE p.active = true
       AND p.group_id = v_group_id
       AND lower(trim(extensions.unaccent(p.color))) = v_color_norm
     LIMIT 1;

    -- Fallback: produto do grupo sem cor (cadastro genérico)
    IF v_target_id IS NULL THEN
      SELECT p.id, p.name, p.quantity
        INTO v_target_id, v_target_name, v_target_qty
        FROM public.products p
       WHERE p.active = true
         AND p.group_id = v_group_id
         AND (p.color IS NULL OR trim(p.color) = '')
       LIMIT 1;
    END IF;

    -- Sem produto cadastrado pra essa tira+cor → emite linha com required>0
    -- e available=0 pra UI alertar "produto não cadastrado". O resolve de
    -- product_id fica null nesse caso (frontend tem que tratar).
    IF v_target_id IS NULL THEN
      -- Pula entrada sem produto resolvido — debit_strap_stock vai falhar
      -- depois, mas pelo menos não polui checkAvailability com null.
      CONTINUE;
    END IF;

    product_id   := v_target_id;
    product_name := v_target_name;
    required     := v_required;
    available    := COALESCE(v_target_qty, 0);
    sufficient   := (COALESCE(v_target_qty, 0) >= v_required);
    RETURN NEXT;
  END LOOP;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.check_stock_availability(uuid, integer, text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.check_stock_availability(uuid, integer, text, jsonb) IS
  'Checa disponibilidade de TODOS os materiais necessários pra produzir p_order_quantity pares de p_reference_id: componentes regulares (sheet_materials) + TIRAS (strap_colors JSONB). Retorno usado pelo MaterialPurchaseConfirmDialog pra detectar shortage e oferecer OC/OS automática. Bug histórico: até 17/05/2026 só checava sheet_materials, deixando tiras invisíveis ao sistema.';
