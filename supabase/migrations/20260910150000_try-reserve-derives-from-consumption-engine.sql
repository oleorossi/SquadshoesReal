-- =============================================================================
-- try_reserve_materials deriva a demanda do motor unificado (2026-07-09)
-- Spec: specs/auditoria-componentes-por-cor.md (achados pós-fix 20260910140000)
--
-- CAUSA RAIZ: a função duplicava a explosão de materiais em 3 loops próprios
-- (BOM de sheet_materials, specs escalares da ficha e componentes avulsos),
-- divergindo do motor único calculate_order_consumption_by_grade:
--   (1) o loop de BOM não pulava a categoria solado → reservava TODOS os
--       produtos-solado do BOM ×pares (DS22: 5 solados ×12 pares), e essas
--       reservas não são limpas por debit_sole_stock_by_grade (que só mexe em
--       kind sole_grade/sole_pending_grade) → reserved_stock inflado pra sempre.
--   (2) o loop de specs lia só upper/lining/insole_consumption escalares e
--       ignorava os *_consumption_per_size (fonte primária do motor) → DS22
--       reservava ZERO de NAPA SUDANI (~1,03 m por 12 pares).
--   (3) no fluxo PV-update o hybrid_debit_stock_for_order(force_soft) faz
--       idempotent_skip por causa das reservas desta função → o conjunto
--       reservado da OP era o conjunto ERRADO e nunca convergia pro motor.
--
-- FIX: mesma assinatura (zero mudança de frontend; refresh_order_reservations
-- herda de graça). A demanda vem de calculate_order_consumption_by_grade
-- (grade da OP via scale_grade_to_total; variante via
-- sale_order_items.material_variant_id; sem grade → wrapper escalar)
-- + filter_caixa_by_packaging_mode — mesmo padrão de fn_projected_demand e
-- compute_materials_per_pv. As regras R1–R5 ficam POR CIMA das linhas:
--   • regras completas (reserva + OC de shortfall + dedup de OC aberta) SÓ pra
--     source IN ('sheet_materials','sole_standard_per_size') — preserva a
--     semântica de compra atual (specs/componentes nunca geraram OC aqui);
--   • reserva simples R1/R3 (sem OC) pras demais linhas (specs per-size,
--     forração de palmilha, fachete, componentes por cor/avulsos, acessórios);
--   • Solado (source primary_sole/variant_sole): reserva soft
--     kind='sole_pending_grade' e NUNCA OC escalar (a OC de solado canônica é
--     por numeração — autoCreateSolePOFromShortfall). debit_sole_stock_by_grade
--     deleta esse kind no force_soft e consome no hard — sem duplicação;
--   • linhas matched_by='color_mismatch' → PULADAS com nota (paridade com o
--     débito: nunca reservar a cor errada — o loop antigo caía em silêncio no
--     produto da cor base);
--   • linhas com conversion_warning → PULADAS com nota (largura faltando =
--     valor ~100× em dm²; preserva o guard da 20260909120200);
--   • reservas parciais capadas em LEAST(demanda, disponível) — o código
--     antigo reservava o disponível INTEIRO quando o safety stock empurrava
--     pra R2/R3, sobre-reservando além da demanda da OP (R1 sempre reservou
--     exatamente a demanda; o cap alinha os parciais à mesma semântica).
-- A interação hybrid_debit idempotent_skip fica INALTERADA (comportamento
-- documentado): com a demanda unificada, o skip é inofensivo por construção.
--
-- Guarda-corpos: run_consumption_parity_tests 13 → 15 cases. Os 2 cases
-- estruturais da reserva (gate por cor / shape do JSONB) assertavam strings
-- que deixam de existir com a delegação — reformulados + 2 novos. O wrapper
-- vitest (consumptionService.parity.test.ts) asserta rows.length >= 13 (ok).
--
-- Aplicar via Supabase MCP (GitHub Action de migrate segue quebrada).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) try_reserve_materials — demanda derivada do motor unificado
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
  v_demand numeric; v_onhand numeric; v_reserved_qty numeric;
  v_available numeric; v_safety numeric; v_demand_with_safety numeric;
  v_inbound_available numeric; v_inbound_eta integer; v_prod_deadline integer;
  v_total_available numeric; v_qty_to_reserve numeric; v_net_missing numeric;
  v_moq numeric; v_po_qty numeric; v_po_id uuid; v_supplier_name text;
  v_target_id uuid; v_target_name text; v_target_unit text;
  v_target_price numeric; v_target_min numeric; v_target_max numeric;
  v_target_group uuid;
  v_sale_order_id uuid; v_packaging_mode text;
  v_order_grade jsonb; v_soi_id uuid; v_variant_id uuid;
  v_demand_lines jsonb := '[]'::jsonb; v_line jsonb;
  v_source text; v_component text;
  v_result jsonb;
BEGIN
  IF NOT public.is_approved_user() THEN RAISE EXCEPTION 'Permission denied'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('try_reserve_materials:' || p_order_id::text));
  SELECT result INTO v_existing FROM reservation_batches WHERE order_id = p_order_id AND status = 'done';
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  DELETE FROM reservation_batches WHERE order_id = p_order_id AND status != 'done';
  INSERT INTO reservation_batches (order_id, status) VALUES (p_order_id, 'processing') RETURNING id INTO v_batch_id;
  v_prod_deadline := CASE WHEN p_production_date IS NOT NULL THEN GREATEST(0, p_production_date - current_date) ELSE 30 END;

  -- Contexto da OP: PV (embalagem), grade e variante de material do item.
  SELECT o.sale_order_id, o.grade, o.sale_order_item_id
    INTO v_sale_order_id, v_order_grade, v_soi_id
    FROM orders o WHERE o.id = p_order_id;
  IF v_sale_order_id IS NOT NULL THEN
    SELECT so.packaging_mode INTO v_packaging_mode FROM sale_orders so WHERE so.id = v_sale_order_id;
    IF v_soi_id IS NULL THEN
      SELECT soi.id INTO v_soi_id
        FROM sale_order_items soi
       WHERE soi.sale_order_id = v_sale_order_id
         AND soi.reference_id = p_reference_id
         AND COALESCE(soi.color, '') = COALESCE(p_color, '')
       LIMIT 1;
    END IF;
  END IF;
  IF v_soi_id IS NOT NULL THEN
    SELECT soi.material_variant_id INTO v_variant_id FROM sale_order_items soi WHERE soi.id = v_soi_id;
  END IF;

  -- Demanda = motor unificado (única fonte da explosão de materiais).
  IF NOT EXISTS (SELECT 1 FROM technical_sheets ts WHERE ts.id = p_reference_id) THEN
    v_notes := v_notes || to_jsonb('Ficha técnica não encontrada: ' || p_reference_id::text);
  ELSIF COALESCE(p_order_quantity, 0) <= 0 THEN
    v_notes := v_notes || to_jsonb('Quantidade da OP inválida (<= 0) — nada a reservar');
  ELSIF v_order_grade IS NOT NULL AND jsonb_typeof(v_order_grade) = 'object'
        AND EXISTS (
          SELECT 1 FROM jsonb_each_text(v_order_grade) g
           WHERE g.key ~ '^[0-9]+(/[0-9]+)?$'
             AND g.value ~ '^[0-9]+(\.[0-9]+)?$'
             AND (g.value)::numeric > 0
        ) THEN
    v_demand_lines := public.calculate_order_consumption_by_grade(
      p_reference_id,
      public.scale_grade_to_total(v_order_grade, p_order_quantity),
      COALESCE(p_color, ''),
      v_variant_id);
  ELSE
    v_demand_lines := public.calculate_order_consumption(
      p_reference_id, p_order_quantity, COALESCE(p_color, ''), NULL, v_variant_id);
  END IF;
  v_demand_lines := COALESCE(public.filter_caixa_by_packaging_mode(v_demand_lines, v_packaging_mode), '[]'::jsonb);

  -- Ordena por product_id (mesma disciplina de lock do hybrid_debit — evita
  -- deadlock entre reservas/débitos concorrentes da mesma família de produtos).
  FOR v_line IN
    SELECT t.value FROM jsonb_array_elements(v_demand_lines) AS t(value)
     ORDER BY t.value ->> 'product_id'
  LOOP
    v_target_id := NULL;
    BEGIN
      v_target_id := NULLIF(v_line ->> 'product_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN v_target_id := NULL; END;
    CONTINUE WHEN v_target_id IS NULL;

    v_source      := COALESCE(v_line ->> 'source', '');
    v_component   := COALESCE(NULLIF(v_line ->> 'component', ''), 'Material');
    v_target_name := COALESCE(v_line ->> 'product_name', v_target_id::text);

    IF (v_line ->> 'matched_by') = 'color_mismatch' THEN
      v_notes := v_notes || to_jsonb('IGNORADO (cor não cadastrada no grupo — não reservar cor errada): ' || v_target_name);
      CONTINUE;
    END IF;
    IF NULLIF(v_line ->> 'conversion_warning', '') IS NOT NULL THEN
      v_notes := v_notes || to_jsonb('IGNORADO (largura faltando, dm²→unidade impossível): ' || v_target_name);
      CONTINUE;
    END IF;

    v_demand := NULL;
    BEGIN
      v_demand := NULLIF(v_line ->> 'required', '')::numeric;
    EXCEPTION WHEN OTHERS THEN v_demand := NULL; END;
    CONTINUE WHEN v_demand IS NULL OR v_demand <= 0;

    -- Solado: reserva pendente por numeração (kind interoperável com
    -- debit_sole_stock_by_grade, que a deleta no force_soft e consome no hard).
    -- Sem OC escalar: compra de solado é por numeração, fora deste fluxo.
    IF v_source IN ('primary_sole', 'variant_sole') THEN
      IF NOT EXISTS (
        SELECT 1 FROM material_reservations mr
         WHERE mr.order_id = p_order_id AND mr.product_id = v_target_id
           AND mr.status IN ('reserved', 'partially_consumed')
           AND COALESCE(mr.metadata ->> 'kind', '') IN ('sole_pending_grade', 'sole_grade')
      ) THEN
        INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, source, batch_id, notes, metadata)
        VALUES (p_order_id, v_target_id, v_demand, 0, 'reserved', 'soft', 'onhand', v_batch_id, 'R1 Solado (pendente por numeração)',
                jsonb_build_object('kind', 'sole_pending_grade', 'component', v_component, 'color', p_color));
        v_reservations := v_reservations || jsonb_build_object('product_id', v_target_id, 'product_name', v_target_name, 'qty_reserved', v_demand, 'source', 'onhand', 'rule', 'R1', 'category', 'Solado');
      END IF;
      CONTINUE;
    END IF;

    SELECT p.name, p.quantity, p.unit, p.unit_price, p.min_stock, p.max_stock, p.group_id
      INTO v_target_name, v_onhand, v_target_unit, v_target_price, v_target_min, v_target_max, v_target_group
      FROM products p WHERE p.id = v_target_id
      FOR UPDATE;
    CONTINUE WHEN NOT FOUND;

    SELECT COALESCE(SUM(mr.quantity_reserved - mr.quantity_consumed), 0) INTO v_reserved_qty
      FROM material_reservations mr
     WHERE mr.product_id = v_target_id AND mr.status IN ('reserved', 'partially_consumed');
    v_available := v_onhand - v_reserved_qty;
    v_safety := CASE WHEN p_consider_safety_stock THEN COALESCE(v_target_min, 0) ELSE 0 END;
    v_demand_with_safety := v_demand + v_safety;

    IF v_source IN ('sheet_materials', 'sole_standard_per_size') THEN
      -- ===== Regras completas R1–R5: reserva + OC de shortfall (com dedup) =====
      SELECT COALESCE(SUM(poi.quantity), 0), COALESCE(MIN(po.eta_days), 999)
        INTO v_inbound_available, v_inbound_eta
        FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.purchase_order_id
       WHERE poi.product_id = v_target_id AND po.status IN ('pending', 'approved');
      IF v_inbound_eta > v_prod_deadline THEN v_inbound_available := 0; END IF;
      v_total_available := v_available + v_inbound_available;

      v_moq := NULL;
      SELECT COALESCE(gsm.minimum_order, 1) INTO v_moq
        FROM group_supplier_materials gsm JOIN group_suppliers gs ON gs.id = gsm.supplier_id
       WHERE gsm.group_id = v_target_group AND gsm.active = true
       ORDER BY gsm.updated_at DESC LIMIT 1;
      IF v_moq IS NULL OR v_moq < 1 THEN v_moq := 1; END IF;

      v_supplier_name := NULL;
      SELECT gs.supplier_name INTO v_supplier_name
        FROM group_suppliers gs WHERE gs.group_id = v_target_group
       ORDER BY gs.updated_at DESC LIMIT 1;
      IF v_supplier_name IS NULL THEN v_supplier_name := 'A definir'; END IF;

      IF p_priority = 'urgent' AND v_available < v_demand THEN
        v_qty_to_reserve := LEAST(v_demand, GREATEST(0, v_available));
        IF v_qty_to_reserve > 0 THEN
          INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, source, batch_id, notes)
          VALUES (p_order_id, v_target_id, v_qty_to_reserve, 0, 'reserved', 'soft', 'onhand', v_batch_id, 'R5-urgent');
          v_reservations := v_reservations || jsonb_build_object('product_id', v_target_id, 'product_name', v_target_name, 'qty_reserved', v_qty_to_reserve, 'source', 'onhand', 'rule', 'R5', 'category', v_component);
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
        v_reservations := v_reservations || jsonb_build_object('product_id', v_target_id, 'product_name', v_target_name, 'qty_reserved', v_demand, 'source', 'onhand', 'rule', 'R1', 'category', v_component);
        v_notes := v_notes || to_jsonb('R1: ' || v_target_name);
      ELSIF v_total_available >= v_demand_with_safety AND p_permit_partial THEN
        v_qty_to_reserve := LEAST(v_demand, GREATEST(0, v_available));
        IF v_qty_to_reserve > 0 THEN
          INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, source, batch_id, notes)
          VALUES (p_order_id, v_target_id, v_qty_to_reserve, 0, 'reserved', 'soft', 'onhand', v_batch_id, 'R2-onhand');
          v_reservations := v_reservations || jsonb_build_object('product_id', v_target_id, 'product_name', v_target_name, 'qty_reserved', v_qty_to_reserve, 'source', 'onhand', 'rule', 'R2', 'category', v_component);
        END IF;
        v_net_missing := v_demand - v_qty_to_reserve;
        IF v_net_missing > 0 AND v_inbound_available > 0 THEN
          INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, source, batch_id, notes)
          VALUES (p_order_id, v_target_id, LEAST(v_net_missing, v_inbound_available), 0, 'reserved', 'soft', 'inbound', v_batch_id, 'R2-inbound');
          v_reservations := v_reservations || jsonb_build_object('product_id', v_target_id, 'product_name', v_target_name, 'qty_reserved', LEAST(v_net_missing, v_inbound_available), 'source', 'inbound', 'rule', 'R2', 'category', v_component);
        END IF;
        v_notes := v_notes || to_jsonb('R2: ' || v_target_name);
      ELSIF p_permit_partial THEN
        v_qty_to_reserve := LEAST(v_demand, GREATEST(0, v_available));
        IF v_qty_to_reserve > 0 THEN
          INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, source, batch_id, notes)
          VALUES (p_order_id, v_target_id, v_qty_to_reserve, 0, 'reserved', 'soft', 'onhand', v_batch_id, 'R3-partial');
          v_reservations := v_reservations || jsonb_build_object('product_id', v_target_id, 'product_name', v_target_name, 'qty_reserved', v_qty_to_reserve, 'source', 'onhand', 'rule', 'R3', 'category', v_component);
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
    ELSE
      -- ===== Reserva simples R1/R3 (sem OC): specs per-size, forração de
      -- palmilha, fachete, componentes por cor/avulsos, acessórios =====
      IF v_available >= v_demand_with_safety THEN
        INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, source, batch_id, notes)
        VALUES (p_order_id, v_target_id, v_demand, 0, 'reserved', 'soft', 'onhand', v_batch_id, 'R1 ' || v_component);
        v_reservations := v_reservations || jsonb_build_object('product_id', v_target_id, 'product_name', v_target_name, 'qty_reserved', v_demand, 'source', 'onhand', 'rule', 'R1', 'category', v_component);
      ELSIF p_permit_partial THEN
        v_qty_to_reserve := LEAST(v_demand, GREATEST(0, v_available));
        IF v_qty_to_reserve > 0 THEN
          INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, source, batch_id, notes)
          VALUES (p_order_id, v_target_id, v_qty_to_reserve, 0, 'reserved', 'soft', 'onhand', v_batch_id, 'R3 ' || v_component);
          v_reservations := v_reservations || jsonb_build_object('product_id', v_target_id, 'product_name', v_target_name, 'qty_reserved', v_qty_to_reserve, 'source', 'onhand', 'rule', 'R3', 'category', v_component);
        END IF;
      END IF;
    END IF;
  END LOOP;

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
-- 2) run_consumption_parity_tests() — 13 → 15 cases. Os cases 12–13 antigos
--    assertavam o gate por cor e o shape do JSONB DENTRO da try_reserve; com a
--    delegação ao motor essas strings somem do fonte. Reformulados pra travar
--    a delegação, + 2 novos (sem specs escalares próprias / pula color_mismatch).
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

  -- Reserva deriva do motor unificado (refactor 2026-07-09)
  case_name := 'reserva_gate_componentes_por_cor';
  ok := v_reserve ILIKE '%calculate_order_consumption_by_grade%'
     OR (v_reserve ILIKE '%component_colors_enabled%' AND v_reserve ILIKE '%technical_sheet_component_colors%');
  message := 'reserva deve respeitar o gate por cor — por delegação ao motor unificado (ou gate próprio)'; RETURN NEXT;

  case_name := 'reserva_demanda_do_motor_unificado';
  ok := v_reserve ILIKE '%calculate_order_consumption_by_grade%'
    AND v_reserve NOT ILIKE '%direct_components%'
    AND v_reserve NOT ILIKE '%sheet_materials sm%';
  message := 'try_reserve deve derivar a demanda de calculate_order_consumption_by_grade, sem explosão própria de BOM/componentes'; RETURN NEXT;

  case_name := 'reserva_sem_specs_escalares';
  ok := v_reserve NOT ILIKE '%upper_consumption%' AND v_reserve NOT ILIKE '%lining_consumption%';
  message := 'try_reserve não deve reler consumos escalares da ficha (per-size mora no motor)'; RETURN NEXT;

  case_name := 'reserva_pula_color_mismatch';
  ok := v_reserve ILIKE '%color_mismatch%';
  message := 'try_reserve deve pular linha com cor não cadastrada (paridade com o débito)'; RETURN NEXT;
END;
$function$;
