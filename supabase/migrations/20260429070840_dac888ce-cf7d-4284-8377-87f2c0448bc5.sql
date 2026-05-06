
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
    FROM production_wave_stages s
    JOIN production_waves w ON w.id = s.wave_id
   WHERE w.status IN ('running', 'planning')
)
SELECT stage, ord,
       (SELECT jsonb_build_object(
           'wave_id',          wave_id,
           'code',             wave_code,
           'week_start',       week_start,
           'week_end',         week_end,
           'progress_pct',     progress_pct,
           'total_pairs',      total_pairs,
           'started_at',       started_at,
           'start_mode',       start_mode,
           'capacity_per_day', capacity_per_day
         )
         FROM stages s2
        WHERE s2.stage = stages.stage AND s2.stage_status = 'in_progress'
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
              -- bloqueia se houver QUALQUER stage do nível anterior ainda não completado
              SELECT 1
                FROM production_wave_stages prev_s
               WHERE prev_s.wave_id = s3.wave_id
                 AND stage_order(prev_s.stage) = s3.ord - 1
                 AND prev_s.status <> 'completed'
            )
          )
        ORDER BY s3.week_start
        LIMIT 1) AS next_wave,
       (SELECT count(*)
          FROM stages s4
         WHERE s4.stage = stages.stage AND s4.stage_status = 'completed') AS completed_count
  FROM stages
 GROUP BY stage, ord
 ORDER BY ord;

GRANT SELECT ON public.v_sector_board TO authenticated;
