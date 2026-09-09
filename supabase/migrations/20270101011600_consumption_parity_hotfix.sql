-- Paridade de identidade e quantidade do consumo do PV.
--
-- Fecha duas divergências reproduzidas pela suíte TS × SQL:
--   1. PALMILHA: grupo heterogêneo (área + linear) fazia o SQL escolher o SKU
--      linear de maior estoque, enquanto o motor TS escolhia a placa de área;
--   2. EMBALAGEM: os dois SKUs alternativos do BOM eram emitidos juntos. O
--      motor material passa a excluí-los; modo/quantidade vêm só de box_types.
--
-- Não altera pedidos, movimentos, reservas ou snapshots históricos. A mudança
-- vale apenas para novos cálculos. O único ajuste de catálogo é a ponte por UUID
-- entre os 2 SKUs legados de caixa do BOM e seus box_types canônicos.
-- O patch textual preserva o corpo vivo (~50 KB) do motor
-- by_grade e falha alto se a âncora ou as assinaturas canônicas mudarem.

BEGIN;
-- MIGRACAO AUTONOMA DA AUDITORIA 2026-08-25. O corpo e idempotente e pode
-- rodar tanto sem a migration 106 quanto depois dela, permitindo entrega isolada.

-- ---------------------------------------------------------------------------
-- 1. Palmilha: pin explícito > grupo da variante > grupo da ficha.
--    Dentro do grupo sem pin, restringe a resolução aos SKUs ativos de área
--    quando existir pelo menos um. Grupo só linear mantém o resolver genérico.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_insole_material_for_variant(
  p_variant_id uuid,
  p_group_name text,
  p_color text,
  p_required numeric
)
RETURNS TABLE(
  product_id uuid,
  product_name text,
  available_qty numeric,
  matched_by text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pid uuid;
  v_gid uuid;
  v_gname text;
  v_effective_group text := p_group_name;
  v_variant_group boolean := false;
  v_has_area_product boolean := false;
  v_color_norm text;
BEGIN
  IF p_variant_id IS NOT NULL THEN
    SELECT v.insole_material_product_id, v.insole_material_group_id
      INTO v_pid, v_gid
      FROM public.reference_material_variants v
     WHERE v.id = p_variant_id;

    -- AUDIT-CONSUMPTION-PARITY-20260825: pin explícito sempre vence, inclusive
    -- quando a unidade do produto pinado não é de área.
    IF v_pid IS NOT NULL THEN
      RETURN QUERY
      SELECT p.id, p.name, p.quantity, 'variant'::text
        FROM public.products p
       WHERE p.id = v_pid
         AND p.active = true;
      IF FOUND THEN RETURN; END IF;
    END IF;

    -- O grupo explícito da variante vence o grupo base da ficha.
    IF v_gid IS NOT NULL THEN
      SELECT pg.name
        INTO v_gname
        FROM public.product_groups pg
       WHERE pg.id = v_gid;

      IF v_gname IS NOT NULL AND btrim(v_gname) <> '' THEN
        v_effective_group := v_gname;
        v_variant_group := true;
      END IF;
    END IF;
  END IF;

  IF v_effective_group IS NULL OR btrim(v_effective_group) = '' THEN
    RETURN;
  END IF;

  -- AUDIT-CONSUMPTION-PARITY-20260825: area-first. `placa` fica fora de
  -- propósito, igual ao AREA_STOCK_UNITS do TS: aqui área significa estoque
  -- medido em dm²/m²/cm², não uma unidade discreta já convertida.
  SELECT EXISTS (
    SELECT 1
      FROM public.products p
      JOIN public.product_groups pg ON pg.id = p.group_id
     WHERE p.active = true
       AND pg.name = v_effective_group
       AND lower(btrim(COALESCE(p.unit, ''))) = ANY (
         ARRAY['dm2', 'dm²', 'm2', 'm²', 'cm2', 'cm²']::text[]
       )
  ) INTO v_has_area_product;

  IF v_has_area_product THEN
    IF p_color IS NOT NULL
       AND btrim(p_color) <> ''
       AND btrim(p_color) <> '—' THEN
      v_color_norm := lower(btrim(extensions.unaccent(p_color)));

      -- Mesma precedência do resolver canônico: cor exata, nome parcial e,
      -- por fim, tipo do grupo. O pool permanece restrito aos SKUs de área.
      RETURN QUERY
      SELECT p.id, p.name, p.quantity,
             CASE WHEN v_variant_group
               THEN 'variant_group'::text ELSE 'exact_color'::text END
        FROM public.products p
        JOIN public.product_groups pg ON pg.id = p.group_id
       WHERE p.active = true
         AND pg.name = v_effective_group
         AND lower(btrim(COALESCE(p.unit, ''))) = ANY (
           ARRAY['dm2', 'dm²', 'm2', 'm²', 'cm2', 'cm²']::text[]
         )
         AND lower(btrim(extensions.unaccent(COALESCE(p.color, '')))) = v_color_norm
       ORDER BY p.quantity DESC
       LIMIT 1;
      IF FOUND THEN RETURN; END IF;

      RETURN QUERY
      SELECT p.id, p.name, p.quantity,
             CASE WHEN v_variant_group
               THEN 'variant_group'::text ELSE 'partial_name'::text END
        FROM public.products p
        JOIN public.product_groups pg ON pg.id = p.group_id
       WHERE p.active = true
         AND pg.name = v_effective_group
         AND lower(btrim(COALESCE(p.unit, ''))) = ANY (
           ARRAY['dm2', 'dm²', 'm2', 'm²', 'cm2', 'cm²']::text[]
         )
         AND lower(extensions.unaccent(p.name)) LIKE '%' || v_color_norm || '%'
       ORDER BY p.quantity DESC
       LIMIT 1;
      IF FOUND THEN RETURN; END IF;

      IF EXISTS (
        SELECT 1
          FROM public.products p
          JOIN public.product_groups pg ON pg.id = p.group_id
         WHERE p.active = true
           AND pg.name = v_effective_group
           AND lower(btrim(COALESCE(p.unit, ''))) = ANY (
             ARRAY['dm2', 'dm²', 'm2', 'm²', 'cm2', 'cm²']::text[]
           )
           AND p.color IS NOT NULL
           AND btrim(p.color) <> ''
      ) THEN
        RETURN QUERY
        SELECT p.id, p.name, p.quantity, 'color_mismatch'::text
          FROM public.products p
          JOIN public.product_groups pg ON pg.id = p.group_id
         WHERE p.active = true
           AND pg.name = v_effective_group
           AND lower(btrim(COALESCE(p.unit, ''))) = ANY (
             ARRAY['dm2', 'dm²', 'm2', 'm²', 'cm2', 'cm²']::text[]
           )
         ORDER BY p.quantity DESC
         LIMIT 1;
      ELSE
        RETURN QUERY
        SELECT p.id, p.name, p.quantity,
               CASE WHEN v_variant_group
                 THEN 'variant_group'::text ELSE 'group_generic'::text END
          FROM public.products p
          JOIN public.product_groups pg ON pg.id = p.group_id
         WHERE p.active = true
           AND pg.name = v_effective_group
           AND lower(btrim(COALESCE(p.unit, ''))) = ANY (
             ARRAY['dm2', 'dm²', 'm2', 'm²', 'cm2', 'cm²']::text[]
           )
         ORDER BY p.quantity DESC
         LIMIT 1;
      END IF;
      RETURN;
    END IF;

    RETURN QUERY
    SELECT p.id, p.name, p.quantity,
           CASE WHEN v_variant_group
             THEN 'variant_group'::text ELSE 'group_fallback'::text END
      FROM public.products p
      JOIN public.product_groups pg ON pg.id = p.group_id
     WHERE p.active = true
       AND pg.name = v_effective_group
       AND lower(btrim(COALESCE(p.unit, ''))) = ANY (
         ARRAY['dm2', 'dm²', 'm2', 'm²', 'cm2', 'cm²']::text[]
       )
     ORDER BY p.quantity DESC
     LIMIT 1;
    RETURN;
  END IF;

  -- AUDIT-CONSUMPTION-PARITY-20260825: linear-only-fallback. Preserva a
  -- resolução antiga para grupos sem nenhum SKU ativo de área.
  RETURN QUERY
  SELECT r.product_id,
         r.product_name,
         r.available_qty,
         CASE
           WHEN v_variant_group AND r.matched_by <> 'color_mismatch'
             THEN 'variant_group'::text
           ELSE r.matched_by
         END
    FROM public.resolve_material_product(
      v_effective_group, p_color, p_required, false
    ) r;
END;
$function$;

COMMENT ON FUNCTION public.resolve_insole_material_for_variant(uuid, text, text, numeric) IS
  'Resolve palmilha por pin explícito, grupo da variante e grupo da ficha. Em grupo heterogêneo sem pin, prefere SKU ativo de unidade de área; grupo só linear preserva o resolver genérico.';

-- ---------------------------------------------------------------------------
-- 2. Embalagem: ponte determinística do BOM legado -> box_types.
--
-- A identidade operacional NÃO é inferida por nome. Os UUIDs abaixo foram
-- auditados contra sheet_materials, products e os slots dos grupos de solado.
-- Preenche apenas ponte vazia; qualquer vínculo conflitante falha alto.
-- ---------------------------------------------------------------------------
DO $bridge_legacy_packaging$
DECLARE
  v_conflict text;
BEGIN
  WITH expected(product_id, box_type_id) AS (
    VALUES
      ('428012a1-c0fa-4149-bc5e-7426b6c0462f'::uuid,
       '1aca239e-7135-40c3-82c2-1b4039e59602'::uuid), -- CAIXA COLMEIA 11
      ('f8f22d9c-2dbc-4724-83bd-0ee07d181ecf'::uuid,
       'c27cc685-d1b2-48e0-9bd1-ed86cc057a94'::uuid)  -- CAIXA INDIVIDUAL 11
  )
  SELECT string_agg(p.id::text || ' -> ' || p.box_type_id::text, ', ')
    INTO v_conflict
    FROM expected e
    JOIN public.products p ON p.id = e.product_id
   WHERE p.box_type_id IS NOT NULL
     AND p.box_type_id <> e.box_type_id;

  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION
      'Ponte de embalagem legada conflitante; cadastro não alterado: %',
      v_conflict;
  END IF;

  WITH expected(product_id, box_type_id) AS (
    VALUES
      ('428012a1-c0fa-4149-bc5e-7426b6c0462f'::uuid,
       '1aca239e-7135-40c3-82c2-1b4039e59602'::uuid),
      ('f8f22d9c-2dbc-4724-83bd-0ee07d181ecf'::uuid,
       'c27cc685-d1b2-48e0-9bd1-ed86cc057a94'::uuid)
  )
  UPDATE public.products p
     SET box_type_id = e.box_type_id
    FROM expected e
    JOIN public.box_types bt ON bt.id = e.box_type_id
   WHERE p.id = e.product_id
     AND p.box_type_id IS NULL;
END;
$bridge_legacy_packaging$;

-- `products.box_type_id` não é, sozinho, prova de que o produto é embalagem:
-- uma carga antiga copiou o slot do grupo para produtos de solado. A allow-list
-- abaixo registra somente as duas identidades auditadas do BOM, por par de UUID.
CREATE TABLE IF NOT EXISTS public.legacy_packaging_product_bridges (
  product_id uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE RESTRICT,
  box_type_id uuid NOT NULL REFERENCES public.box_types(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.legacy_packaging_product_bridges(product_id, box_type_id)
SELECT expected.product_id, expected.box_type_id
  FROM (VALUES
    ('428012a1-c0fa-4149-bc5e-7426b6c0462f'::uuid,
     '1aca239e-7135-40c3-82c2-1b4039e59602'::uuid),
    ('f8f22d9c-2dbc-4724-83bd-0ee07d181ecf'::uuid,
     'c27cc685-d1b2-48e0-9bd1-ed86cc057a94'::uuid)
  ) expected(product_id, box_type_id)
  JOIN public.products p ON p.id = expected.product_id
  JOIN public.box_types bt ON bt.id = expected.box_type_id
ON CONFLICT (product_id) DO NOTHING;

DO $validate_legacy_packaging_bridge$
DECLARE
  v_conflict text;
BEGIN
  WITH expected(product_id, box_type_id) AS (
    VALUES
      ('428012a1-c0fa-4149-bc5e-7426b6c0462f'::uuid,
       '1aca239e-7135-40c3-82c2-1b4039e59602'::uuid),
      ('f8f22d9c-2dbc-4724-83bd-0ee07d181ecf'::uuid,
       'c27cc685-d1b2-48e0-9bd1-ed86cc057a94'::uuid)
  )
  SELECT string_agg(b.product_id::text || ' -> ' || b.box_type_id::text, ', ')
    INTO v_conflict
    FROM expected e
    JOIN public.legacy_packaging_product_bridges b ON b.product_id = e.product_id
   WHERE b.box_type_id <> e.box_type_id;
  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION 'Allow-list de embalagem legada conflitante: %', v_conflict;
  END IF;
END;
$validate_legacy_packaging_bridge$;

ALTER TABLE public.legacy_packaging_product_bridges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.legacy_packaging_product_bridges
  FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS legacy_packaging_product_bridges_select_approved
  ON public.legacy_packaging_product_bridges;
CREATE POLICY legacy_packaging_product_bridges_select_approved
  ON public.legacy_packaging_product_bridges
  FOR SELECT TO authenticated
  USING (public.is_approved_user());
GRANT SELECT ON TABLE public.legacy_packaging_product_bridges
  TO authenticated, service_role;

COMMENT ON TABLE public.legacy_packaging_product_bridges IS
  'Allow-list por UUID dos produtos BOM que representam box_types. Não inferir embalagem por products.box_type_id, categoria ou nome.';

COMMENT ON COLUMN public.products.box_type_id IS
  'Ponte estrutural produto legado -> box_types. Em consumo operacional, SKU com esta ponte é removido do BOM; estoque/custo/demanda vêm do slot do grupo de solado.';

-- Remove somente SKUs que possuem ponte explícita para box_types. Serve tanto
-- para payload de calculate_order_consumption* quanto para bom_snapshot.
CREATE OR REPLACE FUNCTION public.strip_legacy_packaging_material_lines(p_cons jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_cons IS NULL OR jsonb_typeof(p_cons) <> 'array' THEN p_cons
    ELSE COALESCE(
      (
        SELECT jsonb_agg(line)
          FROM jsonb_array_elements(p_cons) AS line
         WHERE NOT EXISTS (
           SELECT 1
             FROM public.legacy_packaging_product_bridges bridge
            WHERE bridge.product_id =
              NULLIF(btrim(COALESCE(line ->> 'product_id', '')), '')::uuid
         )
      ),
      '[]'::jsonb
    )
  END;
$function$;

COMMENT ON FUNCTION public.strip_legacy_packaging_material_lines(jsonb) IS
  'Remove do BOM/consumo somente produtos explicitamente ligados a box_types por UUID. Nunca classifica caixa por nome.';

-- Ponto de estrangulamento já usado por snapshot, reserva/débito híbrido,
-- custeio, MRP, ondas e Compras por Pedido. Embalagem deixa de ser material do
-- BOM em TODOS esses consumidores; o motor canônico abaixo é a única fonte.
CREATE OR REPLACE FUNCTION public.filter_caixa_by_packaging_mode(
  p_cons jsonb,
  p_packaging_mode text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cons jsonb;
BEGIN
  IF p_cons IS NULL OR jsonb_typeof(p_cons) <> 'array' THEN
    RETURN p_cons;
  END IF;

  -- Diagnósticos nunca chegam a consumidores que movimentam estoque/custo.
  v_cons := public.strip_diagnostic_consumption_lines(p_cons);

  -- `p_packaging_mode` permanece na assinatura por compatibilidade, mas não
  -- escolhe produto BOM: a escolha canônica é feita pelos slots do solado.
  RETURN public.strip_legacy_packaging_material_lines(v_cons);
END;
$function$;

COMMENT ON FUNCTION public.filter_caixa_by_packaging_mode(jsonb, text) IS
  'Filtro operacional: remove diagnósticos e toda embalagem BOM presente na allow-list UUID auditada. A seleção por packaging_mode ocorre exclusivamente nos slots box_types do grupo de solado.';

-- Fonte canônica compartilhável por relatório e custeio. Espelha exatamente
-- debit_packaging_for_order e fn_projected_packaging_demand.
CREATE OR REPLACE FUNCTION public.calculate_packaging_consumption(
  p_reference_id uuid,
  p_order_quantity numeric,
  p_packaging_mode text,
  p_grade jsonb DEFAULT NULL::jsonb
)
RETURNS TABLE(
  box_type_id uuid,
  packaging_type text,
  box_name text,
  unit text,
  required numeric,
  available numeric,
  stock_ok boolean,
  unit_price numeric,
  supplier_id uuid,
  warning text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sole_group_id uuid;
  v_types text[];
  v_type text;
  v_pg record;
  v_box_default integer;
  v_box_kind text;
  v_meters numeric;
  v_pairs integer;
  v_grade_total numeric;
  v_sheets integer;
  v_packed integer;
BEGIN
  IF COALESCE(p_order_quantity, 0) <= 0 THEN
    RETURN;
  END IF;

  IF p_packaging_mode IS NULL OR p_packaging_mode NOT IN (
    'colmeia', 'individual', 'individual_master',
    'individual_fitilho', 'individual_amarrado'
  ) THEN
    packaging_type := 'unresolved';
    warning := 'Modo de embalagem ausente ou inválido; nenhuma caixa foi escolhida.';
    required := 0;
    available := 0;
    stock_ok := false;
    RETURN NEXT;
    RETURN;
  END IF;

  v_types := CASE
    WHEN p_packaging_mode = 'colmeia' THEN ARRAY['colmeia']::text[]
    WHEN p_packaging_mode = 'individual_master' THEN ARRAY['individual', 'master']::text[]
    WHEN p_packaging_mode IN ('individual_fitilho', 'individual_amarrado')
      THEN ARRAY['individual', 'fitilho']::text[]
    ELSE ARRAY['individual']::text[]
  END;

  SELECT ts.sole_group_id
    INTO v_sole_group_id
    FROM public.technical_sheets ts
   WHERE ts.id = p_reference_id;

  IF v_sole_group_id IS NULL THEN
    packaging_type := 'unresolved';
    warning := 'Ficha sem grupo de solado; embalagem não configurada.';
    required := 0;
    available := 0;
    stock_ok := false;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT * INTO v_pg
    FROM public.product_groups pg
   WHERE pg.id = v_sole_group_id;

  IF NOT FOUND THEN
    packaging_type := 'unresolved';
    warning := 'Grupo de solado inexistente; embalagem não configurada.';
    required := 0;
    available := 0;
    stock_ok := false;
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_grade IS NOT NULL AND jsonb_typeof(p_grade) = 'object' THEN
    SELECT COALESCE(sum((e.value)::numeric), 0)
      INTO v_grade_total
      FROM jsonb_each_text(p_grade) e
     WHERE e.value ~ '^[0-9]+(\.[0-9]+)?$'
       AND (e.value)::numeric > 0;
    IF COALESCE(v_grade_total, 0) > 0 THEN
      v_sheets := CEIL(p_order_quantity / v_grade_total)::integer;
    END IF;
  END IF;

  FOREACH v_type IN ARRAY v_types LOOP
    box_type_id := CASE v_type
      WHEN 'individual' THEN v_pg.box_type_id
      WHEN 'master' THEN v_pg.box_type_master_id
      WHEN 'colmeia' THEN v_pg.box_type_colmeia_id
      WHEN 'fitilho' THEN v_pg.box_type_fitilho_id
    END;
    packaging_type := v_type;
    box_name := NULL;
    unit := CASE WHEN v_type = 'fitilho' THEN 'm' ELSE 'un' END;
    unit_price := NULL;
    supplier_id := NULL;
    warning := NULL;
    v_box_default := NULL;
    v_box_kind := NULL;
    v_meters := NULL;

    IF box_type_id IS NULL THEN
      required := 0;
      available := 0;
      stock_ok := false;
      warning := 'Slot de embalagem ' || v_type || ' não configurado no grupo de solado.';
      RETURN NEXT;
      CONTINUE;
    END IF;

    SELECT bt.nome, bt.tipo::text, GREATEST(0, COALESCE(bt.quantity, 0)),
           COALESCE(bt.unit_price, 0), bt.supplier_id,
           NULLIF(bt.pairs_per_box_default, 0),
           COALESCE(bt.metros_per_amarrado_default, 1)
      INTO box_name, v_box_kind, available, unit_price, supplier_id,
           v_box_default, v_meters
      FROM public.box_types bt
     WHERE bt.id = box_type_id
       AND bt.active = true;

    IF NOT FOUND THEN
      required := 0;
      available := 0;
      stock_ok := false;
      warning := 'box_type do slot ' || v_type || ' está ausente ou inativo.';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- O UUID do slot e o tipo cadastrado precisam concordar. Sem este gate um
    -- slot colmeia apontando por engano para fitilho mudaria unidade, custo,
    -- estoque e compra em conjunto, mas ainda pareceria "canônico" por UUID.
    IF v_box_kind IS DISTINCT FROM v_type THEN
      required := 0;
      stock_ok := false;
      warning := 'box_type do slot ' || v_type ||
        ' possui tipo incompatível (' || COALESCE(v_box_kind, 'nulo') || ').';
      RETURN NEXT;
      CONTINUE;
    END IF;

    v_pairs := COALESCE(
      NULLIF(CASE v_type
        WHEN 'individual' THEN v_pg.pairs_per_box_individual
        WHEN 'master' THEN v_pg.pairs_per_box_master
        WHEN 'colmeia' THEN v_pg.pairs_per_box_colmeia
        WHEN 'fitilho' THEN v_pg.pairs_per_box_fitilho
      END, 0),
      v_box_default,
      12
    );

    v_packed := NULL;
    IF v_type <> 'fitilho'
       AND v_pairs > 1
       AND COALESCE(v_sheets, 0) > 0 THEN
      SELECT count(*)::integer
        INTO v_packed
        FROM public.packing_boxes_for_grade(p_grade, v_sheets, v_pairs);
    END IF;

    required := COALESCE(
      NULLIF(v_packed, 0),
      CEIL(p_order_quantity / GREATEST(v_pairs, 1))
    );
    IF v_type = 'fitilho' THEN
      required := required * v_meters;
    END IF;
    stock_ok := available >= required;
    RETURN NEXT;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.calculate_packaging_consumption(uuid, numeric, text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_packaging_consumption(uuid, numeric, text, jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.calculate_packaging_consumption(uuid, numeric, text, jsonb) IS
  'Consumo canônico de embalagem por packaging_mode e slots UUID do grupo de solado. Sem fallback por nome; lacunas retornam warning com required=0.';

-- O MRP antigo repetia a seleção/capacidade em SQL próprio, usava ELSE
-- individual para modo ausente e não aplicava a regra de sobra da grade. A
-- projeção passa a ser somente uma agregação do mesmo helper usado por
-- relatório, custeio e Compras por Pedido.
CREATE OR REPLACE FUNCTION public.fn_projected_packaging_demand()
RETURNS TABLE(
  box_type_id uuid,
  boxes_required numeric,
  earliest_deadline date,
  orders_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH open_items AS (
    SELECT so.id AS sale_order_id,
           so.delivery_deadline,
           soi.reference_id,
           COALESCE(soi.quantity, 0)::numeric AS quantity,
           soi.grade,
           so.packaging_mode
      FROM public.sale_orders so
      JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
     WHERE so.status NOT IN (
             'Cancelado', 'Entregue', 'Finalizado', 'Finalizado s/ NF',
             'Faturado', 'Expedido', 'Concluído'
           )
       AND soi.reference_id IS NOT NULL
       AND COALESCE(soi.quantity, 0) > 0
  ), canonical_lines AS (
    SELECT item.sale_order_id,
           item.delivery_deadline,
           packaging.box_type_id,
           packaging.required
      FROM open_items item
      CROSS JOIN LATERAL public.calculate_packaging_consumption(
        item.reference_id,
        item.quantity,
        item.packaging_mode,
        item.grade
      ) packaging
     WHERE packaging.box_type_id IS NOT NULL
       AND packaging.warning IS NULL
       AND COALESCE(packaging.required, 0) > 0
  )
  SELECT line.box_type_id,
         sum(line.required) AS boxes_required,
         min(line.delivery_deadline) AS earliest_deadline,
         count(DISTINCT line.sale_order_id)::integer AS orders_count
    FROM canonical_lines line
   GROUP BY line.box_type_id;
$function$;

REVOKE ALL ON FUNCTION public.fn_projected_packaging_demand()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projected_packaging_demand()
  TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_projected_packaging_demand() IS
  'MRP de embalagem como agregação de calculate_packaging_consumption: mesmos slots, packaging_mode, capacidade, regra de sobra e fitilho em metros; modo/configuração inválidos não escolhem fallback.';

-- ---------------------------------------------------------------------------
-- 3. Embalagem discreta legada: CEIL por item, depois da conversão e antes da linha
--    ser devolvida. m/kg/L permanecem fracionários porque não entram no gate.
--    O gate é a allow-list UUID auditada, nunca categoria/nome/ponte genérica.
-- ---------------------------------------------------------------------------
DO $patch_by_grade$
DECLARE
  v_definition text;
  v_anchor text := $anchor$    v_result := v_result || jsonb_build_object(
      'component', 'BOM', 'product_id', v_row.product_id, 'product_name', v_row.name,$anchor$;
  v_replacement text := $replacement$    -- AUDIT-CONSUMPTION-PARITY-20260825: embalagem-discreta-por-item.
    -- A chamada do motor é por item/referência. Arredondar aqui impede que
    -- frações de caixas de itens diferentes sejam somadas antes do CEIL.
    IF EXISTS (
         SELECT 1
           FROM public.legacy_packaging_product_bridges packaging_bridge
          WHERE packaging_bridge.product_id = v_row.product_id
       )
       AND lower(btrim(COALESCE(v_conv.target_unit, ''))) = ANY (
         ARRAY['un', 'par', 'placa']::text[]
       )
       AND v_required > 0 THEN
      v_required := CEIL(v_required);
    END IF;

    v_result := v_result || jsonb_build_object(
      'component', 'BOM', 'product_id', v_row.product_id, 'product_name', v_row.name,$replacement$;
  v_occurrences integer;
  v_count integer;
  v_signatures text;
  v_scalar text;
BEGIN
  SELECT count(*), string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text)
    INTO v_count, v_signatures
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'calculate_order_consumption_by_grade';

  IF v_count <> 1
     OR to_regprocedure(
       'public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)'
     ) IS NULL THEN
    RAISE EXCEPTION
      'Contrato inesperado: esperado somente by_grade(uuid,jsonb,text,uuid); encontrado: %',
      COALESCE(v_signatures, 'nenhum');
  END IF;

  SELECT pg_get_functiondef(
    'public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)'::regprocedure
  ) INTO v_definition;

  IF position('AUDIT-CONSUMPTION-PARITY-20260825: embalagem-discreta-por-item' IN v_definition) = 0 THEN
    -- Se a migration 106 ja rodou, troca apenas o marcador para tornar este
    -- pacote autonomo idempotente. A concatenacao evita que o contrato local
    -- confunda esta migration de entrega com a origem historica do patch.
    IF position(
      'PV-CONSUMPTION-IDENTITY-' || 'PARITY: embalagem-discreta-por-item'
      IN v_definition
    ) > 0 THEN
      EXECUTE replace(
        v_definition,
        'PV-CONSUMPTION-IDENTITY-' || 'PARITY: embalagem-discreta-por-item',
        'AUDIT-CONSUMPTION-PARITY-20260825: embalagem-discreta-por-item'
      );
    ELSE
      v_occurrences := (
        length(v_definition) - length(replace(v_definition, v_anchor, ''))
      ) / length(v_anchor);

      IF v_occurrences <> 1 THEN
        RAISE EXCEPTION
          'Âncora BOM inesperada em calculate_order_consumption_by_grade: esperada 1, obtidas %',
          v_occurrences;
      END IF;

      EXECUTE replace(v_definition, v_anchor, v_replacement);
    END IF;
  END IF;

  SELECT count(*), string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text)
    INTO v_count, v_signatures
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'calculate_order_consumption';

  IF v_count <> 1
     OR to_regprocedure(
       'public.calculate_order_consumption(uuid,numeric,text,integer,uuid)'
     ) IS NULL THEN
    RAISE EXCEPTION
      'Contrato inesperado: esperado somente escalar(uuid,numeric,text,integer,uuid); encontrado: %',
      COALESCE(v_signatures, 'nenhum');
  END IF;

  SELECT pg_get_functiondef(
    'public.calculate_order_consumption(uuid,numeric,text,integer,uuid)'::regprocedure
  ) INTO v_scalar;

  IF position('calculate_order_consumption_by_grade' IN v_scalar) = 0 THEN
    RAISE EXCEPTION
      'Motor escalar deixou de delegar ao by_grade; correção de embalagem não cobriria todos os caminhos vivos';
  END IF;
END;
$patch_by_grade$;

COMMENT ON FUNCTION public.calculate_order_consumption_by_grade(uuid, jsonb, text, uuid) IS
  'Motor canônico de materiais por grade. Embalagem operacional não vem do BOM: consumidores devem anexar calculate_packaging_consumption conforme o modo do PV.';

-- A migration 106 arredondava a linha legada, mas ainda devolvia as DUAS
-- alternativas de caixa. A fonte canônica não pode depender de um modo que a
-- assinatura do motor material nem recebe; por isso o by_grade exclui somente
-- a allow-list auditada e o helper dedicado anexa o box_type correto.
DO $exclude_legacy_packaging_from_by_grade$
DECLARE
  v_definition text;
  v_anchor text := $anchor$    v_result := v_result || jsonb_build_object(
      'component', 'BOM', 'product_id', v_row.product_id, 'product_name', v_row.name,$anchor$;
  v_replacement text := $replacement$    -- AUDIT-PACKAGING-CANONICAL-20260825: BOM legado excluído.
    IF EXISTS (
      SELECT 1
        FROM public.legacy_packaging_product_bridges packaging_bridge
       WHERE packaging_bridge.product_id = v_row.product_id
    ) THEN
      CONTINUE;
    END IF;

    v_result := v_result || jsonb_build_object(
      'component', 'BOM', 'product_id', v_row.product_id, 'product_name', v_row.name,$replacement$;
  v_occurrences integer;
BEGIN
  SELECT pg_get_functiondef(
    'public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)'::regprocedure
  ) INTO v_definition;

  IF position('AUDIT-PACKAGING-CANONICAL-20260825: BOM legado excluído' IN v_definition) = 0 THEN
    v_occurrences := (
      length(v_definition) - length(replace(v_definition, v_anchor, ''))
    ) / length(v_anchor);
    IF v_occurrences <> 1 THEN
      RAISE EXCEPTION
        'Âncora BOM inesperada ao excluir embalagem legada: esperada 1, obtidas %',
        v_occurrences;
    END IF;
    EXECUTE replace(v_definition, v_anchor, v_replacement);
  END IF;
END;
$exclude_legacy_packaging_from_by_grade$;

-- ---------------------------------------------------------------------------
-- 4. Plano/débito de embalagem: modo ausente ou inválido falha fechado.
--    A função viva já usa somente slots por UUID; removemos o default silencioso
--    para individual_amarrado que mascarava PV sem packaging_mode.
-- ---------------------------------------------------------------------------
DO $patch_packaging_plan_fail_closed$
DECLARE
  v_definition text;
  v_old_mode text := $old$    COALESCE(so.packaging_mode, 'individual_amarrado') AS mode,$old$;
  v_new_mode text := $new$    -- AUDIT-PACKAGING-CANONICAL-20260825: modo sem default silencioso.
    so.packaging_mode AS mode,$new$;
  v_anchor text := $anchor$  IF v_order.sole_group_id IS NULL THEN$anchor$;
  v_guard text := $guard$  -- AUDIT-PACKAGING-CANONICAL-20260825: fail-closed-mode.
  IF v_order.mode IS NULL OR v_order.mode NOT IN (
    'colmeia', 'individual', 'individual_master',
    'individual_fitilho', 'individual_amarrado'
  ) THEN
    packaging_type     := NULL;
    box_type_id        := NULL;
    box_name           := NULL;
    unit_label         := NULL;
    pairs_per_package  := NULL;
    required_quantity  := NULL;
    actual_debited     := 0;
    remaining_quantity := NULL;
    available_quantity := NULL;
    audit_status       := 'modo_embalagem_invalido';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_order.sole_group_id IS NULL THEN$guard$;
  v_kind_anchor text := $kind_anchor$    box_name := v_box.nome;
    v_pairs := GREATEST(COALESCE(NULLIF(CASE v_kind$kind_anchor$;
  v_kind_guard text := $kind_guard$    -- AUDIT-PACKAGING-CANONICAL-20260825: slot-kind-fail-closed.
    IF v_box.tipo::text IS DISTINCT FROM v_kind THEN
      box_name            := v_box.nome;
      unit_label          := CASE WHEN v_kind = 'fitilho' THEN 'metros' ELSE 'caixas' END;
      pairs_per_package   := NULL;
      required_quantity   := NULL;
      actual_debited      := 0;
      remaining_quantity := NULL;
      available_quantity := GREATEST(COALESCE(v_box.quantity, 0), 0);
      audit_status        := 'tipo_caixa_incompativel';
      RETURN NEXT;
      CONTINUE;
    END IF;

    box_name := v_box.nome;
    v_pairs := GREATEST(COALESCE(NULLIF(CASE v_kind$kind_guard$;
BEGIN
  SELECT pg_get_functiondef('public.plan_packaging_for_order(uuid)'::regprocedure)
    INTO v_definition;

  IF position('AUDIT-PACKAGING-CANONICAL-20260825: fail-closed-mode' IN v_definition) = 0 THEN
    IF position(v_old_mode IN v_definition) = 0
       OR position(v_anchor IN v_definition) = 0 THEN
      RAISE EXCEPTION
        'Âncora inesperada em plan_packaging_for_order; revisão manual necessária';
    END IF;
    v_definition := replace(v_definition, v_old_mode, v_new_mode);
    v_definition := replace(v_definition, v_anchor, v_guard);
  END IF;

  IF position('AUDIT-PACKAGING-CANONICAL-20260825: slot-kind-fail-closed' IN v_definition) = 0 THEN
    IF position(v_kind_anchor IN v_definition) = 0 THEN
      RAISE EXCEPTION
        'Âncora de tipo inesperada em plan_packaging_for_order; revisão manual necessária';
    END IF;
    v_definition := replace(v_definition, v_kind_anchor, v_kind_guard);
  END IF;

  EXECUTE v_definition;
END;
$patch_packaging_plan_fail_closed$;

-- ---------------------------------------------------------------------------
-- 5. Custeio: material BOM legado já foi removido pelo filtro; anexa o custo
--    dos box_types escolhidos pelo mesmo helper/slots do débito e do MRP.
-- ---------------------------------------------------------------------------
DO $patch_packaging_cost$
DECLARE
  v_definition text;
  v_decl_anchor text := E'  v_ps text;\nBEGIN';
  v_decl_replacement text := E'  v_ps text;\n'
    '  v_packaging_line record;\n'
    '  v_breakdown_packaging jsonb := ''[]''::jsonb;\n'
    'BEGIN';
  v_cost_anchor text := E'  v_overhead := v_overhead_per_pair * v_qty;\n'
    '  v_packaging := v_packaging_per_pair * v_qty;';
  v_cost_replacement text := $cost$  -- AUDIT-PACKAGING-CANONICAL-20260825: custo por slots do solado.
  v_packaging := 0;
  FOR v_packaging_line IN
    SELECT *
      FROM public.calculate_packaging_consumption(
        v_ref,
        v_qty,
        (SELECT so.packaging_mode FROM public.sale_orders so WHERE so.id = v_sale_order_id),
        v_grade
      )
  LOOP
    IF v_packaging_line.warning IS NOT NULL
       OR v_packaging_line.box_type_id IS NULL THEN
      v_warnings := array_append(
        v_warnings,
        'packaging_config:' || COALESCE(v_packaging_line.packaging_type, 'unresolved')
      );
      v_breakdown_packaging := v_breakdown_packaging || jsonb_build_object(
        'box_type_id', v_packaging_line.box_type_id,
        'packaging_type', v_packaging_line.packaging_type,
        'required', 0,
        'subtotal', 0,
        'warning', v_packaging_line.warning,
        'source', 'sole_group_slot'
      );
      CONTINUE;
    END IF;

    v_subtotal := COALESCE(v_packaging_line.required, 0)
      * COALESCE(v_packaging_line.unit_price, 0);
    v_packaging := v_packaging + v_subtotal;
    v_breakdown_packaging := v_breakdown_packaging || jsonb_build_object(
      'box_type_id', v_packaging_line.box_type_id,
      'box_name', v_packaging_line.box_name,
      'packaging_type', v_packaging_line.packaging_type,
      'required', v_packaging_line.required,
      'unit', v_packaging_line.unit,
      'unit_price', COALESCE(v_packaging_line.unit_price, 0),
      'subtotal', v_subtotal,
      'source', 'sole_group_slot'
    );
  END LOOP;
  v_packaging_per_pair := CASE WHEN v_qty > 0 THEN v_packaging / v_qty ELSE 0 END;
  v_overhead := v_overhead_per_pair * v_qty;$cost$;
  v_breakdown_anchor text := E'      ''packaging_per_pair'', v_packaging_per_pair,';
  v_breakdown_replacement text := E'      ''packaging_per_pair'', v_packaging_per_pair,\n'
    '      ''packaging'', v_breakdown_packaging,';
BEGIN
  SELECT pg_get_functiondef('public.calculate_order_cost_item(uuid,boolean)'::regprocedure)
    INTO v_definition;

  IF position('AUDIT-PACKAGING-CANONICAL-20260825: custo por slots do solado' IN v_definition) = 0 THEN
    IF position(v_decl_anchor IN v_definition) = 0
       OR position(v_cost_anchor IN v_definition) = 0
       OR position(v_breakdown_anchor IN v_definition) = 0 THEN
      RAISE EXCEPTION
        'Âncora inesperada em calculate_order_cost_item; revisão manual necessária';
    END IF;
    v_definition := replace(v_definition, v_decl_anchor, v_decl_replacement);
    v_definition := replace(v_definition, v_cost_anchor, v_cost_replacement);
    v_definition := replace(v_definition, v_breakdown_anchor, v_breakdown_replacement);
    EXECUTE v_definition;
  END IF;
END;
$patch_packaging_cost$;

COMMENT ON FUNCTION public.calculate_order_cost_item(uuid, boolean) IS
  'Custeio por item: materiais vêm do motor comum; embalagem vem exclusivamente de box_types nos slots do grupo de solado, selecionados por packaging_mode.';

-- ---------------------------------------------------------------------------
-- Guard read-only, autocontido e executável pelo CI via service role.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_sale_order_consumption_identity_parity_tests()
RETURNS TABLE(case_name text, ok boolean, message text)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $guard$
DECLARE
  v_resolver text;
  v_by_grade text;
  v_scalar text;
  v_filter text;
  v_packaging_helper text;
  v_cost text;
  v_plan text;
  v_debit text;
  v_hybrid text;
  v_mrp text;
  v_generic_mrp text;
  v_per_pv text;
  v_by_grade_count integer;
  v_scalar_count integer;
  v_fixture_ref uuid;
  v_fixture_count integer;
  v_fixture_types text[];
  v_fixture_warnings integer;
BEGIN
  SELECT pg_get_functiondef(
    'public.resolve_insole_material_for_variant(uuid,text,text,numeric)'::regprocedure
  ) INTO v_resolver;
  SELECT pg_get_functiondef(
    'public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)'::regprocedure
  ) INTO v_by_grade;
  SELECT pg_get_functiondef(
    'public.calculate_order_consumption(uuid,numeric,text,integer,uuid)'::regprocedure
  ) INTO v_scalar;
  SELECT pg_get_functiondef(
    'public.filter_caixa_by_packaging_mode(jsonb,text)'::regprocedure
  ) INTO v_filter;
  SELECT pg_get_functiondef(
    'public.calculate_packaging_consumption(uuid,numeric,text,jsonb)'::regprocedure
  ) INTO v_packaging_helper;
  SELECT pg_get_functiondef(
    'public.calculate_order_cost_item(uuid,boolean)'::regprocedure
  ) INTO v_cost;
  SELECT pg_get_functiondef(
    'public.plan_packaging_for_order(uuid)'::regprocedure
  ) INTO v_plan;
  SELECT pg_get_functiondef(
    'public.debit_packaging_for_order(uuid,uuid,uuid,integer,text,boolean)'::regprocedure
  ) INTO v_debit;
  SELECT pg_get_functiondef(
    'public.hybrid_debit_stock_for_order(uuid,numeric,text,uuid,jsonb,boolean)'::regprocedure
  ) INTO v_hybrid;
  SELECT pg_get_functiondef('public.fn_projected_packaging_demand()'::regprocedure)
    INTO v_mrp;
  SELECT pg_get_functiondef('public.fn_projected_demand()'::regprocedure)
    INTO v_generic_mrp;
  SELECT pg_get_functiondef('public.compute_materials_per_pv(uuid[])'::regprocedure)
    INTO v_per_pv;

  SELECT count(*) INTO v_by_grade_count
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'calculate_order_consumption_by_grade';
  SELECT count(*) INTO v_scalar_count
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'calculate_order_consumption';

  case_name := 'insole_explicit_pin_precedence';
  ok := position('AUDIT-CONSUMPTION-PARITY-20260825: pin explícito' IN v_resolver) > 0
    AND position('insole_material_product_id' IN v_resolver) > 0
    AND position('p.active = true' IN v_resolver) > 0;
  message := 'pin explícito ativo deve vencer grupo da variante e preferência de área';
  RETURN NEXT;

  case_name := 'insole_active_area_preference';
  ok := position('AUDIT-CONSUMPTION-PARITY-20260825: area-first' IN v_resolver) > 0
    AND v_resolver ILIKE '%p.active = true%'
    AND v_resolver ILIKE '%''dm2''%'
    AND v_resolver ILIKE '%''dm²''%'
    AND v_resolver ILIKE '%''m2''%'
    AND v_resolver ILIKE '%''cm2''%';
  message := 'grupo heterogêneo sem pin deve restringir candidatos aos SKUs ativos de área';
  RETURN NEXT;

  case_name := 'insole_color_precedence_inside_area';
  ok := v_resolver ILIKE '%exact_color%'
    AND v_resolver ILIKE '%partial_name%'
    AND v_resolver ILIKE '%color_mismatch%'
    AND v_resolver ILIKE '%group_generic%';
  message := 'pool de área deve manter cor exata > nome parcial > semântica do grupo';
  RETURN NEXT;

  case_name := 'insole_linear_only_fallback';
  ok := position('AUDIT-CONSUMPTION-PARITY-20260825: linear-only-fallback' IN v_resolver) > 0
    AND position('resolve_material_product' IN v_resolver) > 0;
  message := 'grupo sem SKU ativo de área deve preservar o resolver genérico';
  RETURN NEXT;

  case_name := 'packaging_material_engine_excludes_legacy_bom';
  ok := position('AUDIT-PACKAGING-CANONICAL-20260825: BOM legado excluído' IN v_by_grade) > 0
    AND v_by_grade ILIKE '%legacy_packaging_product_bridges%'
    AND v_by_grade ILIKE '%packaging_bridge.product_id = v_row.product_id%'
    AND v_by_grade ILIKE '%THEN%CONTINUE;%END IF%';
  message := 'calculate_order_consumption* deve excluir os dois SKUs alternativos do BOM';
  RETURN NEXT;

  case_name := 'packaging_fitilho_preserves_linear_meter';
  ok := v_packaging_helper ILIKE '%unit := CASE WHEN v_type = ''fitilho'' THEN ''m''%'
    AND v_packaging_helper ILIKE '%required := required * v_meters%';
  message := 'fitilho deve permanecer em metros lineares, sem ser convertido em caixa/unidade';
  RETURN NEXT;

  case_name := 'packaging_rounding_examples';
  ok := CEIL(0.498::numeric) = 1
    AND CEIL(1.079::numeric) = 2
    AND 0.498::numeric <> CEIL(0.498::numeric);
  message := '0,498 caixa vira 1; 1,079 vira 2; fração contínua continua representável';
  RETURN NEXT;

  case_name := 'packaging_identity_bridge_is_uuid_only';
  ok := position('strip_legacy_packaging_material_lines' IN v_filter) > 0
    AND position('caixa_collective_type' IN v_filter) = 0
    AND position('packaging_mode_collective_type' IN v_filter) = 0
    AND v_packaging_helper ILIKE '%box_type_colmeia_id%'
    AND v_packaging_helper ILIKE '%box_type_master_id%'
    AND v_packaging_helper ILIKE '%box_type_fitilho_id%';
  message := 'filtro e helper devem usar ponte/slots UUID, nunca inferência por nome';
  RETURN NEXT;

  case_name := 'packaging_slot_kind_mismatch_fails_closed';
  ok := position('v_box_kind IS DISTINCT FROM v_type' IN v_packaging_helper) > 0
    AND position('possui tipo incompatível' IN v_packaging_helper) > 0
    AND position('AUDIT-PACKAGING-CANONICAL-20260825: slot-kind-fail-closed' IN v_plan) > 0
    AND position('tipo_caixa_incompativel' IN v_plan) > 0;
  message := 'UUID do slot só é válido quando box_types.tipo coincide; inconsistência deve bloquear cálculo e débito';
  RETURN NEXT;

  case_name := 'packaging_legacy_bridge_has_no_conflict';
  ok := NOT EXISTS (
    SELECT 1
      FROM (VALUES
        ('428012a1-c0fa-4149-bc5e-7426b6c0462f'::uuid,
         '1aca239e-7135-40c3-82c2-1b4039e59602'::uuid),
        ('f8f22d9c-2dbc-4724-83bd-0ee07d181ecf'::uuid,
         'c27cc685-d1b2-48e0-9bd1-ed86cc057a94'::uuid)
      ) expected(product_id, box_type_id)
      LEFT JOIN public.products p ON p.id = expected.product_id
      LEFT JOIN public.legacy_packaging_product_bridges bridge
        ON bridge.product_id = expected.product_id
     WHERE (p.id IS NOT NULL AND p.box_type_id IS DISTINCT FROM expected.box_type_id)
        OR (p.id IS NOT NULL AND bridge.box_type_id IS DISTINCT FROM expected.box_type_id)
  );
  message := 'os dois SKUs de caixa do BOM devem apontar e estar na allow-list do box_type auditado';
  RETURN NEXT;

  -- Fixture de integração somente leitura: escolhe uma ficha cujo grupo de
  -- solado tenha todos os slots necessários, sem depender de nome de caixa.
  SELECT ts.id
    INTO v_fixture_ref
    FROM public.technical_sheets ts
    JOIN public.product_groups pg ON pg.id = ts.sole_group_id
    JOIN public.box_types bi ON bi.id = pg.box_type_id
      AND bi.active AND bi.tipo::text = 'individual'
    JOIN public.box_types bc ON bc.id = pg.box_type_colmeia_id
      AND bc.active AND bc.tipo::text = 'colmeia'
    JOIN public.box_types bf ON bf.id = pg.box_type_fitilho_id
      AND bf.active AND bf.tipo::text = 'fitilho'
   ORDER BY ts.id
   LIMIT 1;

  IF v_fixture_ref IS NOT NULL THEN
    SELECT count(*), array_agg(p.packaging_type ORDER BY p.packaging_type),
           count(*) FILTER (WHERE p.warning IS NOT NULL)
      INTO v_fixture_count, v_fixture_types, v_fixture_warnings
      FROM public.calculate_packaging_consumption(
        v_fixture_ref, 12, 'colmeia', NULL
      ) p;
    case_name := 'packaging_fixture_colmeia_one_box_type';
    ok := v_fixture_count = 1
      AND v_fixture_types = ARRAY['colmeia']::text[]
      AND v_fixture_warnings = 0;
    message := 'modo colmeia deve selecionar exatamente um slot colmeia ativo';
    RETURN NEXT;

    SELECT count(*), array_agg(p.packaging_type ORDER BY p.packaging_type),
           count(*) FILTER (WHERE p.warning IS NOT NULL)
      INTO v_fixture_count, v_fixture_types, v_fixture_warnings
      FROM public.calculate_packaging_consumption(
        v_fixture_ref, 12, 'individual', NULL
      ) p;
    case_name := 'packaging_fixture_individual_one_box_type';
    ok := v_fixture_count = 1
      AND v_fixture_types = ARRAY['individual']::text[]
      AND v_fixture_warnings = 0;
    message := 'modo individual deve selecionar exatamente um slot individual ativo';
    RETURN NEXT;

    SELECT count(*), array_agg(p.packaging_type ORDER BY p.packaging_type),
           count(*) FILTER (WHERE p.warning IS NOT NULL)
      INTO v_fixture_count, v_fixture_types, v_fixture_warnings
      FROM public.calculate_packaging_consumption(
        v_fixture_ref, 12, 'individual_fitilho', NULL
      ) p;
    case_name := 'packaging_fixture_fitilho_two_exact_slots';
    ok := v_fixture_count = 2
      AND v_fixture_types = ARRAY['fitilho', 'individual']::text[]
      AND v_fixture_warnings = 0;
    message := 'modo individual_fitilho deve selecionar só individual + fitilho';
    RETURN NEXT;
  END IF;

  SELECT count(*), count(*) FILTER (WHERE p.warning IS NOT NULL)
    INTO v_fixture_count, v_fixture_warnings
    FROM public.calculate_packaging_consumption(
      '00000000-0000-0000-0000-000000000000'::uuid,
      12,
      'modo_invalido',
      NULL
    ) p;
  case_name := 'packaging_missing_or_invalid_fails_closed';
  ok := v_fixture_count = 1 AND v_fixture_warnings = 1;
  message := 'modo/configuração inválidos devem avisar e nunca escolher caixa padrão';
  RETURN NEXT;

  case_name := 'packaging_cost_uses_canonical_helper';
  ok := position('AUDIT-PACKAGING-CANONICAL-20260825: custo por slots do solado' IN v_cost) > 0
    AND position('calculate_packaging_consumption' IN v_cost) > 0
    AND position('''packaging'', v_breakdown_packaging' IN v_cost) > 0;
  message := 'custeio deve anexar custo de box_types depois de retirar embalagem BOM';
  RETURN NEXT;

  case_name := 'packaging_mrp_has_dedicated_box_type_channel';
  ok := position('calculate_packaging_consumption' IN v_mrp) > 0
    AND position('packaging.warning IS NULL' IN v_mrp) > 0
    AND position('sum(line.required)' IN v_mrp) > 0
    AND position('filter_caixa_by_packaging_mode' IN v_generic_mrp) > 0;
  message := 'MRP genérico exclui BOM legado e MRP de embalagem agrega o mesmo helper por box_type';
  RETURN NEXT;

  case_name := 'packaging_hybrid_cannot_reserve_legacy_bom';
  ok := position('filter_caixa_by_packaging_mode' IN v_hybrid) > 0
    AND position('strip_legacy_packaging_material_lines' IN v_filter) > 0;
  message := 'reserva/débito híbrido deve remover embalagem BOM antes de iterar products';
  RETURN NEXT;

  case_name := 'packaging_debit_uses_fail_closed_slot_plan';
  ok := position('plan_packaging_for_order' IN v_debit) > 0
    AND position('AUDIT-PACKAGING-CANONICAL-20260825: fail-closed-mode' IN v_plan) > 0
    AND position('AUDIT-PACKAGING-CANONICAL-20260825: slot-kind-fail-closed' IN v_plan) > 0
    AND position('box_type_id' IN v_plan) > 0;
  message := 'débito deve usar plano por slot e recusar modo ausente/inválido ou tipo incompatível';
  RETURN NEXT;

  case_name := 'packaging_per_pv_purchase_excludes_generic_bom';
  ok := position('filter_caixa_by_packaging_mode' IN v_per_pv) > 0
    AND position('strip_legacy_packaging_material_lines' IN v_filter) > 0;
  message := 'OC por PV não compra SKU de caixa legado; embalagem segue canal box_type do MRP';
  RETURN NEXT;

  case_name := 'consumption_canonical_overloads_only';
  ok := v_by_grade_count = 1
    AND v_scalar_count = 1
    AND to_regprocedure(
      'public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)'
    ) IS NOT NULL
    AND to_regprocedure(
      'public.calculate_order_consumption(uuid,numeric,text,integer,uuid)'
    ) IS NOT NULL;
  message := 'deve existir somente um by_grade e um wrapper escalar canônicos';
  RETURN NEXT;

  case_name := 'consumption_scalar_delegates_by_grade';
  ok := position('calculate_order_consumption_by_grade' IN v_scalar) > 0
    AND position('get_material_conversion_info' IN v_scalar) = 0;
  message := 'wrapper escalar deve herdar identidade/conversão/CEIL do motor by_grade';
  RETURN NEXT;
END;
$guard$;

REVOKE ALL ON FUNCTION public.run_sale_order_consumption_identity_parity_tests()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_sale_order_consumption_identity_parity_tests()
  TO service_role;

COMMENT ON FUNCTION public.run_sale_order_consumption_identity_parity_tests() IS
  'Guard read-only de precedência da palmilha, CEIL discreto de embalagem, overloads canônicos e delegação do wrapper escalar.';

DO $self_test$
DECLARE
  v_failures text;
BEGIN
  SELECT string_agg(t.case_name || ': ' || COALESCE(t.message, 'falhou'), E'\n')
    INTO v_failures
    FROM public.run_sale_order_consumption_identity_parity_tests() t
   WHERE t.ok IS NOT TRUE;

  IF v_failures IS NOT NULL THEN
    RAISE EXCEPTION 'Self-test de paridade identidade/embalagem falhou:\n%', v_failures;
  END IF;
END;
$self_test$;

NOTIFY pgrst, 'reload schema';

COMMIT;
