-- =============================================================================
-- Hardening de try_reserve_materials + audit view de fichas sem setores
-- =============================================================================
-- Cobre:
--   🟡 H1 — try_reserve_materials NÃO tem advisory lock. Duas chamadas
--          concorrentes pro mesmo p_order_id passam ambas pelo guard de
--          idempotência (SELECT result FROM reservation_batches WHERE
--          status='done') e podem inserir reservas em duplicata se a janela
--          entre SELECT e INSERT acontece simultânea. Adiciona
--          pg_advisory_xact_lock(hashtext('reserve:' || p_order_id))
--          serializando a função por order_id. Match com debit_strap_stock
--          e hybrid_debit_stock_for_order.
--
--   🟡 H2 — Audit view v_sheets_missing_sectors lista fichas técnicas com
--          production_sectors NULL ou [] (array vazio). Fichas nessa condição
--          caem em "todos os setores ativos" pelo fallback do
--          compute_wave_timeline / compute_min_billing_date, mas isso pode
--          gerar lead time inflado quando a ficha não usa todos os setores
--          (ex.: produto sem silk gastando capacidade de silk no cálculo).
-- =============================================================================

-- ─── H1: advisory lock em try_reserve_materials ────────────────────────────
-- Reescrevemos apenas o início da função pra adicionar o lock. Pra evitar
-- duplicar 320+ linhas, usamos uma função wrapper interna. Mas como a função
-- atual já é monolítica, fazemos a forma mais simples: adicionar o lock no
-- início. Preservamos toda a lógica restante via CREATE OR REPLACE com o
-- body completo (idêntico ao migration 20260522130000, só com o lock novo).

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

  -- H1 FIX: advisory lock por order_id (serializa chamadas concorrentes).
  -- Previne race entre check de idempotência e INSERT em reservation_batches.
  -- Lock liberado automaticamente ao fim da transação (xact_lock).
  PERFORM pg_advisory_xact_lock(hashtext('try_reserve_materials:' || p_order_id::text));

  -- IDEMPOTENCY (agora dentro do lock — duas chamadas concorrentes verão
  -- o batch criado pela primeira que ganhou o lock)
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

COMMENT ON FUNCTION public.try_reserve_materials(uuid, uuid, numeric, text, date, boolean, boolean, text, boolean, boolean) IS
  'Reserva materiais pra OP (BOM + specs + componentes). Protegida por advisory '
  'lock por order_id (H1, 20260627120000) — duas chamadas concorrentes serializam. '
  'Idempotente via reservation_batches.status=done.';


-- ─── H2: adiciona `missing_production_sectors` em v_technical_sheets_audit ──
-- Em vez de criar view separada, estendemos a audit view existente que já é
-- consumida pelo SheetsAuditPanel.tsx. Operador vê o gap junto com os demais
-- (cabedal/forro/palmilha/solado/etc.) e pode corrigir via ConstructionConfigPanel.
--
-- Fichas com production_sectors NULL ou [] caem no fallback "todos os setores"
-- do compute_wave_timeline/compute_min_billing_date, inflando lead time. Sem
-- setores explícitos, o sistema assume Silk+Colagem+Solagem em fichas que não
-- usam.

-- IMPORTANTE: preservar TODAS as colunas da v_technical_sheets_audit atual
-- (audit-round-17 — 20260524270000) incluindo sole_drives_consumption,
-- sole_driven_but_specs_missing, etc. Apenas adicionamos missing_production_sectors.

CREATE OR REPLACE VIEW public.v_technical_sheets_audit AS
WITH sheet_solados AS (
  SELECT DISTINCT tsc.sheet_id, tsc.sole_product_id
    FROM technical_sheet_sole_colors tsc
   WHERE tsc.sole_product_id IS NOT NULL
),
sole_has_specs AS (
  SELECT
    s.sheet_id,
    bool_or(EXISTS (
      SELECT 1 FROM sole_technical_specs sts
       WHERE sts.sole_id = s.sole_product_id
         AND COALESCE(sts.lining_consumption_dm2, 0) > 0
    )) AS sole_has_lining_specs,
    bool_or(EXISTS (
      SELECT 1 FROM sole_technical_specs sts
       WHERE sts.sole_id = s.sole_product_id
         AND COALESCE(sts.insole_consumption_dm2, 0) > 0
    )) AS sole_has_insole_specs,
    bool_or(EXISTS (
      SELECT 1 FROM products p
       WHERE p.id = s.sole_product_id AND COALESCE(p.is_fachetado, false) = true
    )) AS sole_is_fachetado,
    bool_or(EXISTS (
      SELECT 1 FROM sole_technical_specs sts
       WHERE sts.sole_id = s.sole_product_id
         AND COALESCE(sts.fachete_lining_consumption_dm2, 0) > 0
    )) AS sole_has_fachete_specs
  FROM sheet_solados s
  GROUP BY s.sheet_id
)
SELECT
  ts.id,
  ts.code,
  ts.name,
  ts.status,
  COALESCE(ts.sole_drives_consumption, false) AS sole_drives_consumption,

  COALESCE(ts.upper_material, '') = '' AS missing_upper_material,
  (COALESCE(ts.upper_consumption, 0) <= 0
    AND (ts.upper_consumption_per_size IS NULL OR ts.upper_consumption_per_size = '{}'::jsonb)) AS missing_upper_consumption,

  COALESCE(ts.lining_material, '') = '' AS missing_lining_material,
  (COALESCE(ts.lining_consumption, 0) <= 0
    AND (ts.lining_consumption_per_size IS NULL OR ts.lining_consumption_per_size = '{}'::jsonb)
    AND (
      NOT COALESCE(ts.sole_drives_consumption, false)
      OR NOT COALESCE(shs.sole_has_lining_specs, false)
    )
  ) AS missing_lining_consumption,

  COALESCE(ts.insole_material, '') = '' AS missing_insole_material,
  (COALESCE(ts.insole_consumption, 0) <= 0
    AND (ts.insole_consumption_per_size IS NULL OR ts.insole_consumption_per_size = '{}'::jsonb)
    AND (
      NOT COALESCE(ts.sole_drives_consumption, false)
      OR NOT COALESCE(shs.sole_has_insole_specs, false)
    )
  ) AS missing_insole_consumption,

  COALESCE(ts.sole_material, '') = '' AS missing_sole_material,
  COALESCE(ts.sole_consumption, 0) <= 0 AS missing_sole_consumption,

  NOT EXISTS (SELECT 1 FROM technical_sheet_sole_colors WHERE sheet_id = ts.id) AS missing_sole_color_mapping,

  COALESCE(shs.sole_is_fachetado, false) = true
    AND NOT COALESCE(shs.sole_has_fachete_specs, false) AS sole_fachetado_sem_fachete,

  COALESCE(ts.sole_drives_consumption, false) = true
    AND (
      NOT COALESCE(shs.sole_has_lining_specs, false)
      OR NOT COALESCE(shs.sole_has_insole_specs, false)
    ) AS sole_driven_but_specs_missing,

  COALESCE(ts.has_straps, false) = true
    AND (ts.strap_colors IS NULL OR jsonb_array_length(ts.strap_colors) = 0) AS straps_without_colors,
  COALESCE(ts.has_straps, false) = true
    AND ts.strap_colors IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(ts.strap_colors) s
      WHERE COALESCE(s ->> 'group_id', '') = ''
    ) AS straps_without_group,

  NOT EXISTS (SELECT 1 FROM technical_sheet_operations WHERE sheet_id = ts.id) AS missing_mod,

  (ts.upper_consumption_per_size IS NOT NULL
    AND jsonb_typeof(ts.upper_consumption_per_size) = 'object'
    AND ts.upper_consumption_per_size != '{}'::jsonb
    AND COALESCE(ts.upper_consumption, 0) <= 0
    AND (SELECT COUNT(*) FROM jsonb_each_text(ts.upper_consumption_per_size) WHERE value::numeric > 0) < 5
  ) AS upper_per_size_partial_no_fallback,

  -- ── NOVO (H2 / 20260627120000): setores de produção não configurados ──
  -- Fichas sem production_sectors caem em "todos setores ativos" no
  -- compute_wave_timeline / compute_min_billing_date → lead time inflado.
  (
    ts.production_sectors IS NULL
    OR jsonb_typeof(ts.production_sectors) <> 'array'
    OR jsonb_array_length(ts.production_sectors) = 0
  ) AS missing_production_sectors,

  ts.updated_at,
  ts.created_at
FROM technical_sheets ts
LEFT JOIN sole_has_specs shs ON shs.sheet_id = ts.id;

GRANT SELECT ON public.v_technical_sheets_audit TO authenticated;

ALTER VIEW public.v_technical_sheets_audit SET (security_invoker = true);

COMMENT ON VIEW public.v_technical_sheets_audit IS
  'Relatório de auditoria das fichas técnicas. Cada coluna boolean indica um '
  'gap. UI filtra fichas com qualquer flag=true pra operador corrigir. '
  'H2 (20260627120000) adicionou missing_production_sectors.';


-- Atualiza view-resumo pra contar fichas com setores não configurados
CREATE OR REPLACE VIEW public.v_technical_sheets_audit_summary AS
SELECT
  COUNT(*) AS total_fichas,
  COUNT(*) FILTER (WHERE NOT (
    missing_upper_material OR missing_upper_consumption OR
    missing_lining_material OR missing_lining_consumption OR
    missing_insole_material OR missing_insole_consumption OR
    missing_sole_material OR missing_sole_consumption OR
    missing_sole_color_mapping OR sole_fachetado_sem_fachete OR
    sole_driven_but_specs_missing OR
    straps_without_colors OR straps_without_group OR
    missing_mod OR upper_per_size_partial_no_fallback OR
    missing_production_sectors
  )) AS fichas_100_completas,
  COUNT(*) FILTER (WHERE sole_drives_consumption) AS fichas_sole_driven,
  COUNT(*) FILTER (WHERE sole_driven_but_specs_missing) AS sole_driven_sem_specs,
  COUNT(*) FILTER (WHERE missing_upper_material) AS sem_grupo_cabedal,
  COUNT(*) FILTER (WHERE missing_upper_consumption) AS sem_consumo_cabedal,
  COUNT(*) FILTER (WHERE missing_lining_material) AS sem_grupo_forro,
  COUNT(*) FILTER (WHERE missing_lining_consumption) AS sem_consumo_forro,
  COUNT(*) FILTER (WHERE missing_insole_material) AS sem_grupo_palmilha,
  COUNT(*) FILTER (WHERE missing_insole_consumption) AS sem_consumo_palmilha,
  COUNT(*) FILTER (WHERE missing_sole_material) AS sem_grupo_solado,
  COUNT(*) FILTER (WHERE missing_sole_consumption) AS sem_consumo_solado,
  COUNT(*) FILTER (WHERE missing_sole_color_mapping) AS sem_cores_solado,
  COUNT(*) FILTER (WHERE sole_fachetado_sem_fachete) AS fachetado_sem_fachete,
  COUNT(*) FILTER (WHERE straps_without_colors) AS tiras_sem_cores,
  COUNT(*) FILTER (WHERE straps_without_group) AS tiras_sem_grupo,
  COUNT(*) FILTER (WHERE missing_mod) AS sem_mod_cadastrado,
  COUNT(*) FILTER (WHERE missing_production_sectors) AS sem_setores_producao
FROM v_technical_sheets_audit;

GRANT SELECT ON public.v_technical_sheets_audit_summary TO authenticated;

ALTER VIEW public.v_technical_sheets_audit_summary SET (security_invoker = true);
