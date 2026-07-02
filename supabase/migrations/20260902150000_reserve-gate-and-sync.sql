-- =============================================================================
-- 20260902150000_reserve-gate-and-sync.sql
-- Auditoria dos motores de consumo/compras/débito (2026-07-01) — RESERVAS.
--
-- ACHADO (a) — ALTA · try_reserve_materials reservava Palmilha SEM o gate de
--   palmilha pronta. Fichas vivas (ex.: ST15/ST17) têm
--   sole_classification='palmilha_pronta' no solado E insole_material
--   preenchido na ficha ⇒ a reserva fantasma nascia aqui e
--   convert_reservation_to_out a transformava em débito físico de material
--   que a fábrica não consome. FIX: aplicar a condição canônica de
--   calculate_order_consumption_by_grade (def vivo):
--     insole_ready_made=true OU solado primário (resolve_sole_color) com
--     sole_classification='palmilha_pronta'
--   ⇒ NÃO reservar o braço 'Palmilha'. Obs.: try_reserve_materials não tem
--   braço separado de forração de palmilha (insole_lining) — o único braço
--   afetado é o spec 'Palmilha'; a 'Forração' do spec loop é o forro do
--   CABEDAL (lining_material) e continua reservando normalmente.
--   Ainda em (a): a função TEM loop de BOM (sheet_materials) ⇒ aplica
--   filter_caixa_by_packaging_mode nas caixas, no mesmo padrão do custeio
--   (calculate_order_cost_item): deriva packaging_mode de
--   orders.sale_order_id → sale_orders.packaging_mode e pula as linhas de
--   caixa do tipo coletivo errado. No-op quando o modo é NULL ou o BOM só
--   tem um tipo de caixa (mesma semântica do helper).
--
-- ACHADO (b) — BAIXA · sync_product_reserved_stock somava só status='reserved',
--   mas commit_picking_session grava 'partially_consumed' como status ATIVO
--   (e 5+ funções tratam esse status como vivo, ex.: o próprio
--   try_reserve_materials ao calcular disponível). Qualquer sync posterior
--   zerava o saldo remanescente dessas reservas em products.reserved_stock.
--   FIX: incluir 'partially_consumed' no SUM(quantity_reserved -
--   quantity_consumed). REPAIR: re-roda o sync pra todos os produtos com
--   reservas 'partially_consumed' vivas (hoje 0 no banco — bloco defensivo
--   e idempotente pra quando o picking parcial voltar a gravar).
--
-- ACHADO (c) — BAIXA · reserve_material_for_order: função MORTA e QUEBRADA
--   exposta via RPC (INSERT na coluna inexistente
--   material_reservations.quantity, lê products.current_stock que não
--   existe, e UPDATE manual de reserved_stock que duplicaria com o trigger
--   tg_sync_reserved_stock). Grep no repo: nenhum caller em src/ (só o
--   types.ts gerado). FIX: DROP FUNCTION (todas as assinaturas).
--
-- ACHADO (d) — BAIXA · get_material_conversion_info:
--   1. 'v_waste := COALESCE(v_waste, 8)' dava 8% de perda pra material sem
--      NENHUMA ficha de componente, enquanto o motor TS canônico
--      (src/lib/materialConsumption.ts, referência do modal) usa 0.
--      FIX: default 0.
--   2. O fallback por grupo fazia LIMIT 1 sem ORDER BY (não-determinístico:
--      a largura usada podia mudar entre execuções). FIX: ORDER BY estável
--      (largura preenchida primeiro, depois updated_at DESC, id como
--      desempate). NADA MAIS muda nela (conversion_warning etc. intactos).
--
-- Base das edições: pg_get_functiondef do banco vivo ssvxfoybzmjlypnipqzn
-- (2026-07-02) — NÃO os arquivos de migration antigos do repo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- (a) try_reserve_materials — gate de palmilha pronta + filtro de caixa por
--     packaging_mode no loop de BOM. Restante do corpo idêntico ao def vivo.
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
  -- (a) gate de palmilha pronta + filtro de caixa por packaging_mode
  v_sale_order_id uuid; v_packaging_mode text;
  v_bom_kept jsonb; v_bom_kept_ids uuid[] := ARRAY[]::uuid[];
  v_insole_ready_made boolean := false; v_sole_product_id uuid;
  v_is_palmilha_pronta boolean := false;
BEGIN
  IF NOT public.is_approved_user() THEN RAISE EXCEPTION 'Permission denied'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('try_reserve_materials:' || p_order_id::text));
  SELECT result INTO v_existing FROM reservation_batches WHERE order_id = p_order_id AND status = 'done';
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  DELETE FROM reservation_batches WHERE order_id = p_order_id AND status != 'done';
  INSERT INTO reservation_batches (order_id, status) VALUES (p_order_id, 'processing') RETURNING id INTO v_batch_id;
  v_prod_deadline := CASE WHEN p_production_date IS NOT NULL THEN GREATEST(0, p_production_date - current_date) ELSE 30 END;

  -- (a2) Caixa por packaging_mode — mesmo padrão do custeio
  -- (calculate_order_cost_item): deriva o modo do pedido e pré-computa quais
  -- product_ids do BOM sobrevivem ao filter_caixa_by_packaging_mode. O helper
  -- é no-op quando modo é NULL ou só há um tipo de caixa ⇒ v_bom_kept_ids
  -- vira "todos" nesses casos.
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

  -- (a1) Gate canônico de palmilha pronta — condição unificada copiada do def
  -- vivo de calculate_order_consumption_by_grade: insole_ready_made OU solado
  -- primário com sole_classification='palmilha_pronta' (SEM o legado
  -- insole_mode). Quando true, o braço 'Palmilha' do spec loop não reserva.
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
    -- (a2) caixa do modo de embalagem errado não reserva (paridade com o custeio)
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
    -- conv-bom-c4 (auditoria 2026-06-09): material de área em dm²/par →
    -- unidade física do produto pela largura da ficha de componente.
    SELECT * INTO v_conv4 FROM public.get_material_conversion_info(v_target_id);
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
        v_po_qty := GREATEST(v_net_missing, v_moq);
        INSERT INTO purchase_orders (supplier_name, auto_generated, notes, expedite, reference_order_id) VALUES (v_supplier_name, true, 'MRP R5 urgent | ' || v_target_name, true, p_order_id) RETURNING id INTO v_po_id;
        INSERT INTO purchase_order_items (purchase_order_id, product_id, current_stock, min_stock, max_stock, suggested_quantity, quantity, unit_price, unit) VALUES (v_po_id, v_target_id, v_onhand, COALESCE(v_target_min,0), COALESCE(v_target_max,0), v_po_qty, v_po_qty, v_target_price, v_target_unit);
        UPDATE purchase_orders SET total_value = v_po_qty * v_target_price WHERE id = v_po_id;
        v_pos := v_pos || jsonb_build_object('po_id', v_po_id, 'product_name', v_target_name, 'qty_ordered', v_po_qty, 'expedite', true, 'rule', 'R5');
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
        v_po_qty := GREATEST(v_net_missing, v_moq);
        INSERT INTO purchase_orders (supplier_name, auto_generated, notes, reference_order_id) VALUES (v_supplier_name, true, 'MRP R3 | ' || v_target_name, p_order_id) RETURNING id INTO v_po_id;
        INSERT INTO purchase_order_items (purchase_order_id, product_id, current_stock, min_stock, max_stock, suggested_quantity, quantity, unit_price, unit) VALUES (v_po_id, v_target_id, v_onhand, COALESCE(v_target_min,0), COALESCE(v_target_max,0), v_po_qty, v_po_qty, v_target_price, v_target_unit);
        UPDATE purchase_orders SET total_value = v_po_qty * v_target_price WHERE id = v_po_id;
        v_pos := v_pos || jsonb_build_object('po_id', v_po_id, 'product_name', v_target_name, 'qty_ordered', v_po_qty, 'rule', 'R3');
      END IF;
      v_notes := v_notes || to_jsonb('R3: ' || v_target_name);
    ELSE
      v_net_missing := v_demand;
      v_po_qty := GREATEST(v_net_missing, v_moq);
      INSERT INTO purchase_orders (supplier_name, auto_generated, notes, reference_order_id) VALUES (v_supplier_name, true, 'MRP R4 | ' || v_target_name, p_order_id) RETURNING id INTO v_po_id;
      INSERT INTO purchase_order_items (purchase_order_id, product_id, current_stock, min_stock, max_stock, suggested_quantity, quantity, unit_price, unit) VALUES (v_po_id, v_target_id, v_onhand, COALESCE(v_target_min,0), COALESCE(v_target_max,0), v_po_qty, v_po_qty, v_target_price, v_target_unit);
      UPDATE purchase_orders SET total_value = v_po_qty * v_target_price WHERE id = v_po_id;
      v_pos := v_pos || jsonb_build_object('po_id', v_po_id, 'product_name', v_target_name, 'qty_ordered', v_po_qty, 'rule', 'R4');
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
    -- (a1) palmilha pronta na cor: não reservar Palmilha (paridade com
    -- calculate_order_consumption_by_grade — senão a reserva fantasma vira
    -- débito físico em convert_reservation_to_out).
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
    -- A3: cabedal/forro/palmilha têm consumo em dm²/par → converte p/ a unidade física
    -- do produto pela largura da ficha (igual ao by_grade), senão reserva ~100x inflado.
    SELECT * INTO v_conv4 FROM public.get_material_conversion_info(v_target_id);
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
  IF v_components IS NOT NULL AND jsonb_typeof(v_components) = 'array' AND jsonb_array_length(v_components) > 0 THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_components) AS value LOOP
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

GRANT EXECUTE ON FUNCTION public.try_reserve_materials(uuid, uuid, numeric, text, date, boolean, boolean, text, boolean, boolean) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- (b) sync_product_reserved_stock — 'partially_consumed' é status ATIVO
--     (commit_picking_session grava esse status); o saldo remanescente
--     (quantity_reserved - quantity_consumed) precisa continuar contando em
--     products.reserved_stock. Restante do corpo idêntico ao def vivo.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_product_reserved_stock(p_product_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_total numeric;
BEGIN
  IF p_product_id IS NULL THEN RETURN; END IF;
  SELECT COALESCE(SUM(quantity_reserved - quantity_consumed), 0)
    INTO v_total
    FROM public.material_reservations
   WHERE product_id = p_product_id
     -- (b) 'partially_consumed' é ativo: picking parcial consome parte e o
     -- saldo restante segue reservado — sem ele aqui, o próximo sync zerava
     -- esse saldo em products.reserved_stock.
     AND status IN ('reserved', 'partially_consumed');

  UPDATE public.products
     SET reserved_stock = GREATEST(0, v_total),
         updated_at = now()
   WHERE id = p_product_id
     AND reserved_stock IS DISTINCT FROM GREATEST(0, v_total);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.sync_product_reserved_stock(uuid) TO authenticated, service_role;

-- REPAIR (b): re-roda o sync pra todo produto com reserva 'partially_consumed'
-- viva (drift possível do bug: saldo restante sumia do reserved_stock).
-- Hoje o banco tem 0 reservas nesse status — bloco defensivo e idempotente.
DO $$
DECLARE
  v_pid uuid;
  v_count integer := 0;
BEGIN
  FOR v_pid IN
    SELECT DISTINCT product_id
      FROM public.material_reservations
     WHERE status = 'partially_consumed'
       AND product_id IS NOT NULL
  LOOP
    PERFORM public.sync_product_reserved_stock(v_pid);
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'REPAIR reserved_stock/partially_consumed: % produto(s) ressincronizado(s).', v_count;
END;
$$;

-- -----------------------------------------------------------------------------
-- (c) reserve_material_for_order — função morta e quebrada (coluna
--     material_reservations.quantity não existe, products.current_stock não
--     existe, UPDATE manual de reserved_stock duplicaria com o trigger
--     tg_sync_reserved_stock). Nenhum caller em src/ (só types.ts gerado).
--     DROP dinâmico cobre qualquer assinatura/overload remanescente.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_sig text;
BEGIN
  FOR v_sig IN
    SELECT format('public.reserve_material_for_order(%s)', pg_get_function_identity_arguments(p.oid))
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'reserve_material_for_order'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || v_sig;
    RAISE NOTICE 'DROP %', v_sig;
  END LOOP;
END;
$$;

-- -----------------------------------------------------------------------------
-- (d) get_material_conversion_info — duas mudanças cirúrgicas:
--     1. default de perda 0% (era 8%) quando não há ficha de componente —
--        paridade com o motor TS canônico (materialConsumption.ts);
--     2. ORDER BY estável no fallback por grupo (era LIMIT 1 sem ORDER BY):
--        largura preenchida primeiro, depois updated_at DESC, id desempata.
--     conversion_warning e todo o resto ficam EXATAMENTE como no def vivo.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_material_conversion_info(p_product_id uuid)
 RETURNS TABLE(dm2_per_unit numeric, waste_pct numeric, target_unit text, conversion_warning text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_width numeric; v_length numeric; v_dim numeric; v_dim_unit text;
  v_prod_unit text; v_waste numeric; v_group_id uuid; v_is_linear boolean;
  v_has_cs boolean;
BEGIN
  SELECT unit, group_id INTO v_prod_unit, v_group_id FROM public.products WHERE id = p_product_id;
  SELECT dimensions_width, dimensions_length, dimensions_unit, cs.waste_pct
    INTO v_width, v_length, v_dim_unit, v_waste
    FROM public.component_sheets cs WHERE cs.product_id = p_product_id;
  v_dim := GREATEST(COALESCE(v_width, 0), COALESCE(v_length, 0));
  IF v_dim <= 0 THEN
    SELECT GREATEST(COALESCE(cs.dimensions_width,0), COALESCE(cs.dimensions_length,0)),
           cs.dimensions_unit, COALESCE(v_waste, cs.waste_pct)
      INTO v_dim, v_dim_unit, v_waste
      FROM public.component_sheets cs
      WHERE cs.group_id = v_group_id
        AND GREATEST(COALESCE(cs.dimensions_width,0), COALESCE(cs.dimensions_length,0)) > 0
      -- (d2) fallback determinístico: largura preenchida primeiro, ficha mais
      -- recente depois, id como desempate (antes: LIMIT 1 sem ORDER BY).
      ORDER BY (COALESCE(cs.dimensions_width, 0) > 0) DESC,
               cs.updated_at DESC NULLS LAST,
               cs.id
      LIMIT 1;
  END IF;
  -- (d1) sem NENHUMA ficha de componente não há base pra assumir perda: o
  -- motor TS canônico (materialConsumption.ts) usa 0 — era 8 e inflava a
  -- demanda de itens lineares diretos (tiras/elásticos) em 8%.
  v_waste := COALESCE(v_waste, 0);
  v_prod_unit := LOWER(v_prod_unit);
  v_is_linear := v_prod_unit IN ('m','meters','metros','mt','cm','m linear');
  IF v_is_linear THEN
    IF v_dim IS NOT NULL AND v_dim > 0 THEN
      IF LOWER(v_dim_unit) = 'cm' THEN v_dim := v_dim * 10;
      ELSIF LOWER(v_dim_unit) = 'm' THEN v_dim := v_dim * 1000; END IF;
      dm2_per_unit := v_dim / 10;
      IF v_prod_unit = 'cm' THEN dm2_per_unit := dm2_per_unit / 100; END IF;
      conversion_warning := NULL;
    ELSE
      dm2_per_unit := 1;
      SELECT EXISTS (SELECT 1 FROM public.component_sheets cs
                     WHERE cs.product_id = p_product_id OR cs.group_id = v_group_id)
        INTO v_has_cs;
      IF v_has_cs THEN
        conversion_warning := 'Material em "' || v_prod_unit || '" sem dimensions_width em component_sheets. '
          'Resultado pode estar 100x errado. Configurar largura em Materiais > Ficha de Componente.';
      ELSE
        conversion_warning := NULL;  -- item linear direto (tira/elástico), não converte
      END IF;
    END IF;
  ELSE
    dm2_per_unit := 1;
    conversion_warning := NULL;
  END IF;
  waste_pct := v_waste;
  target_unit := v_prod_unit;
  RETURN NEXT;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_material_conversion_info(uuid) TO authenticated, service_role;
