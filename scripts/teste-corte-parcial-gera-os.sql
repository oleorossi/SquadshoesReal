-- Corte parcial gera uma OS por prestador e por lançamento.
-- Roda inteiro dentro de uma transação que termina em rollback.
-- Não grava dado de teste. Não mexe em PV-00249, PV-00250 nem LOTE-00004.
-- Não debita estoque: atelier_confirm_lot_cut não é chamado.

BEGIN;

DO $$
DECLARE
  v_stamp_249 text;
  v_stamp_250 text;
  v_stamp_lote text;
  v_after_249 text;
  v_after_250 text;
  v_after_lote text;
  v_sheet uuid;
  v_client uuid := gen_random_uuid();
  v_pv uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_job uuid;
  v_lot uuid := gen_random_uuid();
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_c uuid := gen_random_uuid();
  v_number text := 'PV-TESTE-CORTE-' || substr(gen_random_uuid()::text, 1, 8);
  v_req1 uuid := gen_random_uuid();
  v_req2 uuid := gen_random_uuid();
  v_moves_before bigint;
  v_moves_after bigint;
  v_os int;
  v_os_b int;
  v_dispatch int;
  v_demand int;
  v_sent int;
  v_a_pairs int;
  v_b_pairs int;
  v_c_pairs int;
  v_replay int;
  v_ranges jsonb;
  v_parts jsonb;
BEGIN
  SELECT status || '|' || COALESCE(deleted_at::text, '')
    INTO v_stamp_249
    FROM public.sale_orders WHERE order_number = 'PV-00249' LIMIT 1;
  SELECT status || '|' || COALESCE(deleted_at::text, '')
    INTO v_stamp_250
    FROM public.sale_orders WHERE order_number = 'PV-00250' LIMIT 1;
  SELECT status || '|' || COALESCE(updated_at::text, '')
    INTO v_stamp_lote
    FROM public.atelier_lots WHERE lot_number = 'LOTE-00004' LIMIT 1;

  SELECT ts.id INTO v_sheet
    FROM public.technical_sheets ts
    JOIN public.atelier_complex_references a
      ON a.reference_id = ts.id AND a.active AND a.sector = 'costura_cabedal'
   LIMIT 1;
  IF v_sheet IS NULL THEN
    RAISE EXCEPTION 'sem ficha de cabedal complexo ativa para o teste';
  END IF;

  PERFORM set_config('session_replication_role', 'replica', true);

  INSERT INTO public.clients (id, razao_social, nome_fantasia, notes)
  VALUES (v_client, 'TESTE CORTE OS — apagar', 'TESTE CORTE OS — apagar', 'TESTE CORTE OS — apagar');

  INSERT INTO public.sale_orders (
    id, order_number, client_id, client_name, status, notes, total
  ) VALUES (
    v_pv, v_number, v_client, 'TESTE CORTE OS — apagar', 'Rascunho', 'TESTE CORTE OS — apagar', 0
  );

  INSERT INTO public.sale_order_items (
    id, sale_order_id, reference_id, color, quantity, fichas, unit_price, grade
  ) VALUES (
    v_item, v_pv, v_sheet, 'PRETO', 300, 1, 0, '{"34":60,"40":240}'::jsonb
  );

  INSERT INTO public.contractors (id, name, trade_name, active, payment_days, phone, address, city, state)
  VALUES
    (v_a, 'TESTE CORTE A — apagar', 'TESTE CORTE A — apagar', true, 7, '2100000001', 'Rua A', 'Nova Iguaçu', 'RJ'),
    (v_b, 'TESTE CORTE B — apagar', 'TESTE CORTE B — apagar', true, 7, '2100000002', 'Rua B', 'Nilópolis', 'RJ'),
    (v_c, 'TESTE CORTE C — apagar', 'TESTE CORTE C — apagar', true, 7, '2100000003', 'Rua C', 'Mesquita', 'RJ');

  INSERT INTO public.atelier_lots (id, lot_number, reference_id, color, color_norm, status)
  VALUES (v_lot, 'TESTE-CORTE-' || substr(v_lot::text, 1, 8), v_sheet, 'PRETO', 'preto', 'cut');

  PERFORM set_config('session_replication_role', 'origin', true);
  PERFORM set_config('app.sale_order_command_internal', '1', true);

  UPDATE public.technical_sheets
     SET knife_size_ranges = '[{"label":"P","sizes":["34"]},{"label":"G","sizes":["40"]}]'::jsonb
   WHERE id = v_sheet;

  UPDATE public.sale_orders SET status = 'Aprovado' WHERE id = v_pv;

  SELECT j.id INTO v_job
    FROM public.cabedal_prep_jobs j
   WHERE j.sale_order_id = v_pv
     AND j.sector = 'costura_cabedal'
     AND j.pipeline_status <> 'cancelled'
   LIMIT 1;
  IF v_job IS NULL THEN
    RAISE EXCEPTION 'o PV aprovado não gerou job de costura';
  END IF;

  PERFORM set_config('session_replication_role', 'replica', true);
  UPDATE public.cabedal_prep_jobs
     SET lot_id = v_lot, pairs = 300, sale_order_item_id = v_item
   WHERE id = v_job;
  PERFORM set_config('session_replication_role', 'origin', true);

  SELECT count(*) INTO v_moves_before FROM public.stock_movements;

  v_ranges := '[{"label":"P","pairs":30},{"label":"G","pairs":120}]'::jsonb;
  v_parts := jsonb_build_array(
    jsonb_build_object('contractor_id', v_a, 'unit_price', 10, 'ranges', jsonb_build_object('P', 10, 'G', 40)),
    jsonb_build_object('contractor_id', v_b, 'unit_price', 11, 'ranges', jsonb_build_object('P', 20, 'G', 80))
  );
  PERFORM public.approve_atelier_cut(v_job, v_ranges, v_parts, v_req1);
  PERFORM public.approve_atelier_cut(v_job, v_ranges, v_parts, v_req1);

  v_parts := jsonb_build_array(
    jsonb_build_object('contractor_id', v_b, 'unit_price', 11, 'ranges', jsonb_build_object('P', 15, 'G', 60)),
    jsonb_build_object('contractor_id', v_c, 'unit_price', 12, 'ranges', jsonb_build_object('P', 15, 'G', 60))
  );
  PERFORM public.approve_atelier_cut(v_job, v_ranges, v_parts, v_req2);

  SELECT count(*) INTO v_os
    FROM public.service_orders
   WHERE cut_launch_id IN (SELECT id FROM public.atelier_cut_launches WHERE job_id = v_job);
  IF v_os <> 4 THEN
    RAISE EXCEPTION 'esperava 4 OS e saíram %', v_os;
  END IF;

  SELECT count(*) INTO v_replay
    FROM public.service_orders os
    JOIN public.atelier_cut_launches l ON l.id = os.cut_launch_id
   WHERE l.client_request_id = v_req1;
  IF v_replay <> 2 THEN
    RAISE EXCEPTION 'o segundo clique duplicou a primeira leva: % OS', v_replay;
  END IF;

  SELECT count(*) INTO v_os_b
    FROM public.service_orders
   WHERE contractor_id = v_b
     AND cut_launch_id IN (SELECT id FROM public.atelier_cut_launches WHERE job_id = v_job);
  IF v_os_b <> 2 THEN
    RAISE EXCEPTION 'o prestador B deveria ter 2 OS, uma por lançamento, e tem %', v_os_b;
  END IF;

  SELECT count(*) INTO v_dispatch
    FROM public.service_order_dispatches d
    JOIN public.service_orders os ON os.id = d.service_order_id
   WHERE os.cut_launch_id IN (SELECT id FROM public.atelier_cut_launches WHERE job_id = v_job);
  IF v_dispatch <> 0 THEN
    RAISE EXCEPTION 'a OS de corte não pode nascer despachada';
  END IF;

  SELECT COALESCE(sum(demand_pairs), 0), COALESCE(sum(sent_pairs), 0)
    INTO v_demand, v_sent
    FROM public.outsourced_pair_ledger('week')
   WHERE order_number = v_number
     AND sector_key = 'costura';
  IF v_demand <> 300 OR v_sent <> 0 THEN
    RAISE EXCEPTION 'ledger do PV: demanda % enviado % (esperado 300 e 0)', v_demand, v_sent;
  END IF;

  SELECT COALESCE(sum(demand_pairs), 0) INTO v_a_pairs
    FROM public.outsourced_pair_ledger('week')
   WHERE order_number = v_number AND sector_key = 'costura' AND contractor_id = v_a;
  SELECT COALESCE(sum(demand_pairs), 0) INTO v_b_pairs
    FROM public.outsourced_pair_ledger('week')
   WHERE order_number = v_number AND sector_key = 'costura' AND contractor_id = v_b;
  SELECT COALESCE(sum(demand_pairs), 0) INTO v_c_pairs
    FROM public.outsourced_pair_ledger('week')
   WHERE order_number = v_number AND sector_key = 'costura' AND contractor_id = v_c;
  IF v_a_pairs <> 50 OR v_b_pairs <> 175 OR v_c_pairs <> 75 THEN
    RAISE EXCEPTION 'ledger por prestador A % B % C % (esperado 50, 175, 75)', v_a_pairs, v_b_pairs, v_c_pairs;
  END IF;

  BEGIN
    PERFORM public.approve_atelier_cut(
      v_job,
      '[{"label":"P","pairs":1},{"label":"G","pairs":0}]'::jsonb,
      jsonb_build_array(jsonb_build_object('contractor_id', v_a, 'unit_price', 10, 'ranges', jsonb_build_object('P', 1, 'G', 0))),
      gen_random_uuid()
    );
    RAISE EXCEPTION 'o terceiro corte deveria estourar o saldo';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%passa do saldo%' THEN
        RAISE;
      END IF;
  END;

  SELECT count(*) INTO v_moves_after FROM public.stock_movements;
  IF v_moves_after <> v_moves_before THEN
    RAISE EXCEPTION 'o corte debitou estoque: movimentos % -> %', v_moves_before, v_moves_after;
  END IF;

  SELECT status || '|' || COALESCE(deleted_at::text, '')
    INTO v_after_249
    FROM public.sale_orders WHERE order_number = 'PV-00249' LIMIT 1;
  SELECT status || '|' || COALESCE(deleted_at::text, '')
    INTO v_after_250
    FROM public.sale_orders WHERE order_number = 'PV-00250' LIMIT 1;
  SELECT status || '|' || COALESCE(updated_at::text, '')
    INTO v_after_lote
    FROM public.atelier_lots WHERE lot_number = 'LOTE-00004' LIMIT 1;
  IF v_after_249 IS DISTINCT FROM v_stamp_249
     OR v_after_250 IS DISTINCT FROM v_stamp_250
     OR v_after_lote IS DISTINCT FROM v_stamp_lote THEN
    RAISE EXCEPTION 'o teste tocou PV-00249, PV-00250 ou LOTE-00004';
  END IF;

  RAISE EXCEPTION 'rollback teste corte parcial';
END;
$$;
