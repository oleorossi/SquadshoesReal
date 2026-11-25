-- Ensaio do Reverter Faturamento (migration 20270101054600).
-- Roda o comando real em PVs Faturados de produção e termina em RAISE
-- EXCEPTION: nada é gravado. Uso: aplicar a migration e este bloco na mesma
-- transação (ou depois do deploy, só este bloco).
-- Não toca PV-00249, PV-00250, PV-00251 nem LOTE-00004.
DO $teste_reverter$
DECLARE
  v_pv text;
  v_so record;
  v_res jsonb;
  v_out jsonb := '{}'::jsonb;
  v_ar_before text;
  v_ar_after text;
  snap text := $q$
    select jsonb_build_object(
     'pv', (select status from sale_orders where id=%1$L),
     'ops', (select jsonb_agg(order_number||':'||status order by order_number) from orders where sale_order_id=%1$L and deleted_at is null),
     'etapas', (select jsonb_object_agg(k,n) from (select st.status k, count(*) n from order_stages st join orders o on o.id=st.order_id where o.sale_order_id=%1$L and o.deleted_at is null group by 1) z),
     'reservas', (select jsonb_object_agg(k,n) from (select status k, count(*) n from material_reservations where order_id in (select id from orders where sale_order_id=%1$L) group by 1) z),
     'preparos', (select jsonb_object_agg(k,n) from (select pipeline_status k, count(*) n from cabedal_prep_jobs where sale_order_id=%1$L group by 1) z),
     'ar', (select jsonb_agg(status||' '||amount) from accounts_receivable where sale_order_id=%1$L),
     'fin', (select jsonb_agg(reference_type||' '||status) from financial_entries where reference_id=%1$L::text),
     'gestao', (select count(*) from v_production_queue_detail q where q.sale_order_id=%1$L)
    )$q$;
  v_before jsonb;
  v_after jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  FOREACH v_pv IN ARRAY ARRAY['PV-00240', 'PV-00238'] LOOP
    SELECT id, order_version INTO v_so FROM sale_orders
     WHERE order_number = v_pv AND deleted_at IS NULL AND status = 'Faturado';
    CONTINUE WHEN v_so.id IS NULL;
    EXECUTE format(snap, v_so.id) INTO v_before;
    SELECT string_agg(status||' '||amount, ',' ORDER BY id) INTO v_ar_before FROM accounts_receivable WHERE sale_order_id = v_so.id;
    v_res := public.revert_invoiced_sale_order_command(
      v_so.id, v_so.order_version, 'Ensaio com rollback do Reverter Faturamento', gen_random_uuid());
    EXECUTE format(snap, v_so.id) INTO v_after;
    SELECT string_agg(status||' '||amount, ',' ORDER BY id) INTO v_ar_after FROM accounts_receivable WHERE sale_order_id = v_so.id;
    IF (v_res #>> '{result,kept_receivable}')::boolean AND v_ar_after IS DISTINCT FROM v_ar_before THEN
      RAISE EXCEPTION 'FALHA: % tem NF autorizada e o título mudou (% -> %)', v_pv, v_ar_before, v_ar_after;
    END IF;
    IF (v_after->>'pv') NOT IN ('Aprovado', 'Em Produção') THEN
      RAISE EXCEPTION 'FALHA: % ficou em %', v_pv, v_after->>'pv';
    END IF;
    v_out := v_out || jsonb_build_object(v_pv, jsonb_build_object('antes', v_before, 'resultado', v_res->'result', 'depois', v_after));
  END LOOP;
  RAISE EXCEPTION 'ENSAIO_ROLLBACK %', v_out::text;
END
$teste_reverter$;
DO $t255$
DECLARE
  v_so uuid := '5c14d390-7965-493c-8bdf-c1fdbe7420f7';
  v_res jsonb; v_mid jsonb; v_after jsonb; v_before jsonb; v_ver bigint;
  v_ar_before text; v_ar_after text; v_stock_before numeric; v_stock_after numeric;
  snap text := $q$
    select jsonb_build_object(
     'pv', (select status from sale_orders where id=%1$L),
     'ops', (select jsonb_agg(order_number||':'||status order by order_number) from orders where sale_order_id=%1$L and deleted_at is null),
     'etapas', (select jsonb_object_agg(k,n) from (select st.status k, count(*) n from order_stages st join orders o on o.id=st.order_id where o.sale_order_id=%1$L and o.deleted_at is null group by 1) z),
     'reservas', (select jsonb_object_agg(k,n) from (select status k, count(*) n from material_reservations where order_id in (select id from orders where sale_order_id=%1$L) group by 1) z),
     'preparos', (select jsonb_object_agg(k,n) from (select pipeline_status k, count(*) n from cabedal_prep_jobs where sale_order_id=%1$L group by 1) z),
     'ar', (select jsonb_agg(status||' '||amount) from accounts_receivable where sale_order_id=%1$L),
     'rebite', (select quantity from products where id='af0f3c38-94ad-4721-9c62-99be010dc4b5'),
     'gestao', (select count(*) from v_production_queue_detail q where q.sale_order_id=%1$L)
    )$q$;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  EXECUTE format(snap, v_so) INTO v_before;
  -- Simula o faturamento de 24/11 (mesmo UPDATE que disparou os gatilhos).
  PERFORM set_config('app.sale_order_command_internal', '1', true);
  PERFORM set_config('app.production_order_command_internal', '1', true);
  UPDATE sale_orders SET status = 'Faturado', updated_at = now() WHERE id = v_so;
  PERFORM public.sync_atelier_launch_for_order(v_so);
  PERFORM set_config('app.sale_order_command_internal', '', true);
  PERFORM set_config('app.production_order_command_internal', '', true);
  EXECUTE format(snap, v_so) INTO v_mid;
  SELECT order_version INTO v_ver FROM sale_orders WHERE id = v_so;
  v_res := public.revert_invoiced_sale_order_command(v_so, v_ver, 'Ensaio com rollback do Reverter Faturamento (255)', gen_random_uuid());
  EXECUTE format(snap, v_so) INTO v_after;
  IF v_after->>'pv' <> 'Aprovado' THEN RAISE EXCEPTION 'FALHA: 255 foi para %', v_after->>'pv'; END IF;
  IF v_after->'ar' IS DISTINCT FROM v_before->'ar' THEN RAISE EXCEPTION 'FALHA: título mudou % -> %', v_before->'ar', v_after->'ar'; END IF;
  RAISE EXCEPTION 'ENSAIO_ROLLBACK %', jsonb_build_object('antes', v_before, 'faturado_simulado', v_mid, 'resultado', v_res->'result', 'depois', v_after)::text;
END $t255$;
