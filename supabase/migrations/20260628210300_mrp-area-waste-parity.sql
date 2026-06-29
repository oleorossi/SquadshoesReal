-- ============================================================================
-- Auditoria MRP (unidade #5) — PARIDADE DE PERDA (waste) na conversão dm²→física
-- ============================================================================
-- ACHADO (divergência entre motores que leem a MESMA coisa):
--
-- Materiais de ÁREA listados como BOM (sheet_materials) / componente direto /
-- forro-alternativa entram em calculate_order_consumption como linha SEM `unit`
-- (unit IS NULL) com `required` em dm²/par × qtd (CRU, pré-conversão). Os três
-- canais canônicos de MRP/compra derivam dessa linha assim:
--
--     SUM(required) FILTER (unit IS NULL) / dm2_per_unit
--   + SUM(required) FILTER (unit IS NOT NULL)
--
-- ou seja, DIVIDEM por dm2_per_unit mas NÃO aplicam a perda da ficha. Já o
-- custeio (purchase_projection_timeline, convertDm2ToLinearMeters/ToPlates no TS,
-- e as linhas de cabedal/forro/palmilha que JÁ saem com unit≠NULL de
-- calculate_order_consumption) aplicam `× (1 + waste_pct/100)`.
--
-- Efeito: para uma NAPA/COURO/forro cadastrado como BOM (não via
-- technical_sheets.upper/lining/insole_material), o MRP / Compras por Pedido / a
-- onda SUBESTIMAM a necessidade pela perda (default 8%) → compra ~8% a menos do
-- que o custeio e a timeline indicam para o MESMO material. Divergência silenciosa
-- entre motores que leem o mesmo sheet_materials.quantity_per_unit.
--
-- FIX (mínimo, espelha a regra canônica de purchase_projection_timeline e do TS):
-- aplicar `× (1 + waste_pct/100)` à soma das linhas de ÁREA (unit IS NULL) APÓS
-- a divisão por dm2_per_unit — e SOMENTE quando a conversão de área de fato
-- ocorre (produto linear/placa com divisor real). Linhas unit IS NULL que NÃO
-- são área (cola em kg, caixa em un → dm2_per_unit=1, conversion_warning=NULL mas
-- não-linear) NÃO podem ganhar perda: por isso o helper só multiplica quando o
-- produto é linear/placa COM dm2_per_unit > 1 (divisor de bobina/placa real) e
-- sem conversion_warning. Isso preserva byte-a-byte o resultado de cola/caixa/
-- contagem/massa e corrige só o ramo de área.
--
-- Helper centraliza a fórmula pra garantir que os 3 motores fiquem IDÊNTICOS por
-- construção (não há como um divergir do outro de novo). É IMMUTABLE/puro: recebe
-- o dm² cru somado + o product_id, devolve a necessidade convertida na unidade
-- física do produto, já com perda.
--
-- ⚠ NÃO aplica no banco — migration idempotente p/ aplicar pós-merge via MCP.
-- Assinaturas e colunas de saída INALTERADAS → callers (waveTimelineService,
-- usePerPvPurchasing, v_mrp_needs, generate_purchase_orders_from_mrp) intactos.
-- ============================================================================

-- ── Helper: dm² cru (somado) → unidade física do produto, com perda da ficha ──
-- Espelha exatamente o ramo "linear"/"placa" de purchase_projection_timeline e
-- convertDm2ToLinearMeters/convertDm2ToPlates do TS:
--   need_físico = dm²_cru / dm2_per_unit × (1 + waste/100)    [se conversão real]
--   need        = dm²_cru                                     [caso contrário]
CREATE OR REPLACE FUNCTION public.area_dm2_to_stock_qty(
  p_raw_dm2 numeric,
  p_product_id uuid
) RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_conv record;
  v_divisor numeric;
BEGIN
  IF p_raw_dm2 IS NULL OR p_raw_dm2 = 0 THEN
    RETURN COALESCE(p_raw_dm2, 0);
  END IF;

  SELECT * INTO v_conv
    FROM public.get_material_conversion_info(p_product_id) LIMIT 1;

  v_divisor := COALESCE(v_conv.dm2_per_unit, 1);

  -- Conversão de área de verdade: produto linear/placa COM divisor real (> 1) e
  -- sem aviso de largura faltando. Só nesse caso aplica a perda (igual ao TS /
  -- timeline). Caso contrário (cola/caixa/contagem/massa, ou área sem largura),
  -- devolve o cru — comportamento atual preservado.
  IF v_conv.conversion_warning IS NULL
     AND v_divisor > 1
     AND LOWER(COALESCE(v_conv.target_unit, '')) IN ('m','meters','metros','mt','cm') THEN
    RETURN (p_raw_dm2 / v_divisor) * (1 + COALESCE(v_conv.waste_pct, 0) / 100.0);
  END IF;

  -- Sem conversão de área: divide pelo GREATEST(divisor,1) p/ manter o
  -- comportamento anterior exato (divisor=1 → no-op).
  RETURN p_raw_dm2 / GREATEST(v_divisor, 1);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.area_dm2_to_stock_qty(numeric, uuid) TO authenticated;

COMMENT ON FUNCTION public.area_dm2_to_stock_qty(numeric, uuid) IS
  'Converte dm² cru somado (linhas unit IS NULL de calculate_order_consumption) '
  'para a unidade física do produto, aplicando a perda da ficha SOMENTE quando há '
  'conversão de área real (produto linear com largura). Centraliza a fórmula usada '
  'por fn_projected_demand / compute_materials_per_pv / get_wave_material_needs '
  'pra que fiquem idênticos ao custeio e à purchase_projection_timeline.';

-- ── fn_projected_demand (MRP) — usa o helper ────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_projected_demand()
 RETURNS TABLE(product_id uuid, product_name text, total_required numeric, earliest_deadline date, orders_count integer, order_ids uuid[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH items_with_cons AS (
    SELECT so.id AS sale_order_id, so.delivery_deadline, soi.id AS sale_order_item_id,
      COALESCE(public.filter_caixa_by_packaging_mode(
        public.calculate_order_consumption(
          soi.reference_id, soi.quantity, COALESCE(soi.color, ''),
          (SELECT key::integer FROM jsonb_each_text(soi.grade) WHERE key ~ '^[0-9]+$' ORDER BY value::numeric DESC LIMIT 1)
        ), so.packaging_mode), '[]'::jsonb) AS cons
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
    WHERE so.status NOT IN ('Cancelado','Entregue','Finalizado','Finalizado s/ NF','Faturado','Expedido','Concluído')
      AND soi.reference_id IS NOT NULL
  ),
  exploded AS (
    SELECT sale_order_id, delivery_deadline,
      (line ->> 'product_id')::uuid AS product_id,
      (line ->> 'product_name') AS product_name,
      (line ->> 'required')::numeric AS required,
      (line ->> 'unit') AS unit
    FROM items_with_cons, jsonb_array_elements(cons) AS line
  )
  SELECT
    e.product_id,
    MAX(e.product_name) AS product_name,
    -- Linhas de ÁREA (unit IS NULL, dm² cru) → unidade física com perda (helper);
    -- linhas já na unidade do produto (unit IS NOT NULL) somam direto.
    public.area_dm2_to_stock_qty(
      COALESCE(SUM(e.required) FILTER (WHERE e.unit IS NULL), 0), e.product_id)
    + COALESCE(SUM(e.required) FILTER (WHERE e.unit IS NOT NULL), 0) AS total_required,
    MIN(e.delivery_deadline) AS earliest_deadline,
    COUNT(DISTINCT e.sale_order_id)::integer AS orders_count,
    array_agg(DISTINCT e.sale_order_id) AS order_ids
  FROM exploded e
  WHERE e.product_id IS NOT NULL
  GROUP BY e.product_id;
END;
$function$;

-- ── compute_materials_per_pv (Compras por Pedido) — usa o helper ─────────────
DROP FUNCTION IF EXISTS public.compute_materials_per_pv(uuid[]);

CREATE OR REPLACE FUNCTION public.compute_materials_per_pv(p_pv_ids uuid[])
RETURNS TABLE(
  material_id      uuid,
  product_name     text,
  unit             text,
  color            text,
  needed_qty       numeric,
  stock_qty        numeric,
  shortage         numeric,
  supplier_id      uuid,
  supplier_name    text,
  last_unit_price  numeric,
  is_artisanal     boolean
)
LANGUAGE sql
SET search_path TO 'public', 'extensions'
AS $function$
  WITH items_with_cons AS (
    SELECT
      COALESCE(public.filter_caixa_by_packaging_mode(
        public.calculate_order_consumption(
          soi.reference_id, soi.quantity, COALESCE(soi.color, ''),
          (SELECT key::integer FROM jsonb_each_text(soi.grade)
            WHERE key ~ '^[0-9]+$' ORDER BY value::numeric DESC LIMIT 1)
        ), so.packaging_mode), '[]'::jsonb) AS cons
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
    WHERE soi.sale_order_id = ANY(p_pv_ids)
      AND soi.reference_id IS NOT NULL
  ),
  exploded AS (
    SELECT
      (line ->> 'product_id')::uuid AS product_id,
      (line ->> 'product_name')     AS product_name,
      COALESCE(line ->> 'color', '') AS color,
      (line ->> 'required')::numeric AS required,
      (line ->> 'unit')             AS unit
    FROM items_with_cons, jsonb_array_elements(cons) AS line
    WHERE (line ->> 'product_id') IS NOT NULL
  ),
  agg AS (
    SELECT
      e.product_id,
      e.color,
      MAX(e.product_name) AS product_name,
      -- Mesma conversão de fn_projected_demand via helper: área (unit IS NULL)
      -- → unidade física com perda; já-na-unidade (unit IS NOT NULL) soma direto.
      public.area_dm2_to_stock_qty(
        COALESCE(SUM(e.required) FILTER (WHERE e.unit IS NULL), 0), e.product_id)
      + COALESCE(SUM(e.required) FILTER (WHERE e.unit IS NOT NULL), 0) AS needed_qty
    FROM exploded e
    GROUP BY e.product_id, e.color
  )
  SELECT
    a.product_id                  AS material_id,
    COALESCE(p.name, a.product_name) AS product_name,
    COALESCE(p.unit, 'un')        AS unit,
    a.color,
    a.needed_qty,
    GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) AS stock_qty,
    GREATEST(0, a.needed_qty - GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0))) AS shortage,
    p.supplier_id,
    sup.name                      AS supplier_name,
    COALESCE(p.unit_price, 0)     AS last_unit_price,
    COALESCE(p.is_artisanal, false) AS is_artisanal
  FROM agg a
  LEFT JOIN public.products p   ON p.id = a.product_id
  LEFT JOIN public.suppliers sup ON sup.id = p.supplier_id
  WHERE a.needed_qty > 0
  ORDER BY sup.name NULLS LAST, COALESCE(p.name, a.product_name);
$function$;

GRANT EXECUTE ON FUNCTION public.compute_materials_per_pv(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.compute_materials_per_pv(uuid[]) IS
  'Materiais necessários para um conjunto de PVs (canal "Compras por Pedido"). '
  'Espelha fn_projected_demand (calculate_order_consumption + filtro de caixa + '
  'conversão dm²→física via area_dm2_to_stock_qty, COM perda) por PV, agregando '
  'por produto+cor da linha e anexando fornecedor/estoque/preço. Inclui cabedal/'
  'forro/palmilha; cola sem cor.';

-- ── get_wave_material_needs (Ondas) — usa o helper ───────────────────────────
CREATE OR REPLACE FUNCTION public.get_wave_material_needs(p_sale_order_ids uuid[])
RETURNS TABLE(product_id uuid, product_name text, unit text, color text, needed_qty numeric, stock_qty numeric, shortage numeric, supplier_id uuid, supplier_name text, supplier_lead_time_days integer, is_artisanal boolean, artisanal_recipe_id uuid, artisanal_recipe_name text, base_product_id uuid, base_product_name text, base_needed_qty numeric, base_stock_qty numeric, base_shortage numeric, os_send_date date)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
#variable_conflict use_column
DECLARE
  v_corte_start date;
BEGIN
  SELECT t.corte_palmilha_start_date INTO v_corte_start
    FROM public.compute_wave_timeline(p_sale_order_ids) t LIMIT 1;

  RETURN QUERY
  WITH
  items_with_cons AS (
    SELECT COALESCE(public.filter_caixa_by_packaging_mode(
      public.calculate_order_consumption(
        soi.reference_id, soi.quantity, COALESCE(soi.color, ''),
        (SELECT key::integer FROM jsonb_each_text(soi.grade)
          WHERE key ~ '^[0-9]+$' ORDER BY value::numeric DESC LIMIT 1)
      ), so.packaging_mode), '[]'::jsonb) AS cons
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
      AND soi.reference_id IS NOT NULL
  ),
  exploded AS (
    SELECT (line ->> 'product_id')::uuid AS product_id,
           COALESCE(line ->> 'color', '') AS effective_color,
           (line ->> 'required')::numeric AS required,
           (line ->> 'unit') AS unit
    FROM items_with_cons, jsonb_array_elements(cons) AS line
    WHERE (line ->> 'product_id') IS NOT NULL
  ),
  needed AS (
    -- Conversão de área idêntica a fn_projected_demand (helper COM perda):
    -- linhas unit IS NULL em dm² cru → área_dm2_to_stock_qty; linhas já na
    -- unidade do produto somam direto.
    SELECT product_id, effective_color,
      public.area_dm2_to_stock_qty(
        COALESCE(SUM(required) FILTER (WHERE unit IS NULL), 0), product_id)
      + COALESCE(SUM(required) FILTER (WHERE unit IS NOT NULL), 0) AS needed_qty
    FROM exploded
    GROUP BY product_id, effective_color
  ),
  enriched AS (
    SELECT n.product_id, p.name AS product_name, p.group_id AS group_id, COALESCE(p.unit,'un') AS unit,
           n.effective_color AS color, n.needed_qty,
           GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) AS stock_qty,
           GREATEST(0, n.needed_qty - GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0))) AS shortage,
           p.supplier_id, sup.name AS supplier_name,
           COALESCE(p.supplier_lead_time_days, 10)::int AS supplier_lead_time_days,
           COALESCE(p.is_artisanal, false) AS is_artisanal
      FROM needed n
      JOIN public.products p ON p.id = n.product_id
      LEFT JOIN public.suppliers sup ON sup.id = p.supplier_id
     WHERE n.needed_qty > 0
  )
  SELECT e.product_id, e.product_name, e.unit, e.color, e.needed_qty, e.stock_qty,
         e.shortage, e.supplier_id, e.supplier_name, e.supplier_lead_time_days,
         e.is_artisanal,
         ar.id AS artisanal_recipe_id, ar.name AS artisanal_recipe_name,
         bp.id AS base_product_id, ar.base_product_name,
         CASE WHEN e.is_artisanal AND ar.id IS NOT NULL AND ar.yield_per_meter > 0
              THEN ROUND(e.needed_qty / ar.yield_per_meter, 3) ELSE NULL END AS base_needed_qty,
         bp.quantity AS base_stock_qty,
         CASE WHEN e.is_artisanal AND ar.id IS NOT NULL AND bp.id IS NOT NULL
              THEN GREATEST(0, ROUND(e.needed_qty / NULLIF(ar.yield_per_meter, 0), 3) - bp.quantity)
              ELSE NULL END AS base_shortage,
         CASE WHEN e.is_artisanal AND v_corte_start IS NOT NULL
              THEN (v_corte_start - 7)::date ELSE NULL END AS os_send_date
    FROM enriched e
    LEFT JOIN public.product_groups epg ON epg.id = e.group_id
    LEFT JOIN public.artisanal_recipes ar
           ON e.is_artisanal = true AND ar.active = true
          AND epg.id IS NOT NULL
          AND lower(trim(unaccent(ar.artisanal_product_name))) = lower(trim(unaccent(epg.name)))
    LEFT JOIN public.product_groups bpg
           ON ar.id IS NOT NULL
          AND lower(trim(unaccent(bpg.name))) = lower(trim(unaccent(ar.base_product_name)))
    LEFT JOIN LATERAL (
      SELECT bp2.id, bp2.quantity
        FROM public.products bp2
       WHERE ar.id IS NOT NULL AND bp2.active = true
         AND (bp2.group_id = bpg.id
              OR lower(trim(unaccent(bp2.name))) = lower(trim(unaccent(ar.base_product_name))))
         AND (e.color = ''
              OR lower(unaccent(COALESCE(bp2.color,''))) = lower(unaccent(e.color)))
       ORDER BY (bp2.group_id = bpg.id) DESC NULLS LAST, bp2.quantity DESC NULLS LAST
       LIMIT 1
    ) bp ON true
   ORDER BY e.shortage DESC NULLS LAST, e.product_name;
END;
$function$;
