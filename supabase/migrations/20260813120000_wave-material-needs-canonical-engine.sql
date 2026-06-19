-- ============================================================================
-- P0.4 — get_wave_material_needs derivado do motor CANÔNICo (calculate_order_consumption)
-- ============================================================================
-- Auditoria 2026-06-19: get_wave_material_needs (motor das ONDAS, que auto-gera
-- OC em createWaveWithMaterialOrders) só lia sheet_materials (BOM) + solado. Logo
-- napa/cabedal/forro/palmilha/binóculo — que vivem em technical_sheets.*_material
-- e nos specs do solado — ficavam INVISÍVEIS: a onda não comprava os materiais
-- dominantes (ruptura silenciosa de compra). MRP (fn_projected_demand) e Compras
-- por Pedido (compute_materials_per_pv) já são wrappers de
-- calculate_order_consumption; só faltava a onda.
--
-- Agora a necessidade base vem de filter_caixa_by_packaging_mode(
-- calculate_order_consumption(...)) por item — MESMO motor/conversão dos outros
-- canais (dm²→física, massa g↔kg via P0.1, cor da linha, caixa por packaging_mode).
-- A enriquecimento ARTESANAL (recipe/base_product/os_send_date) e os campos de
-- saída são preservados byte-a-byte — só as CTEs de necessidade mudaram.
--
-- Assinatura idêntica → único caller (waveTimelineService.ts) e views inalterados;
-- só passam a ver MAIS linhas (napa/forro/palmilha) e cores corretas.
-- ============================================================================

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
    -- Necessidade por item via motor canônico (igual fn_projected_demand /
    -- compute_materials_per_pv): inclui cabedal/forro/palmilha/fachete/BOM/
    -- diretos + solado, já com conversão dm²→física e filtro de caixa.
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
    -- Conversão de área idêntica a fn_projected_demand: linhas unit IS NULL em
    -- dm² cru ÷ dm2_per_unit; linhas já na unidade do produto somam direto.
    SELECT product_id, effective_color,
      COALESCE(SUM(required) FILTER (WHERE unit IS NULL), 0)
        / GREATEST(COALESCE((SELECT conv.dm2_per_unit FROM public.get_material_conversion_info(product_id) conv LIMIT 1), 1), 1)
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
