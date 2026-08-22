-- ============================================================================
-- E2E: ficha complexa (todas as etapas) → PV → baixa de estoque → PCP
--
-- Alvo: SP120 (rasteirinha, 6 tiras, solado, palmilha, forro) + I50 (infantil).
-- TRANSAÇÃO ÚNICA COM ROLLBACK GARANTIDO — termina em RAISE EXCEPTION.
-- Nada persiste: PV, OPs, reservas, apontamentos, alteração de setores.
-- Uso: workflow supabase-db-exec.yml com strict=false.
-- ============================================================================
DO $e2e$
DECLARE
  c_sp120 constant uuid := '55a258a9-2578-4a29-ad5b-9b6fa0c168bf';
  c_i50   constant uuid := 'b85ac021-dfad-4f97-868d-1105c3451728';
  c_all_sectors constant jsonb :=
    '["Corte Fibra","Corte Forração","Corte Cabedal","Costura Palmilha","Costura Cabedal","Aviamento","Silk","Colagem","Montagem","Solagem","Acabamento","Expedição"]'::jsonb;
  c_warn text[] := ARRAY['limite_setor_anterior','material_nao_reservado','acima_do_total'];
  v_uid text;
  v_client uuid;
  v_color_sp text;
  v_color_i50 text;
  v_straps_sp jsonb;
  v_straps_i50 jsonb;
  v_size_sp text;
  v_size_i50 text;
  v_grade_sp jsonb;
  v_grade_i50 jsonb;
  v_qty int := 12;
  v_created jsonb;
  v_so uuid;
  v_promo jsonb;
  v_promo2 jsonb;
  v_op_sp uuid;
  v_op_i50 uuid;
  v_point jsonb;
  v_n numeric;
  v_c int;
  v_stage text;
  v_price numeric;
  v_sole uuid;
  v_sole_before numeric;
  v_sole_after numeric;
  v_res_n int;
  v_mv_n int;
  v_ok boolean;
  rep text := '';
  fails int := 0;
BEGIN
  SELECT p.id::text INTO v_uid
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
   WHERE COALESCE(p.approved, false)
     AND ur.role::text IN ('admin', 'gerente', 'comercial')
   ORDER BY CASE ur.role::text WHEN 'admin' THEN 0 WHEN 'gerente' THEN 1 ELSE 2 END, p.created_at
   LIMIT 1;
  IF v_uid IS NULL THEN
    SELECT id::text INTO v_uid FROM public.profiles WHERE COALESCE(approved, false) ORDER BY created_at LIMIT 1;
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'E2E ABORTADO: nenhum perfil aprovado';
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_uid, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  SELECT id INTO v_client FROM public.clients ORDER BY created_at DESC LIMIT 1;
  IF v_client IS NULL THEN
    RAISE EXCEPTION 'E2E ABORTADO: nenhum cliente cadastrado';
  END IF;

  SELECT soi.color INTO v_color_sp
    FROM public.sale_order_items soi
   WHERE soi.reference_id = c_sp120 AND COALESCE(soi.color, '') <> ''
   ORDER BY soi.created_at DESC LIMIT 1;
  IF v_color_sp IS NULL THEN
    SELECT rcv.color INTO v_color_sp
      FROM public.reference_color_variants rcv
     WHERE rcv.reference_id = c_sp120 AND rcv.active
     LIMIT 1;
  END IF;
  IF v_color_sp IS NULL THEN v_color_sp := 'PRETO'; END IF;

  SELECT soi.color INTO v_color_i50
    FROM public.sale_order_items soi
   WHERE soi.reference_id = c_i50 AND COALESCE(soi.color, '') <> ''
   ORDER BY soi.created_at DESC LIMIT 1;
  IF v_color_i50 IS NULL THEN
    SELECT rcv.color INTO v_color_i50
      FROM public.reference_color_variants rcv
     WHERE rcv.reference_id = c_i50 AND rcv.active
     LIMIT 1;
  END IF;
  IF v_color_i50 IS NULL THEN v_color_i50 := v_color_sp; END IF;

  SELECT COALESCE(jsonb_agg(
           CASE WHEN COALESCE(s->>'color', '') = ''
                THEN s || jsonb_build_object('color', v_color_sp)
                ELSE s END
         ), '[]'::jsonb)
    INTO v_straps_sp
    FROM public.technical_sheets ts,
         LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(ts.strap_colors) = 'array' THEN ts.strap_colors ELSE '[]'::jsonb END) s
   WHERE ts.id = c_sp120;

  SELECT COALESCE(jsonb_agg(
           CASE WHEN COALESCE(s->>'color', '') = ''
                THEN s || jsonb_build_object('color', v_color_i50)
                ELSE s END
         ), '[]'::jsonb)
    INTO v_straps_i50
    FROM public.technical_sheets ts,
         LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(ts.strap_colors) = 'array' THEN ts.strap_colors ELSE '[]'::jsonb END) s
   WHERE ts.id = c_i50;

  SELECT kv.key INTO v_size_sp
    FROM public.technical_sheets ts,
         LATERAL jsonb_each_text(COALESCE(ts.upper_consumption_per_size, '{}'::jsonb)) kv
   WHERE ts.id = c_sp120 AND kv.value ~ '^[0-9]+(\.[0-9]+)?$' AND kv.value::numeric > 0
   ORDER BY kv.key LIMIT 1;
  IF v_size_sp IS NULL THEN
    SELECT g.key INTO v_size_sp
      FROM public.sale_order_items soi,
           LATERAL jsonb_each_text(COALESCE(soi.grade, '{}'::jsonb)) g
     WHERE soi.reference_id = c_sp120
       AND COALESCE(NULLIF(g.value, ''), '0')::numeric > 0
     ORDER BY soi.created_at DESC LIMIT 1;
  END IF;
  IF v_size_sp IS NULL THEN v_size_sp := '35'; END IF;
  v_grade_sp := jsonb_build_object(v_size_sp, v_qty);

  SELECT kv.key INTO v_size_i50
    FROM public.technical_sheets ts,
         LATERAL jsonb_each_text(COALESCE(ts.upper_consumption_per_size, '{}'::jsonb)) kv
   WHERE ts.id = c_i50 AND kv.value ~ '^[0-9]+(\.[0-9]+)?$' AND kv.value::numeric > 0
   ORDER BY kv.key LIMIT 1;
  IF v_size_i50 IS NULL THEN
    SELECT g.key INTO v_size_i50
      FROM public.sale_order_items soi,
           LATERAL jsonb_each_text(COALESCE(soi.grade, '{}'::jsonb)) g
     WHERE soi.reference_id = c_i50
       AND COALESCE(NULLIF(g.value, ''), '0')::numeric > 0
     ORDER BY soi.created_at DESC LIMIT 1;
  END IF;
  IF v_size_i50 IS NULL THEN v_size_i50 := '25'; END IF;
  v_grade_i50 := jsonb_build_object(v_size_i50, v_qty);

  SELECT COALESCE(ts.sale_price, 1) INTO v_price FROM public.technical_sheets ts WHERE ts.id = c_sp120;
  IF v_price <= 0 THEN v_price := 1; END IF;

  UPDATE public.technical_sheets
     SET production_sectors = c_all_sectors
   WHERE id IN (c_sp120, c_i50);

  IF (SELECT jsonb_array_length(production_sectors) FROM public.technical_sheets WHERE id = c_sp120) = 12 THEN
    rep := rep || 'OK  1 fichas SP120 e I50 com 12 setores canônicos' || E'\n';
  ELSE
    fails := fails + 1;
    rep := rep || 'FAIL 1 não gravou 12 setores na ficha' || E'\n';
  END IF;
  rep := rep || format('ficha SP120 cor=%s tam=%s tiras=%s | I50 cor=%s tam=%s tiras=%s' || E'\n',
    v_color_sp, v_size_sp, jsonb_array_length(v_straps_sp),
    v_color_i50, v_size_i50, jsonb_array_length(v_straps_i50));

  SELECT rsc.sole_product_id INTO v_sole
    FROM public.resolve_sole_color(c_sp120, v_color_sp) rsc;
  IF v_sole IS NOT NULL THEN
    SELECT COALESCE(p.quantity, 0) INTO v_sole_before FROM public.products p WHERE p.id = v_sole;
    UPDATE public.products SET quantity = GREATEST(COALESCE(quantity, 0), 500)
     WHERE id = v_sole;
    rep := rep || format('OK  1b solado resolvido por ficha/cor: %s (estoque antes=%s)' || E'\n', v_sole, v_sole_before);
  ELSE
    fails := fails + 1;
    rep := rep || format('FAIL 1b resolve_sole_color(%s, %s) retornou NULL' || E'\n', c_sp120, v_color_sp);
  END IF;

  BEGIN
    v_created := public.create_sale_order_atomic(
      jsonb_build_object(
        'client_id', v_client,
        'status', 'Rascunho',
        'notes', 'E2E ficha→PV→PCP — rollback automático',
        'packaging_mode', 'individual_amarrado',
        'nfe_required', false,
        'order_type', 'carteira',
        'total', (v_price * v_qty * 2)
      ),
      jsonb_build_array(
        jsonb_build_object(
          'reference_id', c_sp120,
          'color', v_color_sp,
          'quantity', v_qty,
          'unit_price', v_price,
          'grade', v_grade_sp,
          'fichas', 1,
          'strap_colors', v_straps_sp,
          'observation', 'E2E SP120'
        ),
        jsonb_build_object(
          'reference_id', c_i50,
          'color', v_color_i50,
          'quantity', v_qty,
          'unit_price', v_price,
          'grade', v_grade_i50,
          'fichas', 1,
          'strap_colors', v_straps_i50,
          'observation', 'E2E I50 infantil'
        )
      ),
      gen_random_uuid()
    );
  EXCEPTION WHEN OTHERS THEN
    fails := fails + 1;
    rep := rep || format('FAIL 2 create_sale_order_atomic: %s' || E'\n', SQLERRM);
    RAISE EXCEPTION E'ROLLBACK PROPOSITAL DO E2E\n%', rep;
  END;

  v_so := (v_created->>'order_id')::uuid;
  IF v_so IS NULL THEN
    fails := fails + 1;
    rep := rep || 'FAIL 2 PV sem order_id' || E'\n';
    RAISE EXCEPTION E'ROLLBACK PROPOSITAL DO E2E\n%', rep;
  END IF;

  SELECT count(*) INTO v_c FROM public.sale_order_items WHERE sale_order_id = v_so;
  IF v_c = 2 THEN
    rep := rep || format('OK  2 PV criado %s com 2 itens (replay=%s)' || E'\n',
      v_so, COALESCE(v_created->>'idempotent_replay', 'false'));
  ELSE
    fails := fails + 1;
    rep := rep || format('FAIL 2 PV com %s itens (esperado 2)' || E'\n', v_c);
  END IF;

  SELECT count(*) INTO v_c
    FROM public.sale_order_items soi,
         LATERAL jsonb_array_elements(COALESCE(soi.strap_colors, '[]'::jsonb)) s
   WHERE soi.sale_order_id = v_so
     AND COALESCE(s->>'color', '') = '';
  IF v_c = 0 THEN
    rep := rep || 'OK  2b nenhuma tira sem cor no PV' || E'\n';
  ELSE
    fails := fails + 1;
    rep := rep || format('FAIL 2b %s tiras sem cor' || E'\n', v_c);
  END IF;

  BEGIN
    v_promo := public.promote_sale_order_to_production(v_so, 'Aprovado');
  EXCEPTION WHEN OTHERS THEN
    fails := fails + 1;
    rep := rep || format('FAIL 3 promote Aprovado: %s' || E'\n', SQLERRM);
    RAISE EXCEPTION E'ROLLBACK PROPOSITAL DO E2E\n%', rep;
  END;
  rep := rep || format('promote Aprovado: %s' || E'\n', left(v_promo::text, 800));

  SELECT o.id INTO v_op_sp
    FROM public.orders o
    JOIN public.sale_order_items soi ON soi.id = o.sale_order_item_id
   WHERE o.sale_order_id = v_so AND soi.reference_id = c_sp120
     AND o.status NOT IN ('Cancelada', 'Rascunho')
   ORDER BY o.created_at DESC LIMIT 1;

  SELECT o.id INTO v_op_i50
    FROM public.orders o
    JOIN public.sale_order_items soi ON soi.id = o.sale_order_item_id
   WHERE o.sale_order_id = v_so AND soi.reference_id = c_i50
     AND o.status NOT IN ('Cancelada', 'Rascunho')
   ORDER BY o.created_at DESC LIMIT 1;

  IF v_op_sp IS NOT NULL AND v_op_i50 IS NOT NULL THEN
    rep := rep || format('OK  3 duas OPs: SP120=%s I50=%s' || E'\n', v_op_sp, v_op_i50);
  ELSE
    fails := fails + 1;
    rep := rep || format('FAIL 3 OPs faltando SP120=%s I50=%s' || E'\n', v_op_sp, v_op_i50);
    RAISE EXCEPTION E'ROLLBACK PROPOSITAL DO E2E\n%', rep;
  END IF;

  SELECT count(*) INTO v_c FROM public.order_stages WHERE order_id = v_op_sp;
  IF v_c = 12 THEN
    rep := rep || 'OK  3b OP SP120 nasceu com 12 estágios' || E'\n';
  ELSE
    fails := fails + 1;
    rep := rep || format('FAIL 3b OP SP120 tem %s estágios: %s' || E'\n', v_c,
      (SELECT string_agg(stage_name, ', ' ORDER BY stage_order) FROM public.order_stages WHERE order_id = v_op_sp));
  END IF;

  SELECT count(*) INTO v_res_n FROM public.material_reservations WHERE order_id = v_op_sp;
  SELECT count(*) INTO v_mv_n FROM public.stock_movements WHERE order_id = v_op_sp;
  IF v_res_n > 0 THEN
    rep := rep || format('OK  3c SP120 reservas=%s movimentos=%s' || E'\n', v_res_n, v_mv_n);
  ELSE
    fails := fails + 1;
    rep := rep || format('FAIL 3c SP120 sem reservas (mov=%s)' || E'\n', v_mv_n);
  END IF;

  SELECT count(*), COALESCE(SUM(quantity_reserved), 0)
    INTO v_c, v_n
    FROM public.material_reservations
   WHERE order_id = v_op_sp
     AND metadata->>'kind' IN ('sole_grade', 'sole_pending_grade')
     AND (v_sole IS NULL OR product_id = v_sole);
  IF v_c >= 1 AND v_n > 0 THEN
    rep := rep || format('OK  3d solado debitado/reservado: %s reserva(s) qty=%s kind=%s' || E'\n',
      v_c, v_n,
      (SELECT string_agg(DISTINCT metadata->>'kind', ',') FROM public.material_reservations
        WHERE order_id = v_op_sp AND metadata->>'kind' LIKE 'sole%'));
  ELSE
    fails := fails + 1;
    rep := rep || format('FAIL 3d solado NÃO baixou (count=%s qty=%s sole=%s) — furo silencioso?' || E'\n', v_c, v_n, v_sole);
  END IF;

  SELECT count(*) INTO v_c
    FROM public.material_reservations mr
    JOIN public.products p ON p.id = mr.product_id
   WHERE mr.order_id = v_op_sp
     AND (mr.metadata->>'kind' ILIKE '%strap%'
          OR lower(COALESCE(p.category, '')) LIKE '%tira%');
  IF jsonb_array_length(v_straps_sp) > 0 AND v_c = 0 THEN
    fails := fails + 1;
    rep := rep || 'FAIL 3e ficha tem tiras mas OP não reservou tira' || E'\n';
  ELSE
    rep := rep || format('OK  3e reservas de tira=%s (ficha tem %s linhas)' || E'\n',
      v_c, jsonb_array_length(v_straps_sp));
  END IF;

  rep := rep || format('reservas SP120: %s' || E'\n',
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'p', left(p.name, 40), 'q', mr.quantity_reserved, 'st', mr.status, 'k', mr.metadata->>'kind'
      ) ORDER BY mr.quantity_reserved DESC), '[]'::jsonb)
       FROM public.material_reservations mr
       JOIN public.products p ON p.id = mr.product_id
      WHERE mr.order_id = v_op_sp)::text);

  BEGIN
    v_promo2 := public.promote_sale_order_to_production(v_so, 'Em Produção');
  EXCEPTION WHEN OTHERS THEN
    fails := fails + 1;
    rep := rep || format('FAIL 4 promote Em Produção: %s' || E'\n', SQLERRM);
    RAISE EXCEPTION E'ROLLBACK PROPOSITAL DO E2E\n%', rep;
  END;

  IF EXISTS (SELECT 1 FROM public.orders WHERE id = v_op_sp AND status = 'Em Produção') THEN
    rep := rep || 'OK  4 OP SP120 em produção' || E'\n';
  ELSE
    fails := fails + 1;
    rep := rep || format('FAIL 4 status OP SP120=%s' || E'\n',
      (SELECT status FROM public.orders WHERE id = v_op_sp));
  END IF;

  FOREACH v_stage IN ARRAY ARRAY[
    'Corte Fibra','Corte Forração','Corte Cabedal',
    'Costura Palmilha','Costura Cabedal',
    'Aviamento','Silk','Colagem','Montagem','Solagem','Acabamento','Expedição'
  ]
  LOOP
    BEGIN
      v_point := public.apontar_producao_setor(v_op_sp, v_stage, v_qty, NULL, 'E2E full', true, c_warn);
      v_ok := COALESCE((v_point->>'success')::boolean, false);
      IF v_ok AND COALESCE((v_point->>'finalized')::boolean, false)
         AND COALESCE((v_point->>'quantity_processed')::int, 0) = v_qty THEN
        rep := rep || format('OK  5 %s apontou %s e finalizou' || E'\n', v_stage, v_qty);
      ELSIF COALESCE((v_point->>'needs_confirmation')::boolean, false) THEN
        fails := fails + 1;
        rep := rep || format('FAIL 5 %s pediu confirmação mesmo com warnings: %s' || E'\n', v_stage, v_point::text);
      ELSE
        fails := fails + 1;
        rep := rep || format('FAIL 5 %s → %s' || E'\n', v_stage, left(v_point::text, 300));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      fails := fails + 1;
      rep := rep || format('FAIL 5 %s EXCEPTION %s' || E'\n', v_stage, SQLERRM);
    END;
  END LOOP;

  SELECT count(*) FILTER (WHERE status = 'concluido' AND quantity_processed >= v_qty)
    INTO v_c FROM public.order_stages WHERE order_id = v_op_sp;
  IF v_c = 12 THEN
    rep := rep || 'OK  5z SP120: 12/12 setores concluídos com 12 pares' || E'\n';
  ELSE
    fails := fails + 1;
    rep := rep || format('FAIL 5z SP120 só %s/12 concluídos. estados=%s' || E'\n', v_c,
      (SELECT jsonb_agg(jsonb_build_object('s', stage_name, 'st', status, 'q', quantity_processed) ORDER BY stage_order)
         FROM public.order_stages WHERE order_id = v_op_sp)::text);
  END IF;

  FOREACH v_stage IN ARRAY ARRAY['Corte Fibra','Corte Forração','Corte Cabedal','Costura Palmilha','Costura Cabedal','Aviamento']
  LOOP
    BEGIN
      v_point := public.apontar_producao_setor(v_op_i50, v_stage, 4, NULL, 'E2E partial', true, c_warn);
      IF COALESCE((v_point->>'success')::boolean, false) THEN
        rep := rep || format('OK  6 %s I50 apontou 4' || E'\n', v_stage);
      ELSE
        fails := fails + 1;
        rep := rep || format('FAIL 6 %s I50 → %s' || E'\n', v_stage, left(v_point::text, 220));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      fails := fails + 1;
      rep := rep || format('FAIL 6 %s I50 EXCEPTION %s' || E'\n', v_stage, SQLERRM);
    END;
  END LOOP;

  FOREACH v_stage IN ARRAY ARRAY['Silk', 'Colagem']
  LOOP
    BEGIN
      v_point := public.apontar_producao_setor(v_op_i50, v_stage, 0, NULL, 'E2E skip', true, c_warn);
      IF COALESCE((v_point->>'success')::boolean, false)
         AND COALESCE((v_point->>'quantity_processed')::int, -1) = 0 THEN
        rep := rep || format('OK  6b pulou %s (0 pares, concluído)' || E'\n', v_stage);
      ELSE
        fails := fails + 1;
        rep := rep || format('FAIL 6b pular %s → %s' || E'\n', v_stage, left(v_point::text, 220));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      fails := fails + 1;
      rep := rep || format('FAIL 6b pular %s EXCEPTION %s' || E'\n', v_stage, SQLERRM);
    END;
  END LOOP;

  BEGIN
    v_point := public.apontar_producao_setor(
      v_op_i50, 'Montagem', 12, NULL, 'E2E montagem após skip', false, NULL);
    IF COALESCE((v_point->>'needs_confirmation')::boolean, false)
       AND v_point::text ILIKE '%limite_setor_anterior%' THEN
      rep := rep || format('OK  6c Montagem 12 após skip Colagem pediu confirmação (inbound real). warn=%s' || E'\n',
        left(v_point->>'warnings', 240));
    ELSIF COALESCE((v_point->>'success')::boolean, false)
          AND COALESCE((v_point->>'quantity_processed')::int, 0) >= 12 THEN
      fails := fails + 1;
      rep := rep || 'FAIL 6c Montagem aceitou 12 após skip de Colagem — pulo ainda entrega o total da OP' || E'\n';
    ELSE
      rep := rep || format('OK  6c Montagem NÃO passou 12 após skip. resp=%s' || E'\n', left(v_point::text, 280));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    rep := rep || format('OK  6c Montagem recusou 12 (exception %s)' || E'\n', SQLERRM);
  END;

  BEGIN
    v_point := public.apontar_producao_setor(v_op_i50, 'Montagem', 4, NULL, 'E2E inbound 4', true, c_warn);
    IF COALESCE((v_point->>'success')::boolean, false)
       AND COALESCE((v_point->>'quantity_processed')::int, 0) = 4 THEN
      rep := rep || 'OK  6d Montagem apontou os 4 do inbound real' || E'\n';
    ELSE
      fails := fails + 1;
      rep := rep || format('FAIL 6d Montagem 4 → %s' || E'\n', left(v_point::text, 280));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    fails := fails + 1;
    rep := rep || format('FAIL 6d Montagem 4 EXCEPTION %s' || E'\n', SQLERRM);
  END;

  IF fails = 0 THEN
    rep := E'\n===== E2E VERDE (ficha → PV → estoque → PCP) =====\n' || rep;
  ELSE
    rep := format(E'\n===== E2E FALHOU (%s checagens) =====\n', fails) || rep;
  END IF;
  RAISE EXCEPTION E'ROLLBACK PROPOSITAL DO E2E — nada persistiu.\n%', rep;
END;
$e2e$;
