-- Teste do lançamento por faixa de faca (Corte Cabedal / Costura Cabedal).
--
-- Rode no banco DEPOIS da migration 20270101052100, como superusuário:
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f scripts/teste-lancamento-faixa.sql
--
-- O bloco cria ficha, PV e OP só dentro da própria transação e termina com
-- RAISE EXCEPTION. O psql sai com erro de propósito. Sucesso é a mensagem
-- 'TESTE OK — rollback'. Qualquer outra mensagem é falha, e mesmo assim nada
-- fica gravado. Não toca PV-00249 nem pedido real: os ids são novos.
--
-- A carga usa session_replication_role=replica para não disparar reserva,
-- compra, financeiro ou fila. O apontamento em si volta para origin e chama
-- a mesma RPC da tela.

DO $teste_lancamento_faixa$
DECLARE
  c_marker constant text := 'TESTE LANCAMENTO FAIXA — apagar';
  c_ranges constant jsonb := '[{"label":"P","sizes":["34","35"]},{"label":"M","sizes":["36","37"]},{"label":"G","sizes":["38","39","40"]}]'::jsonb;
  c_grade constant jsonb := '{"34":6,"35":8,"36":10,"37":12,"38":8,"39":4,"40":2,"41":3}'::jsonb;
  v_client uuid := gen_random_uuid();
  v_sheet uuid := gen_random_uuid();
  v_sheet_plain uuid := gen_random_uuid();
  v_pv uuid := gen_random_uuid();
  v_pv_plain uuid := gen_random_uuid();
  v_op uuid := gen_random_uuid();
  v_op_plain uuid := gen_random_uuid();
  v_actor uuid;
  v_updated timestamptz;
  v_res jsonb;
  v_caps jsonb;
  v_err text;
  v_processed integer;
  v_bd integer;
  v_qty integer;
BEGIN
  SELECT ur.user_id INTO v_actor
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
   WHERE ur.role::text = 'admin' AND p.approved
   LIMIT 1;

  PERFORM set_config('session_replication_role', 'replica', true);

  INSERT INTO public.clients (id, razao_social, nome_fantasia, notes)
  VALUES (v_client, c_marker, c_marker, c_marker);

  INSERT INTO public.technical_sheets (id, name, code, knife_size_ranges)
  VALUES (v_sheet, c_marker, 'TST-FAIXA-' || left(v_sheet::text, 8), c_ranges);

  INSERT INTO public.technical_sheets (id, name, code, knife_size_ranges)
  VALUES (v_sheet_plain, c_marker || ' sem faixa', 'TST-SEM-' || left(v_sheet_plain::text, 8), NULL);

  INSERT INTO public.sale_orders (id, order_number, client_id, client_name, status, notes, total)
  VALUES
    (v_pv, 'PV-TST-FAIXA-' || left(v_pv::text, 8), v_client, c_marker, 'Rascunho', c_marker, 0),
    (v_pv_plain, 'PV-TST-SEM-' || left(v_pv_plain::text, 8), v_client, c_marker, 'Rascunho', c_marker, 0);

  INSERT INTO public.orders (id, order_number, reference_id, sale_order_id, quantity, grade, status, notes)
  VALUES
    (v_op, 'OP-TST-FAIXA-' || left(v_op::text, 8), v_sheet, v_pv, 53, c_grade, 'Em Produção', c_marker),
    (v_op_plain, 'OP-TST-SEM-' || left(v_op_plain::text, 8), v_sheet_plain, v_pv_plain, 20, '{"34":20}'::jsonb, 'Em Produção', c_marker);

  INSERT INTO public.order_stages (id, order_id, stage_name, stage_order, status, quantity_total, quantity_processed)
  VALUES
    (gen_random_uuid(), v_op, 'Corte Cabedal', 1, 'pendente', 53, 0),
    (gen_random_uuid(), v_op, 'Costura Cabedal', 2, 'pendente', 53, 0),
    (gen_random_uuid(), v_op_plain, 'Corte Cabedal', 1, 'pendente', 20, 0),
    (gen_random_uuid(), v_op_plain, 'Costura Cabedal', 2, 'pendente', 20, 0);

  PERFORM set_config('session_replication_role', 'origin', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  IF v_actor IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_actor, 'role', 'service_role')::text, true);
  END IF;

  v_caps := public.pointing_knife_range_caps(v_op, 'Corte Cabedal');
  IF (v_caps -> 'target' ->> 'P')::integer IS DISTINCT FROM 14
     OR (v_caps -> 'target' ->> 'M')::integer IS DISTINCT FROM 22
     OR (v_caps -> 'target' ->> 'G')::integer IS DISTINCT FROM 14
     OR (v_caps -> 'target' ->> '41')::integer IS DISTINCT FROM 3
     OR COALESCE((v_caps -> 'ranges' -> -1 ->> 'extra')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FALHOU faixa/extra: %', v_caps;
  END IF;

  SELECT updated_at INTO v_updated FROM public.order_stages
   WHERE order_id = v_op AND stage_name = 'Corte Cabedal';
  v_res := public.execute_production_pointing_by_size(
    v_op, 'Corte Cabedal', 4, NULL, c_marker, false, NULL, v_updated, gen_random_uuid(), NULL,
    '{"P":4}'::jsonb
  );
  v_caps := public.pointing_knife_range_caps(v_op, 'Corte Cabedal');
  IF COALESCE((v_res ->> 'success')::boolean, false) IS NOT TRUE
     OR (v_caps -> 'known' ->> 'P')::integer IS DISTINCT FROM 4
     OR (v_caps -> 'pending' ->> 'P')::integer IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION 'FALHOU parcial P 4/10: res=% caps=%', v_res, v_caps;
  END IF;

  SELECT updated_at INTO v_updated FROM public.order_stages
   WHERE order_id = v_op AND stage_name = 'Costura Cabedal';
  BEGIN
    PERFORM public.execute_production_pointing_by_size(
      v_op, 'Costura Cabedal', 6, NULL, c_marker, false, NULL, v_updated, gen_random_uuid(), NULL,
      '{"P":6}'::jsonb
    );
    RAISE EXCEPTION 'FALHOU: Costura aceitou P:6 com o Corte em P:4';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT LIKE '%já lançou%' THEN
      RAISE EXCEPTION 'FALHOU bloqueio da Costura: %', v_err;
    END IF;
  END;

  v_res := public.execute_production_pointing_by_size(
    v_op, 'Costura Cabedal', 4, NULL, c_marker, false, NULL, v_updated, gen_random_uuid(), NULL,
    '{"P":4}'::jsonb
  );
  IF COALESCE((v_res ->> 'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FALHOU Costura P:4 no teto do Corte: %', v_res;
  END IF;

  SELECT updated_at INTO v_updated FROM public.order_stages
   WHERE order_id = v_op AND stage_name = 'Corte Cabedal';
  v_res := public.execute_production_pointing_by_size(
    v_op, 'Corte Cabedal', 10, NULL, c_marker, false, NULL, v_updated, gen_random_uuid(), NULL,
    '{"P":10}'::jsonb
  );
  v_caps := public.pointing_knife_range_caps(v_op, 'Corte Cabedal');
  IF COALESCE((v_res ->> 'success')::boolean, false) IS NOT TRUE
     OR COALESCE((v_caps -> 'pending' ->> 'P')::integer, 0) <> 0
     OR (v_caps -> 'known' ->> 'P')::integer IS DISTINCT FROM 14 THEN
    RAISE EXCEPTION 'FALHOU fechamento da faixa P: res=% caps=%', v_res, v_caps;
  END IF;

  SELECT updated_at INTO v_updated FROM public.order_stages
   WHERE order_id = v_op AND stage_name = 'Corte Cabedal';
  BEGIN
    PERFORM public.execute_production_pointing_by_size(
      v_op, 'Corte Cabedal', 23, NULL, c_marker, false, NULL, v_updated, gen_random_uuid(), NULL,
      '{"M":23}'::jsonb
    );
    RAISE EXCEPTION 'FALHOU: aceitou M:23 acima do saldo 22';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err NOT LIKE 'Faixa M: 23 passa o saldo de 22 pares.%' AND v_err NOT LIKE 'Faixa M: 23 passa o saldo de 22 pares.' THEN
      RAISE EXCEPTION 'FALHOU mensagem de saldo: %', v_err;
    END IF;
  END;

  SELECT quantity_processed INTO v_processed FROM public.order_stages
   WHERE order_id = v_op AND stage_name = 'Corte Cabedal';
  SELECT COALESCE(SUM(public.size_breakdown_sum(size_breakdown)), 0), COALESCE(SUM(quantity), 0)
    INTO v_bd, v_qty
    FROM public.production_pointings
   WHERE order_id = v_op AND stage_name = 'Corte Cabedal';
  IF v_processed IS DISTINCT FROM 14 OR v_bd IS DISTINCT FROM 14 OR v_qty IS DISTINCT FROM 14 THEN
    RAISE EXCEPTION 'FALHOU totais do Corte: processado=% breakdown=% quantity=%', v_processed, v_bd, v_qty;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.production_pointings
     WHERE order_id = v_op AND stage_name = 'Corte Cabedal'
       AND size_breakdown -> '_faixas' -> 'P' = '["34","35"]'::jsonb
  ) THEN
    RAISE EXCEPTION 'FALHOU: size_breakdown não gravou as numerações da faixa P';
  END IF;

  v_caps := public.pointing_knife_range_caps(v_op_plain, 'Corte Cabedal');
  IF v_caps ->> 'mode' IS DISTINCT FROM 'total'
     OR v_caps ->> 'warning' IS DISTINCT FROM 'Ficha sem faixas P/M/G cadastradas' THEN
    RAISE EXCEPTION 'FALHOU ficha sem faixa: %', v_caps;
  END IF;

  SELECT updated_at INTO v_updated FROM public.order_stages
   WHERE order_id = v_op_plain AND stage_name = 'Corte Cabedal';
  v_res := public.execute_production_pointing_by_size(
    v_op_plain, 'Corte Cabedal', 5, NULL, c_marker, false, NULL, v_updated, gen_random_uuid(), NULL, NULL
  );
  SELECT quantity_processed INTO v_processed FROM public.order_stages
   WHERE order_id = v_op_plain AND stage_name = 'Corte Cabedal';
  IF COALESCE((v_res ->> 'success')::boolean, false) IS NOT TRUE OR v_processed IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'FALHOU total sem faixa: res=% processado=%', v_res, v_processed;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.production_pointings
     WHERE order_id = v_op_plain AND size_breakdown IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'FALHOU: ficha sem faixa gravou size_breakdown';
  END IF;

  SELECT updated_at INTO v_updated FROM public.order_stages
   WHERE order_id = v_op_plain AND stage_name = 'Costura Cabedal';
  v_res := public.execute_production_pointing_by_size(
    v_op_plain, 'Costura Cabedal', 8, NULL, c_marker, false, NULL, v_updated, gen_random_uuid(), NULL, NULL
  );
  SELECT quantity_processed INTO v_processed FROM public.order_stages
   WHERE order_id = v_op_plain AND stage_name = 'Costura Cabedal';
  IF COALESCE((
       SELECT check_prev_sector_limit FROM public.sector_settings
        WHERE public.canonical_stage_name(sector) = 'Costura Cabedal'
        LIMIT 1
     ), true) THEN
    IF COALESCE((v_res ->> 'needs_confirmation')::boolean, false) IS NOT TRUE
       OR v_res ->> 'warnings' NOT LIKE '%limite_setor_anterior%'
       OR v_processed IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'FALHOU limite do setor anterior: res=% processado=%', v_res, v_processed;
    END IF;
  END IF;

  RAISE EXCEPTION 'TESTE OK — rollback';
END;
$teste_lancamento_faixa$;
