-- 1. Refactor resync_op_atomic to ensure correct sector names
CREATE OR REPLACE FUNCTION public.resync_op_atomic(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_op record;
  v_mov record;
  v_prev_stock numeric;
  v_new_stock numeric;
  v_grade jsonb;
  v_status text;
  v_errors text[] := '{}';
BEGIN
  SELECT id, reference_id, quantity, color, grade, sale_order_id, order_number, status
    INTO v_op
    FROM public.orders
   WHERE id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OP não encontrada: %', p_order_id;
  END IF;

  v_status := LOWER(COALESCE(v_op.status, ''));
  IF v_status NOT IN ('reservado', 'em produção') THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'OP not active', 'status', v_op.status);
  END IF;

  v_grade := COALESCE(v_op.grade, '{}'::jsonb);

  -- Stock Rollback
  FOR v_mov IN
    SELECT product_id, quantity
      FROM public.stock_movements
     WHERE order_id = p_order_id AND movement_type = 'out'
  LOOP
    SELECT quantity INTO v_prev_stock FROM public.products WHERE id = v_mov.product_id FOR UPDATE;
    IF FOUND THEN
      v_new_stock := v_prev_stock + v_mov.quantity;
      UPDATE public.products SET quantity = v_new_stock, updated_at = now() WHERE id = v_mov.product_id;
      INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES (v_mov.product_id, 'in', v_mov.quantity, v_prev_stock, v_new_stock, 'Estorno automático - resync_op_atomic', p_order_id);
    END IF;
  END LOOP;

  UPDATE public.production_consumptions SET superseded_at = now(), superseded_reason = 'resync_op_atomic' WHERE order_id = p_order_id AND superseded_at IS NULL;
  DELETE FROM public.material_reservations WHERE order_id = p_order_id;
  DELETE FROM public.order_stages WHERE order_id = p_order_id;

  IF v_op.sale_order_id IS NOT NULL THEN
    DELETE FROM public.technical_sheet_snapshots WHERE sale_order_id = v_op.sale_order_id;
  END IF;

  UPDATE public.stock_movements SET order_id = NULL WHERE order_id = p_order_id AND movement_type = 'out';

  BEGIN
    PERFORM public.restore_sole_grade_for_order(p_order_id);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  PERFORM public.hybrid_debit_stock_for_order(v_op.reference_id, v_op.quantity, COALESCE(v_op.color, ''), p_order_id, CASE WHEN v_grade <> '{}'::jsonb THEN v_grade ELSE NULL END);

  IF v_grade <> '{}'::jsonb THEN
    BEGIN
      PERFORM public.debit_sole_stock_by_grade(v_op.reference_id, p_order_id, COALESCE(v_op.color, ''), v_grade);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  -- Recreate Stages with Normalized Names and Sequencing
  INSERT INTO public.order_stages (order_id, stage_name, stage_order, status, quantity_total, quantity_processed)
  SELECT p_order_id,
         normalized_name,
         COALESCE(public.stage_order(public.sector_display_to_enum(normalized_name)), ord),
         'pendente',
         v_op.quantity,
         0
    FROM (
      SELECT
        COALESCE(
          (SELECT array_agg(value::text ORDER BY ordinality)
             FROM public.technical_sheets ts,
                  jsonb_array_elements_text(ts.production_sectors) WITH ORDINALITY
            WHERE ts.id = v_op.reference_id
              AND ts.production_sectors IS NOT NULL
              AND jsonb_array_length(ts.production_sectors) > 0),
          ARRAY['Corte Palmilha','Corte Forração','Mesa','Silk','Colagem','Montagem','Solagem','Acabamento','Expedição']
        ) AS names
    ) s,
    LATERAL (
      SELECT 
        CASE 
          WHEN lower(trim(name)) IN ('corte','palmilha') THEN 'Corte Palmilha'
          WHEN lower(trim(name)) IN ('forração','forracao','costura') THEN 'Corte Forração'
          WHEN lower(trim(name)) = 'aviamento' THEN 'Mesa'
          WHEN lower(trim(name)) = 'serigrafia' THEN 'Silk'
          ELSE name 
        END AS normalized_name, 
        ord
        FROM unnest(s.names) WITH ORDINALITY AS u(name, ord)
    ) lat;

  RETURN jsonb_build_object('order_id', p_order_id, 'order_number', v_op.order_number, 'resynced_at', now());
END;
$function$;

-- 2. Add unique constraint to purchase_order_items if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'purchase_order_items_order_product_unique'
    ) THEN
        ALTER TABLE public.purchase_order_items 
        ADD CONSTRAINT purchase_order_items_order_product_unique UNIQUE (purchase_order_id, product_id);
    END IF;
END $$;

-- 3. Implement atomic UPSERT for PO items with automatic total synchronization
CREATE OR REPLACE FUNCTION public.upsert_po_item_atomic(
    p_purchase_order_id uuid,
    p_product_id uuid,
    p_quantity numeric,
    p_unit_price numeric,
    p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_total_price numeric;
    v_order_total numeric;
BEGIN
    v_total_price := p_quantity * p_unit_price;

    -- Upsert the item
    INSERT INTO public.purchase_order_items (
        purchase_order_id,
        product_id,
        quantity,
        unit_price,
        total_price,
        notes,
        updated_at
    )
    VALUES (
        p_purchase_order_id,
        p_product_id,
        p_quantity,
        p_unit_price,
        v_total_price,
        p_notes,
        now()
    )
    ON CONFLICT (purchase_order_id, product_id) 
    DO UPDATE SET
        quantity = EXCLUDED.quantity,
        unit_price = EXCLUDED.unit_price,
        total_price = EXCLUDED.total_price,
        notes = COALESCE(EXCLUDED.notes, purchase_order_items.notes),
        updated_at = now();

    -- Recalculate and update the order total atomically
    SELECT SUM(total_price) INTO v_order_total
    FROM public.purchase_order_items
    WHERE purchase_order_id = p_purchase_order_id;

    UPDATE public.purchase_orders
    SET total_amount = COALESCE(v_order_total, 0),
        updated_at = now()
    WHERE id = p_purchase_order_id;
END;
$function$;

-- 4. Update the mass upsert function to use the atomic logic if needed
CREATE OR REPLACE FUNCTION public.upsert_purchase_order_items(p_order_id uuid, p_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    item jsonb;
    v_order_total numeric;
BEGIN
    -- Remove items not in the list if we want to sync exactly
    -- Or just delete all and re-insert (traditional way)
    DELETE FROM public.purchase_order_items
    WHERE purchase_order_id = p_order_id;

    -- Insere novos itens
    INSERT INTO public.purchase_order_items (
        purchase_order_id,
        product_id,
        quantity,
        unit_price,
        total_price,
        notes
    )
    SELECT 
        p_order_id,
        (i->>'product_id')::UUID,
        (i->>'quantity')::NUMERIC,
        (i->>'unit_price')::NUMERIC,
        COALESCE((i->>'total_price')::NUMERIC, (i->>'quantity')::NUMERIC * (i->>'unit_price')::NUMERIC),
        i->>'notes'
    FROM jsonb_array_elements(p_items) AS i;

    -- Update parent total
    SELECT SUM(total_price) INTO v_order_total
    FROM public.purchase_order_items
    WHERE purchase_order_id = p_order_id;

    UPDATE public.purchase_orders
    SET total_amount = COALESCE(v_order_total, 0),
        updated_at = now()
    WHERE id = p_order_id;
END;
$function$;
