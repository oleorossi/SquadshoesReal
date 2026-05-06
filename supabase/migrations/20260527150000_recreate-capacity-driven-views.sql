-- Recreate public.v_sector_load and public.v_capacity_driven_lead_times.
--
-- Problem: migration 20260502142405_d5ffa600... appears to have aborted
-- around step 3 (ALTER TABLE DROP COLUMN), so steps 4-6 never executed.
-- That left three views uncreated:
--   - purchase_projection_timeline (step 5)  → recreated in 20260503022023
--   - v_production_planning_kpis  (step 6)   → recreated in 20260527140000
--   - v_capacity_driven_lead_times (step 4)  → still missing
-- v_sector_load (step 2) may or may not exist depending on exactly where
-- the migration died. We DROP + CREATE both to converge regardless.
--
-- Frontend usage of v_capacity_driven_lead_times:
--   - src/components/production/RCCPPlanning.tsx:47
--   - src/hooks/usePurchaseOrders.ts:216
-- Both pages currently fail with PostgREST "table not found in schema cache".
--
-- Definitions are byte-identical to the canonical 20260502142405 versions.
-- NOTIFY pgrst forces PostgREST to refresh schema cache immediately.

-- Order matters: v_capacity_driven_lead_times depends on v_sector_load,
-- so drop dependent first, recreate base first.
DROP VIEW IF EXISTS public.v_capacity_driven_lead_times;
DROP VIEW IF EXISTS public.v_sector_load;

CREATE VIEW public.v_sector_load AS
WITH pending_stages AS (
    SELECT
        COALESCE(pr.shoe_category, 'Geral'::text) AS shoe_category,
        os.stage_name,
        sum(os.quantity_total - os.quantity_processed) AS pending_quantity
    FROM public.order_stages os
    JOIN public.orders o ON os.order_id = o.id
    LEFT JOIN public.product_references pr ON o.reference_id = pr.id
    WHERE os.status <> 'concluido'::text
    GROUP BY pr.shoe_category, os.stage_name
)
SELECT
    shoe_category,
    sum(CASE WHEN stage_name IN ('Corte', 'Corte Forração') THEN pending_quantity ELSE 0 END) AS load_corte,
    sum(CASE WHEN stage_name IN ('Forração', 'Corte Palmilha') THEN pending_quantity ELSE 0 END) AS load_forracao,
    sum(CASE WHEN stage_name = 'Silk' THEN pending_quantity ELSE 0 END) AS load_silk,
    sum(CASE WHEN stage_name = 'Colagem' THEN pending_quantity ELSE 0 END) AS load_colagem,
    sum(CASE WHEN stage_name = 'Montagem' THEN pending_quantity ELSE 0 END) AS load_montagem,
    sum(CASE WHEN stage_name = 'Acabamento' THEN pending_quantity ELSE 0 END) AS load_acabamento,
    sum(CASE WHEN stage_name = 'Expedição' THEN pending_quantity ELSE 0 END) AS load_expedicao
FROM pending_stages
GROUP BY shoe_category;

ALTER VIEW public.v_sector_load SET (security_invoker = true);
GRANT SELECT ON public.v_sector_load TO authenticated;
GRANT SELECT ON public.v_sector_load TO anon;

CREATE VIEW public.v_capacity_driven_lead_times AS
SELECT
    dlt.shoe_category,
    dlt.notes,
    dlt.cutting_capacity_per_day,
    dlt.sewing_capacity_per_day AS forracao_capacity_per_day,
    dlt.silk_capacity_per_day,
    dlt.gluing_capacity_per_day,
    dlt.assembly_capacity_per_day,
    dlt.finishing_capacity_per_day,
    COALESCE(sl.load_corte, 0) AS current_load_corte,
    COALESCE(sl.load_forracao, 0) AS current_load_forracao,
    COALESCE(sl.load_silk, 0) AS current_load_silk,
    COALESCE(sl.load_colagem, 0) AS current_load_colagem,
    COALESCE(sl.load_montagem, 0) AS current_load_montagem,
    COALESCE(sl.load_acabamento, 0) AS current_load_acabamento,
    COALESCE(sl.load_expedicao, 0) AS current_load_expedicao,
    ceil(COALESCE(sl.load_corte, 0)::double precision / NULLIF(dlt.cutting_capacity_per_day, 0)::double precision) AS dynamic_days_corte,
    ceil(COALESCE(sl.load_forracao, 0)::double precision / NULLIF(dlt.sewing_capacity_per_day, 0)::double precision) AS dynamic_days_forracao,
    ceil(COALESCE(sl.load_silk, 0)::double precision / NULLIF(dlt.silk_capacity_per_day, 0)::double precision) AS dynamic_days_silk,
    ceil(COALESCE(sl.load_colagem, 0)::double precision / NULLIF(dlt.gluing_capacity_per_day, 0)::double precision) AS dynamic_days_colagem,
    ceil(COALESCE(sl.load_montagem, 0)::double precision / NULLIF(dlt.assembly_capacity_per_day, 0)::double precision) AS dynamic_days_montagem,
    ceil(COALESCE(sl.load_acabamento, 0)::double precision / NULLIF(dlt.finishing_capacity_per_day, 0)::double precision) AS dynamic_days_acabamento,
    dlt.lead_time_buffer_material_dias,
    ceil(
        COALESCE(COALESCE(sl.load_corte, 0)::double precision / NULLIF(dlt.cutting_capacity_per_day, 0)::double precision, 0) +
        COALESCE(COALESCE(sl.load_forracao, 0)::double precision / NULLIF(dlt.sewing_capacity_per_day, 0)::double precision, 0) +
        COALESCE(COALESCE(sl.load_silk, 0)::double precision / NULLIF(dlt.silk_capacity_per_day, 0)::double precision, 0) +
        COALESCE(COALESCE(sl.load_colagem, 0)::double precision / NULLIF(dlt.gluing_capacity_per_day, 0)::double precision, 0) +
        COALESCE(COALESCE(sl.load_montagem, 0)::double precision / NULLIF(dlt.assembly_capacity_per_day, 0)::double precision, 0) +
        COALESCE(COALESCE(sl.load_acabamento, 0)::double precision / NULLIF(dlt.finishing_capacity_per_day, 0)::double precision, 0) +
        dlt.lead_time_buffer_material_dias::double precision
    ) AS total_dynamic_lead_time_days
FROM public.default_lead_times dlt
LEFT JOIN public.v_sector_load sl ON dlt.shoe_category = sl.shoe_category;

ALTER VIEW public.v_capacity_driven_lead_times SET (security_invoker = true);
GRANT SELECT ON public.v_capacity_driven_lead_times TO authenticated;
GRANT SELECT ON public.v_capacity_driven_lead_times TO anon;

NOTIFY pgrst, 'reload schema';
