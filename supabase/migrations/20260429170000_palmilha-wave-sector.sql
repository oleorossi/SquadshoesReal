-- Palmilha sector in production waves
--
-- Palmilha (insole cutting) runs PARALLEL with costura (sewing):
-- both sectors start as soon as corte finishes.
-- A wave can therefore be "in_progress" in palmilha AND costura simultaneously.
-- Mesa/montagem only start when ALL parallel level-2 stages (palmilha + costura) complete.
--
-- Stage order: corte(1) → palmilha(2) ‖ costura(2) → mesa(3) → montagem(4) → solagem(5) → acabamento(6)
--
-- Changes:
--   1. ADD 'palmilha' to production_stage_enum
--   2. stage_order(): palmilha=2 (parallel with costura=2)
--   3. create_production_wave: add palmilha stage when wave has items needing insole cutting
--   4. DROP old advance_wave_stage(uuid), CREATE advance_wave_stage(uuid, stage) with
--      parallel-stage awareness (complete specific stage; advance only when all same-level stages done)
--   5. v_sector_board: fix next_wave predecessor check for parallel stages

-- ── 1. Enum value ──────────────────────────────────────────────────────────────
ALTER TYPE public.production_stage_enum ADD VALUE IF NOT EXISTS 'palmilha' AFTER 'corte';

-- ── 2. stage_order ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stage_order(s production_stage_enum)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE s
    WHEN 'corte'      THEN 1
    WHEN 'palmilha'   THEN 2  -- parallel with costura
    WHEN 'costura'    THEN 2  -- parallel with palmilha
    WHEN 'mesa'       THEN 3
    WHEN 'montagem'   THEN 4
    WHEN 'solagem'    THEN 5
    WHEN 'acabamento' THEN 6
  END;
$$;

-- ── 3. create_production_wave ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_production_wave(
  p_week_start date,
  p_sale_order_ids uuid[]
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wave_id        uuid;
  v_code           text;
  v_week_end       date;
  v_row            RECORD;
  v_item_id        uuid;
  v_mesa_capacity  int := 0;
  v_needs_palmilha boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  v_week_end := p_week_start + 6;
  v_code := 'W' || to_char(p_week_start, 'IYYY-IW');

  INSERT INTO production_waves(code, week_start, week_end, status, created_by)
  VALUES (v_code, p_week_start, v_week_end, 'draft', auth.uid())
  ON CONFLICT (code) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_wave_id;

  -- Always insert the 5 base stages
  INSERT INTO production_wave_stages(wave_id, stage, status)
  SELECT v_wave_id, s::production_stage_enum, 'pending'
  FROM unnest(ARRAY['corte','costura','montagem','solagem','acabamento']) AS s
  ON CONFLICT DO NOTHING;

  -- Palmilha stage: needed when at least one item does NOT use ready-made insoles
  SELECT EXISTS (
    SELECT 1
    FROM sale_order_items soi
    JOIN technical_sheets ts ON ts.id = soi.reference_id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
      AND (ts.insole_ready_made IS NULL OR ts.insole_ready_made = false)
  ) INTO v_needs_palmilha;

  IF v_needs_palmilha THEN
    INSERT INTO production_wave_stages(wave_id, stage, status)
    VALUES (v_wave_id, 'palmilha', 'pending')
    ON CONFLICT DO NOTHING;
  END IF;

  -- Mesa stage: conditional on mesa_daily_capacity
  SELECT COALESCE(MAX(ts.mesa_daily_capacity), 0)
    INTO v_mesa_capacity
    FROM sale_order_items soi
    JOIN technical_sheets ts ON ts.id = soi.reference_id
   WHERE soi.sale_order_id = ANY(p_sale_order_ids)
     AND ts.mesa_daily_capacity > 0;

  IF v_mesa_capacity > 0 THEN
    INSERT INTO production_wave_stages(wave_id, stage, status, capacity_per_day)
    VALUES (v_wave_id, 'mesa', 'pending', v_mesa_capacity)
    ON CONFLICT DO NOTHING;
  END IF;

  FOR v_row IN
    SELECT
      soi.id              AS source_item_id,
      so.id               AS sale_order_id,
      so.client_id        AS client_id,
      COALESCE(c.razao_social, so.id::text) AS store_name,
      soi.reference_id    AS reference_id,
      COALESCE(soi.color, '') AS color,
      COALESCE(soi.quantity, 0)::numeric AS qty,
      COALESCE(soi.grade, '{}'::jsonb)  AS grade,
      (SELECT sole_product_id FROM resolve_sole_color(soi.reference_id, COALESCE(soi.color,''))) AS sole_id
    FROM sale_orders so
    JOIN sale_order_items soi ON soi.sale_order_id = so.id
    LEFT JOIN clients c ON c.id = so.client_id
    WHERE so.id = ANY(p_sale_order_ids)
  LOOP
    INSERT INTO production_wave_items(wave_id, reference_id, sole_product_id, color, total_quantity, grade)
    VALUES (v_wave_id, v_row.reference_id, v_row.sole_id, v_row.color, v_row.qty, v_row.grade)
    ON CONFLICT (wave_id, reference_id, sole_product_id, color)
    DO UPDATE SET total_quantity = production_wave_items.total_quantity + EXCLUDED.total_quantity
    RETURNING id INTO v_item_id;

    INSERT INTO production_wave_item_sources(
      wave_item_id, sale_order_id, sale_order_item_id, client_id, store_name, quantity, grade
    ) VALUES (
      v_item_id, v_row.sale_order_id, v_row.source_item_id, v_row.client_id, v_row.store_name,
      v_row.qty, v_row.grade
    );
  END LOOP;

  UPDATE production_waves w SET
    total_pairs = COALESCE((SELECT SUM(total_quantity) FROM production_wave_items WHERE wave_id = w.id), 0),
    total_items = COALESCE((SELECT COUNT(*) FROM production_wave_items WHERE wave_id = w.id), 0),
    status = 'planning'
  WHERE w.id = v_wave_id;

  RETURN v_wave_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_production_wave(date, uuid[]) TO authenticated;

-- ── 4. advance_wave_stage — parallel-stage aware ───────────────────────────────
-- Old signature (single-arg) is dropped so the caller must specify which stage
-- to complete. This is required for parallel stages (palmilha ‖ costura both
-- in_progress simultaneously).
DROP FUNCTION IF EXISTS public.advance_wave_stage(uuid);

CREATE OR REPLACE FUNCTION public.advance_wave_stage(
  p_wave_id uuid,
  p_stage   production_stage_enum
)
RETURNS production_stage_enum
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stage_ord int;
  v_next_ord  int;
  v_next      production_stage_enum;
  v_now       timestamptz := now();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  -- Verify the given stage is actually in_progress for this wave
  IF NOT EXISTS (
    SELECT 1 FROM production_wave_stages
    WHERE wave_id = p_wave_id AND stage = p_stage AND status = 'in_progress'
  ) THEN
    RAISE EXCEPTION 'Setor % não está em execução na onda %', p_stage, p_wave_id;
  END IF;

  v_stage_ord := stage_order(p_stage);

  -- Complete this specific stage
  UPDATE production_wave_stages
     SET status = 'completed', finished_at = v_now, updated_at = v_now
   WHERE wave_id = p_wave_id AND stage = p_stage;

  -- Wait: are there other stages at the SAME level still running/pending?
  IF EXISTS (
    SELECT 1 FROM production_wave_stages
    WHERE wave_id = p_wave_id
      AND stage_order(stage) = v_stage_ord
      AND status NOT IN ('completed', 'blocked')
  ) THEN
    -- Parallel partner (e.g. costura while palmilha just finished) still running.
    -- Do not advance to the next level yet.
    RETURN NULL;
  END IF;

  -- All stages at this level are done — find minimum order level above
  SELECT MIN(stage_order(stage)) INTO v_next_ord
    FROM production_wave_stages
   WHERE wave_id = p_wave_id
     AND stage_order(stage) > v_stage_ord
     AND status NOT IN ('completed', 'blocked');

  IF v_next_ord IS NULL THEN
    -- No more stages: wave is finished
    UPDATE production_waves
       SET status = 'finished', finished_at = v_now, current_stage = NULL
     WHERE id = p_wave_id;
    RETURN NULL;
  END IF;

  -- Start ALL stages at the next level simultaneously
  UPDATE production_wave_stages
     SET status = 'in_progress', operator_id = auth.uid(),
         started_at = v_now, updated_at = v_now
   WHERE wave_id = p_wave_id
     AND stage_order(stage) = v_next_ord
     AND status = 'pending';

  -- Set current_stage to the first of the newly started stages (alphabetical for determinism)
  SELECT stage INTO v_next
    FROM production_wave_stages
   WHERE wave_id = p_wave_id
     AND stage_order(stage) = v_next_ord
     AND status = 'in_progress'
   ORDER BY stage
   LIMIT 1;

  UPDATE production_waves SET current_stage = v_next WHERE id = p_wave_id;

  -- Trigger finishing split when acabamento starts
  IF EXISTS (
    SELECT 1 FROM production_wave_stages
    WHERE wave_id = p_wave_id AND stage = 'acabamento' AND status = 'in_progress'
  ) THEN
    PERFORM split_wave_to_finishing(p_wave_id);
  END IF;

  RETURN v_next;
END;
$$;

GRANT EXECUTE ON FUNCTION public.advance_wave_stage(uuid, production_stage_enum) TO authenticated;

-- ── 5. v_sector_board — fix parallel-stage predecessor check ───────────────────
-- next_wave: a wave's stage is ready to queue when ALL stages at the immediately
-- preceding order level are complete (not just any one of them).
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
            -- First level: no predecessor needed
            s3.ord = 1
            OR
            -- All stages at the immediately preceding level must be complete
            NOT EXISTS (
              SELECT 1
                FROM production_wave_stages prev_s
               WHERE prev_s.wave_id = s3.wave_id
                 AND stage_order(prev_s.stage) = (
                   SELECT MAX(stage_order(ps.stage))
                     FROM production_wave_stages ps
                    WHERE ps.wave_id = s3.wave_id
                      AND stage_order(ps.stage) < s3.ord
                 )
                 AND prev_s.status NOT IN ('completed', 'blocked')
            )
          )
        ORDER BY s3.week_start LIMIT 1) AS next_wave,
       (SELECT count(*)
          FROM stages s4
         WHERE s4.stage = stages.stage AND s4.stage_status = 'completed') AS completed_count
  FROM stages
 GROUP BY stage, ord
 ORDER BY ord, stage;

GRANT SELECT ON public.v_sector_board TO authenticated;
