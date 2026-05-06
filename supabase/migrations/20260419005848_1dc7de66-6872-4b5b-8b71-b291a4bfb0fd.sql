CREATE OR REPLACE FUNCTION public.auto_assign_sale_order_to_wave(p_sale_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_week_start date;
  v_week_end date;
  v_code text;
  v_wave_id uuid;
  v_row RECORD;
  v_item_id uuid;
  v_already_in uuid;
BEGIN
  v_week_start := resolve_billing_week_for_order(p_sale_order_id);
  IF v_week_start IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT pwi.wave_id INTO v_already_in
    FROM production_wave_item_sources pwis
    JOIN production_wave_items pwi ON pwi.id = pwis.wave_item_id
    JOIN production_waves pw ON pw.id = pwi.wave_id
   WHERE pwis.sale_order_id = p_sale_order_id
     AND pw.status::text NOT IN ('cancelled','finished')
   LIMIT 1;

  IF v_already_in IS NOT NULL THEN
    RETURN v_already_in;
  END IF;

  v_week_end := v_week_start + 6;
  v_code := 'W' || to_char(v_week_start, 'IYYY-IW');

  INSERT INTO production_waves(code, week_start, week_end, status, created_by)
  VALUES (v_code, v_week_start, v_week_end, 'draft', auth.uid())
  ON CONFLICT (code) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_wave_id;

  IF v_wave_id IS NULL THEN
    SELECT id INTO v_wave_id FROM production_waves WHERE code = v_code;
  END IF;

  INSERT INTO production_wave_stages(wave_id, stage, status)
  SELECT v_wave_id, s::production_stage_enum, 'pending'
  FROM unnest(ARRAY['corte','costura','montagem','solagem','acabamento']) AS s
  ON CONFLICT DO NOTHING;

  FOR v_row IN
    SELECT
      soi.id AS source_item_id,
      so.id AS sale_order_id,
      so.client_id,
      COALESCE(c.razao_social, so.id::text) AS store_name,
      soi.reference_id,
      COALESCE(soi.color,'') AS color,
      COALESCE(soi.quantity,0)::numeric AS qty,
      COALESCE(soi.grade,'{}'::jsonb) AS grade,
      (SELECT sole_product_id FROM resolve_sole_color(soi.reference_id, COALESCE(soi.color,''))) AS sole_id
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
      v_item_id, v_row.sale_order_id, v_row.source_item_id, v_row.client_id, v_row.store_name,
      v_row.qty, v_row.grade
    )
    ON CONFLICT DO NOTHING;
  END LOOP;

  UPDATE production_waves w SET
    total_pairs = COALESCE((SELECT SUM(total_quantity) FROM production_wave_items WHERE wave_id = w.id),0),
    total_items = COALESCE((SELECT COUNT(*) FROM production_wave_items WHERE wave_id = w.id),0),
    status = CASE WHEN status::text = 'draft' THEN 'planning' ELSE status END
  WHERE w.id = v_wave_id;

  RETURN v_wave_id;
END;
$$;