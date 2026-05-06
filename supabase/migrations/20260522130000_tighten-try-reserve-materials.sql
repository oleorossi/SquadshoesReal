-- =============================================================================
-- Add is_approved_user() guard to try_reserve_materials
-- =============================================================================
-- Audit-33 finding [2]: try_reserve_materials is SECURITY DEFINER with
-- EXECUTE granted to PUBLIC by default (no explicit REVOKE FROM PUBLIC).
-- An unapproved authenticated user can call it to spam-create phantom POs
-- and reservations, corrupting MRP demand signals.
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.try_reserve_materials(
  uuid, uuid, numeric, text, date, boolean, boolean, text, boolean, boolean
) FROM PUBLIC;

DROP FUNCTION IF EXISTS public.try_reserve_materials(p_order_id uuid, p_reference_id uuid, p_order_quantity numeric, p_color text, p_production_date date, p_permit_partial boolean, p_consider_safety_stock boolean, p_priority text, p_allow_expedite boolean, p_consolidate_po boolean) CASCADE;
CREATE OR REPLACE FUNCTION public.try_reserve_materials(
  p_order_id uuid,
  p_reference_id uuid,
  p_order_quantity numeric,
  p_color text DEFAULT '',
  p_production_date date DEFAULT NULL,
  p_permit_partial boolean DEFAULT true,
  p_consider_safety_stock boolean DEFAULT true,
  p_priority text DEFAULT 'normal',
  p_allow_expedite boolean DEFAULT false,
  p_consolidate_po boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_existing jsonb;
  v_batch_id uuid;
  v_reservations jsonb := '[]'::jsonb;
  v_pos jsonb := '[]'::jsonb;
  v_notes jsonb := '[]'::jsonb;
  mat RECORD;
  v_demand numeric;
  v_onhand numeric;
  v_reserved_qty numeric;
  v_available numeric;
  v_safety numeric;
  v_demand_with_safety numeric;
  v_inbound_available numeric;
  v_inbound_eta integer;
  v_prod_deadline integer;
  v_total_available numeric;
  v_qty_to_reserve numeric;
  v_net_missing numeric;
  v_moq numeric;
  v_po_qty numeric;
  v_po_id uuid;
  v_supplier_name text;
  v_target_id uuid;
  v_target_name text;
  v_target_qty numeric;
  v_target_unit text;
  v_target_price numeric;
  v_target_min numeric;
  v_target_max numeric;
  v_bom_group_names text[] := '{}';
  v_pg_name text;
  v_upper_material text; v_upper_consumption numeric;
  v_lining_material text; v_lining_consumption numeric;
  v_insole_material text; v_insole_consumption numeric;
  v_components jsonb;
  v_item jsonb;
  v_consumption numeric;
  v_product_id uuid;
  v_spec_materials text[][];
  v_spec text[];
  v_spec_name text;
  v_spec_consumption numeric;
  v_spec_material text;
  v_result jsonb;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  -- IDEMPOTENCY
  SELECT result INTO v_existing FROM reservation_batches WHERE order_id = p_order_id AND status = 'done';
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  DELETE FROM reservation_batches WHERE order_id = p_order_id AND status != 'done';
  INSERT INTO reservation_batches (order_id, status) VALUES (p_order_id, 'processing') RETURNING id INTO v_batch_id;

  v_prod_deadline := CASE WHEN p_production_date IS NOT NULL THEN GREATEST(0, p_production_date - current_date) ELSE 30 END;

  -- ===== BOM MATERIALS =====
  FOR mat IN
    SELECT sm.product_id, sm.quantity_per_unit, p.quantity AS current_stock,
           p.name, p.group_id, p.color AS product_color, p.category,
           p.min_stock, p.max_stock, p.unit, p.unit_price
    FROM sheet_materials sm JOIN products p ON p.id = sm.product_id
    WHERE sm.sheet_id = p_reference_id
  LOOP
    IF mat.group_id IS NOT NULL THEN
      SELECT pg.name INTO v_pg_name FROM product_groups pg WHERE pg.id = mat.group_id;
      IF v_pg_name IS NOT NULL THEN v_bom_group_names := array_append(v_bom_group_names, v_pg_name); END IF;
    END IF;

    v_target_id := mat.product_id; v_target_name := mat.name; v_target_qty := mat.current_stock;
    v_target_unit := mat.unit; v_target_price := mat.unit_price; v_target_min := mat.min_stock; v_target_max := mat.max_stock;

    IF p_color IS NOT NULL AND p_color <> '' AND mat.product_color <> p_color THEN
      SELECT p.id, p.name, p.quantity, p.unit, p.unit_price, p.min_stock, p.max_stock
      INTO v_target_id, v_target_name, v_target_qty, v_target_unit, v_target_price, v_target_min, v_target_max
      FROM products p WHERE p.active = true AND p.color = p_color
        AND ((mat.group_id IS NOT NULL AND p.group_id = mat.group_id) OR (mat.group_id IS NULL AND p.name = mat.name))
      LIMIT 1;
      IF v_target_id IS NULL THEN
        SELECT p.id, p.name, p.quantity, p.unit, p.unit_price, p.min_stock, p.max_stock
        INTO v_target_id, v_target_name, v_target_qty, v_target_unit, v_target_price, v_target_min, v_target_max
        FROM products p WHERE p.active = true
          AND ((mat.group_id IS NOT NULL AND p.group_id = mat.group_id) OR (mat.group_id IS NULL AND p.name = mat.name))
          AND LOWER(p.name) LIKE '%' || LOWER(p_color) || '%'
        LIMIT 1;
      END IF;
      IF v_target_id IS NULL THEN
        v_target_id := mat.product_id; v_target_name := mat.name; v_target_qty := mat.current_stock;
        v_target_unit := mat.unit; v_target_price := mat.unit_price; v_target_min := mat.min_stock; v_target_max := mat.max_stock;
      END IF;
    END IF;

    v_demand := mat.quantity_per_unit * p_order_quantity;
    SELECT p.quantity INTO v_onhand FROM products p WHERE p.id = v_target_id FOR UPDATE;
    SELECT COALESCE(SUM(mr.quantity_reserved - mr.quantity_consumed), 0) INTO v_reserved_qty
    FROM material_reservations mr WHERE mr.product_id = v_target_id AND mr.status IN ('reserved', 'partially_consumed');
    v_available := v_onhand - v_reserved_qty;
    v_safety := CASE WHEN p_consider_safety_stock THEN COALESCE(v_target_min, 0) ELSE 0 END;
    v_demand_with_safety := v_demand + v_safety;

    SELECT COALESCE(SUM(poi.quantity), 0), COALESCE(MIN(po.eta_days), 999)
    INTO v_inbound_available, v_inbound_eta
    FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.purchase_order_id
    WHERE poi.product_id = v_target_id AND po.status IN ('pending', 'approved');
    IF v_inbound_eta > v_prod_deadline THEN v_inbound_available := 0; END IF;
    v_total_available := v_available + v_inbound_available;

    SELECT COALESCE(gsm.minimum_order, 1) INTO v_moq
    FROM group_supplier_materials gsm JOIN group_suppliers gs ON gs.id = gsm.supplier_id
    WHERE gsm.group_id = mat.group_id AND gsm.active = true ORDER BY gsm.updated_at DESC LIMIT 1;
    IF v_moq IS NULL OR v_moq < 1 THEN v_moq := 1; END IF;

    v_supplier_name := 'A definir';
    SELECT gs.supplier_name INTO v_supplier_name FROM group_suppliers gs WHERE gs.group_id = mat.group_id ORDER BY gs.updated_at DESC LIMIT 1;
    IF v_supplier_name IS NULL THEN v_supplier_name := 'A definir'; END IF;

    -- DECISION RULES
    IF p_priority = 'urgent' AND v_available < v_demand THEN
      -- R5: urgent
      v_qty_to_reserve := GREATEST(0, v_available);
      IF v_qty_to_reserve > 0 THEN
        INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, source, batch_id, notes)
        VALUES (p_order_id, v_target_id, v_qty_to_reserve, 0, 'reserved', 'soft', 'onhand', v_batch_id, 'R5-urgent');
        v_reservations := v_reservations || jsonb_build_object('product_id', v_target_id, 'product_name', v_target_name, 'qty_reserved', v_qty_to_reserve, 'source', 'onhand', 'rule', 'R5');
      END IF;
      v_net_missing := v_demand - v_qty_to_reserve;
      IF v_net_missing > 0 THEN
        v_po_qty := GREATEST(v_net_missing, v_moq);
        INSERT INTO purchase_orders (supplier_name, auto_generated, notes, expedite, reference_order_id) VALUES (v_supplier_name, true, 'MRP R5 urgent | ' || v_target_name, true, p_order_id) RETURNING id INTO v_po_id;
        INSERT INTO purchase_order_items (purchase_order_id, product_id, current_stock, min_stock, max_stock, suggested_quantity, quantity, unit_price, unit) VALUES (v_po_id, v_target_id, v_onhand, COALESCE(v_target_min,0), COALESCE(v_target_max,0), v_po_qty, v_po_qty, v_target_price, v_target_unit);
        UPDATE purchase_orders SET total_value = v_po_qty * v_target_price WHERE id = v_po_id;
        v_pos := v_pos || jsonb_build_object('po_id', v_po_id, 'product_name', v_target_name, 'qty_ordered', v_po_qty, 'expedite', true, 'rule', 'R5');
      END IF;
      v_notes := v_notes || to_jsonb('R5: Urgente ' || v_target_name || '. Reservado=' || v_qty_to_reserve || ' PO=' || COALESCE(v_po_qty,0));

    ELSIF v_available >= v_demand_with_safety THEN
      -- R1: full reserve
      INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, source, batch_id, notes)
      VALUES (p_order_id, v_target_id, v_demand, 0, 'reserved', 'soft', 'onhand', v_batch_id, 'R1-full');
      v_reservations := v_reservations || jsonb_build_object('product_id', v_target_id, 'product_name', v_target_name, 'qty_reserved', v_demand, 'source', 'onhand', 'rule', 'R1');
      v_notes := v_notes || to_jsonb('R1: ' || v_target_name || ' reserva total ' || v_demand);

    ELSIF v_total_available >= v_demand_with_safety AND p_permit_partial THEN
      -- R2: onhand + inbound
      v_qty_to_reserve := GREATEST(0, v_available);
      IF v_qty_to_reserve > 0 THEN
        INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, source, batch_id, notes)
        VALUES (p_order_id, v_target_id, v_qty_to_reserve, 0, 'reserved', 'soft', 'onhand', v_batch_id, 'R2-onhand');
        v_reservations := v_reservations || jsonb_build_object('product_id', v_target_id, 'product_name', v_target_name, 'qty_reserved', v_qty_to_reserve, 'source', 'onhand', 'rule', 'R2');
      END IF;
      v_net_missing := v_demand - v_qty_to_reserve;
      IF v_net_missing > 0 AND v_inbound_available > 0 THEN
        INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, source, batch_id, notes)
        VALUES (p_order_id, v_target_id, LEAST(v_net_missing, v_inbound_available), 0, 'reserved', 'soft', 'inbound', v_batch_id, 'R2-inbound ETA=' || v_inbound_eta || 'd');
        v_reservations := v_reservations || jsonb_build_object('product_id', v_target_id, 'product_name', v_target_name, 'qty_reserved', LEAST(v_net_missing, v_inbound_available), 'source', 'inbound', 'rule', 'R2');
      END IF;
      v_notes := v_notes || to_jsonb('R2: ' || v_target_name || ' onhand=' || v_qty_to_reserve || ' inbound=' || LEAST(v_net_missing, v_inbound_available));

    ELSIF p_permit_partial THEN
      -- R3: partial + PO
      v_qty_to_reserve := GREATEST(0, v_available);
      IF v_qty_to_reserve > 0 THEN
        INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, source, batch_id, notes)
        VALUES (p_order_id, v_target_id, v_qty_to_reserve, 0, 'reserved', 'soft', 'onhand', v_batch_id, 'R3-partial');
        v_reservations := v_reservations || jsonb_build_object('product_id', v_target_id, 'product_name', v_target_name, 'qty_reserved', v_qty_to_reserve, 'source', 'onhand', 'rule', 'R3');
      END IF;
      v_net_missing := v_demand - v_qty_to_reserve;
      IF v_net_missing > 0 THEN
        v_po_qty := GREATEST(v_net_missing, v_moq);
        INSERT INTO purchase_orders (supplier_name, auto_generated, notes, reference_order_id) VALUES (v_supplier_name, true, 'MRP R3 | ' || v_target_name || ' faltante=' || round(v_net_missing,2), p_order_id) RETURNING id INTO v_po_id;
        INSERT INTO purchase_order_items (purchase_order_id, product_id, current_stock, min_stock, max_stock, suggested_quantity, quantity, unit_price, unit) VALUES (v_po_id, v_target_id, v_onhand, COALESCE(v_target_min,0), COALESCE(v_target_max,0), v_po_qty, v_po_qty, v_target_price, v_target_unit);
        UPDATE purchase_orders SET total_value = v_po_qty * v_target_price WHERE id = v_po_id;
        v_pos := v_pos || jsonb_build_object('po_id', v_po_id, 'product_name', v_target_name, 'qty_ordered', v_po_qty, 'rule', 'R3');
      END IF;
      v_notes := v_notes || to_jsonb('R3: ' || v_target_name || ' parcial=' || v_qty_to_reserve || ' PO=' || COALESCE(v_po_qty,0));

    ELSE
      -- R4: block + PO
      v_net_missing := v_demand;
      v_po_qty := GREATEST(v_net_missing, v_moq);
      INSERT INTO purchase_orders (supplier_name, auto_generated, notes, reference_order_id) VALUES (v_supplier_name, true, 'MRP R4 bloqueado | ' || v_target_name, p_order_id) RETURNING id INTO v_po_id;
      INSERT INTO purchase_order_items (purchase_order_id, product_id, current_stock, min_stock, max_stock, suggested_quantity, quantity, unit_price, unit) VALUES (v_po_id, v_target_id, v_onhand, COALESCE(v_target_min,0), COALESCE(v_target_max,0), v_po_qty, v_po_qty, v_target_price, v_target_unit);
      UPDATE purchase_orders SET total_value = v_po_qty * v_target_price WHERE id = v_po_id;
      v_pos := v_pos || jsonb_build_object('po_id', v_po_id, 'product_name', v_target_name, 'qty_ordered', v_po_qty, 'rule', 'R4');
      v_notes := v_notes || to_jsonb('R4: ' || v_target_name || ' bloqueado. PO=' || v_po_qty);
    END IF;
  END LOOP;

  -- ===== SPEC MATERIALS (upper/lining/insole) =====
  SELECT ts.upper_material, ts.upper_consumption, ts.lining_material, ts.lining_consumption,
         ts.insole_material, ts.insole_consumption, ts.direct_components
  INTO v_upper_material, v_upper_consumption, v_lining_material, v_lining_consumption,
       v_insole_material, v_insole_consumption, v_components
  FROM technical_sheets ts WHERE ts.id = p_reference_id;

  v_spec_materials := ARRAY[
    ARRAY[COALESCE(v_upper_material,''), COALESCE(v_upper_consumption::text,'0'), 'Cabedal'],
    ARRAY[COALESCE(v_lining_material,''), COALESCE(v_lining_consumption::text,'0'), 'Forro'],
    ARRAY[COALESCE(v_insole_material,''), COALESCE(v_insole_consumption::text,'0'), 'Palmilha']
  ];

  FOREACH v_spec SLICE 1 IN ARRAY v_spec_materials
  LOOP
    v_spec_material := v_spec[1]; v_spec_consumption := v_spec[2]::numeric; v_spec_name := v_spec[3];
    IF v_spec_material = '' OR v_spec_consumption <= 0 THEN CONTINUE; END IF;
    IF v_spec_material = ANY(v_bom_group_names) THEN CONTINUE; END IF;

    v_demand := v_spec_consumption * p_order_quantity;
    v_target_id := NULL;
    IF p_color <> '' THEN
      SELECT p.id, p.name, p.quantity, p.unit, p.unit_price, p.min_stock
      INTO v_target_id, v_target_name, v_target_qty, v_target_unit, v_target_price, v_target_min
      FROM products p JOIN product_groups pg ON pg.id = p.group_id
      WHERE p.active = true AND pg.name = v_spec_material AND p.color = p_color LIMIT 1;
    END IF;
    IF v_target_id IS NULL THEN
      SELECT p.id, p.name, p.quantity, p.unit, p.unit_price, p.min_stock
      INTO v_target_id, v_target_name, v_target_qty, v_target_unit, v_target_price, v_target_min
      FROM products p JOIN product_groups pg ON pg.id = p.group_id
      WHERE p.active = true AND pg.name = v_spec_material LIMIT 1;
    END IF;
    IF v_target_id IS NULL THEN
      v_notes := v_notes || to_jsonb(v_spec_name || ' "' || v_spec_material || '" nao encontrado.');
      CONTINUE;
    END IF;

    SELECT p.quantity INTO v_onhand FROM products p WHERE p.id = v_target_id FOR UPDATE;
    SELECT COALESCE(SUM(mr.quantity_reserved - mr.quantity_consumed), 0) INTO v_reserved_qty
    FROM material_reservations mr WHERE mr.product_id = v_target_id AND mr.status IN ('reserved', 'partially_consumed');
    v_available := v_onhand - v_reserved_qty;
    v_safety := CASE WHEN p_consider_safety_stock THEN COALESCE(v_target_min, 0) ELSE 0 END;
    v_demand_with_safety := v_demand + v_safety;

    IF v_available >= v_demand_with_safety THEN
      INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, source, batch_id, notes)
      VALUES (p_order_id, v_target_id, v_demand, 0, 'reserved', 'soft', 'onhand', v_batch_id, 'R1 ' || v_spec_name);
      v_reservations := v_reservations || jsonb_build_object('product_id', v_target_id, 'product_name', v_target_name, 'qty_reserved', v_demand, 'source', 'onhand', 'rule', 'R1', 'category', v_spec_name);
      v_notes := v_notes || to_jsonb('R1: ' || v_spec_name || ' ' || v_target_name || ' reservado ' || v_demand);
    ELSIF p_permit_partial THEN
      v_qty_to_reserve := GREATEST(0, v_available);
      IF v_qty_to_reserve > 0 THEN
        INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, source, batch_id, notes)
        VALUES (p_order_id, v_target_id, v_qty_to_reserve, 0, 'reserved', 'soft', 'onhand', v_batch_id, 'R3 ' || v_spec_name);
        v_reservations := v_reservations || jsonb_build_object('product_id', v_target_id, 'product_name', v_target_name, 'qty_reserved', v_qty_to_reserve, 'source', 'onhand', 'rule', 'R3', 'category', v_spec_name);
      END IF;
      v_notes := v_notes || to_jsonb('R3: ' || v_spec_name || ' parcial=' || GREATEST(0, v_available) || ' faltante=' || round(v_demand - GREATEST(0, v_available), 2));
    ELSE
      v_notes := v_notes || to_jsonb('R4: ' || v_spec_name || ' bloqueado. Faltante=' || round(v_demand - v_available, 2));
    END IF;
  END LOOP;

  -- ===== DIRECT COMPONENTS =====
  IF v_components IS NOT NULL AND jsonb_typeof(v_components) = 'array' AND jsonb_array_length(v_components) > 0 THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_components) AS value
    LOOP
      v_consumption := COALESCE((v_item ->> 'consumption')::numeric, 0);
      IF v_consumption <= 0 THEN CONTINUE; END IF;
      v_demand := v_consumption * p_order_quantity;
      v_product_id := NULL;
      BEGIN v_product_id := (v_item ->> 'id')::uuid; EXCEPTION WHEN OTHERS THEN v_product_id := NULL; END;
      IF v_product_id IS NULL THEN CONTINUE; END IF;

      SELECT p.id, p.name, p.quantity, p.unit, p.unit_price INTO v_target_id, v_target_name, v_target_qty, v_target_unit, v_target_price
      FROM products p WHERE p.id = v_product_id AND p.active = true;
      IF v_target_id IS NULL THEN CONTINUE; END IF;

      SELECT p.quantity INTO v_onhand FROM products p WHERE p.id = v_target_id FOR UPDATE;
      SELECT COALESCE(SUM(mr.quantity_reserved - mr.quantity_consumed), 0) INTO v_reserved_qty
      FROM material_reservations mr WHERE mr.product_id = v_target_id AND mr.status IN ('reserved', 'partially_consumed');
      v_available := v_onhand - v_reserved_qty;

      IF v_available >= v_demand THEN
        INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, source, batch_id, notes)
        VALUES (p_order_id, v_target_id, v_demand, 0, 'reserved', 'soft', 'onhand', v_batch_id, 'R1 component');
        v_reservations := v_reservations || jsonb_build_object('product_id', v_target_id, 'product_name', v_target_name, 'qty_reserved', v_demand, 'source', 'onhand', 'rule', 'R1', 'category', 'Componente');
      ELSIF p_permit_partial THEN
        v_qty_to_reserve := GREATEST(0, v_available);
        IF v_qty_to_reserve > 0 THEN
          INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, source, batch_id, notes)
          VALUES (p_order_id, v_target_id, v_qty_to_reserve, 0, 'reserved', 'soft', 'onhand', v_batch_id, 'R3 component');
          v_reservations := v_reservations || jsonb_build_object('product_id', v_target_id, 'product_name', v_target_name, 'qty_reserved', v_qty_to_reserve, 'source', 'onhand', 'rule', 'R3', 'category', 'Componente');
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- FINALIZE
  v_result := jsonb_build_object(
    'order_id', p_order_id, 'batch_id', v_batch_id,
    'reservations', v_reservations, 'purchase_orders', v_pos, 'notes', v_notes,
    'status', CASE
      WHEN jsonb_array_length(v_pos) = 0 AND jsonb_array_length(v_reservations) > 0 THEN 'fully_reserved'
      WHEN jsonb_array_length(v_pos) > 0 AND jsonb_array_length(v_reservations) > 0 THEN 'partially_reserved'
      WHEN jsonb_array_length(v_pos) > 0 AND jsonb_array_length(v_reservations) = 0 THEN 'pending_purchase'
      ELSE 'no_materials'
    END
  );

  UPDATE reservation_batches SET status = 'done', result = v_result WHERE id = v_batch_id;
  INSERT INTO audit_logs (action, resource, resource_id, new_data, success)
  VALUES ('try_reserve_materials', 'order', p_order_id::text, v_result, true);

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.try_reserve_materials(
  uuid, uuid, numeric, text, date, boolean, boolean, text, boolean, boolean
) TO authenticated;
