DROP FUNCTION IF EXISTS public.stage_order(s production_stage_enum) CASCADE;
CREATE OR REPLACE FUNCTION public.stage_order(s production_stage_enum)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE s
    WHEN 'corte'      THEN 1
    WHEN 'mesa'       THEN 1
    WHEN 'costura'    THEN 2
    WHEN 'palmilha'   THEN 2
    WHEN 'montagem'   THEN 3
    WHEN 'solagem'    THEN 4
    WHEN 'acabamento' THEN 5
  END;
$$;

DROP FUNCTION IF EXISTS public.compute_wave_timeline(uuid[]);

CREATE FUNCTION public.compute_wave_timeline(p_sale_order_ids uuid[])
RETURNS TABLE (
  earliest_deadline     date,
  corte_start_date      date,
  mesa_start_date       date,
  costura_start_date    date,
  palmilha_start_date   date,
  montagem_start_date   date,
  acabamento_start_date date,
  material_ready_date   date,
  purchase_deadline     date
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_lead_corte     int;
  v_lead_costura   int;
  v_lead_palmilha  int;
  v_lead_montagem  int;
  v_lead_solagem   int := 1;
  v_lead_acab      int;
  v_lead_buffer    int;
  v_lead_mesa      int := 0;
  v_lead_supplier  int;
  v_deadline       date;
  v_lead_n1        int;
  v_lead_n2        int;
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
    COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_palmilha_dias, 0), 1)), 1),
    COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_montagem_dias, 0),
      (SELECT sc.montagem_dias FROM shoe_category_lead_times sc WHERE sc.shoe_category = ts.shoe_category LIMIT 1), 2)), 2),
    COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_acabamento_dias, 0),
      (SELECT sc.acabamento_dias FROM shoe_category_lead_times sc WHERE sc.shoe_category = ts.shoe_category LIMIT 1), 1)), 1),
    COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_buffer_material_dias, 0),
      (SELECT sc.buffer_material_dias FROM shoe_category_lead_times sc WHERE sc.shoe_category = ts.shoe_category LIMIT 1), 2)), 2)
  INTO v_lead_corte, v_lead_costura, v_lead_palmilha, v_lead_montagem, v_lead_acab, v_lead_buffer
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

  v_lead_n1 := GREATEST(v_lead_corte, v_lead_mesa);
  v_lead_n2 := GREATEST(v_lead_costura, v_lead_palmilha);

  RETURN QUERY SELECT
    v_deadline                                                                                              AS earliest_deadline,
    (v_deadline - v_lead_acab - v_lead_solagem - v_lead_montagem - v_lead_n2 - v_lead_corte)::date          AS corte_start_date,
    (v_deadline - v_lead_acab - v_lead_solagem - v_lead_montagem - v_lead_n2 - v_lead_mesa)::date           AS mesa_start_date,
    (v_deadline - v_lead_acab - v_lead_solagem - v_lead_montagem - v_lead_costura)::date                    AS costura_start_date,
    (v_deadline - v_lead_acab - v_lead_solagem - v_lead_montagem - v_lead_palmilha)::date                   AS palmilha_start_date,
    (v_deadline - v_lead_acab - v_lead_solagem - v_lead_montagem)::date                                     AS montagem_start_date,
    (v_deadline - v_lead_acab)::date                                                                         AS acabamento_start_date,
    (v_deadline - v_lead_acab - v_lead_solagem - v_lead_montagem - v_lead_n2 - v_lead_n1 - v_lead_buffer)::date AS material_ready_date,
    (v_deadline - v_lead_acab - v_lead_solagem - v_lead_montagem - v_lead_n2 - v_lead_n1 - v_lead_buffer - v_lead_supplier)::date AS purchase_deadline;
END;
$$;