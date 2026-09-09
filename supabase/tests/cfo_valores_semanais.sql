-- Teste transacional: nenhuma semana nem usuário sintético fica persistido.
BEGIN;
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_plan uuid;
  v_other_plan uuid;
  v_week uuid;
  v_count integer;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_user, 'cfo-rollback-week-' || v_user || '@example.invalid');
  INSERT INTO public.user_roles(user_id, role) VALUES (v_user, 'admin');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  UPDATE public.profiles SET approved = true WHERE id = v_user;
  UPDATE public.user_roles SET role = 'consulta' WHERE user_id = v_user;
  SET LOCAL ROLE authenticated;

  INSERT INTO public.cfo_planos(nome, data_inicio, data_fim)
    VALUES ('Semanas teste rollback', '2026-09-07', '2026-12-15') RETURNING id INTO v_plan;
  INSERT INTO public.cfo_planos(nome, data_inicio, data_fim)
    VALUES ('Outro plano semanal rollback', '2026-09-07', '2026-12-15') RETURNING id INTO v_other_plan;
  INSERT INTO public.cfo_semanas(plano_id, semana_inicio, contas_semana, reinvestimento, pares_produzidos)
    VALUES (v_plan, '2026-09-07', 0, 0, NULL) RETURNING id INTO v_week;
  IF NOT EXISTS (SELECT 1 FROM public.cfo_semanas WHERE id = v_week AND contas_semana = 0
      AND reinvestimento = 0 AND pares_produzidos IS NULL) THEN
    RAISE EXCEPTION 'Zero explícito e produção desconhecida não foram preservados';
  END IF;
  INSERT INTO public.cfo_semanas(plano_id, semana_inicio, contas_semana, reinvestimento, pares_produzidos)
    VALUES (v_other_plan, '2026-09-07', 10, 20, 0);
  UPDATE public.cfo_semanas SET contas_semana = 3200.50, reinvestimento = 1000, pares_produzidos = 2147483647 WHERE id = v_week;
  IF NOT EXISTS (SELECT 1 FROM public.cfo_semanas WHERE id = v_week AND contas_semana = 3200.50
      AND reinvestimento = 1000 AND pares_produzidos = 2147483647) THEN
    RAISE EXCEPTION 'Edição dos dados semanais não persistiu';
  END IF;
  BEGIN
    INSERT INTO public.cfo_semanas(plano_id, semana_inicio, contas_semana, reinvestimento)
      VALUES (v_plan, '2026-09-07', 1, 1);
    RAISE EXCEPTION 'A mesma semana duplicou dentro do plano';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.cfo_semanas(plano_id, semana_inicio, reinvestimento)
      VALUES (v_plan, '2026-09-14', 0);
    RAISE EXCEPTION 'Contas ausentes foram transformadas em zero';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.cfo_semanas(plano_id, semana_inicio, contas_semana)
      VALUES (v_plan, '2026-09-14', 0);
    RAISE EXCEPTION 'Reinvestimento ausente foi transformado em zero';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.cfo_semanas SET contas_semana = NULL WHERE id = v_week;
    RAISE EXCEPTION 'Contas aceitaram NULL';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.cfo_semanas SET contas_semana = -1 WHERE id = v_week;
    RAISE EXCEPTION 'Contas aceitaram negativo';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.cfo_semanas SET reinvestimento = -1 WHERE id = v_week;
    RAISE EXCEPTION 'Reinvestimento aceitou negativo';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.cfo_semanas SET contas_semana = 'NaN'::numeric WHERE id = v_week;
    RAISE EXCEPTION 'Contas aceitaram NaN';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.cfo_semanas SET reinvestimento = 'NaN'::numeric WHERE id = v_week;
    RAISE EXCEPTION 'Reinvestimento aceitou NaN';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.cfo_semanas SET reinvestimento = 'Infinity'::numeric WHERE id = v_week;
    RAISE EXCEPTION 'Reinvestimento aceitou infinito';
  EXCEPTION WHEN numeric_value_out_of_range OR check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.cfo_semanas SET pares_produzidos = -1 WHERE id = v_week;
    RAISE EXCEPTION 'Produção aceitou negativo';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.cfo_semanas SET pares_produzidos = 2147483648 WHERE id = v_week;
    RAISE EXCEPTION 'Produção aceitou acima do limite';
  EXCEPTION WHEN numeric_value_out_of_range THEN NULL;
  END;
  BEGIN
    UPDATE public.cfo_semanas SET semana_inicio = '2026-09-08' WHERE id = v_week;
    RAISE EXCEPTION 'Semana aceitou terça-feira';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.cfo_semanas SET semana_inicio = '10000-01-03' WHERE id = v_week;
    RAISE EXCEPTION 'Semana aceitou ano de cinco dígitos';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.cfo_semanas SET semana_inicio = 'infinity'::date WHERE id = v_week;
    RAISE EXCEPTION 'Semana aceitou data infinita';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.cfo_semanas(plano_id, semana_inicio, contas_semana, reinvestimento)
      VALUES (gen_random_uuid(), '2026-09-14', 0, 0);
    RAISE EXCEPTION 'Semana aceitou plano inexistente';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.cfo_planos WHERE id = v_plan;
    RAISE EXCEPTION 'Plano com dados semanais foi excluído';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  RESET ROLE;
  INSERT INTO public.user_permissions(user_id, module, can_view, can_create, can_edit, can_delete)
    VALUES (v_user, '/financeiro', true, false, false, false);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.cfo_semanas WHERE id = v_week;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Leitor não consegue ver semana'; END IF;
  BEGIN
    INSERT INTO public.cfo_semanas(plano_id, semana_inicio, contas_semana, reinvestimento)
      VALUES (v_plan, '2026-09-14', 0, 0);
    RAISE EXCEPTION 'Leitor conseguiu criar semana';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE public.cfo_semanas SET contas_semana = 1 WHERE id = v_week;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RAISE EXCEPTION 'Leitor conseguiu editar semana'; END IF;
  DELETE FROM public.cfo_semanas WHERE id = v_week;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RAISE EXCEPTION 'Leitor conseguiu excluir semana'; END IF;
  RESET ROLE;
  UPDATE public.user_permissions SET can_edit = true WHERE user_id = v_user;
  SET LOCAL ROLE authenticated;
  UPDATE public.cfo_semanas SET contas_semana = 100, reinvestimento = 50, pares_produzidos = 0 WHERE id = v_week;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Editor sem criação não conseguiu editar semana'; END IF;
  RESET ROLE;
  UPDATE public.user_permissions SET module = '/sales' WHERE user_id = v_user;
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.cfo_semanas WHERE id = v_week;
  IF v_count <> 0 THEN RAISE EXCEPTION 'Permissão de outra tela expôs semana CFO'; END IF;
  RESET ROLE;
  UPDATE public.user_roles SET role = 'admin' WHERE user_id = v_user;
  UPDATE public.profiles SET approved = false WHERE id = v_user;
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.cfo_semanas WHERE id = v_week;
  IF v_count <> 0 THEN RAISE EXCEPTION 'Usuário não aprovado leu semana'; END IF;
  RESET ROLE;
  IF has_table_privilege('anon', 'public.cfo_semanas', 'SELECT') THEN
    RAISE EXCEPTION 'Anônimo tem privilégio sobre semanas';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name = 'cfo_semanas' AND column_name IN ('contas_semana', 'reinvestimento')
      AND column_default IS NOT NULL) THEN
    RAISE EXCEPTION 'Valores financeiros possuem DEFAULT';
  END IF;
END;
$$;
ROLLBACK;
SELECT 'CFO semanal: campos obrigatórios, zero/NULL, dinheiro, calendário, unicidade, FK e RLS validados; fixtures revertidas.' AS resultado;
