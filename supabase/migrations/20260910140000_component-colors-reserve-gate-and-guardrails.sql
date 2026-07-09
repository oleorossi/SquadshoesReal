-- =============================================================================
-- Auditoria "Componentes por Cor" (2026-07-09) — fix + guarda-corpos
-- Spec: specs/auditoria-componentes-por-cor.md
--
-- BUG #1 (crítico): try_reserve_materials lia technical_sheets.direct_components
--   cru, sem o gate por cor predominante (component_colors_enabled +
--   technical_sheet_component_colors). Um PV OFF WHITE da DS22 reservaria os
--   componentes do PADRÃO (ABS Turqueza/Marrom) em vez do da cor (Redondo Pérola).
--
-- BUG #2 (crítico, pré-existente): o loop de componentes lia as chaves JSONB
--   'consumption'/'id', mas TODAS as 32 linhas de direct_components no banco
--   usam 'quantity'/'product_id'. Resultado: consumo avaliado = 0 → CONTINUE →
--   NENHUM componente avulso era reservado, de NENHUMA ficha. Comprovado ao
--   vivo na auditoria: try_reserve de um PV DS22 reservou solados/colas/caixa/
--   linha e zero componentes.
--
-- Guarda-corpos:
--   • component_colors_consistency_report() — 7 checagens de cadastro do
--     mapeamento por cor (exposta em /diagnostics, molde de
--     consumption_consistency_report()).
--   • run_consumption_parity_tests() estendida de 9 → 13 cases, travando o
--     gate por cor no by_grade E na try_reserve (estrutural, versão VIVA).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) try_reserve_materials — gate por cor + shape correto de direct_components
--    (reescrita da versão viva; só o bloco de componentes avulsos muda)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.try_reserve_materials(p_order_id uuid, p_reference_id uuid, p_order_quantity numeric, p_color text DEFAULT ''::text, p_production_date date DEFAULT NULL::date, p_permit_partial boolean DEFAULT true, p_consider_safety_stock boolean DEFAULT true, p_priority text DEFAULT 'normal'::text, p_allow_expedite boolean DEFAULT false, p_consolidate_po boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing jsonb; v_batch_id uuid; v_reservations jsonb := '[]'::jsonb;
  v_pos jsonb := '[]'::jsonb; v_notes jsonb := '[]'::jsonb;
  mat RECORD; v_demand numeric; v_onhand numeric; v_reserved_qty numeric;
  v_available numeric; v_safety numeric; v_demand_with_safety numeric;
  v_inbound_available numeric; v_inbound_eta integer; v_prod_deadline integer;
  v_total_available numeric; v_qty_to_reserve numeric; v_net_missing numeric;
  v_moq numeric; v_po_qty numeric; v_po_id uuid; v_supplier_name text;
  v_target_id uuid; v_target_name text; v_target_qty numeric; v_target_unit text;
  v_target_price numeric; v_target_min numeric; v_target_max numeric;
  v_bom_group_names text[] := '{}'; v_pg_name text;
  v_upper_material text; v_upper_consumption numeric;
  v_lining_material text; v_lining_consumption numeric;
  v_insole_material text; v_insole_consumption numeric;
  v_components jsonb; v_item jsonb; v_consumption numeric; v_product_id uuid;
  v_spec_materials text[][]; v_spec text[]; v_spec_name text;
  v_spec_consumption numeric; v_spec_material text; v_result jsonb;
  v_conv4 record;
  v_sale_order_id uuid; v_packaging_mode text;
  v_bom_kept jsonb; v_bom_kept_ids uuid[] := ARRAY[]::uuid[];
  v_insole_ready_made boolean := false; v_sole_product_id uuid;
  v_is_palmilha_pronta boolean := false;
  v_color_components jsonb;
BEGIN
  IF NOT public.is_approved_user() THEN RAISE EXCEPTION 'Permission denied'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('try_reserve_materials:' || p_order_id::text));
  SELECT result INTO v_existing FROM reservation_batches WHERE order_id = p_order_id AND status = 'done';
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  DELETE FROM reservation_batches WHERE order_id = p_order_id AND status != 'done';
  INSERT INTO reservation_batches (order_id, status) VALUES (p_order_id, 'processing') RETURNING id INTO v_batch_id;
  v_prod_deadline := CASE WHEN p_production_date IS NOT NULL THEN GREATEST(0, p_production_date - current_date) ELSE 30 END;

  SELECT o.sale_order_id INTO v_sale_order_id FROM orders o WHERE o.id = p_order_id;
  IF v_sale_order_id IS NOT NULL THEN
    SELECT so.packaging_mode INTO v_packaging_mode FROM sale_orders so WHERE so.id = v_sale_order_id;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('product_id', sm.product_id)), '[]'::jsonb)
    INTO v_bom_kept
    FROM sheet_materials sm
    WHERE sm.sheet_id = p_reference_id AND sm.product_id IS NOT NULL;
  v_bom_kept := public.filter_caixa_by_packaging_mode(v_bom_kept, v_packaging_mode);
  SELECT COALESCE(array_agg((line ->> 'product_id')::uuid), ARRAY[]::uuid[])
    INTO v_bom_kept_ids
    FROM jsonb_array_elements(v_bom_kept) AS line
    WHERE (line ->> 'product_id') IS NOT NULL;

  SELECT ts.insole_ready_made INTO v_insole_ready_made
    FROM technical_sheets ts WHERE ts.id = p_reference_id;
  SELECT rsc.sole_product_id INTO v_sole_product_id
    FROM resolve_sole_color(p_reference_id, COALESCE(p_color, '')) rsc;
  v_is_palmilha_pronta := COALESCE(v_insole_ready_made, false)
    OR EXISTS (SELECT 1 FROM products WHERE id = v_sole_product_id AND sole_classification::text = 'palmilha_pronta');

  FOR mat IN
    SELECT sm.product_id, sm.quantity_per_unit, p.quantity AS current_stock,
           p.name, p.group_id, p.color AS product_color, p.category,
           p.min_stock, p.max_stock, p.unit, p.unit_price
    FROM sheet_materials sm JOIN products p ON p.id = sm.product_id
    WHERE sm.sheet_id = p_reference_id
  LOOP
    CONTINUE WHEN NOT (mat.product_id = ANY(v_bom_kept_ids));
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
    SELECT * INTO v_conv4 FROM public.get_material_conversion_info(v_target_id);
    IF v_conv4.conversion_warning IS NOT NULL THEN
      v_notes := v_notes || to_jsonb('IGNORADO (largura faltando, dm²→unidade impossível): ' || v_target_name);
      CONTINUE;
    END IF;
    IF COALESCE(v_conv4.dm2_per_unit, 1) > 0 AND COALESCE(v_conv4.dm2_per_unit, 1) <> 1 THEN
      v_demand := (v_demand / v_conv4.dm2_per_unit) * (1 + COALESCE(v_conv4.waste_pct, 0) / 100);
    END IF;
    SELECT p.quantity INTO v_onhand FROM products p WHERE p.id = v_target_id FOR UPDATE;
    SELECT COALESCE(SUM(mr.quantity_reserved - mr.quantity_consumed), 0) INTO v_reserved_qty
    FROM material_reservations mr WHERE mr.product_id = v_target_id AND mr.status IN ('reserved', 'partially_consumed');
    v_available := v_onhand - v_reserved_qty;
    v_safety := CASE WHEN p_consider_safety_stock THEN COALESCE(v_target_min, 0) ELSE 0 END;
    v_demand_with_safety := v_demand + v_safety;
    SELECT COALESCE(SUM(poi.quantity), 0), COALESCE(MIN(po.eta_days), 999) INTO v_inbound_available, v_inbound_eta
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
    IF p_priority = 'urgent' AND v_available < v_demand THEN
      v_qty_to_reserve := GREATEST(0, v_available);
      IF v_qty_to_reserve > 0 THEN
        INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, source, batch_id, notes)
        VALUES (p_order_id, v_target_id, v_qty_to_reserve, 0, 'reserved', 'soft', 'onhand', v_batch_id, 'R5-urgent');
        v_reservations := v_reservations || jsonb_build_object('product_id', v_target_id, 'product_name', v_target_name, 'qty_reserved', v_qty_to_reserve, 'source', 'onhand', 'rule', 'R5');
      END IF;
      v_net_missing := v_demand - v_qty_to_reserve;
      IF v_net_missing > 0 THEN
        IF EXISTS (SELECT 1 FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.purchase_order_id
                   WHERE poi.product_id = v_target_id AND po.status NOT IN ('received', 'receiving', 'cancelled')) THEN
          v_notes := v_notes || to_jsonb('OC já aberta p/ ' || v_target_name || ' — não duplicada (R5)');
        ELSE
          v_po_qty := GREATEST(v_net_missing, v_moq);
          INSERT INTO purchase_orders (supplier_name, auto_generated, notes, expedite, reference_order_id) VALUES (v_supplier_name, true, 'MRP R5 urgent | ' || v_target_name, true, p_order_id) RETURNING id INTO v_po_id;
          INSERT INTO purchase_order_items (purchase_order_id, product_id, current_stock, min_stock, max_stock, suggested_quantity, quantity, unit_price, unit) VALUES (v_po_id, v_target_id, v_onhand, COALESCE(v_target_min,0), COALESCE(v_target_max,0), v_po_qty, v_po_qty, v_target_price, v_target_unit);
          UPDATE purchase_orders SET total_value = v_po_qty * v_target_price WHERE id = v_po_id;
          v_pos := v_pos || jsonb_build_object('po_id', v_po_id, 'product_name', v_target_name, 'qty_ordered', v_po_qty, 'expedite', true, 'rule', 'R5');
        END IF;
      END IF;
      v_notes := v_notes || to_jsonb('R5: ' || v_target_name);
    ELSIF v_available >= v_demand_with_safety THEN
      INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, source, batch_id, notes)
      VALUES (p_order_id, v_target_id, v_demand, 0, 'reserved', 'soft', 'onhand', v_batch_id, 'R1-full');
      v_reservations := v_reservations || jsonb_build_object('product_id', v_target_id, 'product_name', v_target_name, 'qty_reserved', v_demand, 'source', 'onhand', 'rule', 'R1');
      v_notes := v_notes || to_jsonb('R1: ' || v_target_name);
    ELSIF v_total_available >= v_demand_with_safety AND p_permit_partial THEN
      v_qty_to_reserve := GREATEST(0, v_available);
      IF v_qty_to_reserve > 0 THEN
        INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, source, batch_id, notes)
        VALUES (p_order_id, v_target_id, v_qty_to_reserve, 0, 'reserved', 'soft', 'onhand', v_batch_id, 'R2-onhand');
        v_reservations := v_reservations || jsonb_build_object('product_id', v_target_id, 'product_name', v_target_name, 'qty_reserved', v_qty_to_reserve, 'source', 'onhand', 'rule', 'R2');
      END IF;
      v_net_missing := v_demand - v_qty_to_reserve;
      IF v_net_missing > 0 AND v_inbound_available > 0 THEN
        INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, source, batch_id, notes)
        VALUES (p_order_id, v_target_id, LEAST(v_net_missing, v_inbound_available), 0, 'reserved', 'soft', 'inbound', v_batch_id, 'R2-inbound');
        v_reservations := v_reservations || jsonb_build_object('product_id', v_target_id, 'product_name', v_target_name, 'qty_reserved', LEAST(v_net_missing, v_inbound_available), 'source', 'inbound', 'rule', 'R2');
      END IF;
      v_notes := v_notes || to_jsonb('R2: ' || v_target_name);
    ELSIF p_permit_partial THEN
      v_qty_to_reserve := GREATEST(0, v_available);
      IF v_qty_to_reserve > 0 THEN
        INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, source, batch_id, notes)
        VALUES (p_order_id, v_target_id, v_qty_to_reserve, 0, 'reserved', 'soft', 'onhand', v_batch_id, 'R3-partial');
        v_reservations := v_reservations || jsonb_build_object('product_id', v_target_id, 'product_name', v_target_name, 'qty_reserved', v_qty_to_reserve, 'source', 'onhand', 'rule', 'R3');
      END IF;
      v_net_missing := v_demand - v_qty_to_reserve;
      IF v_net_missing > 0 THEN
        IF EXISTS (SELECT 1 FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.purchase_order_id
                   WHERE poi.product_id = v_target_id AND po.status NOT IN ('received', 'receiving', 'cancelled')) THEN
          v_notes := v_notes || to_jsonb('OC já aberta p/ ' || v_target_name || ' — não duplicada (R3)');
        ELSE
          v_po_qty := GREATEST(v_net_missing, v_moq);
          INSERT INTO purchase_orders (supplier_name, auto_generated, notes, reference_order_id) VALUES (v_supplier_name, true, 'MRP R3 | ' || v_target_name, p_order_id) RETURNING id INTO v_po_id;
          INSERT INTO purchase_order_items (purchase_order_id, product_id, current_stock, min_stock, max_stock, suggested_quantity, quantity, unit_price, unit) VALUES (v_po_id, v_target_id, v_onhand, COALESCE(v_target_min,0), COALESCE(v_target_max,0), v_po_qty, v_po_qty, v_target_price, v_target_unit);
          UPDATE purchase_orders SET total_value = v_po_qty * v_target_price WHERE id = v_po_id;
          v_pos := v_pos || jsonb_build_object('po_id', v_po_id, 'product_name', v_target_name, 'qty_ordered', v_po_qty, 'rule', 'R3');
        END IF;
      END IF;
      v_notes := v_notes || to_jsonb('R3: ' || v_target_name);
    ELSE
      v_net_missing := v_demand;
      IF EXISTS (SELECT 1 FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.purchase_order_id
                 WHERE poi.product_id = v_target_id AND po.status NOT IN ('received', 'receiving', 'cancelled')) THEN
        v_notes := v_notes || to_jsonb('OC já aberta p/ ' || v_target_name || ' — não duplicada (R4)');
      ELSE
        v_po_qty := GREATEST(v_net_missing, v_moq);
        INSERT INTO purchase_orders (supplier_name, auto_generated, notes, reference_order_id) VALUES (v_supplier_name, true, 'MRP R4 | ' || v_target_name, p_order_id) RETURNING id INTO v_po_id;
        INSERT INTO purchase_order_items (purchase_order_id, product_id, current_stock, min_stock, max_stock, suggested_quantity, quantity, unit_price, unit) VALUES (v_po_id, v_target_id, v_onhand, COALESCE(v_target_min,0), COALESCE(v_target_max,0), v_po_qty, v_po_qty, v_target_price, v_target_unit);
        UPDATE purchase_orders SET total_value = v_po_qty * v_target_price WHERE id = v_po_id;
        v_pos := v_pos || jsonb_build_object('po_id', v_po_id, 'product_name', v_target_name, 'qty_ordered', v_po_qty, 'rule', 'R4');
      END IF;
      v_notes := v_notes || to_jsonb('R4: ' || v_target_name);
    END IF;
  END LOOP;
  SELECT ts.upper_material, ts.upper_consumption, ts.lining_material, ts.lining_consumption,
         ts.insole_material, ts.insole_consumption, ts.direct_components
  INTO v_upper_material, v_upper_consumption, v_lining_material, v_lining_consumption,
       v_insole_material, v_insole_consumption, v_components
  FROM technical_sheets ts WHERE ts.id = p_reference_id;
  v_spec_materials := ARRAY[
    ARRAY[COALESCE(v_upper_material,''), COALESCE(v_upper_consumption::text,'0'), 'Cabedal'],
    ARRAY[COALESCE(v_lining_material,''), COALESCE(v_lining_consumption::text,'0'), 'Forração'],
    ARRAY[COALESCE(v_insole_material,''), COALESCE(v_insole_consumption::text,'0'), 'Palmilha']];
  FOREACH v_spec SLICE 1 IN ARRAY v_spec_materials LOOP
    v_spec_material := v_spec[1]; v_spec_consumption := v_spec[2]::numeric; v_spec_name := v_spec[3];
    IF v_spec_material = '' OR v_spec_consumption <= 0 THEN CONTINUE; END IF;
    IF v_spec_material = ANY(v_bom_group_names) THEN CONTINUE; END IF;
    IF v_spec_name = 'Palmilha' AND v_is_palmilha_pronta THEN CONTINUE; END IF;
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
    IF v_target_id IS NULL THEN CONTINUE; END IF;
    SELECT p.quantity INTO v_onhand FROM products p WHERE p.id = v_target_id FOR UPDATE;
    SELECT COALESCE(SUM(mr.quantity_reserved - mr.quantity_consumed), 0) INTO v_reserved_qty
    FROM material_reservations mr WHERE mr.product_id = v_target_id AND mr.status IN ('reserved', 'partially_consumed');
    v_available := v_onhand - v_reserved_qty;
    v_safety := CASE WHEN p_consider_safety_stock THEN COALESCE(v_target_min, 0) ELSE 0 END;
    SELECT * INTO v_conv4 FROM public.get_material_conversion_info(v_target_id);
    IF v_conv4.conversion_warning IS NOT NULL THEN
      v_notes := v_notes || to_jsonb('IGNORADO (largura faltando, dm²→unidade impossível): ' || v_target_name);
      CONTINUE;
    END IF;
    IF v_conv4.dm2_per_unit IS NOT NULL AND v_conv4.dm2_per_unit > 0 THEN
      v_demand := (v_demand / v_conv4.dm2_per_unit) * (1 + COALESCE(v_conv4.waste_pct, 0) / 100);
    END IF;
    v_demand_with_safety := v_demand + v_safety;
    IF v_available >= v_demand_with_safety THEN
      INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, source, batch_id, notes)
      VALUES (p_order_id, v_target_id, v_demand, 0, 'reserved', 'soft', 'onhand', v_batch_id, 'R1 ' || v_spec_name);
      v_reservations := v_reservations || jsonb_build_object('product_id', v_target_id, 'product_name', v_target_name, 'qty_reserved', v_demand, 'source', 'onhand', 'rule', 'R1', 'category', v_spec_name);
    ELSIF p_permit_partial THEN
      v_qty_to_reserve := GREATEST(0, v_available);
      IF v_qty_to_reserve > 0 THEN
        INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, source, batch_id, notes)
        VALUES (p_order_id, v_target_id, v_qty_to_reserve, 0, 'reserved', 'soft', 'onhand', v_batch_id, 'R3 ' || v_spec_name);
        v_reservations := v_reservations || jsonb_build_object('product_id', v_target_id, 'product_name', v_target_name, 'qty_reserved', v_qty_to_reserve, 'source', 'onhand', 'rule', 'R3', 'category', v_spec_name);
      END IF;
    END IF;
  END LOOP;
  -- Componentes avulsos — gate por cor predominante (auditoria 2026-07-09).
  -- Espelha calculate_order_consumption_by_grade: com component_colors_enabled
  -- ligado e linha pra cor do pedido em technical_sheet_component_colors, a
  -- lista POR COR substitui direct_components por completo; senão, fallback
  -- pra direct_components. Match accent/case-insensitive (extensions.unaccent
  -- qualificado — search_path é public).
  -- Shape: direct_components usa 'quantity'/'product_id' ('consumption'/'id'
  -- fica só como fallback legado — o loop antigo lia SÓ o shape legado e por
  -- isso nunca reservava componente nenhum).
  IF COALESCE((SELECT ts.component_colors_enabled FROM technical_sheets ts WHERE ts.id = p_reference_id), false)
     AND COALESCE(btrim(p_color), '') <> '' THEN
    SELECT jsonb_agg(jsonb_build_object('product_id', tcc.product_id, 'quantity', tcc.quantity_per_unit))
      INTO v_color_components
      FROM technical_sheet_component_colors tcc
     WHERE tcc.sheet_id = p_reference_id
       AND lower(btrim(extensions.unaccent(tcc.cabedal_color))) = lower(btrim(extensions.unaccent(p_color)));
    IF v_color_components IS NOT NULL AND jsonb_array_length(v_color_components) > 0 THEN
      v_components := v_color_components;
    END IF;
  END IF;
  IF v_components IS NOT NULL AND jsonb_typeof(v_components) = 'array' AND jsonb_array_length(v_components) > 0 THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_components) AS value LOOP
      v_consumption := COALESCE(NULLIF(v_item ->> 'quantity', '')::numeric,
                                NULLIF(v_item ->> 'consumption', '')::numeric, 0);
      IF v_consumption <= 0 THEN CONTINUE; END IF;
      v_demand := v_consumption * p_order_quantity;
      v_product_id := NULL;
      BEGIN
        v_product_id := COALESCE(NULLIF(v_item ->> 'product_id', '')::uuid,
                                 NULLIF(v_item ->> 'id', '')::uuid);
      EXCEPTION WHEN OTHERS THEN v_product_id := NULL; END;
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
  v_result := jsonb_build_object(
    'order_id', p_order_id, 'batch_id', v_batch_id,
    'reservations', v_reservations, 'purchase_orders', v_pos, 'notes', v_notes,
    'status', CASE
      WHEN jsonb_array_length(v_pos) = 0 AND jsonb_array_length(v_reservations) > 0 THEN 'fully_reserved'
      WHEN jsonb_array_length(v_pos) > 0 AND jsonb_array_length(v_reservations) > 0 THEN 'partially_reserved'
      WHEN jsonb_array_length(v_pos) > 0 AND jsonb_array_length(v_reservations) = 0 THEN 'pending_purchase'
      ELSE 'no_materials' END);
  UPDATE reservation_batches SET status = 'done', result = v_result WHERE id = v_batch_id;
  INSERT INTO audit_logs (action, resource, resource_id, new_data, success)
  VALUES ('try_reserve_materials', 'order', p_order_id::text, v_result, true);
  RETURN v_result;
END;
$function$;

-- -----------------------------------------------------------------------------
-- 2) component_colors_consistency_report() — lacunas de cadastro do mapeamento
--    por cor (mesmo shape de consumption_consistency_report; exposta em
--    /diagnostics). Cor é comparada com a MESMA normalização do motor
--    (lower + btrim + extensions.unaccent) — espaço interno duplicado NÃO casa
--    de propósito (nem no SQL nem no TS normalizeColorKey).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.component_colors_consistency_report()
 RETURNS TABLE(check_name text, severity text, item_count integer, sample text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Mapeamento apontando pra produto que não existe mais (consumo/débito somem em silêncio)
  RETURN QUERY SELECT 'cpc_produto_inexistente'::text, 'alto'::text, count(*)::int,
    COALESCE(string_agg(ts.name || ' · ' || c.cabedal_color, ' · ' ORDER BY ts.name), '—')
    FROM technical_sheet_component_colors c
    JOIN technical_sheets ts ON ts.id = c.sheet_id
    LEFT JOIN products p ON p.id = c.product_id
   WHERE p.id IS NULL;

  -- Produto inativo: o consumo SQL inclui a linha, o TS (modal) dropa → superfícies divergem
  RETURN QUERY SELECT 'cpc_produto_inativo'::text, 'alto'::text, count(*)::int,
    COALESCE(string_agg(ts.name || ' · ' || c.cabedal_color || ' → ' || p.name, ' · ' ORDER BY ts.name), '—')
    FROM technical_sheet_component_colors c
    JOIN technical_sheets ts ON ts.id = c.sheet_id
    JOIN products p ON p.id = c.product_id
   WHERE p.active = false;

  -- Quantidade <= 0 ou nula: a cor "existe" (bloqueia o fallback) mas consome zero em silêncio
  RETURN QUERY SELECT 'cpc_quantidade_invalida'::text, 'alto'::text, count(*)::int,
    COALESCE(string_agg(ts.name || ' · ' || c.cabedal_color || ' (' || COALESCE(c.quantity_per_unit::text,'NULL') || ')', ' · ' ORDER BY ts.name), '—')
    FROM technical_sheet_component_colors c
    JOIN technical_sheets ts ON ts.id = c.sheet_id
   WHERE COALESCE(c.quantity_per_unit, 0) <= 0;

  -- Linha duplicada (mesma ficha + cor normalizada + produto): consumo dobrado
  RETURN QUERY SELECT 'cpc_linha_duplicada'::text, 'alto'::text, count(*)::int,
    COALESCE(string_agg(nome || ' · ' || cor, ' · ' ORDER BY nome), '—')
    FROM (
      SELECT ts.name AS nome, c.cabedal_color AS cor
        FROM technical_sheet_component_colors c
        JOIN technical_sheets ts ON ts.id = c.sheet_id
       GROUP BY ts.name, c.cabedal_color, lower(btrim(extensions.unaccent(c.cabedal_color))), c.product_id
      HAVING count(*) > 1
    ) d;

  -- Cor mapeada que não casa (na normalização do motor) com nenhuma cor do grupo predominante
  RETURN QUERY SELECT 'cpc_cor_orfa_grupo_predominante'::text, 'medio'::text, count(*)::int,
    COALESCE(string_agg(ts.name || ' · "' || c.cabedal_color || '"', ' · ' ORDER BY ts.name), '—')
    FROM technical_sheet_component_colors c
    JOIN technical_sheets ts ON ts.id = c.sheet_id
   WHERE ts.cor_predominante_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM products p
        WHERE p.group_id = ts.cor_predominante_id
          AND COALESCE(p.color, '') <> ''
          AND lower(btrim(extensions.unaccent(p.color))) = lower(btrim(extensions.unaccent(c.cabedal_color))));

  -- Flag ligada sem NENHUMA cor configurada (tudo cai no fallback — pendência de cadastro)
  RETURN QUERY SELECT 'cpc_flag_sem_mapeamento'::text, 'baixo'::text, count(*)::int,
    COALESCE(string_agg(ts.name, ' · ' ORDER BY ts.name), '—')
    FROM technical_sheets ts
   WHERE ts.component_colors_enabled = true
     AND NOT EXISTS (SELECT 1 FROM technical_sheet_component_colors c WHERE c.sheet_id = ts.id);

  -- Flag ligada sem grupo de cor predominante (painel e harmonizações caem em empty state)
  RETURN QUERY SELECT 'cpc_flag_sem_grupo_predominante'::text, 'medio'::text, count(*)::int,
    COALESCE(string_agg(ts.name, ' · ' ORDER BY ts.name), '—')
    FROM technical_sheets ts
   WHERE ts.component_colors_enabled = true
     AND ts.cor_predominante_id IS NULL;
END;
$function$;

-- -----------------------------------------------------------------------------
-- 3) run_consumption_parity_tests() — 9 → 13 cases: trava o gate por cor no
--    by_grade e na try_reserve (estrutural, sobre a versão VIVA no banco).
--    Wrapper vitest: src/services/__tests__/consumptionService.parity.test.ts.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_consumption_parity_tests()
 RETURNS TABLE(case_name text, ok boolean, message text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scalar   text;
  v_bygrade  text;
  v_reserve  text;
BEGIN
  SELECT string_agg(pg_get_functiondef(oid), E'\n') INTO v_scalar
    FROM pg_proc WHERE proname = 'calculate_order_consumption' AND pronamespace = 'public'::regnamespace;
  SELECT string_agg(pg_get_functiondef(oid), E'\n') INTO v_bygrade
    FROM pg_proc WHERE proname = 'calculate_order_consumption_by_grade' AND pronamespace = 'public'::regnamespace;
  SELECT string_agg(pg_get_functiondef(oid), E'\n') INTO v_reserve
    FROM pg_proc WHERE proname = 'try_reserve_materials' AND pronamespace = 'public'::regnamespace;

  case_name := 'escalar_existe';  ok := v_scalar IS NOT NULL;  message := COALESCE(left(v_scalar,0),'ausente'); RETURN NEXT;
  case_name := 'bygrade_existe';  ok := v_bygrade IS NOT NULL; message := COALESCE(left(v_bygrade,0),'ausente'); RETURN NEXT;

  case_name := 'escalar_delega_ao_bygrade';
  ok := v_scalar ILIKE '%calculate_order_consumption_by_grade%';
  message := 'escalar deve delegar ao motor único calculate_order_consumption_by_grade'; RETURN NEXT;

  case_name := 'escalar_sem_insole_mode_legado';
  ok := v_scalar NOT ILIKE '%insole_mode%';
  message := 'escalar não deve usar o campo legado insole_mode'; RETURN NEXT;

  case_name := 'escalar_nao_duplica_conversao';
  ok := v_scalar NOT ILIKE '%get_material_conversion_info%';
  message := 'escalar não deve duplicar a conversão (deve herdar do by_grade)'; RETURN NEXT;

  case_name := 'bygrade_palmilha_pronta_unificada';
  ok := v_bygrade ILIKE '%insole_ready_made%' AND v_bygrade ILIKE '%palmilha_pronta%';
  message := 'by_grade deve checar insole_ready_made + sole_classification'; RETURN NEXT;

  case_name := 'bygrade_sem_insole_mode_legado';
  ok := v_bygrade NOT ILIKE '%insole_mode%';
  message := 'by_grade não deve usar o campo legado insole_mode'; RETURN NEXT;

  case_name := 'bygrade_aplica_conversao';
  ok := v_bygrade ILIKE '%get_material_conversion_info%';
  message := 'by_grade deve converter dm²→unidade via get_material_conversion_info'; RETURN NEXT;

  case_name := 'bygrade_inclui_fachete';
  ok := v_bygrade ILIKE '%fachete%';
  message := 'by_grade deve incluir o componente Fachete'; RETURN NEXT;

  -- Componentes por cor predominante (auditoria 2026-07-09)
  case_name := 'bygrade_gate_componentes_por_cor';
  ok := v_bygrade ILIKE '%component_colors_enabled%' AND v_bygrade ILIKE '%technical_sheet_component_colors%';
  message := 'by_grade deve aplicar a lista por cor predominante (source component_color)'; RETURN NEXT;

  case_name := 'bygrade_cor_predominante_normalizada';
  ok := v_bygrade ILIKE '%extensions.unaccent(tcc.cabedal_color)%';
  message := 'match de cor do gate deve ser accent/case-insensitive (extensions.unaccent)'; RETURN NEXT;

  case_name := 'reserva_gate_componentes_por_cor';
  ok := v_reserve ILIKE '%component_colors_enabled%' AND v_reserve ILIKE '%technical_sheet_component_colors%';
  message := 'try_reserve_materials deve aplicar o gate por cor nos componentes avulsos'; RETURN NEXT;

  case_name := 'reserva_shape_direct_components';
  ok := v_reserve ILIKE '%>> ''quantity''%' AND v_reserve ILIKE '%>> ''product_id''%';
  message := 'try_reserve_materials deve ler direct_components pelo shape quantity/product_id (não consumption/id)'; RETURN NEXT;
END;
$function$;
