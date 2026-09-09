-- Early-release Aviamento + Costura Cabedal.
-- start_offset_days em sector_settings antecipa o setor no motor de agenda:
-- com offset > 0 o recompute NÃO espera o nível anterior (cortes) entregar
-- pares. DEFAULT_OP_STAGES / resyncOPs / STAGE_DAG intactos.
--
-- Seed: Aviamento e Costura Cabedal = 5 dias úteis (tunável em /producao/setores).
-- Costura Palmilha permanece 0 — ainda espera o bloco dos cortes.

ALTER TABLE public.sector_settings
  ADD COLUMN IF NOT EXISTS start_offset_days integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.sector_settings.start_offset_days IS
  'Dias úteis de antecipação no planejamento. >0 libera o setor sem esperar o nível anterior (early-release). Aviamento e Costura Cabedal usam 5; Costura Palmilha fica 0.';

UPDATE public.sector_settings
   SET start_offset_days = 5
 WHERE sector IN ('Aviamento', 'Costura Cabedal')
   AND COALESCE(start_offset_days, 0) = 0;

CREATE OR REPLACE FUNCTION public.recompute_production_schedule(p_triggered_by text DEFAULT 'manual'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_run uuid := gen_random_uuid();
  v_t0 timestamptz := clock_timestamp();
  v_today date := public.br_today();
  v_day date;
  v_guard int := 0;
  v_progress int;
  v_sector record;
  v_row record;
  v_f_left numeric;
  v_avail int;
  v_take int;
  v_queue_size int;
  v_scheduled int := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('recompute_production_schedule'));

  DROP TABLE IF EXISTS _rq_queue;
  CREATE TEMP TABLE _rq_queue ON COMMIT DROP AS
  SELECT q.order_id, q.due_date,
         row_number() OVER (
           ORDER BY (q.pinned_position IS NULL), q.pinned_position,
                    q.due_date NULLS LAST, o.created_at, o.id
         ) AS prio
  FROM production_queue q
  JOIN orders o ON o.id = q.order_id
  WHERE o.deleted_at IS NULL;

  SELECT count(*) INTO v_queue_size FROM _rq_queue;

  DROP TABLE IF EXISTS _rq_work;
  CREATE TEMP TABLE _rq_work ON COMMIT DROP AS
  WITH ficha AS (
    SELECT DISTINCT ON (o.id)
           o.id AS order_id,
           ts.production_sectors,
           ts.sewing_capacity_per_day, ts.cutting_capacity_per_day,
           ts.mesa_daily_capacity, ts.costura_capacity_per_day,
           ts.silk_capacity_per_day, ts.gluing_capacity_per_day,
           ts.assembly_capacity_per_day, ts.soling_capacity_per_day,
           ts.finishing_capacity_per_day, ts.expedition_capacity_per_day
    FROM orders o
    JOIN technical_sheets ts ON ts.id = o.reference_id
    WHERE o.id IN (SELECT order_id FROM _rq_queue)
    ORDER BY o.id, ts.updated_at DESC
  ),
  base AS (
    SELECT os.order_id,
           CASE WHEN os.stage_name = 'Mesa' THEN 'Aviamento' ELSE os.stage_name END AS sector,
           GREATEST(0, os.quantity_total - COALESCE(os.quantity_processed, 0)) AS remaining,
           COALESCE(os.quantity_processed, 0) AS processed,
           os.status AS stage_status
    FROM order_stages os
    WHERE os.order_id IN (SELECT order_id FROM _rq_queue)
  ),
  enriched AS (
    SELECT b.order_id, b.sector, b.remaining, b.processed,
           ss.flow_order, ss.parallel_group,
           COALESCE(ss.start_offset_days, 0) AS start_offset_days,
           COALESCE(g.grp_order, ss.flow_order) AS lvl_key,
           ss.daily_capacity_pairs AS global_rate,
           CASE ss.ficha_capacity_column
             WHEN 'sewing_capacity_per_day'     THEN NULLIF(COALESCE(f.sewing_capacity_per_day, 0), 0)
             WHEN 'cutting_capacity_per_day'    THEN NULLIF(COALESCE(f.cutting_capacity_per_day, 0), 0)
             WHEN 'mesa_daily_capacity'         THEN NULLIF(COALESCE(f.mesa_daily_capacity, 0), 0)
             WHEN 'costura_capacity_per_day'    THEN NULLIF(COALESCE(f.costura_capacity_per_day::numeric, 0), 0)
             WHEN 'silk_capacity_per_day'       THEN NULLIF(COALESCE(f.silk_capacity_per_day::numeric, 0), 0)
             WHEN 'gluing_capacity_per_day'     THEN NULLIF(COALESCE(f.gluing_capacity_per_day::numeric, 0), 0)
             WHEN 'assembly_capacity_per_day'   THEN NULLIF(COALESCE(f.assembly_capacity_per_day, 0), 0)
             WHEN 'soling_capacity_per_day'     THEN NULLIF(COALESCE(f.soling_capacity_per_day, 0), 0)
             WHEN 'finishing_capacity_per_day'  THEN NULLIF(COALESCE(f.finishing_capacity_per_day, 0), 0)
             WHEN 'expedition_capacity_per_day' THEN NULLIF(COALESCE(f.expedition_capacity_per_day, 0), 0)
             ELSE NULL
           END AS ficha_rate,
           CASE
             WHEN f.production_sectors IS NOT NULL AND jsonb_array_length(f.production_sectors) > 0
               THEN (f.production_sectors ? b.sector
                     OR (b.sector = 'Aviamento' AND f.production_sectors ? 'Mesa'))
             ELSE ss.enabled
           END AS included
    FROM base b
    JOIN sector_settings ss ON ss.sector = b.sector
    LEFT JOIN (
      SELECT parallel_group, MIN(flow_order) AS grp_order
      FROM sector_settings WHERE parallel_group IS NOT NULL GROUP BY 1
    ) g ON g.parallel_group = ss.parallel_group
    LEFT JOIN ficha f ON f.order_id = b.order_id
    WHERE b.stage_status <> 'concluido'
  ),
  leveled AS (
    SELECT e.*, q.prio, q.due_date,
           dense_rank() OVER (
             PARTITION BY e.order_id ORDER BY e.lvl_key
           ) AS level
    FROM enriched e
    JOIN _rq_queue q ON q.order_id = e.order_id
    WHERE e.included
  )
  SELECT l.*,
         GREATEST(COALESCE(l.ficha_rate, l.global_rate), 1)::numeric AS rate,
         (l.ficha_rate IS NOT NULL) AS is_ficha_override,
         (SELECT MAX(l2.level) FROM leveled l2
           WHERE l2.order_id = l.order_id AND l2.level < l.level) AS prev_level,
         l.remaining AS remaining_alloc,
         0::int AS alloc_cum
  FROM leveled l;

  DROP TABLE IF EXISTS _rq_today_done;
  CREATE TEMP TABLE _rq_today_done ON COMMIT DROP AS
  SELECT pp.order_id,
         CASE WHEN pp.stage_name = 'Mesa' THEN 'Aviamento' ELSE pp.stage_name END AS sector,
         GREATEST(0, SUM(pp.quantity))::int AS done_today
  FROM production_pointings pp
  WHERE (pp.created_at AT TIME ZONE 'America/Sao_Paulo')::date = v_today
  GROUP BY 1, 2
  HAVING GREATEST(0, SUM(pp.quantity)) > 0;

  DROP TABLE IF EXISTS _rq_today_frac;
  CREATE TEMP TABLE _rq_today_frac ON COMMIT DROP AS
  SELECT t.sector,
         LEAST(1.0, SUM(t.done_today::numeric
                        / COALESCE(w.rate, GREATEST(ss.daily_capacity_pairs, 1)::numeric))) AS f_used
  FROM _rq_today_done t
  JOIN sector_settings ss ON ss.sector = t.sector
  LEFT JOIN _rq_work w ON w.order_id = t.order_id AND w.sector = t.sector
  GROUP BY t.sector;

  DROP TABLE IF EXISTS _rq_alloc;
  CREATE TEMP TABLE _rq_alloc (
    order_id uuid, sector text, date date, pairs int, frac numeric, is_ficha_override boolean
  ) ON COMMIT DROP;

  v_day := v_today;
  WHILE EXISTS (SELECT 1 FROM _rq_work WHERE remaining_alloc > 0) LOOP
    v_guard := v_guard + 1;
    EXIT WHEN v_guard > 500;

    -- F1-07: dia útil de VERDADE (seg–sex E não-feriado optional=false) — mesma
    -- fonte de feriados do motor de ondas. Antes: só EXTRACT(ISODOW) BETWEEN 1 AND 5.
    IF public.is_business_day(v_day) THEN
      DROP TABLE IF EXISTS _rq_delivered;
      CREATE TEMP TABLE _rq_delivered ON COMMIT DROP AS
      SELECT w.order_id, w.level,
             MIN(w.processed + COALESCE(a.cum, 0))::int AS delivered
      FROM _rq_work w
      LEFT JOIN (
        SELECT order_id, sector, SUM(pairs)::int AS cum
        FROM _rq_alloc WHERE date < v_day GROUP BY 1, 2
      ) a ON a.order_id = w.order_id AND a.sector = w.sector
      GROUP BY w.order_id, w.level;

      v_progress := 0;

      FOR v_sector IN
        SELECT DISTINCT w.sector, w.flow_order FROM _rq_work w
        WHERE w.remaining_alloc > 0 ORDER BY w.flow_order
      LOOP
        IF v_day = v_today THEN
          v_f_left := GREATEST(0, 1.0 - COALESCE(
            (SELECT f.f_used FROM _rq_today_frac f WHERE f.sector = v_sector.sector), 0));
        ELSE
          v_f_left := 1.0;
        END IF;

        FOR v_row IN
          SELECT w.* FROM _rq_work w
          WHERE w.sector = v_sector.sector AND w.remaining_alloc > 0
          ORDER BY w.prio
        LOOP
          EXIT WHEN v_f_left <= 0.001;

          -- Early-release (start_offset_days > 0): o setor não espera o nível
          -- anterior entregar pares. Aviamento e Costura Cabedal saem antes do
          -- PV "entrar em produção" (antes dos cortes fecharem o bloco 1).
          -- Costura Palmilha permanece com offset 0 e continua esperando.
          IF v_row.prev_level IS NULL OR COALESCE(v_row.start_offset_days, 0) > 0 THEN
            v_avail := v_row.remaining_alloc;
          ELSE
            SELECT GREATEST(0, COALESCE(d.delivered, 0) - v_row.processed - v_row.alloc_cum)
              INTO v_avail
              FROM _rq_delivered d
             WHERE d.order_id = v_row.order_id AND d.level = v_row.prev_level;
            v_avail := COALESCE(v_avail, 0);
          END IF;

          v_take := LEAST(v_row.remaining_alloc, v_avail,
                          FLOOR(v_f_left * v_row.rate)::int);

          IF v_take > 0 THEN
            INSERT INTO _rq_alloc VALUES
              (v_row.order_id, v_row.sector, v_day, v_take,
               v_take::numeric / v_row.rate, v_row.is_ficha_override);
            UPDATE _rq_work
               SET alloc_cum = alloc_cum + v_take,
                   remaining_alloc = remaining_alloc - v_take
             WHERE order_id = v_row.order_id AND sector = v_row.sector;
            v_f_left := v_f_left - (v_take::numeric / v_row.rate);
            v_progress := v_progress + v_take;
          END IF;
        END LOOP;
      END LOOP;

      EXIT WHEN v_progress = 0 AND v_day > v_today;
    END IF;

    v_day := v_day + 1;
  END LOOP;

  DROP TABLE IF EXISTS _rq_out;
  CREATE TEMP TABLE _rq_out ON COMMIT DROP AS
  SELECT order_id, sector, date,
         SUM(pairs)::int AS pairs, SUM(frac) AS frac,
         BOOL_OR(is_ficha_override) AS is_ficha_override
  FROM (
    SELECT order_id, sector, date, pairs, frac, is_ficha_override FROM _rq_alloc
    UNION ALL
    SELECT t.order_id, t.sector, v_today, t.done_today,
           t.done_today::numeric / COALESCE(w.rate, GREATEST(ss.daily_capacity_pairs, 1)::numeric),
           COALESCE(w.is_ficha_override, false)
    FROM _rq_today_done t
    JOIN sector_settings ss ON ss.sector = t.sector
    LEFT JOIN _rq_work w ON w.order_id = t.order_id AND w.sector = t.sector
  ) x
  GROUP BY 1, 2, 3;

  DROP TABLE IF EXISTS _rq_backlog;
  CREATE TEMP TABLE _rq_backlog ON COMMIT DROP AS
  WITH first_sched AS (
    SELECT order_id, sector, MIN(date) AS first_date
    FROM production_schedule
    WHERE date < v_today
    GROUP BY 1, 2
  ),
  done_past AS (
    SELECT pp.order_id,
           CASE WHEN pp.stage_name = 'Mesa' THEN 'Aviamento' ELSE pp.stage_name END AS sector,
           SUM(pp.quantity) FILTER (
             WHERE (pp.created_at AT TIME ZONE 'America/Sao_Paulo')::date < v_today
               AND (pp.created_at AT TIME ZONE 'America/Sao_Paulo')::date >= fs.first_date
           )::int AS qty
    FROM production_pointings pp
    JOIN first_sched fs ON fs.order_id = pp.order_id
      AND fs.sector = CASE WHEN pp.stage_name = 'Mesa' THEN 'Aviamento' ELSE pp.stage_name END
    GROUP BY 1, 2
  )
  SELECT ps.order_id, ps.sector,
         GREATEST(0, SUM(ps.planned_pairs)::int - COALESCE(MIN(dp.qty), 0)) AS backlog
  FROM production_schedule ps
  JOIN (SELECT DISTINCT order_id, sector FROM _rq_work) w
    ON w.order_id = ps.order_id AND w.sector = ps.sector
  LEFT JOIN done_past dp ON dp.order_id = ps.order_id AND dp.sector = ps.sector
  WHERE ps.date < v_today
  GROUP BY ps.order_id, ps.sector;

  DELETE FROM production_schedule WHERE date >= v_today;

  INSERT INTO production_schedule
    (recalc_run_id, order_id, sector, date, planned_pairs, carryover_pairs,
     capacity_source, day_fraction)
  SELECT v_run, a.order_id, a.sector, a.date, a.pairs,
         LEAST(a.pairs, GREATEST(0, COALESCE(b.backlog, 0) - COALESCE(prev.cum_before, 0)))::int,
         CASE WHEN a.is_ficha_override THEN 'ficha_override' ELSE 'global' END,
         ROUND(a.frac, 6)
  FROM _rq_out a
  LEFT JOIN _rq_backlog b ON b.order_id = a.order_id AND b.sector = a.sector
  LEFT JOIN LATERAL (
    SELECT SUM(a2.pairs)::int AS cum_before FROM _rq_out a2
    WHERE a2.order_id = a.order_id AND a2.sector = a.sector AND a2.date < a.date
  ) prev ON true
  WHERE a.pairs > 0;

  SELECT COALESCE(SUM(pairs), 0) INTO v_scheduled FROM _rq_out;

  INSERT INTO production_engine_runs
    (run_id, duration_ms, queue_size, scheduled_pairs, horizon_end, triggered_by)
  VALUES
    (v_run,
     (EXTRACT(EPOCH FROM clock_timestamp() - v_t0) * 1000)::int,
     v_queue_size, v_scheduled,
     (SELECT MAX(date) FROM _rq_out),
     p_triggered_by);

  RETURN jsonb_build_object(
    'run_id', v_run,
    'queue_size', v_queue_size,
    'scheduled_pairs', v_scheduled,
    'horizon_end', (SELECT MAX(date) FROM _rq_out),
    'duration_ms', (EXTRACT(EPOCH FROM clock_timestamp() - v_t0) * 1000)::int
  );
END;
$function$;
