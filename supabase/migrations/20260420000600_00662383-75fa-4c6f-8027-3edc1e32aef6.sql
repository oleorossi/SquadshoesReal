
-- 1) Sync function: reconciles a wave's items with current sale_order state
-- Only runs if wave is still in draft/planning (not yet started production)
CREATE OR REPLACE FUNCTION public.sync_sale_order_wave_items(p_sale_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wave_id uuid;
  v_wave_status text;
  v_row RECORD;
  v_item_id uuid;
  v_orphan RECORD;
BEGIN
  -- Find current wave (active, not finished/cancelled)
  SELECT pwi.wave_id, pw.status::text
    INTO v_wave_id, v_wave_status
    FROM production_wave_item_sources pwis
    JOIN production_wave_items pwi ON pwi.id = pwis.wave_item_id
    JOIN production_waves pw ON pw.id = pwi.wave_id
   WHERE pwis.sale_order_id = p_sale_order_id
     AND pw.status::text NOT IN ('cancelled','finished')
   LIMIT 1;

  IF v_wave_id IS NULL THEN
    -- No wave yet, fall back to auto_assign
    PERFORM auto_assign_sale_order_to_wave(p_sale_order_id);
    RETURN;
  END IF;

  -- Only sync if wave hasn't started production yet
  IF v_wave_status NOT IN ('draft','planning') THEN
    RETURN;
  END IF;

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
    VALUES (v_wave_id, v_row.reference_id, v_row.sole_id, v_row.color, 0, v_row.grade)
    ON CONFLICT (wave_id, reference_id, sole_product_id, color)
    DO UPDATE SET grade = EXCLUDED.grade
    RETURNING id INTO v_item_id;

    IF v_item_id IS NULL THEN
      SELECT id INTO v_item_id FROM production_wave_items
       WHERE wave_id = v_wave_id
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
   WHERE pwi.wave_id = v_wave_id;

  -- Remove wave items that became empty (no sources left)
  DELETE FROM production_wave_items pwi
   WHERE pwi.wave_id = v_wave_id
     AND NOT EXISTS (SELECT 1 FROM production_wave_item_sources WHERE wave_item_id = pwi.id);

  -- Recompute wave totals
  UPDATE production_waves w SET
    total_pairs = COALESCE((SELECT SUM(total_quantity) FROM production_wave_items WHERE wave_id = w.id),0),
    total_items = COALESCE((SELECT COUNT(*) FROM production_wave_items WHERE wave_id = w.id),0),
    updated_at = now()
  WHERE w.id = v_wave_id;
END;
$$;

-- 2) Trigger on sale_order_items
CREATE OR REPLACE FUNCTION public.trg_sync_wave_on_sale_order_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_so_id uuid;
BEGIN
  v_so_id := COALESCE(NEW.sale_order_id, OLD.sale_order_id);
  IF v_so_id IS NOT NULL THEN
    PERFORM sync_sale_order_wave_items(v_so_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_wave_items ON public.sale_order_items;
CREATE TRIGGER trg_sync_wave_items
AFTER INSERT OR UPDATE OF quantity, grade, color, reference_id OR DELETE
ON public.sale_order_items
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_wave_on_sale_order_items();

-- 3) Update existing sale_orders trigger to also call sync (handles billing_week changes)
CREATE OR REPLACE FUNCTION public.trg_auto_assign_wave_on_sale_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.status IN ('Aprovado','Em Produção'))
     OR (TG_OP = 'UPDATE' AND (
           NEW.status IN ('Aprovado','Em Produção')
        OR NEW.billing_week IS DISTINCT FROM OLD.billing_week
        OR NEW.delivery_deadline IS DISTINCT FROM OLD.delivery_deadline
     ))
  THEN
    PERFORM sync_sale_order_wave_items(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

-- 4) Fix public bucket listing security finding (reference-images)
-- Restrict listing to authenticated users only; reads of individual files remain public via signed paths
DROP POLICY IF EXISTS "Public read reference-images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can list reference images" ON storage.objects;

-- Authenticated users can view & list
CREATE POLICY "Authenticated can read reference-images"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'reference-images');

-- Public users can read individual files but not list (no broad SELECT to anon)
-- We keep bucket public so direct image URLs still work in <img> tags
