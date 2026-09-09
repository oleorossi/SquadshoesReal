-- Executar como postgres. O usuário sintético e todos os dados somem no ROLLBACK.
-- Falhas abortam antes da mensagem de sucesso; nenhum usuário real é modificado.
BEGIN;
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_plan uuid;
  v_other_plan uuid;
  v_order uuid;
  v_entry uuid;
  v_count integer;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_user, 'cfo-rollback-' || v_user || '@example.invalid');
  INSERT INTO public.user_roles(user_id, role) VALUES (v_user, 'admin');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  UPDATE public.profiles SET approved = true WHERE id = v_user;
  UPDATE public.user_roles SET role = 'consulta' WHERE user_id = v_user;
  SET LOCAL ROLE authenticated;
  IF NOT public.can_access_cfo('view') OR NOT public.can_access_cfo('create') THEN
    RAISE EXCEPTION 'RBAC legado consulta deveria ter acesso';
  END IF;
  IF public.can_access_cfo('desconhecido') OR public.can_access_cfo(NULL) THEN
    RAISE EXCEPTION 'Ação inválida deveria ser negada';
  END IF;
  INSERT INTO public.cfo_planos(nome, data_inicio, data_fim, saldo_inicial)
    VALUES ('Teste CFO rollback', '2026-09-07', '2028-09-07', -100)
    RETURNING id INTO v_plan;
  INSERT INTO public.cfo_planos(nome, data_inicio, data_fim)
    VALUES ('Outro plano rollback', '2026-09-07', '2026-12-15')
    RETURNING id INTO v_other_plan;
  INSERT INTO public.cfo_pedidos(plano_id, descricao, entrega_em, lucro_informado)
    VALUES (v_plan, 'Pedido teste', '2026-10-10', -50) RETURNING id INTO v_order;
  INSERT INTO public.cfo_lancamentos(plano_id, pedido_id, tipo, descricao, data_prevista, valor_previsto, status, data_realizada, valor_realizado)
    VALUES (v_plan, v_order, 'material', 'Material pago', '2026-09-15', 100, 'realizado', '2026-09-16', 90)
    RETURNING id INTO v_entry;
  UPDATE public.cfo_lancamentos SET valor_realizado = 95 WHERE id = v_entry;
  IF NOT EXISTS (SELECT 1 FROM public.cfo_lancamentos WHERE id = v_entry AND valor_realizado = 95) THEN
    RAISE EXCEPTION 'CRUD autorizado não persistiu';
  END IF;

  BEGIN
    INSERT INTO public.cfo_lancamentos(plano_id, pedido_id, tipo, descricao, data_prevista, valor_previsto)
      VALUES (v_other_plan, v_order, 'material', 'Vínculo inválido', '2026-09-15', 100);
    RAISE EXCEPTION 'FK aceitou pedido de outro plano';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.cfo_pedidos WHERE id = v_order;
    RAISE EXCEPTION 'Pedido com pagamento foi apagado';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  UPDATE public.cfo_pedidos SET status = 'cancelado' WHERE id = v_order;
  IF NOT EXISTS (SELECT 1 FROM public.cfo_lancamentos WHERE id = v_entry AND status = 'realizado' AND valor_realizado = 95) THEN
    RAISE EXCEPTION 'Cancelamento apagou ou alterou realizado';
  END IF;
  BEGIN
    UPDATE public.cfo_planos SET data_fim = '2028-09-08' WHERE id = v_plan;
    RAISE EXCEPTION 'Plano aceitou mais de dois anos civis';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.cfo_planos SET data_fim = '2026-09-06' WHERE id = v_plan;
    RAISE EXCEPTION 'Plano aceitou datas invertidas';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.cfo_planos SET saldo_inicial = 'NaN'::numeric WHERE id = v_plan;
    RAISE EXCEPTION 'Plano aceitou NaN';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.cfo_planos SET data_inicio = '10000-01-01', data_fim = '10000-12-31' WHERE id = v_plan;
    RAISE EXCEPTION 'Plano aceitou ano acima de 9999';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.cfo_planos SET data_inicio = '9999-01-01', data_fim = '10000-12-31' WHERE id = v_plan;
    RAISE EXCEPTION 'Fim do plano aceitou ano acima de 9999';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.cfo_pedidos SET entrega_em = '10000-01-01' WHERE id = v_order;
    RAISE EXCEPTION 'Pedido aceitou ano acima de 9999';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.cfo_lancamentos SET data_prevista = '10000-01-01' WHERE id = v_entry;
    RAISE EXCEPTION 'Previsão aceitou ano acima de 9999';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.cfo_lancamentos SET data_realizada = '10000-01-01' WHERE id = v_entry;
    RAISE EXCEPTION 'Realizado aceitou ano acima de 9999';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.cfo_pedidos SET entrega_em = '0001-01-01 BC' WHERE id = v_order;
    RAISE EXCEPTION 'Pedido aceitou data antes do ano 1';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.cfo_lancamentos SET valor_previsto = -1 WHERE id = v_entry;
    RAISE EXCEPTION 'Lançamento aceitou valor negativo';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.cfo_lancamentos SET data_realizada = NULL WHERE id = v_entry;
    RAISE EXCEPTION 'Realizado aceitou data ausente';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.cfo_lancamentos SET valor_realizado = NULL WHERE id = v_entry;
    RAISE EXCEPTION 'Realizado aceitou valor ausente';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    -- A segunda linha inválida deve desfazer a primeira na mesma instrução.
    INSERT INTO public.cfo_lancamentos(plano_id, tipo, descricao, data_prevista, valor_previsto)
      VALUES (v_plan, 'despesa', 'Lote atômico', '2026-09-15', 10),
             (v_plan, 'despesa', 'Lote atômico', '2026-09-22', -10);
    RAISE EXCEPTION 'Lote inválido deveria falhar';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.cfo_lancamentos WHERE plano_id = v_plan AND descricao = 'Lote atômico') THEN
    RAISE EXCEPTION 'Lote deixou lançamento parcial';
  END IF;

  RESET ROLE;
  INSERT INTO public.user_permissions(user_id, module, can_view, can_create, can_edit, can_delete)
    VALUES (v_user, '/financeiro', true, false, false, false);
  SET LOCAL ROLE authenticated;
  IF NOT public.can_access_cfo('view') OR public.can_access_cfo('create')
      OR public.can_access_cfo('edit') OR public.can_access_cfo('delete') THEN
    RAISE EXCEPTION 'Permissões de somente leitura não respeitadas';
  END IF;
  SELECT count(*) INTO v_count FROM public.cfo_planos WHERE id = v_plan;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Leitor não consegue ler'; END IF;
  BEGIN
    INSERT INTO public.cfo_planos(nome, data_inicio, data_fim)
      VALUES ('Criação negada', '2026-09-07', '2026-12-15');
    RAISE EXCEPTION 'Leitor conseguiu criar';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE public.cfo_planos SET nome = 'Edição indevida' WHERE id = v_plan;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RAISE EXCEPTION 'Leitor conseguiu editar'; END IF;
  DELETE FROM public.cfo_lancamentos WHERE id = v_entry;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RAISE EXCEPTION 'Leitor conseguiu excluir'; END IF;

  RESET ROLE;
  INSERT INTO public.user_permissions(user_id, module, can_view)
    VALUES (v_user, 'financeiro', true);
  SET LOCAL ROLE authenticated;
  IF public.can_access_cfo('edit') THEN RAISE EXCEPTION 'Módulo ignorou negação explícita do path'; END IF;
  RESET ROLE;
  DELETE FROM public.user_permissions WHERE user_id = v_user AND module = '/financeiro';
  SET LOCAL ROLE authenticated;
  IF NOT public.can_access_cfo('delete') THEN RAISE EXCEPTION 'Grant legado de módulo deveria permitir ação'; END IF;

  RESET ROLE;
  UPDATE public.user_permissions SET module = '/sales' WHERE user_id = v_user;
  SET LOCAL ROLE authenticated;
  IF public.can_access_cfo('view') THEN RAISE EXCEPTION 'Allow-list de outra tela liberou CFO'; END IF;
  SELECT count(*) INTO v_count FROM public.cfo_planos WHERE id = v_plan;
  IF v_count <> 0 THEN RAISE EXCEPTION 'Usuário sem Financeiro leu plano'; END IF;

  RESET ROLE;
  DELETE FROM public.user_permissions WHERE user_id = v_user;
  UPDATE public.user_roles SET role = 'producao' WHERE user_id = v_user;
  SET LOCAL ROLE authenticated;
  IF public.can_access_cfo('view') THEN RAISE EXCEPTION 'Produção sem grant liberou CFO'; END IF;
  RESET ROLE;
  INSERT INTO public.user_permissions(user_id, module, can_view, can_edit)
    VALUES (v_user, '/financeiro', true, true);
  SET LOCAL ROLE authenticated;
  IF NOT public.can_access_cfo('edit') OR public.can_access_cfo('create') THEN
    RAISE EXCEPTION 'Grant explícito de edição não foi respeitado';
  END IF;
  UPDATE public.cfo_planos SET nome = 'Edição permitida' WHERE id = v_plan;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Editor sem create não conseguiu atualizar'; END IF;

  RESET ROLE;
  UPDATE public.user_roles SET role = 'admin' WHERE user_id = v_user;
  SET LOCAL ROLE authenticated;
  IF NOT public.can_access_cfo('create') OR NOT public.can_access_cfo('delete') THEN
    RAISE EXCEPTION 'Admin aprovado não recebeu acesso completo';
  END IF;
  RESET ROLE;
  UPDATE public.profiles SET approved = false WHERE id = v_user;
  SET LOCAL ROLE authenticated;
  IF public.can_access_cfo('view') THEN RAISE EXCEPTION 'Admin não aprovado recebeu acesso'; END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF public.can_access_cfo('view') THEN RAISE EXCEPTION 'Sessão sem usuário recebeu acesso'; END IF;
  RESET ROLE;
  IF has_table_privilege('anon', 'public.cfo_planos', 'SELECT')
      OR has_table_privilege('anon', 'public.cfo_pedidos', 'SELECT')
      OR has_table_privilege('anon', 'public.cfo_lancamentos', 'SELECT') THEN
    RAISE EXCEPTION 'Anon recebeu privilégio de leitura CFO';
  END IF;
END;
$$;
ROLLBACK;
SELECT 'CFO: CRUD, RLS por papel/path/ação, integridade e lote atômico validados; fixtures revertidas.' AS resultado;
