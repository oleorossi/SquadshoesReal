-- Executar como postgres, com migrations até165 aplicadas. A ficha I701 não é
-- aprovada nem editada. PVs/OPs, entrada de teste, reservas e baixas são todos
-- transacionais e desaparecem no ROLLBACK. Números explícitos evitam sequências.
-- Demais materiais da ficha continuam reais: suas pendências são reportadas.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
CREATE TEMP TABLE i701_stock_test_results (scenario text, details jsonb) ON COMMIT DROP;

DO $test$
DECLARE
  v_ref constant uuid := '049cef09-f46f-4017-b9c7-e927b52b8632';
  v_variant constant uuid := '864fd0f1-8445-439c-97de-1213fdd59975';
  v_admin uuid;
  v_color text;
  v_pv uuid;
  v_item uuid;
  v_op uuid;
  v_upper uuid;
  v_lining uuid;
  v_initial_upper numeric;
  v_initial_lining numeric;
  v_upper_stock numeric;
  v_lining_stock numeric;
  v_upper_entry numeric;
  v_required_upper numeric := (2.74 + 2.28) * 100 / 137;
  v_required_lining numeric;
  v_required numeric;
  v_lines jsonb;
  v_hybrid jsonb;
  v_repeat jsonb;
  v_reservation_count bigint;
  v_movement_count bigint;
  v_request uuid;
  v_command_payload jsonb;
  v_command_snapshot jsonb;
  v_command_result jsonb;
  v_product record;
  v_case record;
  v_fixture_ref uuid := gen_random_uuid();
  v_fixture_variant uuid := gen_random_uuid();
  v_fixture_extra jsonb;
  v_base_product uuid;
BEGIN
  SELECT ur.user_id INTO v_admin FROM public.user_roles ur
  JOIN public.profiles p ON p.id = ur.user_id AND p.approved
  WHERE ur.role::text IN ('admin', 'gerente') ORDER BY ur.user_id LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'Teste exige admin/gerente aprovado.'; END IF;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub',v_admin)::text, true);
  -- Somente para criar/encerrar as fixtures, mantendo ativos todos os triggers
  -- reais de reserva, snapshot, ledger e finalização.
  PERFORM set_config('app.sale_order_command_internal', '1', true);
  PERFORM set_config('app.production_order_command_internal', '1', true);

  -- Regressões de identidade em uma ficha isolada, sem editar a I701 real.
  SELECT p.id INTO v_base_product FROM public.products p JOIN public.product_groups g ON g.id=p.group_id
  WHERE g.name='NAPA SOFT + MASSABOX' AND p.color='CHAMPAGNE' AND p.active;
  INSERT INTO public.technical_sheets(id,name,upper_material_group_id,upper_consumption,variant_drives_upper)
  SELECT v_fixture_ref,'TESTE-I701-IDENTIDADE-'||v_fixture_ref,upper_material_group_id,2.74,false
  FROM public.technical_sheets WHERE id=v_ref;
  INSERT INTO public.reference_material_variants(id,reference_id,material_name,sku,active,display_order,main_material_group_id,upper_material_group_id)
  SELECT v_fixture_variant,v_fixture_ref,'TESTE GLOW','TESTE-'||v_fixture_variant,true,0,main_material_group_id,upper_material_group_id
  FROM public.reference_material_variants WHERE id=v_variant;
  FOREACH v_fixture_extra IN ARRAY ARRAY[
    jsonb_build_object('material','NAPA SOFT + MASSABOX','mandatory',true,'consumption',2.28,'product_id',v_base_product),
    jsonb_build_object('material','NAPA SOFT + MASSABOX','mandatory',true,'consumption',2.28,'leftover',true),
    jsonb_build_object('material','GLOW METALIC','mandatory',true,'consumption',2.28)
  ] LOOP
    UPDATE public.technical_sheets SET components_accessories=jsonb_build_array(v_fixture_extra) WHERE id=v_fixture_ref;
    v_lines:=public.calculate_order_consumption_by_grade(v_fixture_ref,'{"34":100}','CHAMPAGNE',v_fixture_variant);
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_lines) l JOIN public.products p ON p.id=(l->>'product_id')::uuid
       JOIN public.product_groups g ON g.id=p.group_id WHERE g.name='GLOW METALIC + MASSABOX' AND abs((l->>'required')::numeric-2)<0.000001)
       OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_lines) l JOIN public.products p ON p.id=(l->>'product_id')::uuid
       JOIN public.product_groups g ON g.id=p.group_id WHERE g.name=v_fixture_extra->>'material' AND abs((l->>'required')::numeric-228.0/137)<0.000001) THEN
      RAISE EXCEPTION 'Pin, sobra explícita ou material diferente foi substituído indevidamente: % / %',v_fixture_extra,v_lines;
    END IF;
  END LOOP;

  -- Quatro cores, mesma área, identidade acabada distinta da forração pura.
  FOREACH v_color IN ARRAY ARRAY['CHAMPAGNE','PRATA','COBRE','OURO LIGHT'] LOOP
    v_lines := public.calculate_order_consumption_by_grade(v_ref, '{"34":100}', v_color, v_variant);
    SELECT p.id INTO v_upper FROM public.products p JOIN public.product_groups g ON g.id=p.group_id
    WHERE g.name='GLOW METALIC + MASSABOX' AND p.color=v_color AND p.active;
    SELECT p.id INTO v_lining FROM public.products p JOIN public.product_groups g ON g.id=p.group_id
    WHERE g.name='GLOW METALIC' AND p.color=v_color AND p.active;
    IF v_upper IS NULL OR v_lining IS NULL OR v_upper=v_lining
       OR (SELECT count(*) FROM jsonb_array_elements(v_lines) l WHERE l->>'product_id'=v_upper::text)<>1
       OR abs((SELECT (l->>'required')::numeric FROM jsonb_array_elements(v_lines) l
               WHERE l->>'product_id'=v_upper::text)-v_required_upper)>0.000001
       OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_lines) l
          WHERE l->>'product_id'=v_lining::text AND l->>'component'='Forração Palmilha')
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_lines) l
          JOIN public.products p ON p.id=(l->>'product_id')::uuid
          JOIN public.product_groups g ON g.id=p.group_id WHERE g.name='NAPA SOFT + MASSABOX') THEN
      RAISE EXCEPTION 'Identidade/consumo incorreto para I701 Glow cor %: %',v_color,v_lines;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.products p JOIN public.component_sheets cs ON cs.product_id=p.id
        WHERE p.id=v_upper AND p.unit='m' AND p.purchase_unit='m' AND p.conversion_rate=1
          AND p.unit_price=45.54 AND cs.dimensions_width=1370 AND cs.dimensions_unit='mm') THEN
      RAISE EXCEPTION 'Unidade, preço ou largura incorretos no Cabedal %.',v_color;
    END IF;
  END LOOP;

  -- Cor ausente deve carregar color_mismatch, nunca virar material AMARELO.
  v_lines := public.calculate_order_consumption_by_grade(v_ref, '{"34":100}', 'COR INEXISTENTE TESTE', v_variant);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_lines) l
      WHERE l->>'component'='Cabedal' AND l->>'matched_by'='color_mismatch')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_lines) l JOIN public.products p ON p.id=(l->>'product_id')::uuid
      JOIN public.product_groups g ON g.id=p.group_id WHERE g.name='NAPA SOFT + MASSABOX') THEN
    RAISE EXCEPTION 'Cor ausente retornou Cabedal de outro grupo: %',v_lines;
  END IF;

  FOR v_case IN SELECT * FROM (VALUES ('com_saldo','CHAMPAGNE',true),('sem_saldo','COBRE',false),('saldo_parcial','PRATA',true)) t(scenario,color,funded) LOOP
    v_color:=v_case.color;
    SELECT p.id,p.quantity INTO v_upper,v_initial_upper FROM public.products p JOIN public.product_groups g ON g.id=p.group_id
    WHERE g.name='GLOW METALIC + MASSABOX' AND p.color=v_color AND p.active;
    SELECT p.id,p.quantity INTO v_lining,v_initial_lining FROM public.products p JOIN public.product_groups g ON g.id=p.group_id
    WHERE g.name='GLOW METALIC' AND p.color=v_color AND p.active;
    IF NOT v_case.funded AND (v_initial_upper<>0 OR v_initial_lining<>0) THEN
      RAISE EXCEPTION 'Cenário sem saldo exige COBRE zerado; catálogo mudou, revise fixture.';
    END IF;
    v_upper_stock:=v_initial_upper;
    v_lining_stock:=v_initial_lining;
    IF v_case.funded THEN
      IF v_case.scenario='saldo_parcial' AND v_initial_upper<>0 THEN
        RAISE EXCEPTION 'Cenário parcial exige composto PRATA zerado; revise fixture.';
      END IF;
      v_upper_entry:=CASE WHEN v_case.scenario='saldo_parcial' THEN 1 ELSE 10 END;
      v_upper_stock:=v_initial_upper+v_upper_entry;
      v_lining_stock:=v_initial_lining+100;
      v_request:=gen_random_uuid();
      v_command_payload:=jsonb_build_object('items',jsonb_build_array(
        jsonb_build_object('product_id',v_upper,'expected_previous_qty',v_initial_upper,'new_qty',v_upper_stock,'reason','TESTE I701 GLOW entrada ROLLBACK'),
        jsonb_build_object('product_id',v_lining,'expected_previous_qty',v_initial_lining,'new_qty',v_lining_stock,'reason','TESTE I701 GLOW entrada ROLLBACK')));
      v_command_snapshot:=jsonb_build_object('products',jsonb_build_array(
        jsonb_build_object('product_id',v_upper,'quantity',v_initial_upper),
        jsonb_build_object('product_id',v_lining,'quantity',v_initial_lining)));
      v_command_result:=public.execute_stock_command('adjust_products',v_command_payload,v_request,v_command_snapshot);
      IF NOT coalesce((v_command_result->>'success')::boolean,false) THEN
        RAISE EXCEPTION 'Entrada pelo command canônico falhou: %',v_command_result;
      END IF;
      v_repeat:=public.execute_stock_command('adjust_products',v_command_payload,v_request,v_command_snapshot);
      IF NOT coalesce((v_repeat->>'replayed')::boolean,false)
         OR (SELECT count(*) FROM public.stock_movements sm WHERE sm.stock_command_receipt_id=(v_command_result->>'receipt_id')::uuid)<>2 THEN
        RAISE EXCEPTION 'Replay do command duplicou entrada de estoque.';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.stock_movements sm WHERE sm.product_id=v_upper
          AND sm.description='TESTE I701 GLOW entrada ROLLBACK' AND sm.movement_type='in'
          AND sm.quantity=v_upper_entry AND sm.unit_price_at_movement=45.54)
         OR EXISTS (SELECT 1 FROM public.products p WHERE p.id IN(v_upper,v_lining) AND p.quantity IS DISTINCT FROM p.current_stock) THEN
        RAISE EXCEPTION 'Entrada não refletiu saldo/ledger/custo corretos.';
      END IF;
    END IF;

    v_pv:=gen_random_uuid(); v_item:=gen_random_uuid(); v_op:=gen_random_uuid();
    INSERT INTO public.sale_orders(id,order_number,client_name,status) VALUES(v_pv,'TESTE-I701-'||v_pv,'TESTE ROLLBACK','Rascunho');
    INSERT INTO public.sale_order_items(id,sale_order_id,reference_id,material_variant_id,color,quantity,unit_price,grade)
    VALUES(v_item,v_pv,v_ref,v_variant,v_color,100,100,'{"34":100}');
    INSERT INTO public.orders(id,sale_order_id,sale_order_item_id,reference_id,order_number,color,quantity,grade,status)
    VALUES(v_op,v_pv,v_item,v_ref,'TESTE-I701-'||v_op,v_color,100,'{"34":100}','Pendente');
    v_hybrid:=public.hybrid_debit_stock_for_order(v_ref,100,v_color,v_op,'{"34":100}',true);
    SELECT consumption_snapshot INTO v_lines FROM public.technical_sheet_snapshots WHERE sale_order_id=v_pv AND sale_order_item_id=v_item;
    SELECT (l->>'required')::numeric INTO v_required_lining FROM jsonb_array_elements(v_lines) l WHERE l->>'product_id'=v_lining::text;
    IF (SELECT count(*) FROM public.material_reservations r WHERE r.order_id=v_op AND r.product_id=v_upper)<>1
       OR (SELECT count(*) FROM public.material_reservations r WHERE r.order_id=v_op AND r.product_id=v_lining)<>1
       OR EXISTS (SELECT 1 FROM public.material_reservations r WHERE r.order_id=v_op AND r.product_id IN(v_upper,v_lining)
          AND (r.status<>'reserved' OR r.quantity_consumed<>0))
       OR EXISTS (SELECT 1 FROM public.stock_movements sm WHERE sm.order_id=v_op AND sm.product_id IN(v_upper,v_lining)) THEN
      RAISE EXCEPTION 'Reserva soft duplicou/consumiu os materiais prematuramente: %',v_hybrid;
    END IF;
    SELECT count(*) INTO v_reservation_count FROM public.material_reservations WHERE order_id=v_op;
    v_repeat:=public.hybrid_debit_stock_for_order(v_ref,100,v_color,v_op,'{"34":100}',true);
    IF NOT coalesce((v_repeat->>'idempotent_skip')::boolean,false)
       OR (SELECT count(*) FROM public.material_reservations WHERE order_id=v_op)<>v_reservation_count THEN
      RAISE EXCEPTION 'Repetição duplicou reservas.';
    END IF;

    UPDATE public.orders SET status='Finalizado' WHERE id=v_op;
    IF v_case.scenario='saldo_parcial' THEN
      IF (SELECT count(*) FROM public.material_reservations WHERE order_id=v_op AND product_id=v_upper)<>2
         OR NOT EXISTS(SELECT 1 FROM public.material_reservations WHERE order_id=v_op AND product_id=v_upper AND status='consumed' AND quantity_consumed=1)
         OR NOT EXISTS(SELECT 1 FROM public.material_reservations WHERE order_id=v_op AND product_id=v_upper AND status='pending_reconciliation' AND abs(quantity_reserved-(v_required_upper-1))<0.000001)
         OR NOT EXISTS(SELECT 1 FROM public.material_reservations WHERE order_id=v_op AND product_id=v_lining AND status='consumed') THEN
        RAISE EXCEPTION 'Saldo parcial não separou baixa real de pendência.';
      END IF;
    ELSIF EXISTS (SELECT 1 FROM public.material_reservations r WHERE r.order_id=v_op AND r.product_id IN(v_upper,v_lining)
        AND r.status IS DISTINCT FROM CASE WHEN v_case.funded THEN 'consumed' ELSE 'pending_reconciliation' END) THEN
      RAISE EXCEPTION 'Finalização perdeu reserva/pendência nos materiais Glow.';
    END IF;
    FOR v_product IN SELECT * FROM public.products WHERE id IN(v_upper,v_lining) LOOP
      v_required:=CASE WHEN v_product.id=v_upper THEN v_required_upper ELSE v_required_lining END;
      IF v_case.funded THEN
        IF v_case.scenario='saldo_parcial' AND v_product.id=v_upper THEN v_required:=1; END IF;
        IF abs(v_product.quantity-(CASE WHEN v_product.id=v_upper THEN v_upper_stock ELSE v_lining_stock END-v_required))>0.000001
           OR abs((SELECT sum(sm.quantity) FROM public.stock_movements sm WHERE sm.order_id=v_op AND sm.product_id=v_product.id AND sm.movement_type='out')-v_required)>0.000001 THEN
          RAISE EXCEPTION 'Baixa física/ledger incorretos no produto %.',v_product.id;
        END IF;
      ELSIF v_product.quantity<>0 OR EXISTS(SELECT 1 FROM public.stock_movements sm WHERE sm.order_id=v_op AND sm.product_id=v_product.id) THEN
        RAISE EXCEPTION 'Finalização sem saldo fabricou débito.';
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM public.stock_movements sm WHERE sm.order_id=v_op AND sm.product_id=v_upper
        AND sm.movement_type='out' AND sm.unit_price_at_movement IS DISTINCT FROM 45.54) THEN
      RAISE EXCEPTION 'Baixa de Cabedal registrou custo diferente do SKU acabado.';
    END IF;
    SELECT count(*) INTO v_movement_count FROM public.stock_movements WHERE order_id=v_op;
    PERFORM public.settle_open_reservations_for_order(v_op,'teste_repeticao');
    IF (SELECT count(*) FROM public.stock_movements WHERE order_id=v_op)<>v_movement_count THEN
      RAISE EXCEPTION 'Repetição do settlement duplicou débito.';
    END IF;
    INSERT INTO i701_stock_test_results VALUES(v_case.scenario,jsonb_build_object(
      'upper_required_m',v_required_upper,'lining_required_m',v_required_lining,
      'upper_cost_brl',round(v_required_upper*45.54,6),
      'reservations',(SELECT jsonb_agg(jsonb_build_object('product',p.name,'status',r.status,'reserved',r.quantity_reserved,'consumed',r.quantity_consumed))
        FROM public.material_reservations r JOIN public.products p ON p.id=r.product_id WHERE r.order_id=v_op AND r.product_id IN(v_upper,v_lining)),
      'balances',(SELECT jsonb_agg(jsonb_build_object('product',name,'quantity',quantity,'current_stock',current_stock,'reserved_stock',reserved_stock)) FROM public.products WHERE id IN(v_upper,v_lining)),
      'production_consumptions',(SELECT jsonb_agg(jsonb_build_object('product_id',product_id,'standard_quantity',standard_quantity,'actual_quantity',actual_quantity,'standard_cost',standard_cost,'actual_cost',actual_cost)) FROM public.production_consumptions WHERE order_id=v_op AND product_id IN(v_upper,v_lining)),
      'other_pending',(SELECT count(*) FROM public.material_reservations WHERE order_id=v_op AND product_id NOT IN(v_upper,v_lining) AND status='pending_reconciliation')));
  END LOOP;

  -- CHAMPAGNE ainda tem saldo suficiente nesta transação. Uma cor inexistente
  -- não pode usar esse saldo nem o antigo AMARELO, inclusive após finalizar.
  v_color:='COR INEXISTENTE TESTE';
  v_pv:=gen_random_uuid(); v_item:=gen_random_uuid(); v_op:=gen_random_uuid();
  INSERT INTO public.sale_orders(id,order_number,client_name,status) VALUES(v_pv,'TESTE-I701-'||v_pv,'TESTE ROLLBACK','Rascunho');
  INSERT INTO public.sale_order_items(id,sale_order_id,reference_id,material_variant_id,color,quantity,unit_price,grade)
  VALUES(v_item,v_pv,v_ref,v_variant,v_color,100,100,'{"34":100}');
  INSERT INTO public.orders(id,sale_order_id,sale_order_item_id,reference_id,order_number,color,quantity,grade,status)
  VALUES(v_op,v_pv,v_item,v_ref,'TESTE-I701-'||v_op,v_color,100,'{"34":100}','Pendente');
  v_hybrid:=public.hybrid_debit_stock_for_order(v_ref,100,v_color,v_op,'{"34":100}',true);
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_hybrid->'items') l WHERE l->>'type'='skipped_color_not_registered' AND l->>'component'='Cabedal')
     OR EXISTS(SELECT 1 FROM public.material_reservations r JOIN public.products p ON p.id=r.product_id
       JOIN public.product_groups g ON g.id=p.group_id WHERE r.order_id=v_op AND g.name IN('GLOW METALIC + MASSABOX','NAPA SOFT + MASSABOX')) THEN
    RAISE EXCEPTION 'Cor inexistente reservou material de outra cor: %',v_hybrid;
  END IF;
  UPDATE public.orders SET status='Finalizado' WHERE id=v_op;
  IF EXISTS(SELECT 1 FROM public.stock_movements sm JOIN public.products p ON p.id=sm.product_id
     JOIN public.product_groups g ON g.id=p.group_id WHERE sm.order_id=v_op AND g.name IN('GLOW METALIC + MASSABOX','NAPA SOFT + MASSABOX')) THEN
    RAISE EXCEPTION 'Finalização debitou Cabedal de outra cor.';
  END IF;
  INSERT INTO i701_stock_test_results VALUES('cor_inexistente',jsonb_build_object('result','PASS: sem reserva/débito de Cabedal apesar do saldo de outra cor','hybrid',v_hybrid));
END
$test$;
SELECT scenario,details FROM i701_stock_test_results ORDER BY scenario;
ROLLBACK;
