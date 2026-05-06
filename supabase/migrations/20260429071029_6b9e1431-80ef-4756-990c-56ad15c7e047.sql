CREATE OR REPLACE VIEW public.v_sector_board AS
WITH stages AS (
  SELECT s.stage,
         w.id              AS wave_id,
         w.code            AS wave_code,
         w.week_start,
         w.week_end,
         w.start_mode,
         s.status          AS stage_status,
         s.progress_pct,
         s.started_at,
         s.finished_at,
         s.capacity_per_day,
         w.total_pairs,
         stage_order(s.stage) AS ord
    FROM public.production_wave_stages s
    JOIN public.production_waves w ON w.id = s.wave_id
   WHERE w.status IN ('running', 'planning')
)
SELECT stage,
       ord,
       (SELECT jsonb_build_object(
           'wave_id',          s2.wave_id,
           'code',             s2.wave_code,
           'week_start',       s2.week_start,
           'week_end',         s2.week_end,
           'progress_pct',     s2.progress_pct,
           'total_pairs',      s2.total_pairs,
           'started_at',       s2.started_at,
           'start_mode',       s2.start_mode,
           'capacity_per_day', s2.capacity_per_day
         )
          FROM stages s2
         WHERE s2.stage = stages.stage
           AND s2.stage_status = 'in_progress'
         ORDER BY s2.week_start
         LIMIT 1) AS active_wave,
       (SELECT jsonb_build_object(
           'wave_id',    s3.wave_id,
           'code',       s3.wave_code,
           'week_start', s3.week_start
         )
          FROM stages s3
         WHERE s3.stage = stages.stage
           AND s3.stage_status = 'pending'
           AND (
             s3.ord = 1
             OR NOT EXISTS (
               SELECT 1
                 FROM public.production_wave_stages prev_s
                WHERE prev_s.wave_id = s3.wave_id
                  AND public.stage_order(prev_s.stage) = s3.ord - 1
                  AND prev_s.status <> 'completed'
             )
           )
         ORDER BY s3.week_start
         LIMIT 1) AS next_wave,
       (SELECT count(*)
          FROM stages s4
         WHERE s4.stage = stages.stage
           AND s4.stage_status = 'completed') AS completed_count
  FROM stages
 GROUP BY stage, ord
 ORDER BY ord;

GRANT SELECT ON public.v_sector_board TO authenticated;