-- Teste da migration 20270101067200 SEM persistir nada.
-- Tudo roda dentro de UM bloco DO que termina em RAISE EXCEPTION: o Postgres
-- desfaz a migration e o teste inteiro. O resultado vem na mensagem de erro.
DO $teste$
DECLARE
  v_mig text := $mig$__MIGRATION__$mig$;
  r jsonb := '{}'::jsonb;
  v_pv uuid; v_pv255 uuid; v_pv252 uuid;
  v_snap0 jsonb; v_snap1 jsonb; v_res jsonb; v_res2 jsonb;
  v_stage uuid; v_msg text; v_x jsonb;
  FUNCTION_SNAP text := 'x';
BEGIN
  EXECUTE v_mig;
  r := r || jsonb_build_object('migration_aplicada_na_transacao', true);

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  SELECT id INTO v_pv FROM public.sale_orders WHERE order_number = 'PV-00250';
  SELECT id INTO v_pv255 FROM public.sale_orders WHERE order_number = 'PV-00255';
  SELECT id INTO v_pv252 FROM public.sale_orders WHERE order_number = 'PV-00252';

  v_snap0 := (SELECT jsonb_build_object(
    'estoque_soma', (SELECT COALESCE(sum(quantity),0) FROM public.products),
    'movimentos', (SELECT count(*) FROM public.stock_movements),
    'ocs', (SELECT count(*) FROM public.purchase_orders),
    'consumido', (SELECT COALESCE(sum(quantity_consumed),0) FROM public.material_reservations),
    'reservas_total', (SELECT count(*) FROM public.material_reservations),
    'ops_total', (SELECT count(*) FROM public.orders)));

  r := r || jsonb_build_object('pv250_antes', (SELECT jsonb_build_object(
    'status', so.status,
    'ops', (SELECT count(*) FROM public.orders o WHERE o.sale_order_id = so.id AND o.deleted_at IS NULL),
    'holds', (SELECT count(*) FROM public.sale_order_atelier_production_block_rows(ARRAY[so.id])))
    FROM public.sale_orders so WHERE so.id = v_pv));

  r := r || jsonb_build_object('gate_antes_item_nao_nulo', (
    SELECT bool_and(public.sale_order_item_factory_gate_block_reason(i.id) IS NOT NULL)
      FROM public.sale_order_items i WHERE i.sale_order_id = v_pv));

  -- 1) RPC no PV-00250
  v_res := public.release_preproduction_for_sale_order(v_pv);
  r := r || jsonb_build_object('rpc_pv250', jsonb_build_object(
    'ops_criadas', v_res->'ops_criadas', 'created_ops', v_res->'created_ops',
    'reused_ops', v_res->'reused_ops', 'status', v_res->'status', 'preproduction', v_res->'preproduction'));

  r := r || jsonb_build_object('pv250_ops', (SELECT jsonb_agg(jsonb_build_object(
      'op', o.order_number, 'ref', ts.code, 'cor', o.color, 'pares', o.quantity,
      'status', o.status, 'marcada', o.cabedal_preproduction_at IS NOT NULL,
      'etapas', (SELECT count(*) FROM public.order_stages s WHERE s.order_id = o.id),
      'reservas', (SELECT count(*) FROM public.material_reservations m WHERE m.order_id = o.id),
      'reservas_status', (SELECT string_agg(DISTINCT m.status, ',') FROM public.material_reservations m WHERE m.order_id = o.id),
      'consumido', (SELECT COALESCE(sum(m.quantity_consumed),0) FROM public.material_reservations m WHERE m.order_id = o.id))
      ORDER BY ts.code, o.color)
    FROM public.orders o LEFT JOIN public.technical_sheets ts ON ts.id = o.reference_id
    WHERE o.sale_order_id = v_pv AND o.deleted_at IS NULL));

  v_snap1 := (SELECT jsonb_build_object(
    'estoque_soma', (SELECT COALESCE(sum(quantity),0) FROM public.products),
    'movimentos', (SELECT count(*) FROM public.stock_movements),
    'ocs', (SELECT count(*) FROM public.purchase_orders),
    'consumido', (SELECT COALESCE(sum(quantity_consumed),0) FROM public.material_reservations),
    'reservas_total', (SELECT count(*) FROM public.material_reservations),
    'ops_total', (SELECT count(*) FROM public.orders)));
  r := r || jsonb_build_object('snap_antes', v_snap0, 'snap_depois', v_snap1);

  r := r || jsonb_build_object('pv250_depois', (SELECT jsonb_build_object(
    'status', so.status,
    'holds', (SELECT count(*) FROM public.sale_order_atelier_production_block_rows(ARRAY[so.id])))
    FROM public.sale_orders so WHERE so.id = v_pv));

  r := r || jsonb_build_object('gate_depois_item_nao_nulo', (
    SELECT bool_and(public.sale_order_item_factory_gate_block_reason(i.id) IS NOT NULL)
      FROM public.sale_order_items i WHERE i.sale_order_id = v_pv));

  -- 2) idempotência
  v_res2 := public.release_preproduction_for_sale_order(v_pv);
  r := r || jsonb_build_object('rpc_2a_vez', jsonb_build_object(
    'created_ops', v_res2->'created_ops', 'reused_ops', v_res2->'reused_ops'),
    'ops_apos_2a', (SELECT count(*) FROM public.orders o WHERE o.sale_order_id = v_pv AND o.deleted_at IS NULL));

  -- 3) primeiro apontamento não promove o PV
  SELECT s.id INTO v_stage FROM public.order_stages s JOIN public.orders o ON o.id = s.order_id
   WHERE o.sale_order_id = v_pv ORDER BY s.stage_order LIMIT 1;
  PERFORM set_config('app.sale_order_command_internal', '1', true);
  v_x := public.apply_sale_order_stage_transition_internal(v_pv, 'Em Produção', v_stage);
  r := r || jsonb_build_object('transicao_automatica', v_x);

  -- 4) Em Produção continua recusado
  BEGIN
    UPDATE public.sale_orders SET status = 'Em Produção' WHERE id = v_pv;
    r := r || jsonb_build_object('em_producao_manual', 'PASSOU (ERRO)');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    r := r || jsonb_build_object('em_producao_manual', 'recusado: ' || left(v_msg, 140));
  END;
  PERFORM set_config('app.sale_order_command_internal', '', true);

  -- 5) PVs fora do escopo
  BEGIN
    PERFORM public.release_preproduction_for_sale_order(v_pv252);
    r := r || jsonb_build_object('rpc_pv252_em_producao', 'PASSOU (ERRO)');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    r := r || jsonb_build_object('rpc_pv252_em_producao', 'recusado: ' || left(v_msg, 120));
  END;

  BEGIN
    v_x := public.release_preproduction_for_sale_order(v_pv255);
    r := r || jsonb_build_object('rpc_pv255', jsonb_build_object('created_ops', v_x->'created_ops', 'reused_ops', v_x->'reused_ops'));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    r := r || jsonb_build_object('rpc_pv255', 'erro: ' || left(v_msg, 200));
  END;

  -- 6) sem permissão: remove o papel de serviço e roda sem usuário
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  BEGIN
    PERFORM public.release_preproduction_for_sale_order(v_pv);
    r := r || jsonb_build_object('rpc_sem_permissao', 'PASSOU (ERRO)');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    r := r || jsonb_build_object('rpc_sem_permissao', 'recusado: ' || left(v_msg, 120));
  END;

  r := r || jsonb_build_object('apontar_tem_marca', position('cabedal_preproduction_at' in pg_get_functiondef(
    'public.apontar_producao_setor_impl(uuid, text, integer, uuid, text, boolean, text[])'::regprocedure)) > 0);

  RAISE EXCEPTION 'RESULTADO_ROLLBACK_TEST %', r::text;
END;
$teste$;
