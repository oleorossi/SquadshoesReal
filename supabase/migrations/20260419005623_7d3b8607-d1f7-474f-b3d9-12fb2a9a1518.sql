-- =============================================================================
-- AUTOMATED PRODUCTION WAVE ASSIGNMENT
-- =============================================================================

-- Helper: resolve billing week for a sale order
DROP FUNCTION IF EXISTS public.resolve_billing_week_for_order(p_sale_order_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.resolve_billing_week_for_order(p_sale_order_id uuid)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_billing_week date;
  v_delivery date;
  v_lead_days int;
  v_target date;
BEGIN
  SELECT billing_week, delivery_deadline
    INTO v_billing_week, v_delivery
    FROM sale_orders
   WHERE id = p_sale_order_id;

  -- 1) explicit billing_week wins
  IF v_billing_week IS NOT NULL THEN
    -- snap to monday
    RETURN v_billing_week - ((EXTRACT(ISODOW FROM v_billing_week)::int - 1));
  END IF;

  IF v_delivery IS NULL THEN
    RETURN NULL;
  END IF;

  -- 2) lead time from any technical sheet referenced by an item
  SELECT COALESCE(
           ts.lead_time_corte_dias,0)
         + COALESCE(ts.lead_time_costura_dias,0)
         + COALESCE(ts.lead_time_montagem_dias,0)
         + COALESCE(ts.lead_time_acabamento_dias,0)
         + COALESCE(ts.lead_time_buffer_material_dias,0)
    INTO v_lead_days
    FROM sale_order_items soi
    JOIN technical_sheets ts ON ts.product_id = soi.reference_id
   WHERE soi.sale_order_id = p_sale_order_id
     AND COALESCE(
           ts.lead_time_corte_dias,0)
         + COALESCE(ts.lead_time_costura_dias,0)
         + COALESCE(ts.lead_time_montagem_dias,0)
         + COALESCE(ts.lead_time_acabamento_dias,0)
         + COALESCE(ts.lead_time_buffer_material_dias,0) > 0
   ORDER BY 1 DESC
   LIMIT 1;

  -- 3) fallback to default_lead_times for default category
  IF v_lead_days IS NULL OR v_lead_days = 0 THEN
    SELECT COALESCE(lead_time_corte_dias,0)
         + COALESCE(lead_time_costura_dias,0)
         + COALESCE(lead_time_montagem_dias,0)
         + COALESCE(lead_time_acabamento_dias,0)
         + COALESCE(lead_time_buffer_material_dias,0)
      INTO v_lead_days
      FROM default_lead_times
     ORDER BY shoe_category
     LIMIT 1;
  END IF;

  IF v_lead_days IS NULL OR v_lead_days = 0 THEN
    v_lead_days := 21; -- last-resort
  END IF;

  v_target := v_delivery - v_lead_days;
  -- snap to monday
  RETURN v_target - ((EXTRACT(ISODOW FROM v_target)::int - 1));
END;
$$;

-- Auto-assign one sale order to its wave (idempotent)
DROP FUNCTION IF EXISTS public.auto_assign_sale_order_to_wave(p_sale_order_id uuid) CASCADE;
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

  -- Skip if order items are already linked to an active wave
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
  VALUES (v_code, v_week_start, v_week_end, 'draft',
          COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid))
  ON CONFLICT (code) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_wave_id;

  IF v_wave_id IS NULL THEN
    SELECT id INTO v_wave_id FROM production_waves WHERE code = v_code;
  END IF;

  -- Ensure the 5 stages exist
  INSERT INTO production_wave_stages(wave_id, stage, status)
  SELECT v_wave_id, s::production_stage_enum, 'pending'
  FROM unnest(ARRAY['corte','costura','montagem','solagem','acabamento']) AS s
  ON CONFLICT DO NOTHING;

  -- Add each item from this sale order to the wave
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

  -- Refresh totals + move to planning
  UPDATE production_waves w SET
    total_pairs = COALESCE((SELECT SUM(total_quantity) FROM production_wave_items WHERE wave_id = w.id),0),
    total_items = COALESCE((SELECT COUNT(*) FROM production_wave_items WHERE wave_id = w.id),0),
    status = CASE WHEN status::text = 'draft' THEN 'planning' ELSE status END
  WHERE w.id = v_wave_id;

  RETURN v_wave_id;
END;
$$;

-- Trigger function (skip when service role / no auth context but order is manually edited)
DROP FUNCTION IF EXISTS public.trg_auto_assign_wave_on_sale_order() CASCADE;
CREATE OR REPLACE FUNCTION public.trg_auto_assign_wave_on_sale_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('Aprovado','Em Produção') THEN
    -- run only when relevant fields changed or on insert
    IF TG_OP = 'INSERT'
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.billing_week IS DISTINCT FROM OLD.billing_week
       OR NEW.delivery_deadline IS DISTINCT FROM OLD.delivery_deadline THEN
      PERFORM public.auto_assign_sale_order_to_wave(NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_assign_wave ON public.sale_orders;
CREATE TRIGGER trg_auto_assign_wave
  AFTER INSERT OR UPDATE OF status, billing_week, delivery_deadline
  ON public.sale_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_auto_assign_wave_on_sale_order();

-- Maintenance helper to backfill existing approved orders not yet on a wave
DROP FUNCTION IF EXISTS public.repair_missing_wave_assignments() CASCADE;
CREATE OR REPLACE FUNCTION public.repair_missing_wave_assignments()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_count int := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  FOR v_id IN
    SELECT so.id
      FROM sale_orders so
     WHERE so.status IN ('Aprovado','Em Produção')
       AND NOT EXISTS (
         SELECT 1 FROM production_wave_item_sources pwis
          JOIN production_wave_items pwi ON pwi.id = pwis.wave_item_id
          JOIN production_waves pw ON pw.id = pwi.wave_id
         WHERE pwis.sale_order_id = so.id
           AND pw.status::text NOT IN ('cancelled','finished')
       )
  LOOP
    PERFORM auto_assign_sale_order_to_wave(v_id);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;