-- ============================================================================
-- FIX CRÍTICO (auditoria 2026-06-09, item C3): get_wave_material_needs emitia
-- a necessidade de material de ÁREA (napa/forro em sheet_materials) em dm² CRU
-- (quantity_per_unit × qtd), comparando com stock_qty em METROS → shortage
-- ~100× inflado. Pior: createWaveWithMaterialOrders (waveTimelineService.ts)
-- gera OCs automáticas a partir desse shortage.
--
-- Mesmo bug já corrigido no modal (2026-05-30) e em fn_projected_demand
-- (20260720120000). Fix idêntico: dividir por
-- get_material_conversion_info(product_id).dm2_per_unit — fator = largura da
-- ficha de componente em dm (dm²→m); 1 para não-linear (par/un/kg) e para
-- linear sem largura (tiras/elásticos, que já são nativos).
--
-- O cálculo artesanal (needed_qty / yield_per_meter) herda a correção, pois
-- needed_qty passa a estar em metros.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_wave_material_needs(p_sale_order_ids uuid[])
RETURNS TABLE(product_id uuid, product_name text, unit text, color text, needed_qty numeric, stock_qty numeric, shortage numeric, supplier_id uuid, supplier_name text, supplier_lead_time_days integer, is_artisanal boolean, artisanal_recipe_id uuid, artisanal_recipe_name text, base_product_id uuid, base_product_name text, base_needed_qty numeric, base_stock_qty numeric, base_shortage numeric, os_send_date date)
LANGUAGE plpgsql STABLE SET search_path TO 'public', 'extensions'
AS $function$
#variable_conflict use_column
DECLARE
  v_corte_start date;
BEGIN
  SELECT t.corte_palmilha_start_date INTO v_corte_start
    FROM public.compute_wave_timeline(p_sale_order_ids) t LIMIT 1;

  RETURN QUERY
  WITH
  sole_product_ids AS (
    SELECT DISTINCT rsc.sole_product_id
      FROM public.sale_order_items soi
      CROSS JOIN LATERAL (SELECT sole_product_id FROM public.resolve_sole_color(soi.reference_id, COALESCE(soi.color,''))) rsc
     WHERE soi.sale_order_id = ANY(p_sale_order_ids) AND rsc.sole_product_id IS NOT NULL
  ),
  sheet_needed AS (
    -- Conversão dm²→unidade física do produto (auditoria 2026-06-09 C3):
    -- material de área tem quantity_per_unit em dm²/par; estoque/unidade do
    -- produto é linear (m). dm2_per_unit=1 para não-área → divisão neutra.
    SELECT sm.product_id,
           COALESCE(NULLIF(sm.color,''), soi.color, '') AS effective_color,
           SUM(sm.quantity_per_unit * soi.quantity)
             / COALESCE(NULLIF((SELECT conv.dm2_per_unit
                                  FROM public.get_material_conversion_info(sm.product_id) conv
                                 LIMIT 1), 0), 1) AS needed_qty
      FROM public.sale_order_items soi
      JOIN public.sheet_materials sm ON sm.sheet_id = soi.reference_id
      JOIN public.products sp ON sp.id = sm.product_id
     WHERE soi.sale_order_id = ANY(p_sale_order_ids)
       AND sm.product_id NOT IN (SELECT sole_product_id FROM sole_product_ids)
     GROUP BY sm.product_id, COALESCE(NULLIF(sm.color,''), soi.color, '')
  ),
  sole_needed AS (
    SELECT rsc.sole_product_id AS product_id,
           COALESCE(NULLIF(rsc.sole_color,''), soi.color, '') AS effective_color,
           SUM(soi.quantity) AS needed_qty
      FROM public.sale_order_items soi
      CROSS JOIN LATERAL (SELECT sole_product_id, sole_color FROM public.resolve_sole_color(soi.reference_id, COALESCE(soi.color,''))) rsc
     WHERE soi.sale_order_id = ANY(p_sale_order_ids) AND rsc.sole_product_id IS NOT NULL
     GROUP BY rsc.sole_product_id, COALESCE(NULLIF(rsc.sole_color,''), soi.color, '')
  ),
  all_needed AS (
    SELECT product_id, effective_color, needed_qty FROM sheet_needed
    UNION ALL
    SELECT product_id, effective_color, needed_qty FROM sole_needed
  ),
  needed AS (
    SELECT product_id, effective_color, SUM(needed_qty) AS needed_qty
      FROM all_needed GROUP BY product_id, effective_color
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
    -- 1 produto base por (grupo OU nome) + COR EXATA da tira (regra cor=cor)
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
