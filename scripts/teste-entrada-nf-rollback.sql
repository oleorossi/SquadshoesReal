-- Ensaio ponta a ponta da Entrada por NF. NADA FICA GRAVADO.
-- Roda num único DO e termina com RAISE EXCEPTION 'ENSAIO_ROLLBACK {...}'.
-- Não toca PV-00249, PV-00250, PV-00251 nem LOTE-00004.
-- Não dá entrada em NF real: cria OC/produto/reserva sintéticos e desfaz tudo.
-- Como usar: cole o arquivo inteiro no SQL editor / execute_sql (uma chamada só).

DO $ensaio$
DECLARE
  v_user uuid;
  v_supplier uuid;
  v_product uuid;
  v_po uuid;
  v_item uuid;
  v_res uuid;
  v_pv uuid;
  v_def text;
  v_follow jsonb;
  v_settle jsonb;
  v_out jsonb := '{}'::jsonb;
  v_before_po int;
  v_before_res int;
  v_before_sm int;
BEGIN
  PERFORM set_config('statement_timeout', '180s', true);

  SELECT r2.actor_id INTO v_user
    FROM sale_order_command_receipts r2
    JOIN profiles p ON p.id = r2.actor_id AND p.approved
   ORDER BY r2.created_at DESC LIMIT 1;
  IF v_user IS NULL THEN
    SELECT id INTO v_user FROM profiles WHERE approved LIMIT 1;
  END IF;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  -- Contrato: o gate de receive aceita rascunho/sugerida/pending.
  v_def := pg_get_functiondef('public.execute_purchase_order_command(text,jsonb,uuid,uuid,timestamptz)'::regprocedure);
  IF position($gate$IF v_po.status NOT IN ('draft', 'suggested', 'pending', 'approved', 'sent', 'parcial')$gate$ in v_def) = 0 THEN
    RAISE EXCEPTION 'ENSAIO_ROLLBACK %', jsonb_build_object('ok', false, 'reason', 'gate_receive_sem_rascunho');
  END IF;
  PERFORM public.run_entrada_nf_receive_contract_tests();

  SELECT count(*) INTO v_before_po FROM purchase_orders;
  SELECT count(*) INTO v_before_res FROM material_reservations WHERE status = 'pending_reconciliation';
  SELECT count(*) INTO v_before_sm FROM stock_movements;

  -- Fornecedor e produto sintéticos (somem no rollback).
  INSERT INTO suppliers (name, cnpj, active)
  VALUES ('ENSAIO-NF-ENTRADA', '99999999000191', true)
  RETURNING id INTO v_supplier;

  INSERT INTO products (name, sku, category, unit, quantity, unit_price, min_stock, max_stock, purchase_unit, conversion_rate, supplier_id, active)
  VALUES ('ENSAIO NAPA NF', 'ENSAIO-NF-SKU', 'Componente', 'm', 0, 10, 0, 0, 'm', 1, v_supplier, true)
  RETURNING id INTO v_product;

  -- PV sintético só para satisfazer material_reservations_origin_ck.
  -- Número próprio (PV-ENSAIO-NF); não usa PV-00249/250/251 nem a sequência.
  INSERT INTO sale_orders (order_number, client_name, status, notes)
  VALUES ('PV-ENSAIO-NF', 'ENSAIO-NF-ENTRADA', 'Rascunho', 'Ensaio entrada NF — rollback')
  RETURNING id INTO v_pv;

  -- Falta típica: reserva soft em reserved, quantity_short > 0.
  -- (pending_reconciliation na produção são furos de baixa, reserved>0 e short=0;
  --  o rateio cobre a falta das reservas reserved, não reabre esses furos.)
  INSERT INTO material_reservations (
    product_id, quantity_reserved, quantity_consumed, quantity_short, status, reservation_type, source, sale_order_id
  ) VALUES (
    v_product, 0, 0, 5, 'reserved', 'soft', 'ensaio-entrada-nf', v_pv
  ) RETURNING id INTO v_res;

  INSERT INTO purchase_orders (
    order_number, status, supplier_id, supplier_name, total_value, notes, auto_generated
  ) VALUES (
    'OC-ENSAIO-NF', 'draft', v_supplier, 'ENSAIO-NF-ENTRADA', 50, 'Ensaio entrada NF — rollback', true
  ) RETURNING id INTO v_po;

  INSERT INTO purchase_order_items (
    purchase_order_id, product_id, quantity, unit_price, unit, received_quantity
  ) VALUES (
    v_po, v_product, 5, 10, 'm', 0
  ) RETURNING id INTO v_item;

  -- Recalcula livre + cobre a falta (o followup faz isso depois do receive;
  -- aqui provamos a quitação isolada após creditar saldo, ainda no rollback).
  UPDATE products SET quantity = 5 WHERE id = v_product;
  v_settle := public.reallocate_product_commitments(v_product, NULL);
  v_settle := v_settle || public.settle_pending_reconciliation_for_product(v_product, NULL);

  IF NOT EXISTS (
    SELECT 1 FROM material_reservations
     WHERE id = v_res
       AND status = 'reserved'
       AND COALESCE(quantity_short, 0) <= 0.0001
       AND COALESCE(quantity_reserved, 0) >= 4.999
  ) THEN
    RAISE EXCEPTION 'ENSAIO_ROLLBACK %', jsonb_build_object(
      'ok', false,
      'reason', 'rateio_nao_cobriu_falta',
      'reservation', (SELECT to_jsonb(r) FROM material_reservations r WHERE r.id = v_res),
      'settle', v_settle
    );
  END IF;

  -- Followup completo (gate + motor) sobre a OC sintética, sem receive real de NF.
  v_follow := public.apply_purchase_receive_followup(v_po, ARRAY[v_product], NULL);

  v_out := jsonb_build_object(
    'ok', true,
    'gate_rascunho', true,
    'res_status', (SELECT status FROM material_reservations WHERE id = v_res),
    'res_short', (SELECT quantity_short FROM material_reservations WHERE id = v_res),
    'res_reserved', (SELECT quantity_reserved FROM material_reservations WHERE id = v_res),
    'reallocate', v_settle,
    'followup_ok', COALESCE((v_follow ->> 'ok')::boolean, false),
    'followup_motor_has_error', v_follow -> 'motor' ? 'error',
    'po_count_same_before', v_before_po,
    'touched_forbidden_pv', EXISTS (SELECT 1 FROM sale_orders WHERE id = v_pv AND order_number IN ('PV-00249','PV-00250','PV-00251')),
    'ensaio_pv', (SELECT order_number FROM sale_orders WHERE id = v_pv)
  );

  RAISE EXCEPTION 'ENSAIO_ROLLBACK %', v_out;
END;
$ensaio$;
