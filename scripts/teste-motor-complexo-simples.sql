-- ════════════════════════════════════════════════════════════════════════════
-- Teste do motor de produção: cabedal complexo + cabedal simples no mesmo PV.
--
-- NADA FICA GRAVADO. Tudo roda num único bloco DO que termina com
-- RAISE EXCEPTION 'ENSAIO_ROLLBACK ...' — o Postgres desfaz a transação
-- inteira e o resultado volta no texto do erro.
--
-- A única coisa que o rollback NÃO desfaz são as sequências (nextval).
-- O bloco guarda o valor de cada sequência de numeração no início e, no fim,
-- devolve a sequência ao valor de antes SE o avanço foi só deste ensaio
-- (avanço == linhas criadas nesta transação). Se outra sessão gerou número no
-- meio, a sequência fica como está e o resultado avisa ("nao_restaurada").
--
-- Como usar (SQL editor do Supabase ou MCP execute_sql):
--   1. Ajuste c_secao abaixo: 'resumo' | 'fila' | 'cronograma' | 'motor' | 'fase2'
--   2. Rode o arquivo inteiro. O erro "ENSAIO_ROLLBACK {...}" É o resultado.
--   3. Confira depois: contagem de PVs/OPs/OCs/reservas igual à de antes.
--
-- Cenário (editar em _ens_cen):
--   PV-ENSAIO-A  programado  2026-12-S4 (21/12)  SP143 complexo 3 cores + INL01 simples 2 cores
--   PV-ENSAIO-B  programado  2026-12-S3 (14/12)  INL01 simples 2 cores (fatura antes → caixa)
--   PV-ENSAIO-C  urgente     2026-12-S5 (28/12)  SP143 complexo + INL01 simples
--   PV-ENSAIO-D  programado  2026-12-S5 (28/12)  INL01 simples (fatura DEPOIS do A → deve vir depois do A)
-- Grade: copia a grade do último item real da mesma ref/cor (fichas de 12).
-- Cabeçalho: copia o PV modelo (c_modelo_pv) e troca número, semana e prazo.
--
-- Liga auto_motor_enabled SÓ dentro da transação, para simular. Não gera OC
-- real (as funções de OC do motor não são chamadas), não fatura, não emite NF.
-- Não toca PV-00249/00250/00251 nem LOTE-00004 (só leitura da fila).
-- ════════════════════════════════════════════════════════════════════════════
DO $ensaio$
DECLARE
  c_secao     text := 'resumo';
  c_modelo_pv text := 'PV-00255';
  v_user uuid;
  v_tpl  jsonb;
  v_seq0 jsonb;
  v_pv   record;
  v_res  jsonb;
  v_so   uuid;
  v_ver  bigint;
  v_items jsonb;
  v_ids  uuid[] := ARRAY[]::uuid[];
  v_log  jsonb := '{}'::jsonb;
  v_out  jsonb := '{}'::jsonb;
  v_snap jsonb;
  v_seq_off jsonb; v_seq_on jsonb;
  v_sched1 jsonb; v_sched2 jsonb;
  v_restore jsonb := '{}'::jsonb;
  r record;
  v_now bigint; v_ours bigint;
BEGIN
  PERFORM set_config('statement_timeout', '600s', true);

  -- Autor simulado: o usuário aprovado que mais recentemente rodou comando de PV
  -- (as trilhas de auditoria exigem auth.uid()). Só vale dentro desta transação.
  SELECT r2.actor_id INTO v_user
    FROM sale_order_command_receipts r2
    JOIN profiles p ON p.id = r2.actor_id AND p.approved
   ORDER BY r2.created_at DESC LIMIT 1;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'service_role')::text, true);

  SELECT jsonb_object_agg(sequencename, last_value) INTO v_seq0
    FROM pg_sequences
   WHERE schemaname = 'public'
     AND sequencename IN ('pv_number_seq','op_number_seq','oc_number_seq','so_number_seq','atelier_lot_number_seq','atelier_service_number_seq');

  CREATE TEMP TABLE _ens_cen (pv text, tipo text, bw text, dd date, ref uuid, color text, pares int) ON COMMIT DROP;
  INSERT INTO _ens_cen VALUES
    ('PV-ENSAIO-A','programado','2026-12-S4','2026-12-21','e5263807-0dcc-41fa-9c44-58a9f5b2a8db','NATURAL',360),
    ('PV-ENSAIO-A','programado','2026-12-S4','2026-12-21','e5263807-0dcc-41fa-9c44-58a9f5b2a8db','OFF WHITE',240),
    ('PV-ENSAIO-A','programado','2026-12-S4','2026-12-21','e5263807-0dcc-41fa-9c44-58a9f5b2a8db','ROCHA',144),
    ('PV-ENSAIO-A','programado','2026-12-S4','2026-12-21','989fd2d7-cb19-4194-a5c1-d87f3cadc6cb','OFF WHITE',480),
    ('PV-ENSAIO-A','programado','2026-12-S4','2026-12-21','989fd2d7-cb19-4194-a5c1-d87f3cadc6cb','ROSADO',300),
    ('PV-ENSAIO-B','programado','2026-12-S3','2026-12-14','989fd2d7-cb19-4194-a5c1-d87f3cadc6cb','ROSADO',240),
    ('PV-ENSAIO-B','programado','2026-12-S3','2026-12-14','989fd2d7-cb19-4194-a5c1-d87f3cadc6cb','OFF WHITE',120),
    ('PV-ENSAIO-C','urgente',   '2026-12-S5','2026-12-28','e5263807-0dcc-41fa-9c44-58a9f5b2a8db','OFF WHITE',120),
    ('PV-ENSAIO-C','urgente',   '2026-12-S5','2026-12-28','989fd2d7-cb19-4194-a5c1-d87f3cadc6cb','ROSADO',120),
    ('PV-ENSAIO-D','programado','2026-12-S5','2026-12-28','989fd2d7-cb19-4194-a5c1-d87f3cadc6cb','OFF WHITE',240);

  SELECT to_jsonb(so) - ARRAY['id','nfe','order_number','status','created_at','updated_at','deleted_at','notes','total',
         'client_request_id','order_version','command_error','command_phase','command_job_id','command_started_at',
         'command_target_status','client_request_item_count','client_request_payload_hash','search_norm',
         'external_nfe_number','shipped_at','costs_dirty_at','reservations_outdated_at','picking_individually_done_at',
         'client_signature_at','client_signature_data_url','nfe_first_due_date','scheduled_dispatch_at','checked_by']
    INTO v_tpl FROM sale_orders so WHERE so.order_number = c_modelo_pv;

  BEGIN  -- bloco principal: qualquer erro aqui vira resultado, e as sequências ainda são devolvidas
  -- ── 1. Criar e aprovar (comandos oficiais) ───────────────────────────────
  FOR v_pv IN SELECT DISTINCT pv, tipo, bw, dd FROM _ens_cen ORDER BY pv LOOP
    SELECT jsonb_agg((to_jsonb(soi) - ARRAY['id','sale_order_id','created_at'])
                     || jsonb_build_object('quantity', c.pares, 'fichas', c.pares / 12))
      INTO v_items
      FROM _ens_cen c
      CROSS JOIN LATERAL (
        SELECT * FROM sale_order_items s
         WHERE s.reference_id = c.ref AND s.color = c.color
         ORDER BY s.created_at DESC LIMIT 1) soi
     WHERE c.pv = v_pv.pv;
    v_res := public.create_sale_order_command(
      v_tpl || jsonb_build_object(
        'order_number', v_pv.pv, 'order_type', v_pv.tipo, 'billing_week', v_pv.bw,
        'delivery_month', left(v_pv.bw, 7), 'delivery_week', substr(v_pv.bw, 9),
        'delivery_deadline', v_pv.dd, 'manual_billing_override', false,
        'manual_override_reason', null, 'original_min_billing_date', null,
        'client_order_number', 'ENSAIO-MOTOR', 'notes', 'ENSAIO rollback'),
      v_items, 'ensaio:create:' || gen_random_uuid(), gen_random_uuid());
    v_so := NULLIF(v_res ->> 'sale_order_id', '')::uuid;
    IF v_so IS NULL THEN
      RAISE EXCEPTION 'ENSAIO_ROLLBACK create % falhou: %', v_pv.pv, left(v_res::text, 2000);
    END IF;
    v_ids := v_ids || v_so;
    SELECT order_version INTO v_ver FROM sale_orders WHERE id = v_so;
    v_res := public.execute_sale_order_command(v_so, 'confirm', v_ver, 'ensaio:confirm:' || gen_random_uuid(), '{}'::jsonb, NULL);
    v_log := v_log || jsonb_build_object(v_pv.pv || '_confirm',
      jsonb_build_object('ok', v_res -> 'ok', 'status', v_res #> '{result,status}',
                         'erro', v_res -> 'error',
                         'ops', jsonb_array_length(COALESCE(v_res #> '{result,ops}', '[]'::jsonb))));
    -- Tentativa de ir para Em Produção (a regra nova deve recusar enquanto o cabedal está fora)
    BEGIN
      SELECT order_version INTO v_ver FROM sale_orders WHERE id = v_so;
      v_res := public.execute_sale_order_command(v_so, 'promote', v_ver, 'ensaio:promote:' || gen_random_uuid(), '{}'::jsonb, NULL);
      v_log := v_log || jsonb_build_object(v_pv.pv || '_promote',
        jsonb_build_object('ok', v_res -> 'ok', 'status', (SELECT status FROM sale_orders WHERE id = v_so),
                           'erro', left(COALESCE(v_res #>> '{error,message}', ''), 300)));
    EXCEPTION WHEN others THEN
      v_log := v_log || jsonb_build_object(v_pv.pv || '_promote', 'recusado: ' || left(SQLERRM, 300));
    END;
  END LOOP;

  -- ── 2. Motor ligado SÓ nesta transação ───────────────────────────────────
  v_seq_off := (SELECT jsonb_agg(jsonb_build_object('pos', s.sequence_position, 'op', s.order_number,
                  'pv', so.order_number, 'ref', s.reference_code, 'cor', s.color, 'due', s.due_date,
                  'score', round(s.close_score, 2), 'trava', s.block_reason) ORDER BY s.sequence_position)
                  FROM public.list_production_sequence() s LEFT JOIN sale_orders so ON so.id = s.sale_order_id);
  UPDATE atelier_settings SET auto_motor_enabled = true WHERE id = 1;
  v_snap := public.list_cabedal_motor_purchase_snapshot();
  v_seq_on := (SELECT jsonb_agg(jsonb_build_object('pos', s.sequence_position, 'op', s.order_number,
                  'pv', so.order_number, 'ref', s.reference_code, 'cor', s.color, 'due', s.due_date,
                  'score', round(s.close_score, 2), 'trava', s.block_reason) ORDER BY s.sequence_position)
                  FROM public.list_production_sequence() s LEFT JOIN sale_orders so ON so.id = s.sale_order_id);

  -- ── 3. Agenda de capacidade (finita, setor × dia) ────────────────────────
  -- (recompute 2× na mesma transação colide na chave idempotente da fila de
  --  tiras; por isso a fase 2 só recalcula depois do retorno simulado)
  IF c_secao <> 'fase2' THEN
    PERFORM public.recompute_production_schedule('ensaio');
  END IF;
  v_sched1 := (
    SELECT jsonb_agg(x ORDER BY x->>'pv', x->>'op', (x->>'flow')::int)
      FROM (
        SELECT jsonb_build_object('pv', so.order_number, 'op', o.order_number, 'ref', COALESCE(NULLIF(ts.code,''), ts.name),
                 'cor', o.color, 'setor', ps.sector, 'flow', ss.flow_order,
                 'de', min(ps.date), 'ate', max(ps.date), 'pares', sum(ps.planned_pairs),
                 'semanas', jsonb_object_agg(to_char(ps.date, 'DD/MM'), ps.planned_pairs)) x
          FROM production_schedule ps
          JOIN orders o ON o.id = ps.order_id
          LEFT JOIN sale_orders so ON so.id = o.sale_order_id
          LEFT JOIN technical_sheets ts ON ts.id = o.reference_id
          LEFT JOIN sector_settings ss ON ss.sector = ps.sector
         WHERE ps.recalc_run_id = public.latest_schedule_run_id()
         GROUP BY so.order_number, o.order_number, ts.code, ts.name, o.color, ps.sector, ss.flow_order) z);

  -- ── 4. Fase 2: simula o retorno do prestador e promove ───────────────────
  IF c_secao = 'fase2' THEN
    BEGIN
      UPDATE cabedal_prep_jobs
         SET pipeline_status = 'received_at_factory', received_pairs = pairs,
             cut_at = COALESCE(cut_at, now()), sent_at = COALESCE(sent_at, now()),
             received_at = now(), updated_at = now()
       WHERE sale_order_id = ANY (v_ids) AND pipeline_status <> 'cancelled';
      v_log := v_log || jsonb_build_object('fase2_retorno', 'ok');
    EXCEPTION WHEN others THEN
      v_log := v_log || jsonb_build_object('fase2_retorno', left(SQLERRM, 300));
    END;
    FOR v_so IN SELECT unnest(v_ids) LOOP
      BEGIN
        SELECT order_version INTO v_ver FROM sale_orders WHERE id = v_so;
        v_res := public.execute_sale_order_command(v_so, 'promote', v_ver, 'ensaio:promote2:' || gen_random_uuid(), '{}'::jsonb, NULL);
        v_log := v_log || jsonb_build_object((SELECT order_number FROM sale_orders WHERE id = v_so) || '_promote2',
          jsonb_build_object('ok', v_res -> 'ok', 'status', (SELECT status FROM sale_orders WHERE id = v_so),
                             'erro', left(COALESCE(v_res #>> '{error,message}', ''), 300)));
      EXCEPTION WHEN others THEN
        v_log := v_log || jsonb_build_object(v_so::text || '_promote2', 'recusado: ' || left(SQLERRM, 300));
      END;
    END LOOP;
    PERFORM public.recompute_production_schedule('ensaio');
    v_sched2 := (
      SELECT jsonb_agg(x ORDER BY x->>'pv', x->>'op', (x->>'flow')::int)
        FROM (
          SELECT jsonb_build_object('pv', so.order_number, 'op', o.order_number, 'ref', COALESCE(NULLIF(ts.code,''), ts.name),
                   'cor', o.color, 'setor', ps.sector, 'flow', ss.flow_order,
                   'de', min(ps.date), 'ate', max(ps.date), 'pares', sum(ps.planned_pairs)) x
            FROM production_schedule ps
            JOIN orders o ON o.id = ps.order_id
            LEFT JOIN sale_orders so ON so.id = o.sale_order_id
            LEFT JOIN technical_sheets ts ON ts.id = o.reference_id
            LEFT JOIN sector_settings ss ON ss.sector = ps.sector
           WHERE ps.recalc_run_id = public.latest_schedule_run_id()
             AND ps.sector IN ('Corte Cabedal','Palmilha · Fibra','Costura Cabedal','Aviamento','Montagem','Expedição')
           GROUP BY so.order_number, o.order_number, ts.code, ts.name, o.color, ps.sector, ss.flow_order) z);
  END IF;

  -- ── 5. Montar a saída da seção pedida ────────────────────────────────────
  IF c_secao = 'resumo' THEN
    v_out := jsonb_build_object(
      'log', v_log,
      'pvs', (SELECT jsonb_agg(jsonb_build_object('pv', so.order_number, 'tipo', so.order_type, 'status', so.status,
                'semana', so.billing_week, 'ancora', public.cabedal_prep_billing_start(so.billing_week),
                'total', so.total,
                'itens', (SELECT jsonb_agg(COALESCE(NULLIF(ts.code,''), ts.name) || ' ' || soi.color || ' ' || soi.quantity
                                           || ' (' || (SELECT sum(v::int) FROM jsonb_each_text(soi.grade) g(k, v)) || '/ficha)')
                            FROM sale_order_items soi LEFT JOIN technical_sheets ts ON ts.id = soi.reference_id
                           WHERE soi.sale_order_id = so.id)) ORDER BY so.order_number)
                FROM sale_orders so WHERE so.id = ANY (v_ids)),
      'ops', (SELECT jsonb_agg(o.order_number || ' ' || so.order_number || ' ' || COALESCE(NULLIF(ts.code,''), ts.name) || ' ' || o.color
                               || ' ' || o.quantity || ' ' || o.status || ' inicio_plan=' || COALESCE(o.planned_start::text, '-')
                               || ' fila=' || COALESCE(q.status, 'fora') ORDER BY o.order_number)
                FROM orders o JOIN sale_orders so ON so.id = o.sale_order_id
                LEFT JOIN technical_sheets ts ON ts.id = o.reference_id
                LEFT JOIN production_queue q ON q.order_id = o.id
               WHERE o.sale_order_id = ANY (v_ids)),
      'jobs_ateliê', (SELECT jsonb_agg(jsonb_build_object('pv', so.order_number, 'setor', j.sector, 'cor', j.color, 'pares', j.pairs,
                       'status', j.pipeline_status, 'pronto', d.ready_date, 'inicio_alvo', j.target_start, 'fim_alvo', j.target_end,
                       'dias_montagem', d.assembly_days, 'trava_corte', public.atelier_cut_block_reason(j.id))
                       ORDER BY so.order_number, j.color, j.sector)
                FROM cabedal_prep_jobs j JOIN sale_orders so ON so.id = j.sale_order_id
                LEFT JOIN cabedal_prep_demands d ON d.id = j.demand_id
               WHERE j.sale_order_id = ANY (v_ids)),
      'faltas', (SELECT jsonb_agg(f ORDER BY f->>'pv', f->>'material') FROM (
                SELECT jsonb_build_object('pv', so.order_number, 'material', p.name, 'reservado', round(sum(mr.quantity_reserved), 2),
                    'falta', round(sum(COALESCE(mr.quantity_short, 0)), 2), 'un', p.unit, 'lead', p.supplier_lead_time_days) f
                FROM material_reservations mr
                JOIN products p ON p.id = mr.product_id
                LEFT JOIN orders o ON o.id = mr.order_id
                JOIN sale_orders so ON so.id = COALESCE(mr.sale_order_id, o.sale_order_id)
               WHERE so.id = ANY (v_ids) AND mr.status NOT IN ('cancelled')
               GROUP BY so.order_number, p.name, p.unit, p.supplier_lead_time_days) ff),
      'ocs_novas_na_transacao', (SELECT jsonb_agg(po.order_number || ' ' || po.status) FROM purchase_orders po WHERE po.created_at = now()),
      'gestao', (SELECT jsonb_agg(jsonb_build_object('op', v.order_number, 'pv', v.sale_order_number, 'pos', v.queue_position,
                    'restante', v.remaining_pairs_net, 'previsto', v.projected_completion, 'atraso', v.late_days, 'due', v.due_date) ORDER BY v.queue_position)
                FROM v_production_queue_detail v WHERE v.sale_order_id = ANY (v_ids)));
  ELSIF c_secao = 'fila' THEN
    v_out := jsonb_build_object('log', v_log, 'fila_motor_desligado', v_seq_off, 'fila_motor_ligado', v_seq_on,
      'fila_corte_ateliê', (SELECT jsonb_agg(jsonb_build_object('pv', e->>'order_number', 'setor', e->>'sector', 'cor', e->>'color',
                              'pares', e->'total_pairs', 'semana', e->>'billing_week', 'na_fila', e->'in_queue', 'trava', e->>'block_reason'))
                              FROM jsonb_array_elements(public.list_atelier_cut_queue()) e));
  ELSIF c_secao = 'cronograma' THEN
    v_out := jsonb_build_object('agenda', v_sched1,
      'carga_semana_setor', (SELECT jsonb_object_agg(k, v) FROM (
          SELECT to_char(date_trunc('week', ps.date), 'DD/MM') || ' ' || ps.sector AS k,
                 jsonb_build_object('total', sum(ps.planned_pairs),
                   'ensaio', sum(ps.planned_pairs) FILTER (WHERE o.sale_order_id = ANY (v_ids)),
                   'cap_semana', max(ss.daily_capacity_pairs) * 5) AS v
            FROM production_schedule ps JOIN orders o ON o.id = ps.order_id
            LEFT JOIN sector_settings ss ON ss.sector = ps.sector
           WHERE ps.recalc_run_id = public.latest_schedule_run_id()
           GROUP BY 1) z));
  ELSIF c_secao = 'motor' THEN
    v_out := jsonb_build_object('snapshot', v_snap - 'stock',
      'stock', (SELECT jsonb_agg(s) FROM jsonb_array_elements(v_snap -> 'stock') s
                 WHERE (s ->> 'product_id') IN (SELECT m ->> 'product_id' FROM jsonb_array_elements(v_snap -> 'items') i,
                                                 jsonb_array_elements(i -> 'materials') m)));
  ELSIF c_secao = 'fase2' THEN
    v_out := jsonb_build_object('log', v_log,
      'ops', (SELECT jsonb_agg(o.order_number || ' ' || so.order_number || ' ' || COALESCE(NULLIF(ts.code,''), ts.name) || ' ' || o.color
                               || ' ' || o.quantity || ' ' || o.status ORDER BY o.order_number)
                FROM orders o JOIN sale_orders so ON so.id = o.sale_order_id
                LEFT JOIN technical_sheets ts ON ts.id = o.reference_id
               WHERE o.sale_order_id = ANY (v_ids)),
      'agenda_depois_do_retorno', v_sched2,
      'fila_motor_ligado', (SELECT jsonb_agg(jsonb_build_object('pos', s.sequence_position, 'op', s.order_number,
                  'pv', so.order_number, 'ref', s.reference_code, 'cor', s.color, 'trava', s.block_reason) ORDER BY s.sequence_position)
                  FROM public.list_production_sequence() s LEFT JOIN sale_orders so ON so.id = s.sale_order_id));
  END IF;

  EXCEPTION WHEN others THEN
    v_out := jsonb_build_object('erro', SQLSTATE || ' ' || SQLERRM, 'log', v_log);
  END;

  -- ── 6. Devolver as sequências (o rollback não desfaz nextval) ────────────
  -- Só devolve se nenhum número acima do valor inicial pertence a outra
  -- sessão (linha visível que não foi criada nesta transação).
  FOR r IN SELECT key, value FROM jsonb_each(v_seq0) LOOP
    SELECT last_value INTO v_now FROM pg_sequences WHERE schemaname = 'public' AND sequencename = r.key;
    IF v_now IS NULL OR r.value = 'null'::jsonb OR v_now = (r.value)::bigint THEN
      CONTINUE;
    END IF;
    v_ours := CASE r.key
      WHEN 'op_number_seq' THEN (SELECT max(substring(order_number FROM '(\d+)$')::bigint) FROM orders
                                  WHERE order_number ~ '^OP-\d{4}-\d+$' AND created_at <> now())
      WHEN 'pv_number_seq' THEN (SELECT max(substring(order_number FROM '(\d+)$')::bigint) FROM sale_orders
                                  WHERE order_number ~ '^PV-\d+$' AND created_at <> now())
      WHEN 'oc_number_seq' THEN (SELECT max(substring(order_number FROM '(\d+)$')::bigint) FROM purchase_orders
                                  WHERE order_number ~ '^OC-\d+$' AND created_at <> now())
      WHEN 'atelier_lot_number_seq' THEN (SELECT max(substring(lot_number FROM '(\d+)$')::bigint) FROM atelier_lots
                                  WHERE lot_number ~ '^LOTE-\d+$' AND created_at <> now())
      ELSE NULL END;
    IF r.key IN ('op_number_seq','pv_number_seq','oc_number_seq','atelier_lot_number_seq')
       AND COALESCE(v_ours, 0) <= (r.value)::bigint THEN
      PERFORM setval('public.' || r.key, (r.value)::bigint, true);
      v_restore := v_restore || jsonb_build_object(r.key, format('restaurada %s -> %s', v_now, r.value));
    ELSE
      v_restore := v_restore || jsonb_build_object(r.key, format('nao_restaurada: %s -> %s (maior numero de outra sessao: %s)', r.value, v_now, v_ours));
    END IF;
  END LOOP;
  v_out := v_out || jsonb_build_object('sequencias', v_restore, 'secao', c_secao);

  RAISE EXCEPTION 'ENSAIO_ROLLBACK %', v_out::text;
END
$ensaio$;
