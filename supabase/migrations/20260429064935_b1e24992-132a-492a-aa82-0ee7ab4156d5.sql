CREATE OR REPLACE FUNCTION public.stage_order(s production_stage_enum)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE s
    WHEN 'corte'      THEN 1
    WHEN 'palmilha'   THEN 2
    WHEN 'costura'    THEN 2
    WHEN 'mesa'       THEN 3
    WHEN 'montagem'   THEN 4
    WHEN 'solagem'    THEN 5
    WHEN 'acabamento' THEN 6
  END;
$$;

ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS palmilha_daily_capacity integer;

CREATE OR REPLACE FUNCTION public.create_production_wave(
  p_sale_order_ids uuid[],
  p_week_start date DEFAULT NULL,
  p_start_mode text DEFAULT 'asap'
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wave_id uuid;
  v_code text;
  v_week_start date;
  v_week_end date;
  v_total_pairs integer := 0;
  v_total_items integer := 0;
  v_has_mesa boolean := false;
  v_has_palmilha boolean := false;
  v_mesa_cap integer := NULL;
  v_palmilha_cap integer := NULL;
BEGIN
  v_week_start := COALESCE(p_week_start, date_trunc('week', CURRENT_DATE)::date);
  v_week_end   := v_week_start + INTERVAL '6 days';
  SELECT 'OND-' || to_char(now(), 'YYMMDD-HH24MISS') INTO v_code;

  SELECT COALESCE(SUM(total_quantity), 0), COUNT(*)
    INTO v_total_pairs, v_total_items
    FROM sale_order_items
   WHERE sale_order_id = ANY(p_sale_order_ids);

  SELECT
    bool_or(ts.mesa_daily_capacity IS NOT NULL AND ts.mesa_daily_capacity > 0),
    bool_or(ts.palmilha_daily_capacity IS NOT NULL AND ts.palmilha_daily_capacity > 0),
    NULLIF(ROUND(AVG(ts.mesa_daily_capacity) FILTER (WHERE ts.mesa_daily_capacity > 0)), 0)::int,
    NULLIF(ROUND(AVG(ts.palmilha_daily_capacity) FILTER (WHERE ts.palmilha_daily_capacity > 0)), 0)::int
  INTO v_has_mesa, v_has_palmilha, v_mesa_cap, v_palmilha_cap
  FROM sale_order_items soi
  JOIN technical_sheets ts ON ts.reference_id = soi.reference_id
  WHERE soi.sale_order_id = ANY(p_sale_order_ids);

  INSERT INTO production_waves (code, week_start, week_end, status, total_pairs, total_items, start_mode)
       VALUES (v_code, v_week_start, v_week_end, 'planning', v_total_pairs, v_total_items, p_start_mode)
    RETURNING id INTO v_wave_id;

  INSERT INTO production_wave_orders (wave_id, sale_order_id)
  SELECT v_wave_id, unnest(p_sale_order_ids)
  ON CONFLICT DO NOTHING;

  INSERT INTO production_wave_stages (wave_id, stage, status, capacity_per_day)
  VALUES
    (v_wave_id, 'corte'::production_stage_enum,      'pending', NULL),
    (v_wave_id, 'costura'::production_stage_enum,    'pending', NULL),
    (v_wave_id, 'montagem'::production_stage_enum,   'pending', NULL),
    (v_wave_id, 'solagem'::production_stage_enum,    'pending', NULL),
    (v_wave_id, 'acabamento'::production_stage_enum, 'pending', NULL);

  IF v_has_palmilha THEN
    INSERT INTO production_wave_stages (wave_id, stage, status, capacity_per_day)
    VALUES (v_wave_id, 'palmilha'::production_stage_enum, 'pending', v_palmilha_cap);
  END IF;

  IF v_has_mesa THEN
    INSERT INTO production_wave_stages (wave_id, stage, status, capacity_per_day)
    VALUES (v_wave_id, 'mesa'::production_stage_enum, 'pending', v_mesa_cap);
  END IF;

  RETURN v_wave_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.advance_wave_stage(p_wave_id uuid, p_stage production_stage_enum)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current_ord int;
  v_next_stage production_stage_enum;
  v_pending_prereqs int;
BEGIN
  UPDATE production_wave_stages
     SET status = 'completed', finished_at = now(), progress_pct = 100
   WHERE wave_id = p_wave_id AND stage = p_stage;

  v_current_ord := stage_order(p_stage);

  FOR v_next_stage IN
    SELECT s.stage
      FROM production_wave_stages s
     WHERE s.wave_id = p_wave_id
       AND stage_order(s.stage) = v_current_ord + 1
       AND s.status = 'pending'
  LOOP
    SELECT COUNT(*) INTO v_pending_prereqs
      FROM production_wave_stages prev
     WHERE prev.wave_id = p_wave_id
       AND stage_order(prev.stage) = v_current_ord
       AND prev.status <> 'completed';

    IF v_pending_prereqs = 0 THEN
      UPDATE production_wave_stages
         SET status = 'in_progress', started_at = COALESCE(started_at, now())
       WHERE wave_id = p_wave_id AND stage = v_next_stage;
    END IF;
  END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS public.compute_wave_timeline(uuid[]);
CREATE FUNCTION public.compute_wave_timeline(p_sale_order_ids uuid[])
RETURNS TABLE (
  earliest_deadline       date,
  corte_start_date        date,
  palmilha_start_date     date,
  costura_start_date      date,
  mesa_start_date         date,
  montagem_start_date     date,
  solagem_start_date      date,
  acabamento_start_date   date,
  material_ready_date     date,
  purchase_deadline       date
)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_deadline       date;
  v_total_qty      int := 0;
  v_lead_corte     int := 0;
  v_lead_palmilha  int := 0;
  v_lead_costura   int := 0;
  v_lead_mesa      int := 0;
  v_lead_montagem  int := 0;
  v_lead_solagem   int := 0;
  v_lead_acab      int := 0;
  v_lead_buffer    int := 1;
  v_lead_supplier  int := 0;
  v_has_shortage   boolean := false;
  v_parallel_lead  int := 0;
BEGIN
  SELECT MIN(delivery_deadline), COALESCE(SUM(total_quantity), 0)
    INTO v_deadline, v_total_qty
    FROM sale_orders so
    LEFT JOIN sale_order_items soi ON soi.sale_order_id = so.id
   WHERE so.id = ANY(p_sale_order_ids);

  IF v_deadline IS NULL THEN v_deadline := CURRENT_DATE + 14; END IF;

  SELECT
    COALESCE(CEIL(v_total_qty::numeric / NULLIF(AVG(NULLIF(ts.cutting_daily_capacity,0)),0))::int, 1),
    COALESCE(CEIL(v_total_qty::numeric / NULLIF(AVG(NULLIF(ts.palmilha_daily_capacity,0)),0))::int, 0),
    COALESCE(CEIL(v_total_qty::numeric / NULLIF(AVG(NULLIF(ts.sewing_daily_capacity,0)),0))::int, 1),
    COALESCE(CEIL(v_total_qty::numeric / NULLIF(AVG(NULLIF(ts.mesa_daily_capacity,0)),0))::int, 0),
    COALESCE(CEIL(v_total_qty::numeric / NULLIF(AVG(NULLIF(ts.assembly_daily_capacity,0)),0))::int, 1),
    COALESCE(CEIL(v_total_qty::numeric / NULLIF(AVG(NULLIF(ts.soling_daily_capacity,0)),0))::int, 1),
    COALESCE(CEIL(v_total_qty::numeric / NULLIF(AVG(NULLIF(ts.finishing_daily_capacity,0)),0))::int, 1)
  INTO v_lead_corte, v_lead_palmilha, v_lead_costura, v_lead_mesa,
       v_lead_montagem, v_lead_solagem, v_lead_acab
  FROM sale_order_items soi
  JOIN technical_sheets ts ON ts.reference_id = soi.reference_id
  WHERE soi.sale_order_id = ANY(p_sale_order_ids);

  v_parallel_lead := GREATEST(COALESCE(v_lead_palmilha, 0), COALESCE(v_lead_costura, 0));

  SELECT EXISTS (
    SELECT 1 FROM material_explosion_view mev
     WHERE mev.sale_order_id = ANY(p_sale_order_ids)
       AND mev.qty_needed > COALESCE(mev.qty_on_hand, 0)
  ) INTO v_has_shortage;

  IF v_has_shortage THEN
    SELECT COALESCE(MAX(s.lead_time_days), 0)
      INTO v_lead_supplier
      FROM material_explosion_view mev
      LEFT JOIN suppliers s ON s.id = mev.supplier_id
     WHERE mev.sale_order_id = ANY(p_sale_order_ids)
       AND mev.qty_needed > COALESCE(mev.qty_on_hand, 0);
  END IF;

  RETURN QUERY SELECT
    v_deadline,
    (v_deadline - v_lead_acab - v_lead_solagem - v_lead_montagem - v_lead_mesa - v_parallel_lead - v_lead_corte - v_lead_buffer)::date,
    (v_deadline - v_lead_acab - v_lead_solagem - v_lead_montagem - v_lead_mesa - v_parallel_lead)::date,
    (v_deadline - v_lead_acab - v_lead_solagem - v_lead_montagem - v_lead_mesa - v_parallel_lead)::date,
    (v_deadline - v_lead_acab - v_lead_solagem - v_lead_montagem - v_lead_mesa)::date,
    (v_deadline - v_lead_acab - v_lead_solagem - v_lead_montagem)::date,
    (v_deadline - v_lead_acab - v_lead_solagem)::date,
    (v_deadline - v_lead_acab)::date,
    (v_deadline - v_lead_acab - v_lead_solagem - v_lead_montagem - v_lead_mesa - v_parallel_lead - v_lead_corte - v_lead_buffer)::date,
    (v_deadline - v_lead_acab - v_lead_solagem - v_lead_montagem - v_lead_mesa - v_parallel_lead - v_lead_corte - v_lead_buffer - v_lead_supplier)::date;
END;
$$;