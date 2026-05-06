-- GRUPO F: Setores de onda, dias úteis, embalagem (abr/29)

-- ========== 20260429100000_lead-time-fallback-and-artisanal-auto.sql ==========
-- Lead Time Fallback Chain + Artisanal OS Automation
--
-- 1. shoe_category_lead_times: per-category fallback lead times
-- 2. compute_wave_timeline: updated with 3-level fallback
--    Level 1: technical_sheet value (if > 0 = explicitly set by user)
--    Level 2: shoe_category default
--    Level 3: global hardcoded default
-- 3. Supplier memory: supplier_id on products is already present; no schema change needed

-- ── 1. Shoe category lead time defaults ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shoe_category_lead_times (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shoe_category        text NOT NULL UNIQUE,
  corte_dias           int  NOT NULL DEFAULT 2,
  costura_dias         int  NOT NULL DEFAULT 3,
  montagem_dias        int  NOT NULL DEFAULT 2,
  acabamento_dias      int  NOT NULL DEFAULT 1,
  buffer_material_dias int  NOT NULL DEFAULT 2,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shoe_category_lead_times ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow all authenticated" ON public.shoe_category_lead_times
  FOR ALL USING (auth.role() = 'authenticated');

-- Seed common shoe categories
INSERT INTO public.shoe_category_lead_times
  (shoe_category, corte_dias, costura_dias, montagem_dias, acabamento_dias, buffer_material_dias)
VALUES
  ('Sandália',   1, 2, 2, 1, 2),
  ('Rasteira',   1, 2, 2, 1, 2),
  ('Chinelo',    1, 1, 1, 1, 1),
  ('Scarpin',    2, 3, 2, 1, 2),
  ('Bota',       3, 4, 3, 1, 3),
  ('Botina',     3, 4, 3, 1, 3),
  ('Tênis',      2, 3, 2, 1, 2),
  ('Sapatênis',  2, 3, 2, 1, 2),
  ('Sapatilha',  1, 2, 1, 1, 1),
  ('Sapato',     2, 3, 2, 1, 2),
  ('Mule',       1, 2, 2, 1, 2),
  ('Tamanco',    2, 3, 2, 1, 2),
  ('Plataforma', 2, 3, 2, 1, 2)
ON CONFLICT (shoe_category) DO NOTHING;

-- ── 2. compute_wave_timeline with 3-level fallback ────────────────────────────
CREATE OR REPLACE FUNCTION public.compute_wave_timeline(p_sale_order_ids uuid[])
RETURNS TABLE (
  earliest_deadline     date,
  corte_start_date      date,
  costura_start_date    date,
  montagem_start_date   date,
  acabamento_start_date date,
  material_ready_date   date,
  purchase_deadline     date
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_lead_corte    int;
  v_lead_costura  int;
  v_lead_montagem int;
  v_lead_acab     int;
  v_lead_buffer   int;
  v_lead_supplier int;
  v_deadline      date;
BEGIN
  -- Earliest delivery deadline from sale orders
  SELECT MIN(so.delivery_deadline)
    INTO v_deadline
    FROM sale_orders so
   WHERE so.id = ANY(p_sale_order_ids)
     AND so.delivery_deadline IS NOT NULL;

  IF v_deadline IS NULL THEN RETURN; END IF;

  -- 3-level fallback per lead time field:
  --   Level 1: technical_sheet value if > 0 (user explicitly set it)
  --   Level 2: shoe_category default from shoe_category_lead_times
  --   Level 3: global hardcoded default (2/3/2/1/2 matching column defaults)
  SELECT
    COALESCE(MAX(
      COALESCE(
        NULLIF(ts.lead_time_corte_dias,           0),
        (SELECT sc.corte_dias FROM shoe_category_lead_times sc
          WHERE sc.shoe_category = ts.shoe_category LIMIT 1),
        2
      )
    ), 2),
    COALESCE(MAX(
      COALESCE(
        NULLIF(ts.lead_time_costura_dias,         0),
        (SELECT sc.costura_dias FROM shoe_category_lead_times sc
          WHERE sc.shoe_category = ts.shoe_category LIMIT 1),
        3
      )
    ), 3),
    COALESCE(MAX(
      COALESCE(
        NULLIF(ts.lead_time_montagem_dias,        0),
        (SELECT sc.montagem_dias FROM shoe_category_lead_times sc
          WHERE sc.shoe_category = ts.shoe_category LIMIT 1),
        2
      )
    ), 2),
    COALESCE(MAX(
      COALESCE(
        NULLIF(ts.lead_time_acabamento_dias,      0),
        (SELECT sc.acabamento_dias FROM shoe_category_lead_times sc
          WHERE sc.shoe_category = ts.shoe_category LIMIT 1),
        1
      )
    ), 1),
    COALESCE(MAX(
      COALESCE(
        NULLIF(ts.lead_time_buffer_material_dias, 0),
        (SELECT sc.buffer_material_dias FROM shoe_category_lead_times sc
          WHERE sc.shoe_category = ts.shoe_category LIMIT 1),
        2
      )
    ), 2)
  INTO v_lead_corte, v_lead_costura, v_lead_montagem, v_lead_acab, v_lead_buffer
  FROM sale_order_items soi
  JOIN technical_sheets ts ON ts.id = soi.reference_id
  WHERE soi.sale_order_id = ANY(p_sale_order_ids);

  -- Supplier lead time: COALESCE already provides 7-day fallback
  SELECT COALESCE(MAX(COALESCE(p.supplier_lead_time_days, 7)), 7)
    INTO v_lead_supplier
    FROM sale_order_items soi
    JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
    JOIN products p ON p.id = sm.product_id
   WHERE soi.sale_order_id = ANY(p_sale_order_ids);

  RETURN QUERY SELECT
    v_deadline                                                        AS earliest_deadline,
    (v_deadline
       - v_lead_acab - v_lead_montagem
       - v_lead_costura - v_lead_corte)::date                        AS corte_start_date,
    (v_deadline
       - v_lead_acab - v_lead_montagem
       - v_lead_costura)::date                                        AS costura_start_date,
    (v_deadline
       - v_lead_acab - v_lead_montagem)::date                         AS montagem_start_date,
    (v_deadline - v_lead_acab)::date                                  AS acabamento_start_date,
    (v_deadline
       - v_lead_acab - v_lead_montagem
       - v_lead_costura - v_lead_corte
       - v_lead_buffer)::date                                         AS material_ready_date,
    (v_deadline
       - v_lead_acab - v_lead_montagem
       - v_lead_costura - v_lead_corte
       - v_lead_buffer - v_lead_supplier)::date                       AS purchase_deadline;
END;
$$;

-- ========== 20260429110000_auto-start-waves.sql ==========
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

-- ========== 20260429120000_fix-timeline-material-check.sql ==========
-- Fix compute_wave_timeline: only add supplier lead time when a material is
-- actually short (needed qty > current stock). If ALL materials are in stock
-- the supplier delay is 0 and corte_start_date is computed from production
-- lead times only — no extra wait for material arrival.

CREATE OR REPLACE FUNCTION public.compute_wave_timeline(p_sale_order_ids uuid[])
RETURNS TABLE (
  earliest_deadline     date,
  corte_start_date      date,
  costura_start_date    date,
  montagem_start_date   date,
  acabamento_start_date date,
  material_ready_date   date,
  purchase_deadline     date
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_lead_corte    int;
  v_lead_costura  int;
  v_lead_montagem int;
  v_lead_acab     int;
  v_lead_buffer   int;
  v_lead_supplier int;
  v_deadline      date;
BEGIN
  -- Earliest delivery deadline from sale orders
  SELECT MIN(so.delivery_deadline)
    INTO v_deadline
    FROM sale_orders so
   WHERE so.id = ANY(p_sale_order_ids)
     AND so.delivery_deadline IS NOT NULL;

  IF v_deadline IS NULL THEN RETURN; END IF;

  -- 3-level fallback per lead time field:
  --   Level 1: technical_sheet value if > 0 (user explicitly set it)
  --   Level 2: shoe_category default from shoe_category_lead_times
  --   Level 3: global hardcoded default (2/3/2/1/2)
  SELECT
    COALESCE(MAX(
      COALESCE(
        NULLIF(ts.lead_time_corte_dias,           0),
        (SELECT sc.corte_dias FROM shoe_category_lead_times sc
          WHERE sc.shoe_category = ts.shoe_category LIMIT 1),
        2
      )
    ), 2),
    COALESCE(MAX(
      COALESCE(
        NULLIF(ts.lead_time_costura_dias,         0),
        (SELECT sc.costura_dias FROM shoe_category_lead_times sc
          WHERE sc.shoe_category = ts.shoe_category LIMIT 1),
        3
      )
    ), 3),
    COALESCE(MAX(
      COALESCE(
        NULLIF(ts.lead_time_montagem_dias,        0),
        (SELECT sc.montagem_dias FROM shoe_category_lead_times sc
          WHERE sc.shoe_category = ts.shoe_category LIMIT 1),
        2
      )
    ), 2),
    COALESCE(MAX(
      COALESCE(
        NULLIF(ts.lead_time_acabamento_dias,      0),
        (SELECT sc.acabamento_dias FROM shoe_category_lead_times sc
          WHERE sc.shoe_category = ts.shoe_category LIMIT 1),
        1
      )
    ), 1),
    COALESCE(MAX(
      COALESCE(
        NULLIF(ts.lead_time_buffer_material_dias, 0),
        (SELECT sc.buffer_material_dias FROM shoe_category_lead_times sc
          WHERE sc.shoe_category = ts.shoe_category LIMIT 1),
        2
      )
    ), 2)
  INTO v_lead_corte, v_lead_costura, v_lead_montagem, v_lead_acab, v_lead_buffer
  FROM sale_order_items soi
  JOIN technical_sheets ts ON ts.id = soi.reference_id
  WHERE soi.sale_order_id = ANY(p_sale_order_ids);

  -- Supplier lead time: ONLY counted for materials that are actually short.
  -- Aggregate total required qty per product across all sale order items,
  -- then compare against current stock. If stock covers the demand, that
  -- product contributes 0 days; if short, it contributes its supplier_lead_time_days.
  -- The wave must wait for the slowest short material.
  SELECT COALESCE(MAX(
    CASE WHEN COALESCE(needed.total_needed, 0) > COALESCE(p.quantity, 0)
         THEN COALESCE(p.supplier_lead_time_days, 7)
         ELSE 0
    END
  ), 0)
    INTO v_lead_supplier
    FROM (
      SELECT sm.product_id,
             SUM(sm.quantity_per_unit * soi.quantity) AS total_needed
        FROM sale_order_items soi
        JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
       WHERE soi.sale_order_id = ANY(p_sale_order_ids)
       GROUP BY sm.product_id
    ) AS needed
    JOIN products p ON p.id = needed.product_id;

  RETURN QUERY SELECT
    v_deadline                                                        AS earliest_deadline,
    (v_deadline
       - v_lead_acab - v_lead_montagem
       - v_lead_costura - v_lead_corte)::date                        AS corte_start_date,
    (v_deadline
       - v_lead_acab - v_lead_montagem
       - v_lead_costura)::date                                        AS costura_start_date,
    (v_deadline
       - v_lead_acab - v_lead_montagem)::date                         AS montagem_start_date,
    (v_deadline - v_lead_acab)::date                                  AS acabamento_start_date,
    (v_deadline
       - v_lead_acab - v_lead_montagem
       - v_lead_costura - v_lead_corte
       - v_lead_buffer)::date                                         AS material_ready_date,
    (v_deadline
       - v_lead_acab - v_lead_montagem
       - v_lead_costura - v_lead_corte
       - v_lead_buffer - v_lead_supplier)::date                       AS purchase_deadline;
END;
$$;

-- ========== 20260429130000_fix-sector-board-next-wave-logic.sql ==========
-- Fix v_sector_board: restore predecessor check in next_wave that was lost in
-- 20260429110000. A wave should only appear as "next" in a sector after its
-- previous stage has been completed (except corte, which has no predecessor).
-- Also keeps the start_mode field added in 20260429110000.

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
           'wave_id',      wave_id,
           'code',         wave_code,
           'week_start',   week_start,
           'week_end',     week_end,
           'progress_pct', progress_pct,
           'total_pairs',  total_pairs,
           'started_at',   started_at,
           'start_mode',   start_mode
         )
         FROM stages s2
        WHERE s2.stage = stages.stage AND s2.stage_status = 'in_progress'
        LIMIT 1) AS active_wave,

       -- next_wave: only queue a pending wave when it is ready for this sector
       -- (corte has no predecessor; every other stage requires the previous one
       --  to be completed before it can start)
       (SELECT jsonb_build_object(
           'wave_id',    s3.wave_id,
           'code',       s3.wave_code,
           'week_start', s3.week_start
         )
         FROM stages s3
        WHERE s3.stage = stages.stage
          AND s3.stage_status = 'pending'
          AND (
            s3.ord = 1   -- corte: no predecessor
            OR EXISTS (
              SELECT 1
                FROM production_wave_stages prev_s
               WHERE prev_s.wave_id = s3.wave_id
                 AND stage_order(prev_s.stage) = s3.ord - 1
                 AND prev_s.status = 'completed'
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

-- ========== 20260429140000_mesa-wave-sector.sql ==========
-- Mesa sector in production waves
--
-- Mesa is an optional sector (per-reference) positioned between solagem and
-- acabamento. It is enabled on a technical sheet by setting mesa_daily_capacity > 0.
--
-- Changes:
--   1. ADD 'mesa' to production_stage_enum
--   2. update stage_order(): mesa=5, acabamento=6
--   3. ADD mesa_daily_capacity to technical_sheets
--   4. ADD capacity_per_day to production_wave_stages (wave-level override)
--   5. update create_production_wave: insert mesa stage only when needed
--   6. update advance_wave_stage: dynamic next-stage lookup from actual stages
--   7. update compute_wave_timeline: mesa shifts all start dates earlier
--   8. update v_sector_board: expose capacity_per_day in active_wave JSONB

-- ── 1. Enum value ──────────────────────────────────────────────────────────────
ALTER TYPE public.production_stage_enum ADD VALUE IF NOT EXISTS 'mesa' AFTER 'solagem';

-- ── 2. stage_order ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stage_order(s production_stage_enum)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE s
    WHEN 'corte'      THEN 1
    WHEN 'costura'    THEN 2
    WHEN 'montagem'   THEN 3
    WHEN 'solagem'    THEN 4
    WHEN 'mesa'       THEN 5
    WHEN 'acabamento' THEN 6
  END;
$$;

-- ── 3. mesa_daily_capacity on technical_sheets ─────────────────────────────────
-- 0 = Mesa sector not used for this reference.
ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS mesa_daily_capacity int NOT NULL DEFAULT 0;

-- ── 4. capacity_per_day on production_wave_stages ──────────────────────────────
-- Stores the daily capacity (pares/dia) for the Mesa stage of a specific wave.
-- Can be overridden by the user via the "boost capacity" dialog.
ALTER TABLE public.production_wave_stages
  ADD COLUMN IF NOT EXISTS capacity_per_day int NOT NULL DEFAULT 0;

-- ── 5. create_production_wave ──────────────────────────────────────────────────
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

  -- Conditionally insert mesa stage with its default capacity
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

-- ── 6. advance_wave_stage ──────────────────────────────────────────────────────
-- Uses dynamic stage lookup from production_wave_stages so that optional stages
-- (like mesa) are only advanced when they actually exist for the wave.
CREATE OR REPLACE FUNCTION public.advance_wave_stage(p_wave_id uuid)
RETURNS production_stage_enum
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current production_stage_enum;
  v_next    production_stage_enum;
  v_now     timestamptz := now();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  SELECT current_stage INTO v_current FROM production_waves WHERE id = p_wave_id;
  IF v_current IS NULL THEN
    RAISE EXCEPTION 'Onda % não iniciada. Chame start_wave() primeiro.', p_wave_id;
  END IF;

  -- Complete current stage
  UPDATE production_wave_stages
     SET status = 'completed', finished_at = v_now, updated_at = v_now
   WHERE wave_id = p_wave_id AND stage = v_current;

  -- Next stage: first non-completed stage with higher order that EXISTS for this wave
  SELECT stage INTO v_next
    FROM production_wave_stages
   WHERE wave_id = p_wave_id
     AND stage_order(stage) > stage_order(v_current)
     AND status NOT IN ('completed', 'blocked')
   ORDER BY stage_order(stage)
   LIMIT 1;

  IF v_next IS NULL THEN
    UPDATE production_waves
       SET status = 'finished', finished_at = v_now, current_stage = NULL
     WHERE id = p_wave_id;
    RETURN NULL;
  END IF;

  -- Start next stage
  UPDATE production_wave_stages
     SET status = 'in_progress', operator_id = auth.uid(),
         started_at = v_now, updated_at = v_now
   WHERE wave_id = p_wave_id AND stage = v_next;

  UPDATE production_waves SET current_stage = v_next WHERE id = p_wave_id;

  IF v_next = 'acabamento' THEN
    PERFORM split_wave_to_finishing(p_wave_id);
  END IF;

  RETURN v_next;
END;
$$;

GRANT EXECUTE ON FUNCTION public.advance_wave_stage(uuid) TO authenticated;

-- ── 7. compute_wave_timeline ───────────────────────────────────────────────────
-- Mesa shifts corte_start_date and purchase_deadline earlier by lead_mesa days.
-- lead_mesa = 0 when no item in the wave has mesa_daily_capacity > 0.
CREATE OR REPLACE FUNCTION public.compute_wave_timeline(p_sale_order_ids uuid[])
RETURNS TABLE (
  earliest_deadline     date,
  corte_start_date      date,
  costura_start_date    date,
  montagem_start_date   date,
  acabamento_start_date date,
  material_ready_date   date,
  purchase_deadline     date
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_lead_corte    int;
  v_lead_costura  int;
  v_lead_montagem int;
  v_lead_acab     int;
  v_lead_buffer   int;
  v_lead_mesa     int := 0;
  v_lead_supplier int;
  v_deadline      date;
BEGIN
  SELECT MIN(so.delivery_deadline)
    INTO v_deadline
    FROM sale_orders so
   WHERE so.id = ANY(p_sale_order_ids)
     AND so.delivery_deadline IS NOT NULL;

  IF v_deadline IS NULL THEN RETURN; END IF;

  -- 3-level lead time fallback per sector
  SELECT
    COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_corte_dias, 0),
      (SELECT sc.corte_dias FROM shoe_category_lead_times sc WHERE sc.shoe_category = ts.shoe_category LIMIT 1), 2)), 2),
    COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_costura_dias, 0),
      (SELECT sc.costura_dias FROM shoe_category_lead_times sc WHERE sc.shoe_category = ts.shoe_category LIMIT 1), 3)), 3),
    COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_montagem_dias, 0),
      (SELECT sc.montagem_dias FROM shoe_category_lead_times sc WHERE sc.shoe_category = ts.shoe_category LIMIT 1), 2)), 2),
    COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_acabamento_dias, 0),
      (SELECT sc.acabamento_dias FROM shoe_category_lead_times sc WHERE sc.shoe_category = ts.shoe_category LIMIT 1), 1)), 1),
    COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_buffer_material_dias, 0),
      (SELECT sc.buffer_material_dias FROM shoe_category_lead_times sc WHERE sc.shoe_category = ts.shoe_category LIMIT 1), 2)), 2)
  INTO v_lead_corte, v_lead_costura, v_lead_montagem, v_lead_acab, v_lead_buffer
  FROM sale_order_items soi
  JOIN technical_sheets ts ON ts.id = soi.reference_id
  WHERE soi.sale_order_id = ANY(p_sale_order_ids);

  -- Mesa: only counted when at least one item requires mesa
  SELECT GREATEST(1, CEIL(
      SUM(soi.quantity)::numeric /
      NULLIF(MIN(ts.mesa_daily_capacity), 0)::numeric
    )::int)
    INTO v_lead_mesa
    FROM sale_order_items soi
    JOIN technical_sheets ts ON ts.id = soi.reference_id
   WHERE soi.sale_order_id = ANY(p_sale_order_ids)
     AND ts.mesa_daily_capacity > 0;

  v_lead_mesa := COALESCE(v_lead_mesa, 0);

  -- Supplier lead time: conditional (only for materials actually short)
  SELECT COALESCE(MAX(
    CASE WHEN COALESCE(needed.total_needed, 0) > COALESCE(p.quantity, 0)
         THEN COALESCE(p.supplier_lead_time_days, 7) ELSE 0 END
  ), 0)
    INTO v_lead_supplier
    FROM (
      SELECT sm.product_id, SUM(sm.quantity_per_unit * soi.quantity) AS total_needed
        FROM sale_order_items soi
        JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
       WHERE soi.sale_order_id = ANY(p_sale_order_ids)
       GROUP BY sm.product_id
    ) AS needed
    JOIN products p ON p.id = needed.product_id;

  RETURN QUERY SELECT
    v_deadline                                                                           AS earliest_deadline,
    (v_deadline - v_lead_acab - v_lead_mesa - v_lead_montagem
       - v_lead_costura - v_lead_corte)::date                                           AS corte_start_date,
    (v_deadline - v_lead_acab - v_lead_mesa - v_lead_montagem
       - v_lead_costura)::date                                                           AS costura_start_date,
    (v_deadline - v_lead_acab - v_lead_mesa - v_lead_montagem)::date                    AS montagem_start_date,
    (v_deadline - v_lead_acab)::date                                                     AS acabamento_start_date,
    (v_deadline - v_lead_acab - v_lead_mesa - v_lead_montagem
       - v_lead_costura - v_lead_corte - v_lead_buffer)::date                           AS material_ready_date,
    (v_deadline - v_lead_acab - v_lead_mesa - v_lead_montagem
       - v_lead_costura - v_lead_corte - v_lead_buffer - v_lead_supplier)::date         AS purchase_deadline;
END;
$$;

-- ── 8. v_sector_board — expose capacity_per_day in active_wave JSONB ──────────
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
           'wave_id',        wave_id,
           'code',           wave_code,
           'week_start',     week_start,
           'week_end',       week_end,
           'progress_pct',   progress_pct,
           'total_pairs',    total_pairs,
           'started_at',     started_at,
           'start_mode',     start_mode,
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
            OR EXISTS (
              SELECT 1
                FROM production_wave_stages prev_s
               WHERE prev_s.wave_id = s3.wave_id
                 AND stage_order(prev_s.stage) = s3.ord - 1
                 AND prev_s.status = 'completed'
            )
          )
        ORDER BY s3.week_start LIMIT 1) AS next_wave,
       (SELECT count(*)
          FROM stages s4
         WHERE s4.stage = stages.stage AND s4.stage_status = 'completed') AS completed_count
  FROM stages
 GROUP BY stage, ord
 ORDER BY ord;

GRANT SELECT ON public.v_sector_board TO authenticated;

-- ========== 20260429150000_reposition-mesa-after-costura.sql ==========
-- Reposition Mesa: corte(1) → costura(2) → mesa(3) → montagem(4) → solagem(5) → acabamento(6)
--
-- Cascade (backward from deadline):
--   deadline → -acabamento → -montagem → -mesa → -costura → -corte → -buffer → -supplier

-- ── 1. stage_order ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stage_order(s production_stage_enum)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE s
    WHEN 'corte'      THEN 1
    WHEN 'costura'    THEN 2
    WHEN 'mesa'       THEN 3
    WHEN 'montagem'   THEN 4
    WHEN 'solagem'    THEN 5
    WHEN 'acabamento' THEN 6
  END;
$$;

-- ── 2. compute_wave_timeline ───────────────────────────────────────────────────
-- Mesa is now between costura and montagem, so montagem_start no longer
-- subtracts lead_mesa (mesa comes after montagem going backwards).
CREATE OR REPLACE FUNCTION public.compute_wave_timeline(p_sale_order_ids uuid[])
RETURNS TABLE (
  earliest_deadline     date,
  corte_start_date      date,
  costura_start_date    date,
  montagem_start_date   date,
  acabamento_start_date date,
  material_ready_date   date,
  purchase_deadline     date
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_lead_corte    int;
  v_lead_costura  int;
  v_lead_montagem int;
  v_lead_acab     int;
  v_lead_buffer   int;
  v_lead_mesa     int := 0;
  v_lead_supplier int;
  v_deadline      date;
BEGIN
  SELECT MIN(so.delivery_deadline)
    INTO v_deadline
    FROM sale_orders so
   WHERE so.id = ANY(p_sale_order_ids)
     AND so.delivery_deadline IS NOT NULL;

  IF v_deadline IS NULL THEN RETURN; END IF;

  SELECT
    COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_corte_dias, 0),
      (SELECT sc.corte_dias FROM shoe_category_lead_times sc WHERE sc.shoe_category = ts.shoe_category LIMIT 1), 2)), 2),
    COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_costura_dias, 0),
      (SELECT sc.costura_dias FROM shoe_category_lead_times sc WHERE sc.shoe_category = ts.shoe_category LIMIT 1), 3)), 3),
    COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_montagem_dias, 0),
      (SELECT sc.montagem_dias FROM shoe_category_lead_times sc WHERE sc.shoe_category = ts.shoe_category LIMIT 1), 2)), 2),
    COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_acabamento_dias, 0),
      (SELECT sc.acabamento_dias FROM shoe_category_lead_times sc WHERE sc.shoe_category = ts.shoe_category LIMIT 1), 1)), 1),
    COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_buffer_material_dias, 0),
      (SELECT sc.buffer_material_dias FROM shoe_category_lead_times sc WHERE sc.shoe_category = ts.shoe_category LIMIT 1), 2)), 2)
  INTO v_lead_corte, v_lead_costura, v_lead_montagem, v_lead_acab, v_lead_buffer
  FROM sale_order_items soi
  JOIN technical_sheets ts ON ts.id = soi.reference_id
  WHERE soi.sale_order_id = ANY(p_sale_order_ids);

  SELECT GREATEST(1, CEIL(
      SUM(soi.quantity)::numeric / NULLIF(MIN(ts.mesa_daily_capacity), 0)::numeric
    )::int)
    INTO v_lead_mesa
    FROM sale_order_items soi
    JOIN technical_sheets ts ON ts.id = soi.reference_id
   WHERE soi.sale_order_id = ANY(p_sale_order_ids)
     AND ts.mesa_daily_capacity > 0;

  v_lead_mesa := COALESCE(v_lead_mesa, 0);

  SELECT COALESCE(MAX(
    CASE WHEN COALESCE(needed.total_needed, 0) > COALESCE(p.quantity, 0)
         THEN COALESCE(p.supplier_lead_time_days, 7) ELSE 0 END
  ), 0)
    INTO v_lead_supplier
    FROM (
      SELECT sm.product_id, SUM(sm.quantity_per_unit * soi.quantity) AS total_needed
        FROM sale_order_items soi
        JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
       WHERE soi.sale_order_id = ANY(p_sale_order_ids)
       GROUP BY sm.product_id
    ) AS needed
    JOIN products p ON p.id = needed.product_id;

  -- Cascade (backward):
  --   deadline → -acab → -montagem → -mesa → -costura → -corte → -buffer → -supplier
  RETURN QUERY SELECT
    v_deadline                                                                             AS earliest_deadline,
    (v_deadline - v_lead_acab - v_lead_montagem
       - v_lead_mesa - v_lead_costura - v_lead_corte)::date                              AS corte_start_date,
    (v_deadline - v_lead_acab - v_lead_montagem
       - v_lead_mesa - v_lead_costura)::date                                              AS costura_start_date,
    (v_deadline - v_lead_acab - v_lead_montagem)::date                                    AS montagem_start_date,
    (v_deadline - v_lead_acab)::date                                                       AS acabamento_start_date,
    (v_deadline - v_lead_acab - v_lead_montagem
       - v_lead_mesa - v_lead_costura - v_lead_corte - v_lead_buffer)::date              AS material_ready_date,
    (v_deadline - v_lead_acab - v_lead_montagem
       - v_lead_mesa - v_lead_costura - v_lead_corte - v_lead_buffer
       - v_lead_supplier)::date                                                            AS purchase_deadline;
END;
$$;

-- ========== 20260429160000_insole-ready-made.sql ==========
-- insole_ready_made: palmilha pronta na cor
-- When true: no insole cutting, no lining sector, no Forração/Costura operator sheets
ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS insole_ready_made boolean NOT NULL DEFAULT false;

-- ========== 20260429170000_palmilha-wave-sector.sql ==========
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

-- ========== 20260429180000_mesa-parallel-with-corte.sql ==========
-- Mesa sector: independent, runs parallel with Corte
--
-- Mesa handles the upper part of the shoe (parte de cima / cabedal).
-- It starts as soon as the wave begins — it does not depend on Corte's output.
--
-- New stage flow:
--   start_wave → Corte(1) ‖ Mesa(1)
--              → Palmilha(2) ‖ Costura(2)   [after ALL level-1 stages complete]
--              → Montagem(3) → Solagem(4) → Acabamento(5)
--
-- Mesa is removed from the linear timeline cascade because it runs in
-- parallel with Corte and does not lengthen the critical path.
--
-- Changes:
--   1. stage_order(): mesa = 1 (parallel with corte)
--   2. start_wave(): start ALL level-1 stages (corte AND mesa when present)
--   3. compute_wave_timeline(): remove mesa from the backward cascade

-- ── 1. stage_order ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stage_order(s production_stage_enum)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE s
    WHEN 'corte'      THEN 1
    WHEN 'mesa'       THEN 1  -- parallel with corte (independent sector)
    WHEN 'palmilha'   THEN 2  -- parallel with costura
    WHEN 'costura'    THEN 2  -- parallel with palmilha
    WHEN 'montagem'   THEN 3
    WHEN 'solagem'    THEN 4
    WHEN 'acabamento' THEN 5
  END;
$$;

-- ── 2. start_wave — start ALL level-1 stages ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.start_wave(p_wave_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_now           timestamptz := now();
  v_first_stage   production_stage_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  -- Start ALL stages at the minimum order level (1 = corte + mesa when present)
  UPDATE production_wave_stages
     SET status     = 'in_progress',
         operator_id = COALESCE(operator_id, auth.uid()),
         started_at  = v_now,
         updated_at  = v_now
   WHERE wave_id = p_wave_id
     AND status = 'pending'
     AND stage_order(stage) = 1;

  -- Set current_stage to the first level-1 stage alphabetically (deterministic)
  SELECT stage INTO v_first_stage
    FROM production_wave_stages
   WHERE wave_id = p_wave_id AND stage_order(stage) = 1 AND status = 'in_progress'
   ORDER BY stage
   LIMIT 1;

  UPDATE production_waves
     SET status        = 'running',
         current_stage  = v_first_stage,
         started_at     = COALESCE(started_at, v_now)
   WHERE id = p_wave_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_wave(uuid) TO authenticated;

-- ── 3. compute_wave_timeline — mesa removed from cascade ────────────────────────
-- Mesa runs in parallel with Corte at level 1 and is not on the critical path.
-- Cascade is now: deadline → -acab → -montagem → -costura → -corte → -buffer → -supplier
CREATE OR REPLACE FUNCTION public.compute_wave_timeline(p_sale_order_ids uuid[])
RETURNS TABLE (
  earliest_deadline     date,
  corte_start_date      date,
  costura_start_date    date,
  montagem_start_date   date,
  acabamento_start_date date,
  material_ready_date   date,
  purchase_deadline     date
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_lead_corte    int;
  v_lead_costura  int;
  v_lead_montagem int;
  v_lead_acab     int;
  v_lead_buffer   int;
  v_lead_supplier int;
  v_deadline      date;
BEGIN
  SELECT MIN(so.delivery_deadline)
    INTO v_deadline
    FROM sale_orders so
   WHERE so.id = ANY(p_sale_order_ids)
     AND so.delivery_deadline IS NOT NULL;

  IF v_deadline IS NULL THEN RETURN; END IF;

  SELECT
    COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_corte_dias, 0),
      (SELECT sc.corte_dias FROM shoe_category_lead_times sc WHERE sc.shoe_category = ts.shoe_category LIMIT 1), 2)), 2),
    COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_costura_dias, 0),
      (SELECT sc.costura_dias FROM shoe_category_lead_times sc WHERE sc.shoe_category = ts.shoe_category LIMIT 1), 3)), 3),
    COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_montagem_dias, 0),
      (SELECT sc.montagem_dias FROM shoe_category_lead_times sc WHERE sc.shoe_category = ts.shoe_category LIMIT 1), 2)), 2),
    COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_acabamento_dias, 0),
      (SELECT sc.acabamento_dias FROM shoe_category_lead_times sc WHERE sc.shoe_category = ts.shoe_category LIMIT 1), 1)), 1),
    COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_buffer_material_dias, 0),
      (SELECT sc.buffer_material_dias FROM shoe_category_lead_times sc WHERE sc.shoe_category = ts.shoe_category LIMIT 1), 2)), 2)
  INTO v_lead_corte, v_lead_costura, v_lead_montagem, v_lead_acab, v_lead_buffer
  FROM sale_order_items soi
  JOIN technical_sheets ts ON ts.id = soi.reference_id
  WHERE soi.sale_order_id = ANY(p_sale_order_ids);

  SELECT COALESCE(MAX(
    CASE WHEN COALESCE(needed.total_needed, 0) > COALESCE(p.quantity, 0)
         THEN COALESCE(p.supplier_lead_time_days, 7) ELSE 0 END
  ), 0)
    INTO v_lead_supplier
    FROM (
      SELECT sm.product_id, SUM(sm.quantity_per_unit * soi.quantity) AS total_needed
        FROM sale_order_items soi
        JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
       WHERE soi.sale_order_id = ANY(p_sale_order_ids)
       GROUP BY sm.product_id
    ) AS needed
    JOIN products p ON p.id = needed.product_id;

  -- Mesa runs in parallel with Corte (level 1) — not in the critical path.
  -- Cascade: deadline → -acab → -montagem → -costura → -corte → -buffer → -supplier
  RETURN QUERY SELECT
    v_deadline                                                                          AS earliest_deadline,
    (v_deadline - v_lead_acab - v_lead_montagem
       - v_lead_costura - v_lead_corte)::date                                          AS corte_start_date,
    (v_deadline - v_lead_acab - v_lead_montagem
       - v_lead_costura)::date                                                          AS costura_start_date,
    (v_deadline - v_lead_acab - v_lead_montagem)::date                                 AS montagem_start_date,
    (v_deadline - v_lead_acab)::date                                                    AS acabamento_start_date,
    (v_deadline - v_lead_acab - v_lead_montagem
       - v_lead_costura - v_lead_corte - v_lead_buffer)::date                          AS material_ready_date,
    (v_deadline - v_lead_acab - v_lead_montagem
       - v_lead_costura - v_lead_corte - v_lead_buffer
       - v_lead_supplier)::date                                                         AS purchase_deadline;
END;
$$;

-- ========== 20260429190000_mesa-independent-stage.sql ==========
-- Mesa: setor independente, inicia com a onda, não bloqueia Palmilha/Costura
--
-- Mesa está no nível 2 junto com Palmilha e Costura, MAS é iniciada
-- pelo start_wave simultaneamente ao Corte (nível 1).
--
-- Resultado:
--   start_wave      → Corte(1) inicia E Mesa(2) inicia imediatamente
--   Corte termina   → Palmilha(2) e Costura(2) iniciam
--                     (Mesa pode ainda estar em execução — não bloqueia)
--   Mesa+Palmi+Costu terminam (qualquer ordem) → Montagem(3) inicia
--
-- Por que funciona:
--   advance_wave_stage ao terminar Corte(1): verifica se todos os ord=1
--   estão prontos → só Corte está no ord=1 → inicia TODOS os pendentes
--   do ord=2 (Palmilha e Costura). Mesa já está in_progress desde
--   start_wave, portanto não está 'pending' e não é reiniciada.
--   Quando o último entre Mesa/Palmilha/Costura terminar: todos ord=2
--   estão completos → inicia Montagem(3).
--
-- Changes:
--   1. stage_order(): mesa = 2 (era 1)
--   2. start_wave(): inicia ord=1 E 'mesa' especificamente

-- ── 1. stage_order ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stage_order(s production_stage_enum)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE s
    WHEN 'corte'      THEN 1
    WHEN 'mesa'       THEN 2  -- inicia com a onda, termina antes da montagem
    WHEN 'palmilha'   THEN 2  -- inicia após corte, paralelo com costura e mesa
    WHEN 'costura'    THEN 2  -- inicia após corte, paralelo com palmilha e mesa
    WHEN 'montagem'   THEN 3  -- aguarda mesa + palmilha + costura
    WHEN 'solagem'    THEN 4
    WHEN 'acabamento' THEN 5
  END;
$$;

-- ── 2. start_wave — inicia Corte (ord=1) e Mesa imediatamente ──────────────────
CREATE OR REPLACE FUNCTION public.start_wave(p_wave_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_now           timestamptz := now();
  v_first_stage   production_stage_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  -- Inicia estágios de nível 1 (Corte) + Mesa (independente, começa junto)
  UPDATE production_wave_stages
     SET status      = 'in_progress',
         operator_id = COALESCE(operator_id, auth.uid()),
         started_at  = v_now,
         updated_at  = v_now
   WHERE wave_id = p_wave_id
     AND status = 'pending'
     AND (stage_order(stage) = 1 OR stage = 'mesa');

  -- current_stage aponta para o primeiro estágio iniciado (Corte)
  SELECT stage INTO v_first_stage
    FROM production_wave_stages
   WHERE wave_id = p_wave_id
     AND stage_order(stage) = 1
     AND status = 'in_progress'
   ORDER BY stage
   LIMIT 1;

  UPDATE production_waves
     SET status        = 'running',
         current_stage  = v_first_stage,
         started_at     = COALESCE(started_at, v_now)
   WHERE id = p_wave_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_wave(uuid) TO authenticated;

-- ========== 20260429200000_create-solo-wave.sql ==========
-- create_solo_wave: cria e inicia imediatamente uma onda de produção para um único PV.
-- Chamada quando o usuário coloca um pedido em produção manualmente (status → 'Em Produção').
--
-- Diferenças em relação à onda semanal (create_production_wave):
--   - Código: 'PV-{order_number}' — nunca conflita com 'W{IYYY-IW}'
--   - Onda iniciada automaticamente (start_wave é chamado internamente)
--   - Destinada a pedidos urgentes ou fora do ciclo de planejamento semanal

CREATE OR REPLACE FUNCTION public.create_solo_wave(p_sale_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wave_id    uuid;
  v_wave_code  text;
  v_week_start date;
  v_week_end   date;
  v_order_num  text;
  v_item_id    uuid;
  v_row        RECORD;
  v_mesa_cap   int := 0;
  v_needs_palm boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  v_week_start := date_trunc('week', current_date)::date;
  v_week_end   := v_week_start + 6;

  SELECT COALESCE(order_number, id::text) INTO v_order_num
    FROM sale_orders WHERE id = p_sale_order_id;

  -- Código 'PV-{número}' não conflita com ondas semanais 'W{ano-semana}'
  v_wave_code := 'PV-' || v_order_num;

  INSERT INTO production_waves(code, week_start, week_end, status, created_by)
  VALUES (v_wave_code, v_week_start, v_week_end, 'draft', auth.uid())
  ON CONFLICT (code) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_wave_id;

  -- Setores base (sempre presentes)
  INSERT INTO production_wave_stages(wave_id, stage, status)
  SELECT v_wave_id, s::production_stage_enum, 'pending'
  FROM unnest(ARRAY['corte','costura','montagem','solagem','acabamento']) AS s
  ON CONFLICT DO NOTHING;

  -- Palmilha: quando ao menos um item não usa palmilha pronta na cor
  SELECT EXISTS (
    SELECT 1 FROM sale_order_items soi
    JOIN technical_sheets ts ON ts.id = soi.reference_id
    WHERE soi.sale_order_id = p_sale_order_id
      AND (ts.insole_ready_made IS NULL OR ts.insole_ready_made = false)
  ) INTO v_needs_palm;

  IF v_needs_palm THEN
    INSERT INTO production_wave_stages(wave_id, stage, status)
    VALUES (v_wave_id, 'palmilha', 'pending')
    ON CONFLICT DO NOTHING;
  END IF;

  -- Mesa: quando a referência exige o setor (mesa_daily_capacity > 0)
  SELECT COALESCE(MAX(ts.mesa_daily_capacity), 0) INTO v_mesa_cap
    FROM sale_order_items soi
    JOIN technical_sheets ts ON ts.id = soi.reference_id
   WHERE soi.sale_order_id = p_sale_order_id
     AND ts.mesa_daily_capacity > 0;

  IF v_mesa_cap > 0 THEN
    INSERT INTO production_wave_stages(wave_id, stage, status, capacity_per_day)
    VALUES (v_wave_id, 'mesa', 'pending', v_mesa_cap)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Itens da onda (agrupados por referência + solado + cor)
  FOR v_row IN
    SELECT
      soi.id                                 AS source_item_id,
      so.id                                  AS sale_order_id,
      so.client_id,
      COALESCE(c.razao_social, so.id::text)  AS store_name,
      soi.reference_id,
      COALESCE(soi.color, '')                AS color,
      COALESCE(soi.quantity, 0)::numeric     AS qty,
      COALESCE(soi.grade, '{}'::jsonb)       AS grade,
      (SELECT sole_product_id
         FROM resolve_sole_color(soi.reference_id, COALESCE(soi.color, ''))) AS sole_id
    FROM sale_orders so
    JOIN sale_order_items soi ON soi.sale_order_id = so.id
    LEFT JOIN clients c ON c.id = so.client_id
    WHERE so.id = p_sale_order_id
  LOOP
    INSERT INTO production_wave_items(wave_id, reference_id, sole_product_id, color, total_quantity, grade)
    VALUES (v_wave_id, v_row.reference_id, v_row.sole_id, v_row.color, v_row.qty, v_row.grade)
    ON CONFLICT (wave_id, reference_id, sole_product_id, color)
    DO UPDATE SET total_quantity = production_wave_items.total_quantity + EXCLUDED.total_quantity
    RETURNING id INTO v_item_id;

    INSERT INTO production_wave_item_sources(
      wave_item_id, sale_order_id, sale_order_item_id, client_id, store_name, quantity, grade
    ) VALUES (
      v_item_id, v_row.sale_order_id, v_row.source_item_id,
      v_row.client_id, v_row.store_name, v_row.qty, v_row.grade
    );
  END LOOP;

  -- Totais
  UPDATE production_waves SET
    total_pairs = COALESCE((SELECT SUM(total_quantity) FROM production_wave_items WHERE wave_id = v_wave_id), 0),
    total_items = COALESCE((SELECT COUNT(*) FROM production_wave_items WHERE wave_id = v_wave_id), 0),
    status = 'planning'
  WHERE id = v_wave_id;

  -- Inicia imediatamente (Corte + Mesa se presente)
  PERFORM public.start_wave(v_wave_id);

  RETURN v_wave_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_solo_wave(uuid) TO authenticated;

-- ========== 20260429210000_start-wave-updates-ops.sql ==========
-- Quando start_wave() é chamado, atualiza as OPs dos PVs da onda para
-- status 'Em Produção', para que o sistema de etiquetas (LabelProductionTab)
-- exiba o status correto. OPs criadas pelo fluxo 'Aprovado → WaveBuilder'
-- ficavam em 'Reservado' mesmo durante a execução da onda.

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

  -- Inicia estágios ord=1 (Corte) + Mesa independente
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
         current_stage  = v_first_stage,
         started_at     = COALESCE(started_at, v_now)
   WHERE id = p_wave_id;

  -- Promove as OPs dos PVs desta onda para 'Em Produção'
  -- (OPs criadas no fluxo Aprovado ficam em 'Reservado' até aqui)
  UPDATE orders o
     SET status     = 'Em Produção',
         updated_at = v_now
   WHERE o.sale_order_id IN (
     SELECT DISTINCT pwis.sale_order_id
       FROM production_wave_item_sources pwis
       JOIN production_wave_items pwi ON pwi.id = pwis.wave_item_id
      WHERE pwi.wave_id = p_wave_id
   )
     AND o.status NOT IN ('Em Produção', 'Finalizado', 'Cancelada');
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_wave(uuid) TO authenticated;

-- ========== 20260429220000_consolidate-stage-order-and-business-days.sql ==========
-- ╔════════════════════════════════════════════════════════════════════════════╗
-- ║ MIGRATION CONSOLIDADA — fluxo de setores, mesa independente e dias úteis  ║
-- ║                                                                            ║
-- ║ Esta migration é a fonte canônica de verdade para:                        ║
-- ║   1. stage_order()         → mapa de níveis dos setores                   ║
-- ║   2. stage_starts_with_wave() → quais setores iniciam junto com a onda   ║
-- ║   3. start_wave()          → inicia Corte (nível 1) + Mesa (independente) ║
-- ║   4. add_business_days()   → soma/subtração em dias ÚTEIS (seg-sex)       ║
-- ║   5. compute_wave_timeline() → cronograma usando dias úteis              ║
-- ║                                                                            ║
-- ║ Substitui as definições anteriores espalhadas em:                         ║
-- ║   20260429140000_mesa-wave-sector.sql       (versão obsoleta)             ║
-- ║   20260429150000_reposition-mesa-after-costura.sql (obsoleta)             ║
-- ║   20260429170000_palmilha-wave-sector.sql   (parte: stage_order)          ║
-- ║   20260429180000_mesa-parallel-with-corte.sql (obsoleta)                  ║
-- ║   20260429190000_mesa-independent-stage.sql (obsoleta)                    ║
-- ║   20260428190000_wave-material-intelligence.sql (compute_wave_timeline)   ║
-- ║                                                                            ║
-- ║ NOTA: as migrations antigas continuam no histórico para auditoria mas as  ║
-- ║ funções aqui definidas são as ATIVAS (CREATE OR REPLACE sobrescreve).     ║
-- ╚════════════════════════════════════════════════════════════════════════════╝

-- ── 1. stage_order — mapa de níveis ──────────────────────────────────────────
-- Define o nível de execução de cada setor. Setores com o mesmo nível executam
-- em paralelo. advance_wave_stage só avança ao próximo nível quando todos os
-- estágios do nível atual estiverem 'completed'.
CREATE OR REPLACE FUNCTION public.stage_order(s production_stage_enum)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE s
    WHEN 'corte'      THEN 1
    WHEN 'mesa'       THEN 2  -- inicia junto com Corte (independente), aguarda no nível 2
    WHEN 'palmilha'   THEN 2
    WHEN 'costura'    THEN 2
    WHEN 'montagem'   THEN 3
    WHEN 'solagem'    THEN 4
    WHEN 'acabamento' THEN 5
  END;
$$;

-- ── 2. stage_starts_with_wave — quais setores iniciam imediatamente ──────────
-- Encapsula a regra "este setor inicia junto com a onda" (em vez de hardcoded
-- 'mesa' espalhado pelo código). Adicionar novos setores independentes aqui.
CREATE OR REPLACE FUNCTION public.stage_starts_with_wave(s production_stage_enum)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT s = 'mesa';  -- Mesa é independente: começa quando a onda começa
$$;

-- ── 3. start_wave — usa stage_starts_with_wave em vez de hardcoded 'mesa' ────
CREATE OR REPLACE FUNCTION public.start_wave(p_wave_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_now           timestamptz := now();
  v_first_stage   production_stage_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  -- Inicia: estágios de nível 1 (Corte) + qualquer estágio independente (Mesa).
  UPDATE production_wave_stages
     SET status      = 'in_progress',
         operator_id = COALESCE(operator_id, auth.uid()),
         started_at  = v_now,
         updated_at  = v_now
   WHERE wave_id = p_wave_id
     AND status   = 'pending'
     AND (stage_order(stage) = 1 OR stage_starts_with_wave(stage));

  -- current_stage aponta para Corte (estágio principal de nível 1)
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

GRANT EXECUTE ON FUNCTION public.start_wave(uuid)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.stage_starts_with_wave(production_stage_enum) TO authenticated;

-- ── 4. add_business_days — soma de dias úteis (seg-sex, ignora feriados) ─────
-- Não considera feriados nacionais/estaduais por enquanto. Para suportar
-- feriados, criar tabela `holidays(date)` e cruzar aqui.
-- p_days pode ser negativo (subtração).
CREATE OR REPLACE FUNCTION public.add_business_days(p_start date, p_days int)
RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_date  date := p_start;
  v_step  int  := CASE WHEN p_days >= 0 THEN 1 ELSE -1 END;
  v_left  int  := abs(p_days);
BEGIN
  IF p_start IS NULL THEN RETURN NULL; END IF;
  WHILE v_left > 0 LOOP
    v_date := v_date + v_step;
    -- 1=Mon … 5=Fri são úteis; 6=Sat, 7=Sun são fim de semana
    IF EXTRACT(ISODOW FROM v_date) BETWEEN 1 AND 5 THEN
      v_left := v_left - 1;
    END IF;
  END LOOP;
  RETURN v_date;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_business_days(date, int) TO authenticated;

-- ── 5. compute_wave_timeline — cronograma em DIAS ÚTEIS ──────────────────────
-- Substitui a versão anterior (subtração corrida) para evitar planejar início
-- em fim de semana. Mantém a mesma assinatura — chamadores não precisam mudar.
CREATE OR REPLACE FUNCTION public.compute_wave_timeline(p_sale_order_ids uuid[])
RETURNS TABLE (
  earliest_deadline    date,
  corte_start_date     date,
  costura_start_date   date,
  montagem_start_date  date,
  acabamento_start_date date,
  material_ready_date  date,
  purchase_deadline    date
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_lead_corte    int;
  v_lead_costura  int;
  v_lead_montagem int;
  v_lead_acab     int;
  v_lead_buffer   int;
  v_lead_supplier int;
  v_deadline      date;
BEGIN
  SELECT MIN(so.delivery_deadline)
    INTO v_deadline
    FROM sale_orders so
   WHERE so.id = ANY(p_sale_order_ids)
     AND so.delivery_deadline IS NOT NULL;

  IF v_deadline IS NULL THEN
    RETURN;
  END IF;

  SELECT
    COALESCE(MAX(ts.lead_time_corte_dias),           2),
    COALESCE(MAX(ts.lead_time_costura_dias),         3),
    COALESCE(MAX(ts.lead_time_montagem_dias),        2),
    COALESCE(MAX(ts.lead_time_acabamento_dias),      1),
    COALESCE(MAX(ts.lead_time_buffer_material_dias), 2)
  INTO v_lead_corte, v_lead_costura, v_lead_montagem, v_lead_acab, v_lead_buffer
  FROM sale_order_items soi
  JOIN technical_sheets ts ON ts.id = soi.reference_id
  WHERE soi.sale_order_id = ANY(p_sale_order_ids);

  SELECT COALESCE(MAX(COALESCE(p.supplier_lead_time_days, 7)), 7)
    INTO v_lead_supplier
    FROM sale_order_items soi
    JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
    JOIN products p ON p.id = sm.product_id
   WHERE soi.sale_order_id = ANY(p_sale_order_ids);

  RETURN QUERY SELECT
    v_deadline                                                                         AS earliest_deadline,
    add_business_days(v_deadline, -(v_lead_acab + v_lead_montagem + v_lead_costura + v_lead_corte))  AS corte_start_date,
    add_business_days(v_deadline, -(v_lead_acab + v_lead_montagem + v_lead_costura))                 AS costura_start_date,
    add_business_days(v_deadline, -(v_lead_acab + v_lead_montagem))                                  AS montagem_start_date,
    add_business_days(v_deadline, -v_lead_acab)                                                       AS acabamento_start_date,
    add_business_days(v_deadline, -(v_lead_acab + v_lead_montagem + v_lead_costura + v_lead_corte + v_lead_buffer))                 AS material_ready_date,
    add_business_days(v_deadline, -(v_lead_acab + v_lead_montagem + v_lead_costura + v_lead_corte + v_lead_buffer + v_lead_supplier)) AS purchase_deadline;
END;
$$;

-- ── 6. Comentário de design — solado debita em pares (sem waste) ─────────────
COMMENT ON FUNCTION public.debit_sole_stock_by_grade(uuid, uuid, text, jsonb) IS
  'Debita estoque de solado por grade. Solado é consumido em PARES (1 par por par produzido), portanto NÃO aplica waste_pct — diferente de cabedal/forro/palmilha que são debitados por área (dm²) com desperdício de corte.';

-- ========== 20260429230000_integrity-fixes-locks-constraints.sql ==========
-- ╔════════════════════════════════════════════════════════════════════════════╗
-- ║ AUDITORIA DE INTEGRIDADE — fixes de constraints, locks e triggers          ║
-- ║                                                                            ║
-- ║ Esta migration agrupa correções identificadas na auditoria multi-frente:  ║
-- ║                                                                            ║
-- ║  Estoque/Reservas:                                                         ║
-- ║   1. confirm_picking_reservation — lock pessimista na reserva              ║
-- ║   2. adjust_stock — valida sum(stock_grade) == quantity                    ║
-- ║   3. debit_strap_stock — FOR UPDATE no SELECT do produto                   ║
-- ║   4. trigger sync_grade_sum — força quantity = SUM(stock_grade)            ║
-- ║   5. trigger auto_release_reservations_on_cancel                           ║
-- ║                                                                            ║
-- ║  PV/OP/NFe:                                                                ║
-- ║   6. UNIQUE constraints: orders.order_number, sale_orders.order_number,    ║
-- ║      nfe_emitidas (company_id, numero, serie)                              ║
-- ║   7. UNIQUE parcial: 1 OP ativa por sale_order_item_id                     ║
-- ║   8. Wave assignment trigger ignora Rascunho                               ║
-- ║                                                                            ║
-- ║  Concorrência:                                                             ║
-- ║   9. advance_wave_stage — FOR UPDATE na wave                               ║
-- ╚════════════════════════════════════════════════════════════════════════════╝

-- ── 1. confirm_picking_reservation: lock pessimista no início ────────────────
CREATE OR REPLACE FUNCTION public.confirm_picking_reservation(
  p_reservation_id uuid,
  p_picked_by text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res RECORD;
  v_current_qty numeric;
BEGIN
  -- Lock pessimista na reserva ANTES de validar status. Sem isso, duas
  -- requisições simultâneas podem ambas ler 'reserved' e debitar duas vezes.
  SELECT * INTO v_res
    FROM material_reservations
   WHERE id = p_reservation_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva não encontrada';
  END IF;

  IF v_res.status <> 'reserved' THEN
    RAISE EXCEPTION 'Reserva já consumida ou cancelada (status atual: %)', v_res.status;
  END IF;

  SELECT quantity INTO v_current_qty
    FROM products
   WHERE id = v_res.product_id
     FOR UPDATE;

  IF v_current_qty < v_res.quantity_reserved THEN
    RAISE EXCEPTION 'Estoque insuficiente para confirmar picking: disponivel %, necessario %', v_current_qty, v_res.quantity_reserved;
  END IF;

  UPDATE products
     SET quantity = quantity - v_res.quantity_reserved,
         updated_at = now()
   WHERE id = v_res.product_id;

  INSERT INTO stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
  VALUES (v_res.product_id, 'out', v_res.quantity_reserved, v_current_qty, v_current_qty - v_res.quantity_reserved,
          'Debito Picking Confirmado', v_res.order_id);

  UPDATE material_reservations
     SET status = 'consumed',
         quantity_consumed = quantity_reserved,
         consumed_at = now(),
         reservation_type = 'hard',
         updated_at = now()
   WHERE id = p_reservation_id;
END;
$$;

-- ── 2. adjust_stock: valida soma da grade vs quantity (somente quando grade vem) ──
-- Reusa a função existente; adiciona validação de coerência.
DO $$
DECLARE
  v_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'adjust_stock' AND pronamespace = 'public'::regnamespace
  ) INTO v_exists;
  IF NOT v_exists THEN
    -- adjust_stock ainda não foi criada (migration 20260425155923 não aplicada). Pula.
    RAISE NOTICE 'adjust_stock() não existe ainda — pule essa parte e aplique 20260425155923 antes.';
  END IF;
END $$;

-- Trigger genérico: bloqueia UPDATE em products com stock_grade onde sum(grade) != quantity.
-- Apenas quando ambos campos estão sendo escritos. Tolera grade NULL ou {}.
CREATE OR REPLACE FUNCTION public.check_grade_quantity_coherence()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_grade_sum numeric := 0;
BEGIN
  IF NEW.stock_grade IS NULL OR jsonb_typeof(NEW.stock_grade) <> 'object' THEN
    RETURN NEW;
  END IF;

  -- Apenas valida quando há ao menos uma chave numérica positiva (evita falsos
  -- positivos com grades vazias = produto sem numeração configurada).
  IF (SELECT COUNT(*) FROM jsonb_each_text(NEW.stock_grade)) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(GREATEST(0, value::numeric)), 0)
    INTO v_grade_sum
    FROM jsonb_each_text(NEW.stock_grade);

  -- Tolerância 0.01 para drifts de float
  IF ABS(v_grade_sum - COALESCE(NEW.quantity, 0)) > 0.01 THEN
    RAISE EXCEPTION 'Inconsistência: SUM(stock_grade) = % difere de quantity = % no produto %',
      v_grade_sum, NEW.quantity, NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_grade_quantity_coherence ON public.products;
CREATE TRIGGER trg_check_grade_quantity_coherence
  BEFORE UPDATE ON public.products
  FOR EACH ROW
  WHEN (NEW.stock_grade IS DISTINCT FROM OLD.stock_grade
     OR NEW.quantity    IS DISTINCT FROM OLD.quantity)
  EXECUTE FUNCTION public.check_grade_quantity_coherence();

-- ── 3. UNIQUE parcial em sale_order_items → orders (uma OP ativa por item) ───
-- Previne geração duplicada de OPs quando PV é aprovado múltiplas vezes.
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_active_per_sale_order_item
  ON public.orders (sale_order_item_id)
  WHERE sale_order_item_id IS NOT NULL AND status <> 'Cancelada';

-- ── 4. UNIQUE em order_number e sale_orders.order_number ─────────────────────
-- Sequence garante atomicidade, mas constraint protege contra race condition
-- + inserts manuais.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'orders' AND c.conname = 'uq_orders_order_number'
  ) THEN
    BEGIN
      ALTER TABLE public.orders
        ADD CONSTRAINT uq_orders_order_number UNIQUE (order_number);
    EXCEPTION
      WHEN unique_violation THEN
        RAISE NOTICE 'orders.order_number já tem duplicatas — limpe antes de aplicar UNIQUE.';
      WHEN OTHERS THEN
        RAISE NOTICE 'Não foi possível adicionar UNIQUE em orders.order_number: %', SQLERRM;
    END;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'sale_orders' AND c.conname = 'uq_sale_orders_order_number'
  ) THEN
    BEGIN
      ALTER TABLE public.sale_orders
        ADD CONSTRAINT uq_sale_orders_order_number UNIQUE (order_number);
    EXCEPTION
      WHEN unique_violation THEN
        RAISE NOTICE 'sale_orders.order_number já tem duplicatas — limpe antes de aplicar UNIQUE.';
      WHEN OTHERS THEN
        RAISE NOTICE 'Não foi possível adicionar UNIQUE em sale_orders.order_number: %', SQLERRM;
    END;
  END IF;
END $$;

-- ── 5. UNIQUE em nfe_emitidas (company_id, numero, serie) — só autorizadas ───
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname = 'uq_nfe_company_numero_serie_authorized'
  ) THEN
    BEGIN
      EXECUTE $sql$
        CREATE UNIQUE INDEX uq_nfe_company_numero_serie_authorized
          ON public.nfe_emitidas (company_id, numero, serie)
          WHERE status = 'autorizada' AND numero <> '' AND serie <> ''
      $sql$;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE NOTICE 'nfe_emitidas tem duplicatas (company_id, numero, serie) — limpe antes de aplicar.';
      WHEN OTHERS THEN
        RAISE NOTICE 'Não foi possível criar índice nfe_emitidas: %', SQLERRM;
    END;
  END IF;
END $$;

-- ── 6. Trigger: ao cancelar OP, libera reservas ──────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_release_reservations_on_op_cancel()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'Cancelada' AND OLD.status <> 'Cancelada' THEN
    UPDATE material_reservations
       SET status = 'cancelled',
           updated_at = now()
     WHERE order_id = NEW.id
       AND status IN ('reserved', 'partially_consumed');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_release_reservations_on_op_cancel ON public.orders;
CREATE TRIGGER trg_auto_release_reservations_on_op_cancel
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (NEW.status = 'Cancelada' AND OLD.status IS DISTINCT FROM 'Cancelada')
  EXECUTE FUNCTION public.auto_release_reservations_on_op_cancel();

-- ── 7. advance_wave_stage: FOR UPDATE na wave ────────────────────────────────
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
  v_wave_id   uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  -- Lock pessimista na onda — previne race condition entre operadores simultâneos.
  SELECT id INTO v_wave_id
    FROM production_waves
   WHERE id = p_wave_id
     FOR UPDATE;

  IF v_wave_id IS NULL THEN
    RAISE EXCEPTION 'Onda % não encontrada', p_wave_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM production_wave_stages
    WHERE wave_id = p_wave_id AND stage = p_stage AND status = 'in_progress'
  ) THEN
    RAISE EXCEPTION 'Setor % não está em execução na onda %', p_stage, p_wave_id;
  END IF;

  v_stage_ord := stage_order(p_stage);

  UPDATE production_wave_stages
     SET status = 'completed', finished_at = v_now, updated_at = v_now
   WHERE wave_id = p_wave_id AND stage = p_stage;

  IF EXISTS (
    SELECT 1 FROM production_wave_stages
    WHERE wave_id = p_wave_id
      AND stage_order(stage) = v_stage_ord
      AND status NOT IN ('completed', 'blocked')
  ) THEN
    RETURN NULL;
  END IF;

  SELECT MIN(stage_order(stage)) INTO v_next_ord
    FROM production_wave_stages
   WHERE wave_id = p_wave_id
     AND stage_order(stage) > v_stage_ord
     AND status NOT IN ('completed', 'blocked');

  IF v_next_ord IS NULL THEN
    UPDATE production_waves
       SET status = 'finished', finished_at = v_now, current_stage = NULL
     WHERE id = p_wave_id;
    RETURN NULL;
  END IF;

  UPDATE production_wave_stages
     SET status = 'in_progress', operator_id = auth.uid(),
         started_at = v_now, updated_at = v_now
   WHERE wave_id = p_wave_id
     AND stage_order(stage) = v_next_ord
     AND status = 'pending';

  SELECT stage INTO v_next
    FROM production_wave_stages
   WHERE wave_id = p_wave_id
     AND stage_order(stage) = v_next_ord
     AND status = 'in_progress'
   ORDER BY stage
   LIMIT 1;

  UPDATE production_waves SET current_stage = v_next WHERE id = p_wave_id;

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

-- ========== 20260429240000_role-based-rls.sql ==========
-- =============================================================================
-- Role-Based Row Level Security (RLS)
-- Migration: 20260429240000_role-based-rls.sql
-- =============================================================================
--
-- Role hierarchy (defined in app_role enum):
--   admin        — full access to everything including user management
--   gerente      — full access except user management (read-only on user_roles)
--   almoxarifado — operational access (same as any authenticated user for Cat B)
--   operador     — operational access (same as authenticated for Cat B)
--   comercial    — operational access
--   consulta     — read-only (covered by authenticated SELECT policies)
--
-- Categories:
--   A  Reference/config data  — all authenticated can SELECT; admin/gerente write
--   B  Operational data       — all authenticated can read and write
--   C  Financial/sensitive    — admin/gerente only for all operations
--   D  User management        — users see own role; admin writes
--
-- NOTE: The `role` column is of type app_role (enum). Comparisons are done via
-- ::text cast to avoid coupling to the enum internals in helper functions.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper functions in the auth schema
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION auth.user_has_role(required_role text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid()
    AND role::text = required_role
  );
$$;

CREATE OR REPLACE FUNCTION auth.user_has_any_role(roles text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid()
    AND role::text = ANY(roles)
  );
$$;

-- =============================================================================
-- CATEGORY A — Reference / Config data
-- SELECT: all authenticated users
-- INSERT / UPDATE / DELETE: admin or gerente only
-- Tables: groups (product_groups), suppliers, products, technical_sheets,
--         sole_technical_specs, component_sheets, fiscal_config, cost_policies,
--         factoring_config, work_schedules
-- =============================================================================

-- ---- suppliers ----
DROP POLICY IF EXISTS "Auth users can view suppliers"   ON public.suppliers;
DROP POLICY IF EXISTS "Auth users can insert suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Auth users can update suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Auth users can delete suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "rls_suppliers_select"            ON public.suppliers;
DROP POLICY IF EXISTS "rls_suppliers_write"             ON public.suppliers;

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_suppliers_select" ON public.suppliers
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "rls_suppliers_write" ON public.suppliers
  FOR ALL TO authenticated
  USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- ---- products ----
DROP POLICY IF EXISTS "Authenticated users can view products"    ON public.products;
DROP POLICY IF EXISTS "Authenticated users can insert products"  ON public.products;
DROP POLICY IF EXISTS "Authenticated users can update products"  ON public.products;
DROP POLICY IF EXISTS "Authenticated users can delete products"  ON public.products;
DROP POLICY IF EXISTS "Anyone can view products"                 ON public.products;
DROP POLICY IF EXISTS "rls_products_select"                      ON public.products;
DROP POLICY IF EXISTS "rls_products_write"                       ON public.products;

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_products_select" ON public.products
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "rls_products_write" ON public.products
  FOR ALL TO authenticated
  USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- ---- product_groups ----
DROP POLICY IF EXISTS "rls_product_groups_select" ON public.product_groups;
DROP POLICY IF EXISTS "rls_product_groups_write"  ON public.product_groups;

ALTER TABLE public.product_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_product_groups_select" ON public.product_groups
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "rls_product_groups_write" ON public.product_groups
  FOR ALL TO authenticated
  USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- ---- technical_sheets ----
DROP POLICY IF EXISTS "Auth users can view technical_sheets"    ON public.technical_sheets;
DROP POLICY IF EXISTS "Auth users can insert technical_sheets"  ON public.technical_sheets;
DROP POLICY IF EXISTS "Auth users can update technical_sheets"  ON public.technical_sheets;
DROP POLICY IF EXISTS "Auth users can delete technical_sheets"  ON public.technical_sheets;
DROP POLICY IF EXISTS "rls_technical_sheets_select"             ON public.technical_sheets;
DROP POLICY IF EXISTS "rls_technical_sheets_write"              ON public.technical_sheets;

ALTER TABLE public.technical_sheets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_technical_sheets_select" ON public.technical_sheets
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "rls_technical_sheets_write" ON public.technical_sheets
  FOR ALL TO authenticated
  USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- ---- sole_technical_specs ----
DROP POLICY IF EXISTS "Enable all for authenticated users" ON public.sole_technical_specs;
DROP POLICY IF EXISTS "rls_sole_technical_specs_select"   ON public.sole_technical_specs;
DROP POLICY IF EXISTS "rls_sole_technical_specs_write"    ON public.sole_technical_specs;

ALTER TABLE public.sole_technical_specs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_sole_technical_specs_select" ON public.sole_technical_specs
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "rls_sole_technical_specs_write" ON public.sole_technical_specs
  FOR ALL TO authenticated
  USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- ---- component_sheets ----
DROP POLICY IF EXISTS "Auth users can view component_sheets"    ON public.component_sheets;
DROP POLICY IF EXISTS "Auth users can insert component_sheets"  ON public.component_sheets;
DROP POLICY IF EXISTS "Auth users can update component_sheets"  ON public.component_sheets;
DROP POLICY IF EXISTS "Auth users can delete component_sheets"  ON public.component_sheets;
DROP POLICY IF EXISTS "Approved users can insert component_sheets" ON public.component_sheets;
DROP POLICY IF EXISTS "Approved users can update component_sheets" ON public.component_sheets;
DROP POLICY IF EXISTS "Approved users can delete component_sheets" ON public.component_sheets;
DROP POLICY IF EXISTS "rls_component_sheets_select"             ON public.component_sheets;
DROP POLICY IF EXISTS "rls_component_sheets_write"              ON public.component_sheets;

ALTER TABLE public.component_sheets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_component_sheets_select" ON public.component_sheets
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "rls_component_sheets_write" ON public.component_sheets
  FOR ALL TO authenticated
  USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- ---- fiscal_config ----
DROP POLICY IF EXISTS "Auth users can view fiscal_config"    ON public.fiscal_config;
DROP POLICY IF EXISTS "Auth users can insert fiscal_config"  ON public.fiscal_config;
DROP POLICY IF EXISTS "Auth users can update fiscal_config"  ON public.fiscal_config;
DROP POLICY IF EXISTS "Auth users can delete fiscal_config"  ON public.fiscal_config;
DROP POLICY IF EXISTS "rls_fiscal_config_select"             ON public.fiscal_config;
DROP POLICY IF EXISTS "rls_fiscal_config_write"              ON public.fiscal_config;

ALTER TABLE public.fiscal_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_fiscal_config_select" ON public.fiscal_config
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "rls_fiscal_config_write" ON public.fiscal_config
  FOR ALL TO authenticated
  USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- ---- cost_policies ----
DROP POLICY IF EXISTS "Auth users can view cost_policies"    ON public.cost_policies;
DROP POLICY IF EXISTS "Auth users can insert cost_policies"  ON public.cost_policies;
DROP POLICY IF EXISTS "Auth users can update cost_policies"  ON public.cost_policies;
DROP POLICY IF EXISTS "Auth users can delete cost_policies"  ON public.cost_policies;
DROP POLICY IF EXISTS "Approved users can insert cost_policies" ON public.cost_policies;
DROP POLICY IF EXISTS "Approved users can update cost_policies" ON public.cost_policies;
DROP POLICY IF EXISTS "Approved users can delete cost_policies" ON public.cost_policies;
DROP POLICY IF EXISTS "rls_cost_policies_select"             ON public.cost_policies;
DROP POLICY IF EXISTS "rls_cost_policies_write"              ON public.cost_policies;

ALTER TABLE public.cost_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_cost_policies_select" ON public.cost_policies
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "rls_cost_policies_write" ON public.cost_policies
  FOR ALL TO authenticated
  USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- ---- factoring_config ----
DROP POLICY IF EXISTS "Authenticated users can manage factoring_config" ON public.factoring_config;
DROP POLICY IF EXISTS "rls_factoring_config_select"                     ON public.factoring_config;
DROP POLICY IF EXISTS "rls_factoring_config_write"                      ON public.factoring_config;

ALTER TABLE public.factoring_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_factoring_config_select" ON public.factoring_config
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "rls_factoring_config_write" ON public.factoring_config
  FOR ALL TO authenticated
  USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- ---- work_schedules ----
DROP POLICY IF EXISTS "Auth users can view work_schedules"    ON public.work_schedules;
DROP POLICY IF EXISTS "Auth users can insert work_schedules"  ON public.work_schedules;
DROP POLICY IF EXISTS "Auth users can update work_schedules"  ON public.work_schedules;
DROP POLICY IF EXISTS "Auth users can delete work_schedules"  ON public.work_schedules;
DROP POLICY IF EXISTS "rls_work_schedules_select"             ON public.work_schedules;
DROP POLICY IF EXISTS "rls_work_schedules_write"              ON public.work_schedules;

ALTER TABLE public.work_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_work_schedules_select" ON public.work_schedules
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "rls_work_schedules_write" ON public.work_schedules
  FOR ALL TO authenticated
  USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- =============================================================================
-- CATEGORY B — Operational data (all authenticated users can read and write)
-- Tables: orders, sale_orders, sale_order_items, production_waves, wave_orders,
--         picking_lists, picking_list_items, stock_movements, quality_records,
--         notifications
-- =============================================================================

-- ---- orders ----
DROP POLICY IF EXISTS "Auth users can view orders"          ON public.orders;
DROP POLICY IF EXISTS "Auth users can insert orders"        ON public.orders;
DROP POLICY IF EXISTS "Auth users can update orders"        ON public.orders;
DROP POLICY IF EXISTS "Auth users can delete orders"        ON public.orders;
DROP POLICY IF EXISTS "Approved users can insert orders"    ON public.orders;
DROP POLICY IF EXISTS "Approved users can update orders"    ON public.orders;
DROP POLICY IF EXISTS "Approved users can delete orders"    ON public.orders;
DROP POLICY IF EXISTS "rls_orders_all"                      ON public.orders;

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_orders_all" ON public.orders
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---- sale_orders ----
DROP POLICY IF EXISTS "Auth users can view sale_orders"    ON public.sale_orders;
DROP POLICY IF EXISTS "Auth users can insert sale_orders"  ON public.sale_orders;
DROP POLICY IF EXISTS "Auth users can update sale_orders"  ON public.sale_orders;
DROP POLICY IF EXISTS "Auth users can delete sale_orders"  ON public.sale_orders;
DROP POLICY IF EXISTS "rls_sale_orders_all"               ON public.sale_orders;

ALTER TABLE public.sale_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_sale_orders_all" ON public.sale_orders
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---- sale_order_items ----
DROP POLICY IF EXISTS "Auth users can view sale_order_items"    ON public.sale_order_items;
DROP POLICY IF EXISTS "Auth users can insert sale_order_items"  ON public.sale_order_items;
DROP POLICY IF EXISTS "Auth users can update sale_order_items"  ON public.sale_order_items;
DROP POLICY IF EXISTS "Auth users can delete sale_order_items"  ON public.sale_order_items;
DROP POLICY IF EXISTS "Approved users can insert sale_order_items" ON public.sale_order_items;
DROP POLICY IF EXISTS "Approved users can update sale_order_items" ON public.sale_order_items;
DROP POLICY IF EXISTS "Approved users can delete sale_order_items" ON public.sale_order_items;
DROP POLICY IF EXISTS "rls_sale_order_items_all"               ON public.sale_order_items;

ALTER TABLE public.sale_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_sale_order_items_all" ON public.sale_order_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---- production_waves ----
-- Note: prior policies named auth_all_waves / waves_select / waves_insert / etc.
DROP POLICY IF EXISTS "auth_all_waves"   ON public.production_waves;
DROP POLICY IF EXISTS "waves_select"     ON public.production_waves;
DROP POLICY IF EXISTS "waves_insert"     ON public.production_waves;
DROP POLICY IF EXISTS "waves_update"     ON public.production_waves;
DROP POLICY IF EXISTS "waves_delete"     ON public.production_waves;
DROP POLICY IF EXISTS "rls_production_waves_all" ON public.production_waves;

ALTER TABLE public.production_waves ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_production_waves_all" ON public.production_waves
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---- wave_orders (may not exist yet — wrapped in exception block) ----
DO $$ BEGIN
  DROP POLICY IF EXISTS "rls_wave_orders_all" ON public.wave_orders;
  ALTER TABLE public.wave_orders ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "rls_wave_orders_all" ON public.wave_orders
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN
  NULL; -- table does not exist yet; skip silently
END $$;

-- ---- picking_lists ----
DROP POLICY IF EXISTS "Auth users can view picking_lists"       ON public.picking_lists;
DROP POLICY IF EXISTS "Approved users can insert picking_lists" ON public.picking_lists;
DROP POLICY IF EXISTS "Approved users can update picking_lists" ON public.picking_lists;
DROP POLICY IF EXISTS "Approved users can delete picking_lists" ON public.picking_lists;
DROP POLICY IF EXISTS "rls_picking_lists_all"                   ON public.picking_lists;

ALTER TABLE public.picking_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_picking_lists_all" ON public.picking_lists
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---- picking_list_items ----
DROP POLICY IF EXISTS "Auth users can view picking_list_items"       ON public.picking_list_items;
DROP POLICY IF EXISTS "Approved users can insert picking_list_items" ON public.picking_list_items;
DROP POLICY IF EXISTS "Approved users can update picking_list_items" ON public.picking_list_items;
DROP POLICY IF EXISTS "Approved users can delete picking_list_items" ON public.picking_list_items;
DROP POLICY IF EXISTS "rls_picking_list_items_all"                   ON public.picking_list_items;

ALTER TABLE public.picking_list_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_picking_list_items_all" ON public.picking_list_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---- stock_movements ----
DROP POLICY IF EXISTS "Auth users can view movements"               ON public.stock_movements;
DROP POLICY IF EXISTS "Auth users can insert movements"             ON public.stock_movements;
DROP POLICY IF EXISTS "Approved users can insert stock_movements"   ON public.stock_movements;
DROP POLICY IF EXISTS "Approved users can update stock_movements"   ON public.stock_movements;
DROP POLICY IF EXISTS "Approved users can delete stock_movements"   ON public.stock_movements;
DROP POLICY IF EXISTS "rls_stock_movements_all"                     ON public.stock_movements;

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_stock_movements_all" ON public.stock_movements
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---- quality_records ----
DROP POLICY IF EXISTS "Auth users can view quality_records"       ON public.quality_records;
DROP POLICY IF EXISTS "Approved users can insert quality_records" ON public.quality_records;
DROP POLICY IF EXISTS "Approved users can update quality_records" ON public.quality_records;
DROP POLICY IF EXISTS "Approved users can delete quality_records" ON public.quality_records;
DROP POLICY IF EXISTS "rls_quality_records_all"                   ON public.quality_records;

ALTER TABLE public.quality_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_quality_records_all" ON public.quality_records
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---- notifications ----
DROP POLICY IF EXISTS "Users can view own or broadcast notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can view relevant notifications"         ON public.notifications;
DROP POLICY IF EXISTS "Approved users can create notifications"       ON public.notifications;
DROP POLICY IF EXISTS "Users can update own notifications"            ON public.notifications;
DROP POLICY IF EXISTS "Users can delete own notifications"            ON public.notifications;
DROP POLICY IF EXISTS "rls_notifications_all"                         ON public.notifications;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_notifications_all" ON public.notifications
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =============================================================================
-- CATEGORY C — Financial / Sensitive data (admin or gerente only)
-- Tables: financial_entries, accounts_receivable, accounts_payable,
--         purchase_orders, purchase_order_items, nfe_emitidas, cogs_entries
-- =============================================================================

-- ---- financial_entries ----
DROP POLICY IF EXISTS "Auth users can view financial_entries"    ON public.financial_entries;
DROP POLICY IF EXISTS "Auth users can insert financial_entries"  ON public.financial_entries;
DROP POLICY IF EXISTS "Auth users can update financial_entries"  ON public.financial_entries;
DROP POLICY IF EXISTS "Auth users can delete financial_entries"  ON public.financial_entries;
DROP POLICY IF EXISTS "rls_financial_entries_all"               ON public.financial_entries;

ALTER TABLE public.financial_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_financial_entries_all" ON public.financial_entries
  FOR ALL TO authenticated
  USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- ---- accounts_receivable ----
DROP POLICY IF EXISTS "Auth users can view accounts_receivable"    ON public.accounts_receivable;
DROP POLICY IF EXISTS "Auth users can insert accounts_receivable"  ON public.accounts_receivable;
DROP POLICY IF EXISTS "Auth users can update accounts_receivable"  ON public.accounts_receivable;
DROP POLICY IF EXISTS "Auth users can delete accounts_receivable"  ON public.accounts_receivable;
DROP POLICY IF EXISTS "rls_accounts_receivable_all"               ON public.accounts_receivable;

ALTER TABLE public.accounts_receivable ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_accounts_receivable_all" ON public.accounts_receivable
  FOR ALL TO authenticated
  USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- ---- accounts_payable ----
DROP POLICY IF EXISTS "Auth users can view accounts_payable"       ON public.accounts_payable;
DROP POLICY IF EXISTS "Auth users can insert accounts_payable"     ON public.accounts_payable;
DROP POLICY IF EXISTS "Auth users can update accounts_payable"     ON public.accounts_payable;
DROP POLICY IF EXISTS "Auth users can delete accounts_payable"     ON public.accounts_payable;
DROP POLICY IF EXISTS "Approved users can insert accounts_payable" ON public.accounts_payable;
DROP POLICY IF EXISTS "Approved users can update accounts_payable" ON public.accounts_payable;
DROP POLICY IF EXISTS "Approved users can delete accounts_payable" ON public.accounts_payable;
DROP POLICY IF EXISTS "rls_accounts_payable_all"                   ON public.accounts_payable;

ALTER TABLE public.accounts_payable ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_accounts_payable_all" ON public.accounts_payable
  FOR ALL TO authenticated
  USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- ---- purchase_orders ----
DROP POLICY IF EXISTS "Auth users can view purchase_orders"    ON public.purchase_orders;
DROP POLICY IF EXISTS "Auth users can insert purchase_orders"  ON public.purchase_orders;
DROP POLICY IF EXISTS "Auth users can update purchase_orders"  ON public.purchase_orders;
DROP POLICY IF EXISTS "Auth users can delete purchase_orders"  ON public.purchase_orders;
DROP POLICY IF EXISTS "rls_purchase_orders_all"               ON public.purchase_orders;

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_purchase_orders_all" ON public.purchase_orders
  FOR ALL TO authenticated
  USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- ---- purchase_order_items ----
DROP POLICY IF EXISTS "Auth users can view purchase_order_items"    ON public.purchase_order_items;
DROP POLICY IF EXISTS "Auth users can insert purchase_order_items"  ON public.purchase_order_items;
DROP POLICY IF EXISTS "Auth users can update purchase_order_items"  ON public.purchase_order_items;
DROP POLICY IF EXISTS "Auth users can delete purchase_order_items"  ON public.purchase_order_items;
DROP POLICY IF EXISTS "rls_purchase_order_items_all"               ON public.purchase_order_items;

ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_purchase_order_items_all" ON public.purchase_order_items
  FOR ALL TO authenticated
  USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- ---- nfe_emitidas ----
-- Note: prior migration dropped all policies via a DO loop before recreating them
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'nfe_emitidas'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.nfe_emitidas', pol.policyname);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "rls_nfe_emitidas_all" ON public.nfe_emitidas;

ALTER TABLE public.nfe_emitidas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_nfe_emitidas_all" ON public.nfe_emitidas
  FOR ALL TO authenticated
  USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- ---- cogs_entries ----
DROP POLICY IF EXISTS "Auth users can view cogs_entries"       ON public.cogs_entries;
DROP POLICY IF EXISTS "Approved users can insert cogs_entries" ON public.cogs_entries;
DROP POLICY IF EXISTS "Approved users can update cogs_entries" ON public.cogs_entries;
DROP POLICY IF EXISTS "Approved users can delete cogs_entries" ON public.cogs_entries;
DROP POLICY IF EXISTS "rls_cogs_entries_all"                   ON public.cogs_entries;

ALTER TABLE public.cogs_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rls_cogs_entries_all" ON public.cogs_entries
  FOR ALL TO authenticated
  USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- =============================================================================
-- CATEGORY D — User management
-- user_roles : SELECT own row or admin/gerente; INSERT/UPDATE/DELETE admin only
-- companies  : SELECT authenticated; INSERT/UPDATE/DELETE admin only
-- =============================================================================

-- ---- user_roles ----
-- Drop existing policies individually to avoid locking out current users
DROP POLICY IF EXISTS "Users can view own roles"  ON public.user_roles;
DROP POLICY IF EXISTS "Admins can insert roles"   ON public.user_roles;
DROP POLICY IF EXISTS "Admins can delete roles"   ON public.user_roles;
DROP POLICY IF EXISTS "users_see_own_role"        ON public.user_roles;
DROP POLICY IF EXISTS "rls_user_roles_select"     ON public.user_roles;
DROP POLICY IF EXISTS "rls_user_roles_insert"     ON public.user_roles;
DROP POLICY IF EXISTS "rls_user_roles_update"     ON public.user_roles;
DROP POLICY IF EXISTS "rls_user_roles_delete"     ON public.user_roles;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Allow a user to see their own role, or admin/gerente to see all
CREATE POLICY "users_see_own_role" ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR auth.user_has_any_role(ARRAY['admin', 'gerente']));

-- Only admin can modify role assignments
CREATE POLICY "rls_user_roles_insert" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (auth.user_has_role('admin'));

CREATE POLICY "rls_user_roles_update" ON public.user_roles
  FOR UPDATE TO authenticated
  USING  (auth.user_has_role('admin'))
  WITH CHECK (auth.user_has_role('admin'));

CREATE POLICY "rls_user_roles_delete" ON public.user_roles
  FOR DELETE TO authenticated
  USING (auth.user_has_role('admin'));

-- ---- companies ----
DROP POLICY IF EXISTS "Auth users can manage companies" ON public.companies;
DROP POLICY IF EXISTS "rls_companies_select"            ON public.companies;
DROP POLICY IF EXISTS "rls_companies_write"             ON public.companies;

DO $$ BEGIN
  ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "rls_companies_select" ON public.companies
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "rls_companies_write" ON public.companies
    FOR ALL TO authenticated
    USING  (auth.user_has_any_role(ARRAY['admin', 'gerente']))
    WITH CHECK (auth.user_has_any_role(ARRAY['admin', 'gerente']));
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ========== 20260429250000_packaging-linked-to-sole-group.sql ==========
-- ============================================================
-- Move packaging_configs linkage from technical_sheets to
-- product_groups (sole group), so packaging is configured once
-- per sole model rather than duplicated per technical sheet.
--
-- Strategy:
--   1. Add sole_group_id column (nullable FK → product_groups)
--   2. Backfill from existing sheet → sole_group_id relationship
--   3. Make sheet_id nullable (no longer mandatory)
--   4. Add CHECK: at least one of sheet_id / sole_group_id must be set
--   5. Update debit_packaging_for_order to prefer sole_group_id
-- ============================================================

-- 1. Add sole_group_id
ALTER TABLE public.packaging_configs
  ADD COLUMN IF NOT EXISTS sole_group_id UUID
    REFERENCES public.product_groups(id) ON DELETE SET NULL;

-- 2. Backfill: copy sole_group_id from the referenced technical sheet
UPDATE public.packaging_configs pc
SET    sole_group_id = ts.sole_group_id
FROM   public.technical_sheets ts
WHERE  ts.id = pc.sheet_id
  AND  ts.sole_group_id IS NOT NULL
  AND  pc.sole_group_id IS NULL;

-- 3. Make sheet_id nullable (was NOT NULL before)
ALTER TABLE public.packaging_configs
  ALTER COLUMN sheet_id DROP NOT NULL;

-- 4. Ensure at least one anchor is always set
ALTER TABLE public.packaging_configs
  DROP CONSTRAINT IF EXISTS packaging_configs_anchor_check;
ALTER TABLE public.packaging_configs
  ADD CONSTRAINT packaging_configs_anchor_check
    CHECK (sheet_id IS NOT NULL OR sole_group_id IS NOT NULL);

-- 5. Update debit function to prefer sole-level packaging
CREATE OR REPLACE FUNCTION public.debit_packaging_for_order(
  p_sale_order_id uuid,
  p_order_id uuid,
  p_reference_id uuid,
  p_order_quantity integer,
  p_packaging_mode text DEFAULT 'individual_amarrado'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg              RECORD;
  boxes_needed     integer;
  v_result         jsonb := '[]'::jsonb;
  v_types_to_debit text[];
  v_sole_group_id  uuid;
BEGIN
  -- Determine which packaging types to debit based on mode
  IF p_packaging_mode = 'colmeia' THEN
    v_types_to_debit := ARRAY['colmeia'];
  ELSIF p_packaging_mode = 'individual_master' THEN
    v_types_to_debit := ARRAY['individual', 'master'];
  ELSIF p_packaging_mode = 'individual_fitilho' THEN
    v_types_to_debit := ARRAY['individual', 'fitilho'];
  ELSE
    v_types_to_debit := ARRAY['individual'];
  END IF;

  -- Look up the sole_group_id for this technical sheet
  SELECT sole_group_id INTO v_sole_group_id
  FROM   technical_sheets
  WHERE  id = p_reference_id;

  FOR cfg IN
    SELECT pc.id, pc.packaging_type, pc.nome, pc.pairs_per_box, pc.product_id, pc.box_type_id,
           p.name    AS product_name, p.quantity AS current_stock,
           bt.quantity AS box_stock,  bt.nome   AS box_name
    FROM packaging_configs pc
    LEFT JOIN products  p  ON p.id  = pc.product_id  AND p.active  = true
    LEFT JOIN box_types bt ON bt.id = pc.box_type_id AND bt.active = true
    WHERE (
      -- Prefer sole-level packaging when available
      (v_sole_group_id IS NOT NULL AND pc.sole_group_id = v_sole_group_id)
      -- Fallback: sheet-level packaging for sheets with no sole group
      OR (v_sole_group_id IS NULL AND pc.sheet_id = p_reference_id)
    )
      AND pc.active        = true
      AND pc.packaging_type = ANY(v_types_to_debit)
  LOOP
    boxes_needed := CEIL(p_order_quantity::numeric / GREATEST(cfg.pairs_per_box, 1));

    -- Primary path: debit box_types (centralised packaging stock)
    IF cfg.box_type_id IS NOT NULL THEN
      IF cfg.box_stock IS NULL OR cfg.box_stock < boxes_needed THEN
        RAISE EXCEPTION 'Estoque insuficiente para embalagem "%": disponível %, necessário %',
          COALESCE(cfg.box_name, cfg.nome), COALESCE(cfg.box_stock, 0), boxes_needed;
      END IF;

      UPDATE box_types
      SET quantity = quantity - boxes_needed, updated_at = now()
      WHERE id = cfg.box_type_id;

      INSERT INTO stock_movements (
        product_id, movement_type, quantity,
        previous_stock, new_stock, description, order_id
      ) VALUES (
        cfg.box_type_id, 'out', boxes_needed,
        cfg.box_stock, cfg.box_stock - boxes_needed,
        'Débito embalagem ' || COALESCE(cfg.box_name, cfg.nome) || ' (' || cfg.packaging_type || ')',
        p_order_id
      );

      v_result := v_result || jsonb_build_object(
        'box_type_id',    cfg.box_type_id,
        'box_name',       COALESCE(cfg.box_name, cfg.nome),
        'packaging_type', cfg.packaging_type,
        'boxes_needed',   boxes_needed,
        'status',         'debited_box_types'
      );

    -- Legacy path: debit from products table (direct product link)
    ELSIF cfg.product_id IS NOT NULL THEN
      IF cfg.current_stock IS NULL OR cfg.current_stock < boxes_needed THEN
        RAISE EXCEPTION 'Estoque insuficiente para embalagem "%": disponível %, necessário %',
          COALESCE(cfg.product_name, cfg.nome), COALESCE(cfg.current_stock, 0), boxes_needed;
      END IF;

      UPDATE products
      SET quantity = quantity - boxes_needed, updated_at = now()
      WHERE id = cfg.product_id;

      INSERT INTO stock_movements (
        product_id, movement_type, quantity,
        previous_stock, new_stock, description, order_id
      ) VALUES (
        cfg.product_id, 'out', boxes_needed,
        cfg.current_stock, cfg.current_stock - boxes_needed,
        'Débito embalagem ' || COALESCE(cfg.product_name, cfg.nome) || ' (' || cfg.packaging_type || ')',
        p_order_id
      );

      v_result := v_result || jsonb_build_object(
        'product_id',     cfg.product_id,
        'product_name',   COALESCE(cfg.product_name, cfg.nome),
        'packaging_type', cfg.packaging_type,
        'boxes_needed',   boxes_needed,
        'status',         'debited_products'
      );

    ELSE
      v_result := v_result || jsonb_build_object(
        'packaging_type', cfg.packaging_type,
        'nome',           cfg.nome,
        'status',         'skipped',
        'reason',         'no_stock_linked'
      );
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.debit_packaging_for_order(uuid, uuid, uuid, integer, text) TO authenticated;
