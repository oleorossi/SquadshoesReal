-- ════════════════════════════════════════════════════════════════════════════
-- O quadro de capacidade estava somando TODOS os recálculos, não o último.
--
-- `recompute_production_schedule` carimba cada execução com um `recalc_run_id`
-- e INSERE as linhas novas — mas nunca apagou as antigas. As duas views que
-- leem o plano faziam `SUM(planned_pairs)` sem filtrar o run, então cada
-- recálculo somava por cima do anterior.
--
-- Medido em 10/08/2026, antes deste arquivo: 22 runs acumulados, 2.807 linhas,
-- das quais **2.347 (84%) eram resíduo**. O quadro exibia:
--
--     setor              exibia    real    inflação
--     Corte Forração     19.734   6.800      2,9×
--     Corte Palmilha     21.440   8.528      2,5×
--     Costura Palmilha   12.224   6.224      2,0×
--     Aviamento          12.800   6.800      1,9×
--
-- Ou seja: o planejamento apontava o Corte Forração como o setor mais
-- carregado da fábrica com o TRIPLO da carga que ele realmente tem. Falha
-- silenciosa — nada quebrava, nenhum alerta, e o número parecia plausível.
--
-- ⚠ Isto NÃO é perda de dado: `production_schedule` é 100% derivada e pode ser
-- regenerada a qualquer momento por `recompute_production_schedule()`.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Qual é o recálculo vigente ───────────────────────────────────────────
-- Prefere o run registrado em `production_engine_runs` que de fato tenha linhas
-- no plano; cai para a linha mais recente do próprio plano se o log de runs
-- estiver vazio ou dessincronizado. Nunca devolve NULL tendo plano gravado —
-- devolver NULL esvaziaria as duas views e apagaria o quadro da fábrica.
CREATE OR REPLACE FUNCTION public.latest_schedule_run_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT r.run_id
       FROM public.production_engine_runs r
      WHERE EXISTS (SELECT 1 FROM public.production_schedule ps
                     WHERE ps.recalc_run_id = r.run_id)
      ORDER BY r.ran_at DESC
      LIMIT 1),
    (SELECT ps.recalc_run_id
       FROM public.production_schedule ps
      ORDER BY ps.created_at DESC
      LIMIT 1)
  );
$$;

COMMENT ON FUNCTION public.latest_schedule_run_id() IS
  'Run vigente do plano de produção. Toda leitura de production_schedule deve '
  'filtrar por ela — sem isso, os recálculos se somam (bug de 10/08/2026).';

-- ── 2. A grade de capacidade ────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_production_schedule_grid AS
SELECT ps.sector,
       ps.date,
       sum(ps.planned_pairs)::integer   AS planned_pairs,
       sum(ps.carryover_pairs)::integer AS carryover_pairs,
       ss.daily_capacity_pairs          AS capacity_pairs,
       round(sum(ps.day_fraction), 4)   AS utilization,
       CASE
         WHEN sum(ps.day_fraction) > 0.0001
           THEN GREATEST(1::numeric, round(sum(ps.planned_pairs)::numeric / sum(ps.day_fraction)))::integer
         ELSE ss.daily_capacity_pairs
       END AS effective_capacity_pairs,
       count(DISTINCT ps.order_id)::integer AS ops,
       count(DISTINCT ps.order_id) FILTER (WHERE ps.capacity_source = 'ficha_override')::integer
         AS ops_ficha_override,
       ss.flow_order,
       ss.enabled,
       ss.parallel_group
  FROM public.production_schedule ps
  JOIN public.sector_settings ss ON ss.sector = ps.sector
 WHERE ps.recalc_run_id = public.latest_schedule_run_id()   -- ← a correção
 GROUP BY ps.sector, ps.date, ss.daily_capacity_pairs, ss.flow_order,
          ss.enabled, ss.parallel_group;

-- ── 3. O detalhe da fila ────────────────────────────────────────────────────
-- Mesmo defeito: `sched` agregava projeção e carryover sobre todos os runs, o
-- que inflava `carryover_total` e podia empurrar `projected_completion` para
-- uma data de um recálculo antigo.
CREATE OR REPLACE VIEW public.v_production_queue_detail AS
WITH sched AS (
  SELECT ps.order_id,
         max(ps.date) AS projected_completion,
         min(ps.date) AS next_scheduled_date,
         bool_or(ps.capacity_source = 'ficha_override') AS has_ficha_override,
         sum(ps.carryover_pairs)::integer AS carryover_total,
         max(ps.carryover_pairs)          AS carryover_peak
    FROM public.production_schedule ps
   WHERE ps.date >= public.br_today()
     AND ps.recalc_run_id = public.latest_schedule_run_id()   -- ← a correção
   GROUP BY ps.order_id
), stg AS (
  SELECT os.order_id,
         sum(GREATEST(0, os.quantity_total - COALESCE(os.quantity_processed, 0)))::integer AS remaining_pairs
    FROM public.order_stages os
   WHERE os.status <> 'concluido'
   GROUP BY os.order_id
), last_stage AS (
  SELECT DISTINCT ON (os.order_id) os.order_id,
         COALESCE(os.quantity_processed, 0) AS last_processed
    FROM public.order_stages os
   ORDER BY os.order_id, os.stage_order DESC
), rota AS (
  SELECT os.order_id,
         sum(COALESCE(os.quantity_processed, 0))::numeric AS feito,
         sum(COALESCE(os.quantity_total, 0))::numeric     AS total_rota
    FROM public.order_stages os
   GROUP BY os.order_id
)
SELECT q.order_id,
       o.order_number,
       o.reference_id,
       ts.name      AS reference_name,
       ts.image_url AS reference_photo_url,
       o.color,
       o.quantity,
       o.status     AS order_status,
       o.sale_order_id,
       so.order_number AS sale_order_number,
       c.razao_social  AS client_name,
       q.due_date,
       q.pinned_position,
       q.pinned_by,
       q.pinned_at,
       q.status AS queue_status,
       s.projected_completion,
       s.next_scheduled_date,
       COALESCE(s.has_ficha_override, false) AS has_ficha_override,
       COALESCE(s.carryover_total, 0)        AS carryover_total,
       COALESCE(st.remaining_pairs, 0)       AS remaining_pairs,
       CASE
         WHEN q.due_date IS NOT NULL AND s.projected_completion > q.due_date
           THEN s.projected_completion - q.due_date
         ELSE 0
       END AS late_days,
       row_number() OVER (ORDER BY (q.pinned_position IS NULL), q.pinned_position,
                                   q.due_date, o.created_at, o.id)::integer AS queue_position,
       c.nome_fantasia AS client_fantasia,
       eg.name         AS client_group_name,
       GREATEST(0, o.quantity - COALESCE(ls.last_processed, 0)) AS remaining_pairs_net,
       COALESCE(s.carryover_peak, 0) AS carryover_peak,
       COALESCE(round(100::numeric * r.feito / NULLIF(r.total_rota, 0::numeric)), 0::numeric)::integer
         AS route_progress_pct
  FROM public.production_queue q
  JOIN public.orders o ON o.id = q.order_id AND o.deleted_at IS NULL
  LEFT JOIN public.technical_sheets ts ON ts.id = o.reference_id
  LEFT JOIN public.sale_orders so       ON so.id = o.sale_order_id
  LEFT JOIN public.clients c            ON c.id = so.client_id
  LEFT JOIN public.economic_groups eg   ON eg.id = c.economic_group_id
  LEFT JOIN sched s      ON s.order_id = q.order_id
  LEFT JOIN stg st       ON st.order_id = q.order_id
  LEFT JOIN last_stage ls ON ls.order_id = q.order_id
  LEFT JOIN rota r       ON r.order_id = q.order_id;

-- ── 4. Retenção: o plano para de crescer sem limite ─────────────────────────
-- Mantém os N runs mais recentes. Chamado pelo cron diário logo depois do
-- recálculo. Não é limpeza cosmética: sem isso a tabela cresce ~460 linhas por
-- execução e o `if_stale` roda no mount de QUALQUER tela de produção.
CREATE OR REPLACE FUNCTION public.prune_production_schedule_runs(p_keep int DEFAULT 3)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deleted int := 0;
BEGIN
  IF p_keep < 1 THEN
    RAISE EXCEPTION 'p_keep precisa ser >= 1 (recebido: %)', p_keep;
  END IF;

  WITH recentes AS (
    SELECT ps.recalc_run_id,
           max(COALESCE(r.ran_at, ps.created_at)) AS quando
      FROM public.production_schedule ps
      LEFT JOIN public.production_engine_runs r ON r.run_id = ps.recalc_run_id
     GROUP BY ps.recalc_run_id
     ORDER BY quando DESC
     LIMIT p_keep
  )
  DELETE FROM public.production_schedule ps
   WHERE ps.recalc_run_id NOT IN (SELECT recalc_run_id FROM recentes);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.prune_production_schedule_runs(int) IS
  'Descarta runs antigos de production_schedule (dado 100% derivado, '
  'regenerável por recompute_production_schedule). Mantém os N mais recentes.';

GRANT EXECUTE ON FUNCTION public.latest_schedule_run_id()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.prune_production_schedule_runs(int) TO authenticated;
