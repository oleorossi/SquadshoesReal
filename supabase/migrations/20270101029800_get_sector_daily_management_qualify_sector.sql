-- =============================================================================
-- Fix: get_sector_daily_management — sector ambíguo (PL/pgSQL OUT vs coluna)
-- =============================================================================
-- Sintoma: toast global "column reference \"sector\" is ambiguous" (sqlstate
-- 42702). detail: "It could refer to either a PL/pgSQL variable or a table
-- column." Contexto: get_sector_daily_management(date) line 4 RETURN QUERY.
--
-- Causa: RETURNS TABLE(sector text, ...) cria variável OUT `sector`. O CTE
-- scheduled fazia `SELECT sector … FROM production_schedule` sem qualificar —
-- PG não sabe se é a OUT ou a coluna. Posição do erro: 32 (primeiro "sector").
--
-- Marca: get_sector_daily_management_qualify_sector_298
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_sector_daily_management(p_date date DEFAULT CURRENT_DATE)
RETURNS TABLE(
  sector text,
  flow_order integer,
  planned_pairs numeric,
  pointed_pairs numeric,
  adherence_pct numeric,
  open_ops integer,
  wip_pairs numeric,
  oldest_due_date date,
  priority_order_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- get_sector_daily_management_qualify_sector_298
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  RETURN QUERY
  WITH scheduled AS (
    SELECT ps.sector AS sector,
           SUM(ps.planned_pairs)::numeric AS planned_pairs
      FROM public.production_schedule ps
     WHERE ps.date = p_date
     GROUP BY ps.sector
  ), pointed AS (
    SELECT pp.stage_name AS sector,
           SUM(pp.quantity)::numeric AS pointed_pairs
      FROM public.production_pointings pp
     WHERE pp.created_at >= (p_date::timestamp AT TIME ZONE 'America/Sao_Paulo')
       AND pp.created_at < ((p_date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
     GROUP BY pp.stage_name
  ), wip AS (
    SELECT os.stage_name AS sector,
           count(*)::integer AS open_ops,
           SUM(GREATEST(0, os.quantity_total - os.quantity_processed))::numeric AS wip_pairs,
           MIN(COALESCE(pq.due_date, so.delivery_deadline, o.planned_delivery)) AS oldest_due_date,
           (array_agg(o.id ORDER BY COALESCE(pq.due_date, so.delivery_deadline, o.planned_delivery) NULLS LAST, o.created_at))[1] AS priority_order_id
      FROM public.order_stages os
      JOIN public.orders o ON o.id = os.order_id
      LEFT JOIN public.sale_orders so ON so.id = o.sale_order_id
      LEFT JOIN public.production_queue pq ON pq.order_id = o.id
     WHERE o.status IN ('Reservado', 'Em Produção')
       AND os.status <> 'concluido'
     GROUP BY os.stage_name
  )
  SELECT ss.sector,
         ss.flow_order,
         COALESCE(s.planned_pairs, 0::numeric),
         COALESCE(p.pointed_pairs, 0::numeric),
         CASE
           WHEN COALESCE(s.planned_pairs, 0::numeric) > 0
             THEN round(LEAST(100, COALESCE(p.pointed_pairs, 0::numeric) / s.planned_pairs * 100), 1)
           ELSE NULL
         END,
         COALESCE(w.open_ops, 0),
         COALESCE(w.wip_pairs, 0::numeric),
         w.oldest_due_date,
         w.priority_order_id
    FROM public.sector_settings ss
    LEFT JOIN scheduled s ON s.sector = ss.sector
    LEFT JOIN pointed p ON p.sector = ss.sector
    LEFT JOIN wip w ON w.sector = ss.sector
   WHERE ss.enabled
   ORDER BY ss.flow_order;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_sector_daily_management(date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sector_daily_management(date)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_sector_daily_management(date) IS
  'Gestão diária por setor (agenda + apontamentos). Colunas OUT qualificam '
  'aliases de tabela pra não colidir com variável PL/pgSQL sector.';

DO $guards$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(
    'public.get_sector_daily_management(date)'::regprocedure
  ) INTO v_def;

  IF v_def NOT ILIKE '%get_sector_daily_management_qualify_sector_298%' THEN
    RAISE EXCEPTION 'Guard: get_sector_daily_management sem marca 298';
  END IF;

  IF v_def NOT ILIKE '%ps.sector%' THEN
    RAISE EXCEPTION 'Guard: scheduled sem alias ps.sector';
  END IF;

  IF v_def NOT ILIKE '%::numeric AS planned_pairs%' THEN
    RAISE EXCEPTION 'Guard: SUM(planned_pairs) sem cast numeric';
  END IF;
END;
$guards$;

COMMIT;
