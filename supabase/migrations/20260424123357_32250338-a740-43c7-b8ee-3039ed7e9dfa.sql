DROP FUNCTION IF EXISTS public.sync_sale_order_wave_items(p_sale_order_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.sync_sale_order_wave_items(p_sale_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_wave_id uuid;
  v_current_wave_status text;
  v_current_wave_start date;
  v_target_week_start date;
  v_row RECORD;
  v_item_id uuid;
  v_orphan RECORD;
BEGIN
  -- 1) Calculate where it SHOULD be
  v_target_week_start := resolve_billing_week_for_order(p_sale_order_id);
  
  -- 2) Find current wave (active, not finished/cancelled)
  SELECT pwi.wave_id, pw.status::text, pw.week_start
    INTO v_current_wave_id, v_current_wave_status, v_current_wave_start
    FROM production_wave_item_sources pwis
    JOIN production_wave_items pwi ON pwi.id = pwis.wave_item_id
    JOIN production_waves pw ON pw.id = pwi.wave_id
   WHERE pwis.sale_order_id = p_sale_order_id
     AND pw.status::text NOT IN ('cancelled','finished')
   LIMIT 1;

  -- 3) If wave changed and it's still in planning/draft, remove from old wave
  IF v_current_wave_id IS NOT NULL AND v_target_week_start IS NOT NULL AND v_current_wave_start != v_target_week_start THEN
    IF v_current_wave_status IN ('draft','planning') THEN
      -- Remove sources for this order from the old wave
      DELETE FROM production_wave_item_sources 
       WHERE sale_order_id = p_sale_order_id 
         AND wave_item_id IN (SELECT id FROM production_wave_items WHERE wave_id = v_current_wave_id);
      
      -- Recalculate totals for the OLD wave items
      UPDATE production_wave_items pwi
         SET total_quantity = COALESCE((
            SELECT SUM(quantity) FROM production_wave_item_sources WHERE wave_item_id = pwi.id
         ), 0)
       WHERE pwi.wave_id = v_current_wave_id;

      -- Remove empty wave items from OLD wave
      DELETE FROM production_wave_items pwi
       WHERE pwi.wave_id = v_current_wave_id
         AND NOT EXISTS (SELECT 1 FROM production_wave_item_sources WHERE wave_item_id = pwi.id);

      -- Update OLD wave totals
      UPDATE production_waves w SET
        total_pairs = COALESCE((SELECT SUM(total_quantity) FROM production_wave_items WHERE wave_id = w.id),0),
        total_items = COALESCE((SELECT COUNT(*) FROM production_wave_items WHERE wave_id = w.id),0),
        updated_at = now()
      WHERE w.id = v_current_wave_id;

      -- Clear current wave ID so it gets re-assigned below
      v_current_wave_id := NULL;
    END IF;
  END IF;

  -- 4) If no wave (or just removed from one), auto-assign
  IF v_current_wave_id IS NULL THEN
    IF v_target_week_start IS NOT NULL THEN
      PERFORM auto_assign_sale_order_to_wave(p_sale_order_id);
    END IF;
    RETURN;
  END IF;

  -- 5) If still in the same wave, just sync items (standard logic)
  -- Remove orphan sources (items deleted from sale order)
  FOR v_orphan IN
    SELECT pwis.id AS source_id, pwis.wave_item_id
      FROM production_wave_item_sources pwis
     WHERE pwis.sale_order_id = p_sale_order_id
       AND NOT EXISTS (
         SELECT 1 FROM sale_order_items soi
          WHERE soi.id = pwis.sale_order_item_id
       )
  LOOP
    DELETE FROM production_wave_item_sources WHERE id = v_orphan.source_id;
  END LOOP;

  -- Upsert sources for current sale order items
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
    VALUES (v_current_wave_id, v_row.reference_id, v_row.sole_id, v_row.color, 0, v_row.grade)
    ON CONFLICT (wave_id, reference_id, sole_product_id, color)
    DO UPDATE SET grade = EXCLUDED.grade
    RETURNING id INTO v_item_id;

    IF v_item_id IS NULL THEN
      SELECT id INTO v_item_id FROM production_wave_items
       WHERE wave_id = v_current_wave_id
         AND reference_id = v_row.reference_id
         AND COALESCE(sole_product_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(v_row.sole_id, '00000000-0000-0000-0000-000000000000'::uuid)
         AND color = v_row.color
       LIMIT 1;
    END IF;

    INSERT INTO production_wave_item_sources(
      wave_item_id, sale_order_id, sale_order_item_id, client_id, store_name, quantity, grade
    ) VALUES (
      v_item_id, v_row.sale_order_id, v_row.source_item_id, v_row.client_id, v_row.store_name,
      v_row.qty, v_row.grade
    )
    ON CONFLICT (wave_item_id, sale_order_id, sale_order_item_id) DO UPDATE SET
      quantity = EXCLUDED.quantity,
      grade = EXCLUDED.grade,
      store_name = EXCLUDED.store_name;
  END LOOP;

  -- Recompute totals on each wave item from sources
  UPDATE production_wave_items pwi
     SET total_quantity = COALESCE((
        SELECT SUM(quantity) FROM production_wave_item_sources WHERE wave_item_id = pwi.id
     ),0)
   WHERE pwi.wave_id = v_current_wave_id;

  -- Remove wave items that became empty (no sources left)
  DELETE FROM production_wave_items pwi
   WHERE pwi.wave_id = v_current_wave_id
     AND NOT EXISTS (SELECT 1 FROM production_wave_item_sources WHERE wave_item_id = pwi.id);

  -- Recompute wave totals
  UPDATE production_waves w SET
    total_pairs = COALESCE((SELECT SUM(total_quantity) FROM production_wave_items WHERE wave_id = w.id),0),
    total_items = COALESCE((SELECT COUNT(*) FROM production_wave_items WHERE wave_id = w.id),0),
    updated_at = now()
  WHERE w.id = v_current_wave_id;
END;
$$;