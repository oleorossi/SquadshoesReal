DROP FUNCTION IF EXISTS public.stage_order(s production_stage_enum) CASCADE;
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

ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS mesa_daily_capacity int NOT NULL DEFAULT 0;

ALTER TABLE public.production_wave_stages
  ADD COLUMN IF NOT EXISTS capacity_per_day int NOT NULL DEFAULT 0;

DROP FUNCTION IF EXISTS public.create_production_wave(
  p_week_start date,
  p_sale_order_ids uuid[]
) CASCADE;
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

  INSERT INTO production_wave_stages(wave_id, stage, status)
  SELECT v_wave_id, s::production_stage_enum, 'pending'
  FROM unnest(ARRAY['corte','costura','montagem','solagem','acabamento']) AS s
  ON CONFLICT DO NOTHING;

  SELECT COALESCE(MAX(ts.mesa_daily_capacity), 0)
    INTO v_mesa_capacity
    FROM sale_order_items soi
    JOIN technical_sheets ts ON ts.id = soi.reference_id
   WHERE soi.sale_order_id = ANY(p_sale_order_ids)
     AND ts.mesa_daily_capacity > 0;

  IF v_mesa_capacity > 0 THEN
    INSERT INTO production_wave_stages(wave_id, stage, status, capacity_per_day)
    VALUES (v_wave_id, 'mesa'::production_stage_enum, 'pending', v_mesa_capacity)
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

DROP FUNCTION IF EXISTS public.advance_wave_stage(p_wave_id uuid) CASCADE;
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

  UPDATE production_wave_stages
     SET status = 'completed', finished_at = v_now, updated_at = v_now
   WHERE wave_id = p_wave_id AND stage = v_current;

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

DROP FUNCTION IF EXISTS public.compute_wave_timeline(p_sale_order_ids uuid[]) CASCADE;
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
  SELECT MIN(so.delivery_deadline) INTO v_deadline
    FROM sale_orders so
   WHERE so.id = ANY(p_sale_order_ids) AND so.delivery_deadline IS NOT NULL;
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
    )::int) INTO v_lead_mesa
    FROM sale_order_items soi
    JOIN technical_sheets ts ON ts.id = soi.reference_id
   WHERE soi.sale_order_id = ANY(p_sale_order_ids) AND ts.mesa_daily_capacity > 0;
  v_lead_mesa := COALESCE(v_lead_mesa, 0);

  SELECT COALESCE(MAX(
    CASE WHEN COALESCE(needed.total_needed, 0) > COALESCE(p.quantity, 0)
         THEN COALESCE(p.supplier_lead_time_days, 7) ELSE 0 END
  ), 0) INTO v_lead_supplier
    FROM (
      SELECT sm.product_id, SUM(sm.quantity_per_unit * soi.quantity) AS total_needed
        FROM sale_order_items soi
        JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
       WHERE soi.sale_order_id = ANY(p_sale_order_ids)
       GROUP BY sm.product_id
    ) AS needed
    JOIN products p ON p.id = needed.product_id;

  RETURN QUERY SELECT
    v_deadline                                                                          AS earliest_deadline,
    (v_deadline - v_lead_acab - v_lead_montagem
       - v_lead_mesa - v_lead_costura - v_lead_corte)::date                           AS corte_start_date,
    (v_deadline - v_lead_acab - v_lead_montagem
       - v_lead_mesa - v_lead_costura)::date                                           AS costura_start_date,
    (v_deadline - v_lead_acab - v_lead_montagem)::date                                 AS montagem_start_date,
    (v_deadline - v_lead_acab)::date                                                    AS acabamento_start_date,
    (v_deadline - v_lead_acab - v_lead_montagem
       - v_lead_mesa - v_lead_costura - v_lead_corte - v_lead_buffer)::date           AS material_ready_date,
    (v_deadline - v_lead_acab - v_lead_montagem
       - v_lead_mesa - v_lead_costura - v_lead_corte - v_lead_buffer
       - v_lead_supplier)::date                                                         AS purchase_deadline;
END;
$$;

DROP VIEW IF EXISTS public.v_sector_board CASCADE;
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
            OR EXISTS (
              SELECT 1 FROM production_wave_stages prev_s
               WHERE prev_s.wave_id = s3.wave_id
                 AND stage_order(prev_s.stage) = s3.ord - 1
                 AND prev_s.status = 'completed'
            )
          )
        ORDER BY s3.week_start LIMIT 1) AS next_wave,
       (SELECT count(*) FROM stages s4
         WHERE s4.stage = stages.stage AND s4.stage_status = 'completed') AS completed_count
  FROM stages
 GROUP BY stage, ord
 ORDER BY ord;

GRANT SELECT ON public.v_sector_board TO authenticated;