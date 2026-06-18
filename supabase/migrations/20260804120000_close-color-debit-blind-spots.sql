-- ════════════════════════════════════════════════════════════════════════
-- Fecha o PONTO CEGO de débito em COR ERRADA (forração/cabedal/palmilha e
-- demais materiais de área resolvidos por grupo+cor). Pedido do dono 2026-06-18.
--
-- ANTES: resolve_material_product, ao não achar a cor pedida, caía no
-- group_fallback = QUALQUER produto ativo do grupo (maior estoque) → o débito
-- (hybrid_debit_stock_for_order) tirava do estoque da COR ERRADA, em silêncio.
--
-- AGORA (2 camadas):
--  1) resolve_material_product distingue:
--       exact_color  → casa a cor (acento/caixa-insensível, igual às tiras)
--       partial_name → cor no nome
--       group_generic→ produto SEM cor no grupo (material não gerido por cor) = OK
--       color_mismatch → grupo TEM cores cadastradas mas NENHUMA casa a pedida
--                        (devolve produto só p/ custeio/UI; NÃO é pra debitar)
--       group_fallback → quando NENHUMA cor foi pedida (comportamento legado)
--  2) hybrid_debit_stock_for_order PULA itens 'color_mismatch' (não reserva nem
--     debita cor errada) e registra o item como 'skipped_color_not_registered'.
--     Não usa RAISE pq o gatilho de criação de OP engole exceção de débito soft
--     (RAISE WARNING) e abortaria TODAS as reservas da OP. Skip = some material
--     fica como ruptura (aparece na conferência) em vez de débito errado.
--
-- Custeio/MRP seguem inalterados (continuam recebendo um product_id; só o
-- LABEL matched_by muda). Tiras já tratavam isto em debit_strap_stock (erro em
-- cor inexistente) — não mexido aqui.
--
-- Timestamp > 20260803120000 (última migration) pra o `db push` não reverter
-- estas redefinições de função (gotcha conhecido de função recorrente).
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.resolve_material_product(
  p_group_name text, p_color text, p_required numeric DEFAULT 0, p_check_stock boolean DEFAULT false)
 RETURNS TABLE(product_id uuid, product_name text, available_qty numeric, matched_by text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_color_norm text;
BEGIN
  IF p_color IS NOT NULL AND p_color <> '' THEN
    v_color_norm := lower(trim(unaccent(p_color)));

    -- 1. Match exato por cor (acento/caixa-insensível — antes era '=' cru)
    RETURN QUERY
    SELECT p.id, p.name, p.quantity, 'exact_color'::text
    FROM products p
    JOIN product_groups pg ON pg.id = p.group_id
    WHERE p.active = true
      AND pg.name = p_group_name
      AND lower(trim(unaccent(COALESCE(p.color, '')))) = v_color_norm
      AND (NOT p_check_stock OR p.quantity >= p_required)
    ORDER BY p.quantity DESC
    LIMIT 1;
    IF FOUND THEN RETURN; END IF;

    -- 2. Match parcial no nome
    RETURN QUERY
    SELECT p.id, p.name, p.quantity, 'partial_name'::text
    FROM products p
    JOIN product_groups pg ON pg.id = p.group_id
    WHERE p.active = true
      AND pg.name = p_group_name
      AND lower(unaccent(p.name)) LIKE '%' || v_color_norm || '%'
      AND (NOT p_check_stock OR p.quantity >= p_required)
    ORDER BY p.quantity DESC
    LIMIT 1;
    IF FOUND THEN RETURN; END IF;

    -- 3. Decisão pelo TIPO do grupo:
    --   - Grupo GERIDO POR COR (tem ≥1 produto com cor): nenhuma casou a cor
    --     pedida → 'color_mismatch' (NÃO debitar cego; só p/ custeio/UI).
    --   - Grupo SEM cores (material genérico): qualquer produto serve →
    --     'group_generic' (OK debitar). Um produto SEM cor solto num grupo
    --     colorido NÃO conta como genérico (senão mascara a cor errada).
    IF EXISTS (
      SELECT 1 FROM products p2
      JOIN product_groups pg2 ON pg2.id = p2.group_id
      WHERE p2.active = true AND pg2.name = p_group_name
        AND p2.color IS NOT NULL AND trim(p2.color) <> ''
    ) THEN
      RETURN QUERY
      SELECT p.id, p.name, p.quantity, 'color_mismatch'::text
      FROM products p
      JOIN product_groups pg ON pg.id = p.group_id
      WHERE p.active = true
        AND pg.name = p_group_name
        AND (NOT p_check_stock OR p.quantity >= p_required)
      ORDER BY p.quantity DESC
      LIMIT 1;
    ELSE
      RETURN QUERY
      SELECT p.id, p.name, p.quantity, 'group_generic'::text
      FROM products p
      JOIN product_groups pg ON pg.id = p.group_id
      WHERE p.active = true
        AND pg.name = p_group_name
        AND (NOT p_check_stock OR p.quantity >= p_required)
      ORDER BY p.quantity DESC
      LIMIT 1;
    END IF;
    RETURN;
  END IF;

  -- Sem cor pedida → fallback do grupo (comportamento legado).
  RETURN QUERY
  SELECT p.id, p.name, p.quantity, 'group_fallback'::text
  FROM products p
  JOIN product_groups pg ON pg.id = p.group_id
  WHERE p.active = true
    AND pg.name = p_group_name
    AND (NOT p_check_stock OR p.quantity >= p_required)
  ORDER BY p.quantity DESC
  LIMIT 1;
END;
$function$;


CREATE OR REPLACE FUNCTION public.hybrid_debit_stock_for_order(
  p_reference_id uuid, p_order_quantity numeric, p_color text, p_order_id uuid,
  p_order_grade jsonb DEFAULT NULL::jsonb, p_force_soft boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_items jsonb;
  v_item jsonb;
  v_pid uuid;
  v_name text;
  v_required numeric;
  v_available numeric;
  v_mode text;
  v_source text;
  v_result jsonb := '[]'::jsonb;
  v_size integer;
  v_snap_id uuid;
  v_soi_id uuid;
  v_sale_order_id uuid;
  v_product record;
  v_sole_handled_by_grade boolean;
  v_already_debited boolean;
  v_eff_grade jsonb;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('hybrid_debit:' || p_order_id::text));

  SELECT EXISTS (
    SELECT 1 FROM public.material_reservations
     WHERE order_id = p_order_id
       AND status <> 'cancelled'
  ) INTO v_already_debited;

  IF v_already_debited THEN
    RETURN jsonb_build_object('snapshot_id', NULL, 'items', '[]'::jsonb, 'idempotent_skip', true);
  END IF;

  v_sole_handled_by_grade := (p_order_grade IS NOT NULL AND jsonb_typeof(p_order_grade) = 'object');

  v_eff_grade := CASE WHEN v_sole_handled_by_grade THEN public.scale_grade_to_total(p_order_grade, p_order_quantity) ELSE p_order_grade END;

  v_size := NULL;
  IF v_sole_handled_by_grade THEN
    SELECT split_part(key, '/', 1)::integer INTO v_size
      FROM jsonb_each_text(v_eff_grade)
     WHERE key ~ '^[0-9]+(/[0-9]+)?$'
     ORDER BY value::numeric DESC
     LIMIT 1;
  END IF;

  SELECT sale_order_id INTO v_sale_order_id FROM public.orders WHERE id = p_order_id;

  IF v_sale_order_id IS NOT NULL THEN
    SELECT id INTO v_soi_id
      FROM public.sale_order_items
     WHERE sale_order_id = v_sale_order_id
       AND reference_id = p_reference_id
       AND COALESCE(color,'') = COALESCE(p_color,'')
     LIMIT 1;
  END IF;

  IF v_sale_order_id IS NOT NULL THEN
    SELECT consumption_snapshot, id INTO v_items, v_snap_id
      FROM public.technical_sheet_snapshots
     WHERE sale_order_id = v_sale_order_id
       AND (sale_order_item_id IS NOT DISTINCT FROM v_soi_id)
     LIMIT 1;
  END IF;

  IF v_items IS NULL THEN
    IF v_sale_order_id IS NOT NULL THEN
      v_snap_id := public.freeze_technical_sheet(
        p_reference_id, v_sale_order_id, v_soi_id, p_color, p_order_quantity, v_size, v_eff_grade
      );
      SELECT consumption_snapshot INTO v_items
        FROM public.technical_sheet_snapshots WHERE id = v_snap_id;
    ELSE
      IF v_sole_handled_by_grade THEN
        v_items := public.calculate_order_consumption_by_grade(p_reference_id, v_eff_grade, p_color);
      ELSE
        SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
          INTO v_items
          FROM public.calculate_order_consumption(p_reference_id, p_order_quantity, p_color, v_size) c;
      END IF;
    END IF;
  END IF;

  -- Pre-flight stock check (apenas itens HARD; soft pula validação inicial pra
  -- permitir reserva mesmo sem stock suficiente — checagem fica pro consume).
  IF NOT p_force_soft THEN
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(v_items) AS value
       ORDER BY value ->> 'product_id'
    LOOP
      -- Cor pedida sem produto cadastrado no grupo → não valida nem debita
      -- (será pulado no laço de débito abaixo).
      IF (v_item ->> 'matched_by') = 'color_mismatch' THEN
        CONTINUE;
      END IF;

      v_pid    := (v_item ->> 'product_id')::uuid;
      v_source := v_item ->> 'source';

      IF v_sole_handled_by_grade AND v_source = 'primary_sole' THEN
        CONTINUE;
      END IF;

      SELECT id, quantity, name INTO v_product
        FROM public.products WHERE id = v_pid FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Produto % do snapshot não encontrado', v_pid;
      END IF;

      v_required := (v_item ->> 'required')::numeric;
      IF v_product.quantity < v_required AND (v_item ->> 'debit_mode') = 'hard' THEN
        RAISE EXCEPTION
          'Estoque insuficiente para % "%": disponível %, necessário %',
          v_item ->> 'component', v_product.name, v_product.quantity, v_required;
      END IF;
    END LOOP;
  END IF;

  -- Aplica débito ou reserva
  FOR v_item IN
    SELECT value FROM jsonb_array_elements(v_items) AS value
     ORDER BY value ->> 'product_id'
  LOOP
    v_pid    := (v_item ->> 'product_id')::uuid;
    v_name   := v_item ->> 'product_name';
    v_required := (v_item ->> 'required')::numeric;
    v_mode   := v_item ->> 'debit_mode';
    v_source := v_item ->> 'source';

    -- ---- PONTO CEGO: cor pedida não cadastrada no grupo ----
    -- NÃO reserva/debita cor errada. Registra como skip pra ficar rastreável
    -- (some como ruptura na conferência, em vez de baixar a cor errada).
    IF (v_item ->> 'matched_by') = 'color_mismatch' THEN
      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name, 'required', v_required,
        'type', 'skipped_color_not_registered',
        'component', v_item ->> 'component', 'color', p_color);
      CONTINUE;
    END IF;

    SELECT quantity INTO v_available FROM public.products WHERE id = v_pid;

    -- ---- BRANCH primary_sole ----
    IF v_sole_handled_by_grade AND v_source = 'primary_sole' THEN
      IF p_force_soft THEN
        v_result := v_result || jsonb_build_object(
          'product_id', v_pid, 'product_name', v_name,
          'required', v_required, 'type', 'sole_deferred_to_grade_soft'
        );
        CONTINUE;
      END IF;

      INSERT INTO public.material_reservations
        (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, metadata)
      VALUES (p_order_id, v_pid, v_required, 0, 'reserved', 'soft',
              jsonb_build_object('kind', 'sole_pending_grade', 'component', v_item->>'component'));

      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name,
        'required', v_required, 'type', 'sole_deferred_to_grade'
      );
      CONTINUE;
    END IF;

    -- ---- BRANCH normal: força soft se p_force_soft=true ----
    IF p_force_soft OR v_mode = 'soft' THEN
      INSERT INTO public.material_reservations
        (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, metadata)
      VALUES (p_order_id, v_pid, v_required, 0, 'reserved', 'soft',
              jsonb_build_object(
                'kind', 'component',
                'component', v_item->>'component',
                'source', v_source,
                'color', p_color
              ));

      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name,
        'required', v_required, 'type', 'reserved'
      );
    ELSE
      -- legacy hard debit
      UPDATE public.products
         SET quantity = GREATEST(0, quantity - v_required), updated_at = now()
       WHERE id = v_pid;

      INSERT INTO public.stock_movements
        (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES
        (v_pid, 'out', v_required, v_available, v_available - v_required,
         'Débito OP ' || COALESCE(v_name,'') ||
         CASE WHEN COALESCE(p_color,'') <> '' THEN ' Cor: ' || p_color ELSE '' END, p_order_id);

      INSERT INTO public.material_reservations
        (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, metadata)
      VALUES (p_order_id, v_pid, v_required, v_required, 'consumed', 'hard',
              jsonb_build_object('kind', 'component', 'component', v_item->>'component'));

      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name,
        'required', v_required, 'type', 'debited'
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('snapshot_id', v_snap_id, 'items', v_result, 'force_soft', p_force_soft);
END;
$function$;
