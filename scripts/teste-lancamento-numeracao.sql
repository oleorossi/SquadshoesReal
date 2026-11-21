-- Teste do lançamento por numeração. Roda dentro de BEGIN/ROLLBACK
-- (workflow supabase-db-exec, dry_run=true). Não commita.
--
-- O PV oficial dispararia reserva, compra e financeiro. Aqui a OP nasce
-- direto, com session_replication_role=replica só na carga, para nenhum
-- gatilho de estoque, fila, OC ou financeiro disparar. O apontamento em si
-- usa a mesma RPC da tela: execute_production_pointing_by_size.

CREATE TEMP TABLE lanc_report (
  sector text,
  check_name text,
  ok boolean,
  detail text
);

DO $teste_lancamento_numeracao$
DECLARE
  c_marker constant text := 'TESTE LANCAMENTO NUMERACAO — apagar';
  c_grade constant jsonb := '{"34":6,"35":8,"36":10,"37":12,"38":8,"39":4}'::jsonb;
  c_total constant integer := 48;
  v_client uuid := gen_random_uuid();
  v_pv uuid := gen_random_uuid();
  v_op uuid := gen_random_uuid();
  v_ref uuid;
  v_actor uuid;
  v_sector record;
  v_stage_id uuid;
  v_updated timestamptz;
  v_res jsonb;
  v_caps jsonb;
  v_err text;
  v_sum_bd integer;
  v_sum_qty integer;
  v_processed integer;
  v_side integer;
  v_names text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.sale_orders
     WHERE order_number IN ('PV-00249', 'PV-00250')
       AND id IN (v_pv)
  ) OR EXISTS (
    SELECT 1 FROM public.production_lots WHERE code = 'LOTE-00004' AND id = v_op
  ) THEN
    RAISE EXCEPTION 'proteção dos pedidos reais disparou';
  END IF;

  SELECT ts.id INTO v_ref
    FROM public.technical_sheets ts
   WHERE ts.id IS NOT NULL
   LIMIT 1;
  IF v_ref IS NULL THEN
    RAISE EXCEPTION 'sem ficha para usar só como referência da OP de teste';
  END IF;

  SELECT ur.user_id INTO v_actor
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
   WHERE ur.role::text = 'admin'
     AND p.approved = true
   LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'sem administrador aprovado para simular o usuário da tela';
  END IF;

  PERFORM set_config('session_replication_role', 'replica', true);

  INSERT INTO public.clients (id, razao_social, nome_fantasia, notes)
  VALUES (v_client, c_marker, c_marker, c_marker);

  INSERT INTO public.sale_orders (
    id, order_number, client_id, client_name, status, notes, total
  ) VALUES (
    v_pv, 'PV-TESTE-NUM-APAGAR', v_client, c_marker, 'Rascunho', c_marker, 0
  );

  INSERT INTO public.orders (
    id, order_number, reference_id, sale_order_id, quantity, grade, status, notes
  ) VALUES (
    v_op, 'OP-TESTE-NUM-APAGAR', v_ref, v_pv, c_total, c_grade, 'Em Produção', c_marker
  );

  FOR v_sector IN
    SELECT canon, min(flow_order) AS flow_order, bool_or(pays_by_pair) AS pays_by_pair,
           string_agg(sector, ' | ' ORDER BY sector) AS nomes
      FROM (
        SELECT public.canonical_stage_name(sector) AS canon,
               sector, flow_order, pays_by_pair
          FROM public.sector_settings
         WHERE point_by_size
      ) s
     GROUP BY canon
     ORDER BY min(flow_order), canon
  LOOP
    v_stage_id := gen_random_uuid();
    INSERT INTO public.order_stages (
      id, order_id, stage_name, stage_order, status, quantity_total, quantity_processed
    ) VALUES (
      v_stage_id, v_op, v_sector.canon, v_sector.flow_order, 'pendente', c_total, 0
    );
    INSERT INTO lanc_report VALUES (
      v_sector.canon, 'cadastro', true, v_sector.nomes
    );
  END LOOP;

  PERFORM set_config('session_replication_role', 'origin', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_actor, 'role', 'service_role')::text,
    true
  );
  PERFORM set_config('app.order_stage_command_internal', '1', true);
  PERFORM set_config('app.production_order_command_internal', '1', true);
  PERFORM set_config('app.sale_order_command_internal', '1', true);

  IF NOT EXISTS (SELECT 1 FROM lanc_report WHERE check_name = 'cadastro') THEN
    RAISE EXCEPTION 'nenhum setor com point_by_size';
  END IF;

  FOR v_sector IN
    SELECT DISTINCT sector AS canon FROM lanc_report WHERE check_name = 'cadastro'
  LOOP
    SELECT updated_at INTO v_updated
      FROM public.order_stages
     WHERE order_id = v_op AND stage_name = v_sector.canon;

    BEGIN
      v_res := public.execute_production_pointing_by_size(
        v_op, v_sector.canon, 4, NULL, c_marker,
        false, NULL, v_updated, gen_random_uuid(), NULL, '{"34":4}'::jsonb
      );
      v_caps := public.pointing_size_caps(v_op, v_sector.canon);
      INSERT INTO lanc_report VALUES (
        v_sector.canon, 'parcial 34:4 saldo 4/2',
        COALESCE((v_res->>'success')::boolean, false)
          AND COALESCE((v_caps->'known'->>'34')::integer, 0) = 4
          AND COALESCE((v_caps->'pending'->>'34')::integer, 0) = 2,
        format('res=%s caps=%s', v_res, v_caps)
      );
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      INSERT INTO lanc_report VALUES (v_sector.canon, 'parcial 34:4 saldo 4/2', false, v_err);
    END;

    SELECT updated_at INTO v_updated
      FROM public.order_stages
     WHERE order_id = v_op AND stage_name = v_sector.canon;

    BEGIN
      v_res := public.execute_production_pointing_by_size(
        v_op, v_sector.canon, 10, NULL, c_marker,
        false, NULL, v_updated, gen_random_uuid(), NULL, '{"34":2,"35":8}'::jsonb
      );
      v_caps := public.pointing_size_caps(v_op, v_sector.canon);
      INSERT INTO lanc_report VALUES (
        v_sector.canon, 'completa 34 e 35',
        COALESCE((v_res->>'success')::boolean, false)
          AND COALESCE((v_caps->'pending'->>'34')::integer, 0) = 0
          AND COALESCE((v_caps->'known'->>'34')::integer, 0) = 6
          AND COALESCE((v_caps->'pending'->>'35')::integer, 0) = 0
          AND COALESCE((v_caps->'known'->>'35')::integer, 0) = 8,
        format('res=%s caps=%s', v_res, v_caps)
      );
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      INSERT INTO lanc_report VALUES (v_sector.canon, 'completa 34 e 35', false, v_err);
    END;

    SELECT updated_at INTO v_updated
      FROM public.order_stages
     WHERE order_id = v_op AND stage_name = v_sector.canon;
    BEGIN
      v_res := public.execute_production_pointing_by_size(
        v_op, v_sector.canon, 11, NULL, c_marker,
        false, NULL, v_updated, gen_random_uuid(), NULL, '{"36":11}'::jsonb
      );
      INSERT INTO lanc_report VALUES (
        v_sector.canon, 'exceder 36 bloqueado', false,
        format('aceitou indevidamente %s', v_res)
      );
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      INSERT INTO lanc_report VALUES (
        v_sector.canon, 'exceder 36 bloqueado',
        v_err ILIKE '%passa o saldo%',
        v_err
      );
    END;

    SELECT COALESCE(sum(public.size_breakdown_sum(size_breakdown)), 0),
           COALESCE(sum(quantity), 0)
      INTO v_sum_bd, v_sum_qty
      FROM public.production_pointings
     WHERE order_id = v_op
       AND public.canonical_stage_name(stage_name) = v_sector.canon;

    SELECT quantity_processed INTO v_processed
      FROM public.order_stages
     WHERE order_id = v_op AND stage_name = v_sector.canon;

    INSERT INTO lanc_report VALUES (
      v_sector.canon, 'somas grade=quantity=processado',
      v_sum_bd = v_sum_qty AND v_sum_qty = v_processed AND v_processed = 14,
      format('breakdown=%s quantity=%s processado=%s', v_sum_bd, v_sum_qty, v_processed)
    );

    SELECT bool_or(pays_by_pair) INTO v_pays
      FROM public.sector_settings
     WHERE public.canonical_stage_name(sector) = v_sector.canon;
    INSERT INTO lanc_report VALUES (
      v_sector.canon, 'pagamento por par',
      true,
      CASE
        WHEN v_pays THEN format('pays_by_pair=true e a quantidade que a ficha usaria é %s, igual à soma da grade', v_sum_qty)
        ELSE 'pays_by_pair=false neste setor; o lançamento não gera pagamento por par'
      END
    );
  END LOOP;

  SELECT count(*) INTO v_side FROM public.material_reservations WHERE order_id = v_op;
  INSERT INTO lanc_report VALUES ('isolamento', 'sem reserva de estoque', v_side = 0, format('reservas=%s', v_side));

  SELECT count(*) INTO v_side FROM public.production_queue WHERE order_id = v_op;
  INSERT INTO lanc_report VALUES ('isolamento', 'sem fila do motor', v_side = 0, format('fila=%s', v_side));

  SELECT count(*) INTO v_side
    FROM public.accounts_receivable
   WHERE sale_order_id = v_pv;
  INSERT INTO lanc_report VALUES ('isolamento', 'sem financeiro', v_side = 0, format('receber=%s', v_side));

  SELECT string_agg(sector || '=' || point_by_size::text, ', ' ORDER BY flow_order)
    INTO v_names
    FROM public.sector_settings;
  INSERT INTO lanc_report VALUES ('cadastro', 'flags', true, v_names);
END;
$teste_lancamento_numeracao$;

SELECT sector, check_name, ok, detail
  FROM lanc_report
 ORDER BY sector, check_name;
