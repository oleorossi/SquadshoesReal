-- Mesa: setor independente, inicia com a onda, não bloqueia Palmilha/Costura
DROP FUNCTION IF EXISTS public.stage_order(s production_stage_enum) CASCADE;
CREATE OR REPLACE FUNCTION public.stage_order(s production_stage_enum)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE s
    WHEN 'corte'      THEN 1
    WHEN 'mesa'       THEN 2
    WHEN 'palmilha'   THEN 2
    WHEN 'costura'    THEN 2
    WHEN 'montagem'   THEN 3
    WHEN 'solagem'    THEN 4
    WHEN 'acabamento' THEN 5
  END;
$$;

DROP FUNCTION IF EXISTS public.start_wave(p_wave_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.start_wave(p_wave_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_now         timestamptz := now();
  v_first_stage production_stage_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  UPDATE production_wave_stages
     SET status      = 'in_progress',
         operator_id = COALESCE(operator_id, auth.uid()),
         started_at  = v_now,
         updated_at  = v_now
   WHERE wave_id = p_wave_id
     AND status = 'pending'
     AND (stage_order(stage) = 1 OR stage = 'mesa');

  SELECT stage INTO v_first_stage
    FROM production_wave_stages
   WHERE wave_id = p_wave_id
     AND stage_order(stage) = 1
     AND status = 'in_progress'
   ORDER BY stage
   LIMIT 1;

  UPDATE production_waves
     SET status        = 'running',
         current_stage = v_first_stage,
         started_at    = COALESCE(started_at, v_now)
   WHERE id = p_wave_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_wave(uuid) TO authenticated;

-- advance_wave_stage: ajusta para a nova ordenação (Mesa nível 2, mas independente)
DROP FUNCTION IF EXISTS public.advance_wave_stage(
  p_wave_id uuid,
  p_stage   production_stage_enum
) CASCADE;
CREATE OR REPLACE FUNCTION public.advance_wave_stage(
  p_wave_id uuid,
  p_stage   production_stage_enum
)
RETURNS production_stage_enum
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status      text;
  v_next_stages production_stage_enum[];
  v_opened      production_stage_enum;
  s             production_stage_enum;
BEGIN
  SELECT status INTO v_status FROM production_waves WHERE id = p_wave_id FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Onda % não encontrada', p_wave_id;
  END IF;
  IF v_status NOT IN ('running','planning') THEN
    RAISE EXCEPTION 'Onda % não está ativa (status=%)', p_wave_id, v_status;
  END IF;

  UPDATE production_wave_stages
     SET status       = 'completed',
         progress_pct = 100,
         finished_at  = COALESCE(finished_at, now())
   WHERE wave_id = p_wave_id
     AND stage   = p_stage;

  v_next_stages := ARRAY[]::production_stage_enum[];

  IF p_stage = 'corte' THEN
    -- Libera Palmilha e Costura (Mesa já foi iniciada no start_wave)
    v_next_stages := ARRAY['palmilha','costura']::production_stage_enum[];

  ELSIF p_stage IN ('mesa','palmilha','costura') THEN
    -- Montagem só inicia quando os três (entre os existentes na onda) estiverem completos
    IF NOT EXISTS (
      SELECT 1 FROM production_wave_stages
       WHERE wave_id = p_wave_id
         AND stage IN ('mesa','palmilha','costura')
         AND status <> 'completed'
    ) THEN
      v_next_stages := ARRAY['montagem']::production_stage_enum[];
    END IF;

  ELSIF p_stage = 'montagem' THEN
    v_next_stages := ARRAY['solagem']::production_stage_enum[];

  ELSIF p_stage = 'solagem' THEN
    v_next_stages := ARRAY['acabamento']::production_stage_enum[];

  ELSIF p_stage = 'acabamento' THEN
    UPDATE production_waves
       SET status        = 'finished',
           finished_at   = COALESCE(finished_at, now()),
           current_stage = 'acabamento'
     WHERE id = p_wave_id;
    RETURN NULL;
  END IF;

  v_opened := NULL;
  FOREACH s IN ARRAY v_next_stages LOOP
    UPDATE production_wave_stages
       SET status     = 'in_progress',
           started_at = COALESCE(started_at, now())
     WHERE wave_id = p_wave_id
       AND stage   = s
       AND status  = 'pending';
    IF FOUND AND v_opened IS NULL THEN
      v_opened := s;
    END IF;
  END LOOP;

  IF v_opened IS NOT NULL THEN
    UPDATE production_waves
       SET current_stage = v_opened
     WHERE id = p_wave_id;
  END IF;

  RETURN v_opened;
END;
$$;

-- v_sector_board: Mesa não depende de Corte (independente); demais regras inalteradas
DROP VIEW IF EXISTS public.v_sector_board CASCADE;
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
   WHERE w.status IN ('planning','running')
)
SELECT stage,
       ord,
       (SELECT to_jsonb(t) FROM (
          SELECT s2.wave_id, s2.wave_code AS code, s2.week_start, s2.week_end,
                 s2.progress_pct, s2.total_pairs, s2.started_at
            FROM stages s2
           WHERE s2.stage = stages.stage
             AND s2.stage_status = 'in_progress'
           ORDER BY s2.week_start
           LIMIT 1
        ) t) AS active_wave,
       (SELECT to_jsonb(t) FROM (
          SELECT s3.wave_id, s3.wave_code AS code, s3.week_start
            FROM stages s3
           WHERE s3.stage = stages.stage
             AND s3.stage_status = 'pending'
             AND (
               CASE s3.stage
                 WHEN 'corte'    THEN TRUE
                 WHEN 'mesa'     THEN TRUE
                 WHEN 'palmilha' THEN EXISTS (
                   SELECT 1 FROM production_wave_stages ps
                    WHERE ps.wave_id = s3.wave_id AND ps.stage = 'corte' AND ps.status = 'completed'
                 )
                 WHEN 'costura'  THEN EXISTS (
                   SELECT 1 FROM production_wave_stages ps
                    WHERE ps.wave_id = s3.wave_id AND ps.stage = 'corte' AND ps.status = 'completed'
                 )
                 WHEN 'montagem' THEN NOT EXISTS (
                   SELECT 1 FROM production_wave_stages ps
                    WHERE ps.wave_id = s3.wave_id
                      AND ps.stage IN ('mesa','palmilha','costura')
                      AND ps.status <> 'completed'
                 )
                 WHEN 'solagem'  THEN EXISTS (
                   SELECT 1 FROM production_wave_stages ps
                    WHERE ps.wave_id = s3.wave_id AND ps.stage = 'montagem' AND ps.status = 'completed'
                 )
                 WHEN 'acabamento' THEN EXISTS (
                   SELECT 1 FROM production_wave_stages ps
                    WHERE ps.wave_id = s3.wave_id AND ps.stage = 'solagem' AND ps.status = 'completed'
                 )
               END
             )
           ORDER BY s3.week_start
           LIMIT 1
        ) t) AS next_wave,
       (SELECT count(*)
          FROM stages s4
         WHERE s4.stage = stages.stage AND s4.stage_status = 'completed') AS completed_count
  FROM stages
 GROUP BY stage, ord
 ORDER BY ord, stage;

GRANT SELECT ON public.v_sector_board TO authenticated;