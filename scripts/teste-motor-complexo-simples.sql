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
--   1. Ajuste c_secao abaixo: 'veredito' (padrão: critérios a–e + agenda semana×setor)
--      | 'resumo' | 'fila' | 'cronograma' | 'motor' | 'fase2'
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
-- 'veredito' (padrão) roda com auto_motor_enabled como está (desligado): a
-- ordem única do motor (20270101054800) não depende da chave. 'fila'/'motor'
-- ligam auto_motor_enabled SÓ dentro da transação, para comparar.
-- Simula o outbox dentro da transação (materializa Ateliê, liga o kit às
-- reservas, cria OCs RASCUNHO do kit e do PV) — tudo some no rollback. Nunca
-- gera OC real (Gerar OC), não fatura, não emite NF.
-- Para testar migrations ainda não aplicadas: injete "EXECUTE $MIG$<sql>$MIG$;"
-- no marcador @MIGRATIONS@ (DDL do Postgres é transacional e também volta).
-- Não toca PV-00249/00250/00251 nem LOTE-00004 (só leitura da fila).
-- ════════════════════════════════════════════════════════════════════════════
DO $ensaio$
DECLARE
  c_secao     text := 'veredito';
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
  -- @MIGRATIONS@ (o runner pode injetar aqui EXECUTE das migrations novas para
  -- testar a versão nova das funções dentro desta mesma transação)

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

  -- ── 1b. O que o outbox faz depois do commit (aqui, na mesma transação):
  --        materializa Ateliê + liga o kit às reservas + OC rascunho do kit
  --        e OC rascunho por PV. Tudo some no rollback.
  FOR v_so IN SELECT unnest(v_ids) LOOP
    BEGIN
      v_res := public.process_cabedal_prep_purchase_shortages(v_so);
      v_log := v_log || jsonb_build_object((SELECT order_number FROM sale_orders WHERE id = v_so) || '_oc_kit', v_res);
    EXCEPTION WHEN others THEN
      v_log := v_log || jsonb_build_object((SELECT order_number FROM sale_orders WHERE id = v_so) || '_oc_kit', 'erro: ' || left(SQLERRM, 300));
    END;
    BEGIN
      v_res := public.process_sale_order_purchase_shortages(v_so);
      v_log := v_log || jsonb_build_object((SELECT order_number FROM sale_orders WHERE id = v_so) || '_oc_pv',
                 jsonb_build_object('ok', v_res -> 'ok', 'created', v_res -> 'created', 'reused', v_res -> 'reused'));
    EXCEPTION WHEN others THEN
      v_log := v_log || jsonb_build_object((SELECT order_number FROM sale_orders WHERE id = v_so) || '_oc_pv', 'erro: ' || left(SQLERRM, 300));
    END;
  END LOOP;

  -- ── 2. Motor ligado SÓ nesta transação ───────────────────────────────────
  v_seq_off := (SELECT jsonb_agg(jsonb_build_object('pos', s.sequence_position, 'op', s.order_number,
                  'pv', so.order_number, 'ref', s.reference_code, 'cor', s.color, 'due', s.due_date,
                  'score', round(s.close_score, 2), 'trava', s.block_reason) ORDER BY s.sequence_position)
                  FROM public.list_production_sequence() s LEFT JOIN sale_orders so ON so.id = s.sale_order_id);
  IF c_secao IN ('fila', 'motor') THEN
    UPDATE atelier_settings SET auto_motor_enabled = true WHERE id = 1;  -- só nesta transação
  END IF;
  v_snap := public.list_cabedal_motor_purchase_snapshot();
  v_seq_on := (SELECT jsonb_agg(jsonb_build_object('pos', s.sequence_position, 'op', s.order_number,
                  'pv', so.order_number, 'ref', s.reference_code, 'cor', s.color, 'due', s.due_date,
                  'score', round(s.close_score, 2), 'trava', s.block_reason) ORDER BY s.sequence_position)
                  FROM public.list_production_sequence() s LEFT JOIN sale_orders so ON so.id = s.sale_order_id);

  -- ── 3. Agenda de capacidade (finita, setor × dia) ────────────────────────
  -- (recompute 2× na mesma transação colide na chave idempotente da fila de
  --  tiras; por isso a fase 2 só recalcula depois do retorno simulado)
  IF c_secao <> 'fase2' THEN
    v_res := public.recompute_production_schedule('ensaio');
    v_log := v_log || jsonb_build_object('recompute', v_res);
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
  IF c_secao = 'veredito' THEN
    v_out := jsonb_build_object(
      'log', v_log,
      -- Plano do motor (ordem única) dos PVs de ensaio + PVs reais em produção
      'plano', (SELECT jsonb_agg(jsonb_build_object(
                  'pos', p.motor_position, 'pv', p.sale_order_number, 'op', COALESCE(p.order_number, '(previsto)'),
                  'ref', p.reference_code, 'cor', p.color, 'pares', p.pairs, 'classe', p.item_class,
                  'semana', p.billing_week, 'ancora', p.billing_anchor, 'urgente', p.is_urgent,
                  'espera', p.wait_reason, 'volta_prestador', p.cabedal_expected_return, 'material_chega', p.material_eta,
                  'fim_previsto', p.projected_completion, 'dias_vs_fatura', p.days_vs_billing) ORDER BY p.motor_position)
                  FROM v_production_motor_plan p
                 WHERE p.sale_order_id = ANY (v_ids)
                    OR p.sale_order_number IN ('PV-00252', 'PV-00255')),
      -- Agenda semana × setor (ensaio): OP = agenda real; previsto = complexo no prestador
      'agenda_semana_setor', (SELECT jsonb_object_agg(k, v) FROM (
          SELECT to_char(date_trunc('week', x.date), 'DD/MM') || ' · ' || x.sector AS k,
                 jsonb_object_agg(x.pv || ' ' || x.classe, x.pares) AS v
            FROM (
              SELECT ps.date, ps.sector, so.order_number AS pv,
                     public.production_motor_item_class(o.reference_id) AS classe, ps.planned_pairs AS pares
                FROM production_schedule ps JOIN orders o ON o.id = ps.order_id
                JOIN sale_orders so ON so.id = o.sale_order_id
               WHERE o.sale_order_id = ANY (v_ids) AND ps.date >= public.br_today()
              UNION ALL
              SELECT f.date, f.sector, so.order_number, 'complexo(previsto)', f.planned_pairs
                FROM production_motor_forecast f JOIN sale_orders so ON so.id = f.sale_order_id
               WHERE f.sale_order_id = ANY (v_ids)
            ) x
           GROUP BY 1, date_trunc('week', x.date), x.sector
        ) z),
      'prestador', (SELECT jsonb_agg(jsonb_build_object(
                  'pv', so.order_number, 'cor', e.sector || ' ' || j.color, 'pares', j.pairs,
                  'prazo_dias_uteis', e.prep_business_days, 'envio_meta', e.target_start, 'envio_previsto', e.planned_send,
                  'kit_chega', e.kit_material_eta, 'volta_prevista', e.expected_return, 'pronto_meta', d.ready_date,
                  'empurrado_capacidade', e.capacity_pushed) ORDER BY so.order_number, j.color, e.sector)
                  FROM atelier_jobs_expected_dates() e
                  JOIN cabedal_prep_jobs j ON j.id = e.job_id
                  JOIN sale_orders so ON so.id = e.sale_order_id
                  LEFT JOIN cabedal_prep_demands d ON d.id = j.demand_id
                 WHERE e.sale_order_id = ANY (v_ids)),
      'reservas_kit', (SELECT jsonb_agg(jsonb_build_object('pv', so.order_number, 'material', p.name,
                  'tipo', mr.metadata ->> 'kind', 'empenhado', round(mr.quantity_reserved, 2), 'falta', round(COALESCE(mr.quantity_short, 0), 2),
                  'itens', jsonb_array_length(COALESCE(mr.metadata -> 'atelier_item_ids', '[]'::jsonb))) ORDER BY so.order_number, p.name)
                  FROM material_reservations mr JOIN products p ON p.id = mr.product_id
                  JOIN sale_orders so ON so.id = mr.sale_order_id
                 WHERE mr.sale_order_id = ANY (v_ids) AND mr.status IN ('reserved', 'partially_consumed')
                   AND mr.metadata ->> 'kind' = 'atelier_prep'),
      'reservas_pv_nivel', (SELECT jsonb_agg(jsonb_build_object('pv', so.order_number, 'material', p.name || ' ' || COALESCE(p.color, ''),
                  'tipo', COALESCE(mr.metadata ->> 'kind', mr.reservation_type), 'emp', round(mr.quantity_reserved, 1),
                  'falta', round(COALESCE(mr.quantity_short, 0), 1)) ORDER BY so.order_number, p.name)
                  FROM material_reservations mr JOIN products p ON p.id = mr.product_id
                  JOIN sale_orders so ON so.id = mr.sale_order_id
                 WHERE mr.sale_order_id = ANY (v_ids) AND mr.order_id IS NULL
                   AND mr.status IN ('reserved', 'partially_consumed')
                   AND so.order_number IN ('PV-ENSAIO-A', 'PV-ENSAIO-C')),
      'ocs_rascunho', (SELECT jsonb_agg(jsonb_build_object('oc', po.order_number, 'status', po.status, 'origem', po.source_type,
                  'fornecedor', po.supplier_name, 'valor', round(po.total_value, 2), 'comprar_ate', pr.purchase_by_date, 'material_na_fabrica', pr.material_need_date,
                  'chegar', po.promised_date, 'envio_prestador', pr.send_to_contractor_date, 'expedite', po.expedite,
                  'prioridade', pr.motor_rank, 'urgencia', pr.urgency, 'motivo', pr.reason, 'acima_teto', pr.over_weekly_cap)
                  ORDER BY pr.motor_rank NULLS LAST)
                  FROM purchase_orders po LEFT JOIN purchase_order_motor_priority pr ON pr.purchase_order_id = po.id
                 WHERE po.created_at = now()),
      'criterios', jsonb_build_object(
        'a_prestador_com_tempo', (
          SELECT jsonb_build_object(
            'ok', COALESCE(bool_and(x.volta <= x.pronto AND (x.mont IS NULL OR x.mont >= x.volta)), false),
            'itens', jsonb_agg(jsonb_build_object('pv', x.pv, 'cor', x.cor, 'envio', x.envio, 'volta', x.volta,
                                                  'pronto', x.pronto, 'primeira_montagem', x.mont)))
            FROM (
              SELECT so.order_number AS pv, soi.color AS cor, MAX(e.planned_send) AS envio, MAX(e.expected_return) AS volta,
                     MAX(d.ready_date) AS pronto,
                     (SELECT MIN(f.date) FROM production_motor_forecast f
                       WHERE f.sale_order_item_id = soi.id AND f.sector = 'Montagem') AS mont
                FROM atelier_jobs_expected_dates() e
                JOIN sale_order_items soi ON soi.id = e.sale_order_item_id
                JOIN sale_orders so ON so.id = soi.sale_order_id
                LEFT JOIN cabedal_prep_demands d ON d.sale_order_item_id = soi.id
               WHERE e.sale_order_id = ANY (v_ids)
               GROUP BY so.order_number, soi.id, soi.color) x),
        'b_mescla_complexo_simples', (
          SELECT jsonb_build_object(
            'ok', COALESCE(bool_or(x.tem_c AND x.tem_s), false),
            'dias_montagem', jsonb_object_agg(to_char(x.date, 'DD/MM'), jsonb_build_object('complexo', x.c, 'simples', x.s)))
            FROM (
              SELECT y.date, SUM(y.p) FILTER (WHERE y.cl = 'complexo') AS c, SUM(y.p) FILTER (WHERE y.cl = 'simples') AS s,
                     COALESCE(SUM(y.p) FILTER (WHERE y.cl = 'complexo'), 0) > 0 AS tem_c,
                     COALESCE(SUM(y.p) FILTER (WHERE y.cl = 'simples'), 0) > 0 AS tem_s
                FROM (
                  SELECT ps.date, public.production_motor_item_class(o.reference_id) AS cl, ps.planned_pairs AS p
                    FROM production_schedule ps JOIN orders o ON o.id = ps.order_id
                   WHERE ps.sector = 'Montagem' AND o.sale_order_id = ANY (v_ids)
                  UNION ALL
                  SELECT f.date, 'complexo', f.planned_pairs FROM production_motor_forecast f
                   WHERE f.sector = 'Montagem' AND f.sale_order_id = ANY (v_ids)
                ) y GROUP BY y.date
            ) x),
        'c_caixa', (
          SELECT jsonb_build_object(
            'ok', (min_pos ->> 'PV-ENSAIO-C')::int < (min_pos ->> 'PV-ENSAIO-B')::int
                  AND (min_pos ->> 'PV-ENSAIO-B')::int < (min_pos ->> 'PV-ENSAIO-A')::int
                  AND (min_pos ->> 'PV-ENSAIO-A')::int < (min_pos ->> 'PV-ENSAIO-D')::int,
            'primeira_posicao', min_pos)
            FROM (SELECT jsonb_object_agg(pv, pos) AS min_pos FROM (
                    SELECT p.sale_order_number AS pv, MIN(p.motor_position) AS pos
                      FROM v_production_motor_plan p WHERE p.sale_order_id = ANY (v_ids)
                     GROUP BY 1) q) z),
        'd_realismo', jsonb_build_object(
          'costura_do_ateliê_agendada_na_fabrica', (
            SELECT count(*) FROM production_schedule ps JOIN orders o ON o.id = ps.order_id
             WHERE ps.date >= public.br_today()
               AND public.production_motor_item_class(o.reference_id) = 'complexo'
               AND (ps.sector = 'Corte Cabedal'
                    OR (ps.sector = 'Costura Cabedal' AND 'costura_cabedal' = ANY (public.atelier_reference_street_sectors(o.reference_id)))
                    OR (ps.sector = 'Aviamento' AND 'aviamento' = ANY (public.atelier_reference_street_sectors(o.reference_id))))),
          'op_comeca_antes_do_material', (
            SELECT count(*) FROM production_motor_state st
              JOIN LATERAL (SELECT MIN(ps.date) AS d FROM production_schedule ps WHERE ps.order_id = st.order_id
                              AND ps.date >= public.br_today() AND ps.sector <> 'Solagem') f ON true
             WHERE st.material_eta IS NOT NULL AND f.d < st.material_eta),
          'complexo_antes_do_retorno', (
            SELECT count(*) FROM production_motor_forecast f JOIN production_motor_state st ON st.order_key = f.sale_order_item_id
             WHERE st.cabedal_expected_return IS NOT NULL AND f.date < st.cabedal_expected_return),
          'dias_setor_acima_da_capacidade', (
            SELECT count(*) FROM (
              SELECT ps.sector, ps.date, SUM(ps.day_fraction) AS fr
                FROM production_schedule ps WHERE ps.date >= public.br_today() GROUP BY 1, 2) t
             WHERE t.fr > 1.0001),
          'snapshot_multiplicado', (
            SELECT count(*) FROM (
              SELECT (m ->> 'product_id') AS pid, i ->> 'sale_order_id' AS so, SUM((m ->> 'required')::numeric) AS req
                FROM jsonb_array_elements(public.list_cabedal_motor_purchase_snapshot() -> 'items') i,
                     jsonb_array_elements(i -> 'materials') m
               WHERE (i ->> 'sale_order_id')::uuid = ANY (v_ids)
               GROUP BY 1, 2) s
              JOIN (SELECT d.product_id::text AS pid, x.id::text AS so, SUM(d.required) AS req
                      FROM unnest(v_ids) x(id), LATERAL public.sale_order_material_demand_lines(x.id) d GROUP BY 1, 2) t
                ON t.pid = s.pid AND t.so = s.so
             WHERE abs(s.req - t.req) > 0.01)),
        'e_datas_vs_semana', (
          SELECT jsonb_build_object('ok', COALESCE(bool_and(x.fim <= x.ancora + 4), false),
                                    'pvs', jsonb_object_agg(x.pv, jsonb_build_object('ancora', x.ancora, 'fim_previsto', x.fim)))
            FROM (SELECT p.sale_order_number AS pv, MIN(p.billing_anchor) AS ancora, MAX(p.projected_completion) AS fim
                    FROM v_production_motor_plan p WHERE p.sale_order_id = ANY (v_ids) GROUP BY 1) x)
      ));
  ELSIF c_secao = 'resumo' THEN
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
