-- =============================================================================
-- min_billing em LOTE — mata o N+1 da view sale_order_min_billing
-- =============================================================================
-- Medição (03/08/2026, PV com mais itens):
--   compute_min_billing_date(1 pedido) ............ 160,6 ms
--     └─ get_wave_material_needs_core(ARRAY[id]) .. 139,9 ms  (87%)
--     └─ agregação de lead times .................. ~21 ms
--
-- A view roda essa função POR LINHA. Em 93 dias isso somou ~20 min de CPU e
-- ainda custa ~900 ms por visita à tela de PVs.
--
-- ⚠ POR QUE NÃO BASTA CHAMAR A _core COM O ARRAY INTEIRO
-- A _core rateia estoque entre TUDO que está na chamada:
--     product_needed_total = SUM(needed_qty) OVER (PARTITION BY product_id)
--     stock_qty            = avail_total * needed_qty / product_needed_total
-- Com 1 pedido, o rateio é entre as cores daquele pedido. Com 15 pedidos numa
-- chamada só, a fatia de cada um encolhe → shortage sobe → lead de fornecedor
-- entra → a data de faturamento é EMPURRADA. Ou seja: o batch ingênuo mudaria
-- número de negócio silenciosamente. Não é equivalente.
--
-- SOLUÇÃO: grão opcional na _core (p_per_order). O grão entra no PARTITION BY,
-- então cada pedido enxerga o estoque INTEIRO, rateado só entre as próprias
-- cores — idêntico a chamar a função sozinha pra ele.
-- Com p_per_order = false (default), grp_order é NULL em todas as linhas e
-- "PARTITION BY grp_order, product_id" colapsa em "PARTITION BY product_id":
-- comportamento atual preservado bit a bit para os 4 chamadores de wave.
--
-- Motor ÚNICO de propósito: duplicar a _core numa variante por pedido criaria
-- dois motores divergindo — erro que este projeto já pagou caro (ver
-- "Motor consumo unificado modal+ficha" e "Consumo Consolidado").
-- =============================================================================

-- Assinatura muda (coluna nova na saída) → exige DROP. Nenhum objeto SQL depende
-- por catálogo: corpos plpgsql não criam dependência. O único chamador que
-- quebraria é o wrapper get_wave_material_needs (usa SELECT *), recriado abaixo.
DROP FUNCTION IF EXISTS public.get_wave_material_needs_core(uuid[], date);

CREATE FUNCTION public.get_wave_material_needs_core(
  p_sale_order_ids uuid[],
  p_corte_start date,
  p_per_order boolean DEFAULT false
)
RETURNS TABLE(
  product_id uuid, product_name text, unit text, color text, needed_qty numeric,
  stock_qty numeric, shortage numeric, supplier_id uuid, supplier_name text,
  supplier_lead_time_days integer, is_artisanal boolean, artisanal_recipe_id uuid,
  artisanal_recipe_name text, base_product_id uuid, base_product_name text,
  base_needed_qty numeric, base_stock_qty numeric, base_shortage numeric,
  os_send_date date, conversion_warning text,
  sale_order_id uuid  -- NOVA, no fim: NULL quando p_per_order = false
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH
  items_with_cons AS (
    SELECT
      CASE WHEN p_per_order THEN soi.sale_order_id END AS grp_order,
      COALESCE(public.filter_caixa_by_packaging_mode(
        public.calculate_order_consumption_by_grade(
          soi.reference_id,
          public.scale_grade_to_total(soi.grade, soi.quantity),
          COALESCE(soi.color, ''),
          soi.material_variant_id
        ), so.packaging_mode), '[]'::jsonb) AS cons
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
      AND soi.reference_id IS NOT NULL
      AND soi.grade IS NOT NULL
      AND jsonb_typeof(soi.grade) = 'object'
      AND EXISTS (
        SELECT 1 FROM jsonb_each_text(soi.grade) g
        WHERE g.key ~ '^[0-9]+(/[0-9]+)?$' AND (g.value)::numeric > 0
      )
      AND (
        so.status NOT IN ('Faturado', 'Cancelado', 'Finalizado s/ NF')
        OR EXISTS (
          SELECT 1 FROM public.orders o
           WHERE o.sale_order_item_id = soi.id
             AND o.status NOT IN ('Finalizado', 'Cancelada')
        )
      )
  ),
  exploded AS (
    SELECT (line ->> 'product_id')::uuid AS product_id,
           COALESCE(line ->> 'color', '') AS effective_color,
           (line ->> 'required')::numeric AS required,
           (line ->> 'unit') AS unit,
           (line ->> 'conversion_warning') AS conversion_warning,
           NULL::text AS family,
           grp_order
    FROM items_with_cons, jsonb_array_elements(cons) AS line
    WHERE (line ->> 'product_id') IS NOT NULL
  ),
  strap_exploded AS (
    SELECT sn.product_id,
           COALESCE(sn.color, '') AS effective_color,
           sn.required_m AS required,
           'm'::text AS unit,
           NULL::text AS conversion_warning,
           COALESCE(NULLIF(trim(ts.upper_material), ''), NULLIF(trim(ts.lining_material), '')) AS family,
           CASE WHEN p_per_order THEN soi.sale_order_id END AS grp_order
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
    LEFT JOIN public.technical_sheets ts ON ts.id = soi.reference_id
    CROSS JOIN LATERAL public.order_strap_needs(soi.strap_colors, soi.quantity::numeric, soi.grade) sn
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
      AND sn.product_id IS NOT NULL
      AND (
        so.status NOT IN ('Faturado', 'Cancelado', 'Finalizado s/ NF')
        OR EXISTS (
          SELECT 1 FROM public.orders o
           WHERE o.sale_order_item_id = soi.id
             AND o.status NOT IN ('Finalizado', 'Cancelada')
        )
      )
  ),
  all_exploded AS (
    SELECT * FROM exploded
    UNION ALL
    SELECT * FROM strap_exploded
  ),
  needed AS (
    SELECT product_id, effective_color, family, grp_order,
      COALESCE(SUM(required) FILTER (WHERE unit IS NULL AND conversion_warning IS NULL), 0)
        / GREATEST(COALESCE((SELECT conv.dm2_per_unit FROM public.get_material_conversion_info(product_id) conv LIMIT 1), 1), 1)
      + COALESCE(SUM(required) FILTER (WHERE unit IS NOT NULL AND conversion_warning IS NULL), 0) AS needed_qty,
      MAX(conversion_warning) AS conversion_warning
    FROM all_exploded
    GROUP BY product_id, effective_color, family, grp_order
  ),
  own_res AS (
    SELECT mr.product_id,
           CASE WHEN p_per_order THEN o.sale_order_id END AS grp_order,
           SUM(GREATEST(0, COALESCE(mr.quantity_reserved, 0) - COALESCE(mr.quantity_consumed, 0))) AS own_reserved
    FROM public.material_reservations mr
    JOIN public.orders o ON o.id = mr.order_id
    WHERE o.sale_order_id = ANY(p_sale_order_ids)
      AND mr.status IN ('reserved', 'partially_consumed')
    GROUP BY mr.product_id, CASE WHEN p_per_order THEN o.sale_order_id END
  ),
  enriched_base AS (
    SELECT n.product_id, p.name AS product_name, p.group_id AS group_id, COALESCE(p.unit,'un') AS unit,
           n.effective_color AS color, n.family AS family, n.needed_qty, n.grp_order,
           GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0) + COALESCE(orr.own_reserved, 0)) AS avail_total,
           -- grão no PARTITION BY: com grp_order NULL (modo wave) é idêntico ao
           -- "PARTITION BY n.product_id" original.
           SUM(n.needed_qty) OVER (PARTITION BY n.grp_order, n.product_id) AS product_needed_total,
           p.supplier_id, sup.name AS supplier_name,
           COALESCE(p.supplier_lead_time_days, 10)::int AS supplier_lead_time_days,
           COALESCE(p.is_artisanal, false) AS is_artisanal,
           n.conversion_warning
      FROM needed n
      JOIN public.products p ON p.id = n.product_id
      LEFT JOIN public.suppliers sup ON sup.id = p.supplier_id
      LEFT JOIN own_res orr
             ON orr.product_id = n.product_id
            AND orr.grp_order IS NOT DISTINCT FROM n.grp_order
     WHERE n.needed_qty > 0 OR n.conversion_warning IS NOT NULL
  ),
  enriched AS (
    SELECT eb.*,
           CASE WHEN eb.product_needed_total > 0
                THEN eb.avail_total * eb.needed_qty / eb.product_needed_total
                ELSE eb.avail_total END AS stock_qty,
           GREATEST(0, eb.needed_qty - CASE WHEN eb.product_needed_total > 0
                THEN eb.avail_total * eb.needed_qty / eb.product_needed_total
                ELSE eb.avail_total END) AS shortage
      FROM enriched_base eb
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
         CASE WHEN e.is_artisanal AND p_corte_start IS NOT NULL
              THEN (p_corte_start - 7)::date ELSE NULL END AS os_send_date,
         CASE
           WHEN e.family IS NOT NULL AND e.is_artisanal AND ar.id IS NULL
           THEN COALESCE(epg.name, e.product_name, 'Tira') || ' em ' || e.family
                || ': rendimento não cadastrado — cadastre a receita da tira nessa napa'
           ELSE e.conversion_warning
         END AS conversion_warning,
         e.grp_order AS sale_order_id
    FROM enriched e
    LEFT JOIN public.product_groups epg ON epg.id = e.group_id
    LEFT JOIN public.artisanal_recipes ar
           ON e.is_artisanal = true AND ar.active = true
          AND epg.id IS NOT NULL
          AND lower(trim(unaccent(ar.artisanal_product_name))) = lower(trim(unaccent(epg.name)))
          AND (e.family IS NULL
               OR lower(trim(unaccent(ar.base_product_name))) = lower(trim(unaccent(e.family))))
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

REVOKE ALL ON FUNCTION public.get_wave_material_needs_core(uuid[], date, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_wave_material_needs_core(uuid[], date, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_wave_material_needs_core(uuid[], date, boolean) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- Wrapper: enumera as colunas em vez de SELECT * (que agora traria 21 contra as
-- 20 do RETURNS TABLE). Continua sem expor sale_order_id — nenhum consumidor de
-- wave precisa dele, e manter a assinatura preserva os chamadores do frontend.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_wave_material_needs(p_sale_order_ids uuid[])
RETURNS TABLE(
  product_id uuid, product_name text, unit text, color text, needed_qty numeric,
  stock_qty numeric, shortage numeric, supplier_id uuid, supplier_name text,
  supplier_lead_time_days integer, is_artisanal boolean, artisanal_recipe_id uuid,
  artisanal_recipe_name text, base_product_id uuid, base_product_name text,
  base_needed_qty numeric, base_stock_qty numeric, base_shortage numeric,
  os_send_date date, conversion_warning text
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_corte_start date;
BEGIN
  SELECT t.corte_palmilha_start_date INTO v_corte_start
    FROM public.compute_wave_timeline(p_sale_order_ids) t LIMIT 1;

  RETURN QUERY
  SELECT c.product_id, c.product_name, c.unit, c.color, c.needed_qty, c.stock_qty,
         c.shortage, c.supplier_id, c.supplier_name, c.supplier_lead_time_days,
         c.is_artisanal, c.artisanal_recipe_id, c.artisanal_recipe_name,
         c.base_product_id, c.base_product_name, c.base_needed_qty,
         c.base_stock_qty, c.base_shortage, c.os_send_date, c.conversion_warning
    FROM public.get_wave_material_needs_core(p_sale_order_ids, v_corte_start) c;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_wave_material_needs(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_wave_material_needs(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_wave_material_needs(uuid[]) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- compute_min_billing_dates(uuid[]) — versão em LOTE, set-based.
-- Mesma matemática de compute_min_billing_date, sem laço por pedido:
--   • agregação de lead times: 1 query com GROUP BY sale_order_id
--   • lead de fornecedor: 1 chamada da _core com p_per_order = true
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compute_min_billing_dates(p_sale_order_ids uuid[])
RETURNS TABLE(sale_order_id uuid, min_billing_date date)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH leads AS (
    SELECT
      soi.sale_order_id AS so_id,
      COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'corte_palmilha')
        THEN CASE WHEN COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day, 0) > 0
            THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day)::numeric)::int)
            ELSE COALESCE(NULLIF(ts.lead_time_corte_dias,0), dlt.lead_time_corte_dias, 1) END
        ELSE 0 END), 0) AS lead_palmilha,
      COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'corte_forracao')
        THEN CASE WHEN COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day, 0) > 0
            THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day)::numeric)::int)
            ELSE COALESCE(NULLIF(ts.lead_time_corte_dias,0), dlt.lead_time_corte_dias, 2) END
        ELSE 0 END), 0) AS lead_forracao,
      COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE LOWER(TRIM(x.value)) IN ('costura palmilha','costura'))
        THEN CASE WHEN COALESCE(NULLIF(ts.costura_palmilha_capacity_per_day,0), NULLIF(ts.costura_capacity_per_day,0), NULLIF(dlt.costura_palmilha_capacity_per_day,0), dlt.costura_capacity_per_day, 0) > 0
            THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.costura_palmilha_capacity_per_day,0), NULLIF(ts.costura_capacity_per_day,0), NULLIF(dlt.costura_palmilha_capacity_per_day,0), dlt.costura_capacity_per_day)::numeric)::int)
            ELSE COALESCE(NULLIF(ts.lead_time_costura_dias,0), dlt.lead_time_costura_dias, 1) END
        ELSE 0 END), 0) AS lead_cost_palm,
      COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE LOWER(TRIM(x.value)) = 'costura cabedal')
        THEN CASE WHEN COALESCE(NULLIF(ts.costura_cabedal_capacity_per_day,0), NULLIF(ts.costura_capacity_per_day,0), NULLIF(dlt.costura_cabedal_capacity_per_day,0), dlt.costura_capacity_per_day, 0) > 0
            THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.costura_cabedal_capacity_per_day,0), NULLIF(ts.costura_capacity_per_day,0), NULLIF(dlt.costura_cabedal_capacity_per_day,0), dlt.costura_capacity_per_day)::numeric)::int)
            ELSE COALESCE(NULLIF(ts.lead_time_costura_dias,0), dlt.lead_time_costura_dias, 1) END
        ELSE 0 END), 0) AS lead_cost_cab,
      COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'mesa')
        THEN CASE WHEN COALESCE(NULLIF(ts.mesa_daily_capacity,0), dlt.mesa_daily_capacity, 0) > 0
            THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.mesa_daily_capacity,0), dlt.mesa_daily_capacity)::numeric)::int)
            ELSE 1 END
        ELSE 0 END), 0) AS lead_mesa,
      COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'silk')
        THEN CASE WHEN COALESCE(NULLIF(ts.silk_capacity_per_day,0), dlt.silk_capacity_per_day, 0) > 0
            THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.silk_capacity_per_day,0), dlt.silk_capacity_per_day)::numeric)::int)
            ELSE 1 END
        ELSE 0 END), 0) AS lead_silk,
      COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'colagem')
        THEN CASE WHEN COALESCE(NULLIF(ts.gluing_capacity_per_day,0), dlt.gluing_capacity_per_day, 0) > 0
            THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.gluing_capacity_per_day,0), dlt.gluing_capacity_per_day)::numeric)::int)
            ELSE 1 END
        ELSE 0 END), 0) AS lead_colagem,
      COALESCE(MAX(CASE WHEN COALESCE(NULLIF(ts.assembly_capacity_per_day,0), dlt.assembly_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.assembly_capacity_per_day,0), dlt.assembly_capacity_per_day)::numeric)::int)
          ELSE COALESCE(NULLIF(ts.lead_time_montagem_dias,0), dlt.lead_time_montagem_dias, 2) END), 2) AS lead_montagem,
      COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'solagem')
        THEN CASE WHEN COALESCE(NULLIF(ts.soling_capacity_per_day,0), dlt.soling_capacity_per_day, 0) > 0
            THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.soling_capacity_per_day,0), dlt.soling_capacity_per_day)::numeric)::int)
            ELSE 1 END
        ELSE 0 END), 0) AS lead_solagem,
      COALESCE(MAX(CASE WHEN COALESCE(NULLIF(ts.finishing_capacity_per_day,0), dlt.finishing_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.finishing_capacity_per_day,0), dlt.finishing_capacity_per_day)::numeric)::int)
          ELSE COALESCE(NULLIF(ts.lead_time_acabamento_dias,0), dlt.lead_time_acabamento_dias, 1) END), 1) AS lead_acab,
      COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_buffer_material_dias,0), dlt.lead_time_buffer_material_dias, 2)), 2) AS lead_buffer
    FROM public.sale_order_items soi
    JOIN public.technical_sheets ts ON ts.id = soi.reference_id
    LEFT JOIN public.default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
    GROUP BY soi.sale_order_id
  ),
  -- UMA chamada da _core no grão de pedido. Espelha exatamente o SELECT que a
  -- compute_min_billing_date fazia por pedido.
  supplier_leads AS (
    SELECT n.sale_order_id AS so_id,
           COALESCE(MAX(CASE
             WHEN n.conversion_warning IS NOT NULL THEN 0
             WHEN COALESCE(n.is_artisanal, false) THEN
               CASE WHEN COALESCE(n.base_shortage, 0) > 0 AND n.base_product_id IS NOT NULL
                    THEN public.get_effective_supplier_lead_days(n.base_product_id, NULL) ELSE 0 END
             WHEN COALESCE(n.shortage, 0) > 0
               THEN public.get_effective_supplier_lead_days(n.product_id, NULL)
             ELSE 0 END), 0) AS lead_supplier
      FROM public.get_wave_material_needs_core(p_sale_order_ids, NULL, true) n
     GROUP BY n.sale_order_id
  )
  SELECT l.so_id,
         LEAST(
           public.next_dow(public.add_business_days(CURRENT_DATE, (
             COALESCE(s.lead_supplier, 0) + COALESCE(l.lead_buffer, 2)
             + GREATEST(l.lead_palmilha, l.lead_forracao)
             + GREATEST(GREATEST(l.lead_cost_palm, l.lead_cost_cab), l.lead_mesa)
             + COALESCE(l.lead_silk, 0) + COALESCE(l.lead_colagem, 0)
             + COALESCE(l.lead_montagem, 2) + COALESCE(l.lead_solagem, 0) + COALESCE(l.lead_acab, 1)
           ))::date, 2),
           public.next_dow(public.add_business_days(CURRENT_DATE, (
             COALESCE(s.lead_supplier, 0) + COALESCE(l.lead_buffer, 2)
             + GREATEST(l.lead_palmilha, l.lead_forracao)
             + GREATEST(GREATEST(l.lead_cost_palm, l.lead_cost_cab), l.lead_mesa)
             + COALESCE(l.lead_silk, 0) + COALESCE(l.lead_colagem, 0)
             + COALESCE(l.lead_montagem, 2) + COALESCE(l.lead_solagem, 0) + COALESCE(l.lead_acab, 1)
           ))::date, 5)
         )::date
    FROM leads l
    LEFT JOIN supplier_leads s ON s.so_id = l.so_id;
$function$;

REVOKE ALL ON FUNCTION public.compute_min_billing_dates(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.compute_min_billing_dates(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.compute_min_billing_dates(uuid[]) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- compute_min_billing_date(uuid) singular vira wrapper do lote: MOTOR ÚNICO.
-- Mantém a assinatura usada por src/lib/minBillingDate.ts (RPC) e pelo
-- SaleOrderForm em modo edição.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compute_min_billing_date(p_sale_order_id uuid)
RETURNS date
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT min_billing_date
    FROM public.compute_min_billing_dates(ARRAY[p_sale_order_id])
   LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.compute_min_billing_date(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.compute_min_billing_date(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.compute_min_billing_date(uuid) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- A view deixa de chamar função por linha.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.sale_order_min_billing AS
SELECT m.sale_order_id, m.min_billing_date
  FROM public.compute_min_billing_dates(
    ARRAY(SELECT so.id FROM public.sale_orders so
           WHERE so.status <> ALL (ARRAY['Cancelado'::text, 'cancelado'::text, 'FINALIZADO'::text]))
  ) m;
