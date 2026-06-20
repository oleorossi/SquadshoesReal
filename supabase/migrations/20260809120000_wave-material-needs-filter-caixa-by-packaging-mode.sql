-- ============================================================================
-- get_wave_material_needs: filtrar CAIXA por packaging_mode
-- ============================================================================
-- Achado (auditoria 2026-06-19, canal "Compras por Pedido"): a ficha (BOM via
-- sheet_materials) lista TODAS as caixas (colmeia + individual + master/fitilho),
-- mas cada PV usa só uma modalidade. get_wave_material_needs somava todas →
-- super-contagem de embalagem (ex.: PV-00144 é 'colmeia' mas trazia CAIXA
-- INDIVIDUAL 11 também). Isso afetava tanto o novo canal quanto o motor de
-- ondas (createWaveWithMaterialOrders), que geram OC a partir desse shortage.
--
-- fn_projected_demand (caminho do MRP) já corrige isso via
-- filter_caixa_by_packaging_mode. Aqui replicamos a MESMA regra no nível de
-- linha do CTE sheet_needed, usando os helpers canônicos
-- caixa_collective_type(name) + packaging_mode_collective_type(mode):
--
--   Descarta a linha de caixa SE (e só se):
--     - so.packaging_mode IS NOT NULL  (NULL nunca filtra — igual ao helper)
--     - o produto é caixa (caixa_collective_type <> NULL)
--     - o tipo da caixa ≠ tipo-alvo do packaging_mode do PV
--     - EXISTE, na MESMA ficha, a caixa do tipo-alvo (senão mantém, pra não
--       zerar a embalagem quando o BOM só tem o tipo "errado")
--
-- O EXISTS por ficha (soi.reference_id) replica o guard "2+ tipos presentes E
-- alvo presente" de filter_caixa_by_packaging_mode na mesma granularidade que
-- fn_projected_demand (1 consumo por sale_order_item/referência). Não-caixa e
-- packaging_mode NULL passam intactos.
--
-- Dry-run validado em prod: PVs colmeia (00141/00144/00145) mantêm colmeia e
-- descartam individual; PVs individual_amarrado (00117-00120, 2026-00004…)
-- mantêm individual e descartam colmeia. Nenhum caso mantém/descarta os dois.
--
-- Resto da função preservado byte-a-byte (apenas o CTE sheet_needed mudou:
-- + JOIN sale_orders + cláusula NOT(...)). Mesma assinatura de retorno.
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
    --
    -- Filtro de CAIXA por packaging_mode (2026-06-19): descarta a caixa que não
    -- casa com so.packaging_mode SÓ quando existe, na mesma ficha, a caixa do
    -- tipo certo. Replica filter_caixa_by_packaging_mode (caminho do MRP).
    SELECT sm.product_id,
           COALESCE(NULLIF(sm.color,''), soi.color, '') AS effective_color,
           SUM(sm.quantity_per_unit * soi.quantity)
             / COALESCE(NULLIF((SELECT conv.dm2_per_unit
                                  FROM public.get_material_conversion_info(sm.product_id) conv
                                 LIMIT 1), 0), 1) AS needed_qty
      FROM public.sale_order_items soi
      JOIN public.sale_orders so ON so.id = soi.sale_order_id
      JOIN public.sheet_materials sm ON sm.sheet_id = soi.reference_id
      JOIN public.products sp ON sp.id = sm.product_id
     WHERE soi.sale_order_id = ANY(p_sale_order_ids)
       AND sm.product_id NOT IN (SELECT sole_product_id FROM sole_product_ids)
       AND NOT (
         so.packaging_mode IS NOT NULL
         AND public.caixa_collective_type(sp.name) IS NOT NULL
         AND public.caixa_collective_type(sp.name)
             <> public.packaging_mode_collective_type(so.packaging_mode)
         AND EXISTS (
           SELECT 1
             FROM public.sheet_materials sm_box
             JOIN public.products p_box ON p_box.id = sm_box.product_id
            WHERE sm_box.sheet_id = soi.reference_id
              AND public.caixa_collective_type(p_box.name)
                  = public.packaging_mode_collective_type(so.packaging_mode)
         )
       )
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
