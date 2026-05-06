-- Recreate public.v_production_planning_kpis.
--
-- Problem: ProductionPlanning.tsx queries this view via PostgREST and fails
-- with "Could not find the table 'public.v_production_planning_kpis' in the
-- schema cache". The view was originally created in
-- 20260502142405_d5ffa600-e79c-4c0e-a0a5-851a79632dd0.sql alongside several
-- other view rebuilds, but appears to be missing in the deployed database
-- (likely because that migration aborted mid-way at one of the
-- ALTER TABLE DROP COLUMN steps and the view was never recreated).
--
-- This migration is narrowly scoped: it ONLY recreates this one view.
-- It does not touch the surrounding views that may have already diverged.
-- The view body is identical to the canonical definition in 20260502142405.
--
-- It also issues NOTIFY pgrst, 'reload schema' so PostgREST picks up the
-- new view without waiting for its periodic schema refresh.

DROP VIEW IF EXISTS public.v_production_planning_kpis;

CREATE VIEW public.v_production_planning_kpis AS
WITH sector_metrics AS (
    SELECT
        os.stage_name AS sector,
        sum(os.quantity_total) AS total_pairs,
        sum(CASE WHEN os.status = 'pendente' THEN os.quantity_total ELSE 0 END) AS pending_pairs,
        sum(CASE WHEN os.status = 'em_andamento' THEN os.quantity_total - os.quantity_processed ELSE 0 END) AS in_progress_pairs,
        count(DISTINCT os.order_id) AS orders_count
    FROM public.order_stages os
    WHERE os.status IN ('pendente', 'em_andamento')
    GROUP BY os.stage_name
), capacity_data AS (
    SELECT 'Corte'::text AS sector, avg(cutting_capacity_per_day) AS avg_capacity FROM public.technical_sheets WHERE cutting_capacity_per_day > 0
    UNION ALL
    SELECT 'Forração'::text, avg(sewing_capacity_per_day) FROM public.technical_sheets WHERE sewing_capacity_per_day > 0
    UNION ALL
    SELECT 'Silk'::text, avg(silk_capacity_per_day) FROM public.technical_sheets WHERE silk_capacity_per_day > 0
    UNION ALL
    SELECT 'Colagem'::text, avg(gluing_capacity_per_day) FROM public.technical_sheets WHERE gluing_capacity_per_day > 0
    UNION ALL
    SELECT 'Montagem'::text, avg(assembly_capacity_per_day) FROM public.technical_sheets WHERE assembly_capacity_per_day > 0
    UNION ALL
    SELECT 'Acabamento'::text, avg(finishing_capacity_per_day) FROM public.technical_sheets WHERE finishing_capacity_per_day > 0
)
SELECT
    sm.sector,
    sm.total_pairs,
    sm.pending_pairs,
    sm.in_progress_pairs,
    sm.orders_count,
    COALESCE(cd.avg_capacity, 0) AS daily_capacity,
    CASE WHEN cd.avg_capacity > 0 THEN round(sm.total_pairs::numeric / cd.avg_capacity, 1) ELSE 0 END AS days_of_backlog,
    CASE
        WHEN cd.avg_capacity > 0 AND (sm.total_pairs::numeric / cd.avg_capacity) > 10 THEN 'crítico'
        WHEN cd.avg_capacity > 0 AND (sm.total_pairs::numeric / cd.avg_capacity) > 5 THEN 'atenção'
        ELSE 'normal'
    END AS risk_level
FROM sector_metrics sm
LEFT JOIN capacity_data cd ON sm.sector = cd.sector;

ALTER VIEW public.v_production_planning_kpis SET (security_invoker = true);

GRANT SELECT ON public.v_production_planning_kpis TO authenticated;
GRANT SELECT ON public.v_production_planning_kpis TO anon;

-- Force PostgREST to refresh its schema cache so the view becomes
-- queryable immediately rather than after the next periodic reload.
NOTIFY pgrst, 'reload schema';
