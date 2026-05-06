-- Auto-start production waves + start_mode differentiation
--
-- 1. start_mode column on production_waves ('manual' | 'auto')
-- 2. auto_start_due_waves() — starts every planned wave whose corte_start_date <= today
-- 3. v_sector_board — includes start_mode in active_wave JSONB
-- 4. Sale orders: remove 'Pendente' from wave-eligible statuses (handled in frontend)

-- ── 1. start_mode column ──────────────────────────────────────────────────────
ALTER TABLE public.production_waves
  ADD COLUMN IF NOT EXISTS start_mode text NOT NULL DEFAULT 'manual'
  CHECK (start_mode IN ('manual', 'auto'));

-- ── 2. auto_start_due_waves ───────────────────────────────────────────────────
-- Starts every wave in 'draft' or 'planning' status whose corte_start_date has
-- arrived (corte_start_date <= CURRENT_DATE). Sets start_mode = 'auto'.
-- Returns the number of waves started.
CREATE OR REPLACE FUNCTION public.auto_start_due_waves()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wave  record;
  v_count int := 0;
BEGIN
  FOR v_wave IN
    SELECT id
      FROM production_waves
     WHERE status IN ('draft', 'planning')
       AND corte_start_date IS NOT NULL
       AND corte_start_date <= CURRENT_DATE
  LOOP
    -- Mark first stage (corte) as in_progress
    UPDATE production_wave_stages
       SET status = 'in_progress'
     WHERE wave_id = v_wave.id AND stage = 'corte';

    -- Transition wave to running, flag as auto-started
    UPDATE production_waves
       SET status      = 'running',
           current_stage = 'corte',
           started_at  = COALESCE(started_at, now()),
           start_mode  = 'auto'
     WHERE id = v_wave.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_start_due_waves() TO authenticated;

-- ── 3. v_sector_board — add start_mode to active_wave JSONB ──────────────────
CREATE OR REPLACE VIEW public.v_sector_board AS
WITH stages AS (
  SELECT s.stage,
         w.id            AS wave_id,
         w.code          AS wave_code,
         w.week_start,
         w.week_end,
         w.start_mode,
         s.status        AS stage_status,
         s.progress_pct,
         s.started_at,
         s.finished_at,
         w.total_pairs,
         stage_order(s.stage) AS ord
    FROM production_wave_stages s
    JOIN production_waves w ON w.id = s.wave_id
   WHERE w.status IN ('running', 'planning')
)
SELECT stage, ord,
       (SELECT jsonb_build_object(
           'wave_id',    wave_id,
           'code',       wave_code,
           'week_start', week_start,
           'week_end',   week_end,
           'progress_pct', progress_pct,
           'total_pairs',  total_pairs,
           'started_at',   started_at,
           'start_mode',   start_mode
         )
         FROM stages s2
        WHERE s2.stage = stages.stage AND s2.stage_status = 'in_progress'
        LIMIT 1) AS active_wave,
       (SELECT jsonb_build_object(
           'wave_id',    wave_id,
           'code',       wave_code,
           'week_start', week_start
         )
         FROM stages s3
        WHERE s3.stage = stages.stage AND s3.stage_status = 'pending'
        ORDER BY week_start LIMIT 1) AS next_wave,
       (SELECT count(*)
          FROM stages s4
         WHERE s4.stage = stages.stage AND s4.stage_status = 'completed') AS completed_count
  FROM stages
 GROUP BY stage, ord
 ORDER BY ord;

GRANT SELECT ON public.v_sector_board TO authenticated;
