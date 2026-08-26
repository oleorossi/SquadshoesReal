-- =============================================================================
-- E2E transacional — integridade do ponto, adiantamentos e folha (migrations
-- 20270101013400 + 20270101013500 + 20270101013600)
--
-- Seguro para produção: todos os dados sintéticos e efeitos colaterais ficam na
-- mesma transação e são descartados pelo ROLLBACK final. Execute somente depois
-- das duas migrations acima (ou concatene migrations + corpo deste teste dentro
-- de uma única transação de validação).
-- =============================================================================

BEGIN;

SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';

-- As helpers de autorização são STABLE, a identidade precisa existir antes do
-- DO (uma única statement) para não congelar auth.uid() como NULL no primeiro
-- guard executado pelo bloco.
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claim.sub',
  (
    SELECT ur.user_id::text
      FROM public.user_roles ur
      JOIN public.profiles p ON p.id = ur.user_id AND p.approved = true
     WHERE ur.role::text IN ('admin', 'gerente', 'rh')
     ORDER BY CASE ur.role::text WHEN 'admin' THEN 1 WHEN 'gerente' THEN 2 ELSE 3 END,
              ur.user_id
     LIMIT 1
  ),
  true
);

DO $test$
DECLARE
  v_actor uuid;
  v_schedule_id uuid;
  v_employee_id uuid := gen_random_uuid();
  v_other_employee_id uuid := gen_random_uuid();
  v_zero_employee_id uuid := gen_random_uuid();
  v_external_id text := 'E2E-PONTO-' || gen_random_uuid()::text;
  v_other_external_id text := 'E2E-PONTO-' || gen_random_uuid()::text;
  v_orphan_external_id text := 'ORFA-' || gen_random_uuid()::text;
  v_batch text := 'e2e-1999-01-' || gen_random_uuid()::text;
  v_null_batch text := 'e2e-1999-null-' || gen_random_uuid()::text;
  v_bad_batch text := 'e2e-1999-02-' || gen_random_uuid()::text;
  v_missing_file_batch text := 'e2e-1999-03-' || gen_random_uuid()::text;
  v_future_batch text := 'e2e-futuro-' || gen_random_uuid()::text;
  v_file_path text;
  v_null_file_path text;
  v_bad_file_path text;
  v_future_file_path text;
  v_log_id uuid;
  v_quarantine_id uuid;
  v_dismiss_quarantine_id uuid := gen_random_uuid();
  v_closed_quarantine_id uuid := gen_random_uuid();
  v_null_log_id uuid;
  v_bad_log_id uuid;
  v_missing_file_log_id uuid;
  v_future_log_id uuid;
  v_complete_record_id uuid;
  v_run_id uuid := gen_random_uuid();
  v_replacement_run_id uuid := gen_random_uuid();
  v_closed_insert_id uuid := gen_random_uuid();
  v_empty_draft_id uuid := gen_random_uuid();
  v_zero_run_id uuid := gen_random_uuid();
  v_uncovered_run_id uuid := gen_random_uuid();
  v_advance_id uuid;
  v_advance_replay_id uuid;
  v_advance_key uuid := gen_random_uuid();
  v_settled_advance_key uuid := gen_random_uuid();
  v_cancelled_advance_key uuid := gen_random_uuid();
  v_bulk_advance_key uuid := gen_random_uuid();
  v_settled_advance_id uuid;
  v_cancelled_advance_id uuid;
  v_bulk_advance_id uuid;
  v_payment_id uuid;
  v_final_payment_id uuid;
  v_replacement_payment_id uuid;
  v_payment_replay_id uuid;
  v_payment_key uuid := gen_random_uuid();
  v_final_payment_key uuid := gen_random_uuid();
  v_replacement_payment_key uuid := gen_random_uuid();
  v_receipt_path text;
  v_unreferenced_receipt_path text := 'e2e-recibo-orphan-' || gen_random_uuid()::text || '/retry.pdf';
  v_payload jsonb;
  v_bad_payload jsonb;
  v_first jsonb;
  v_replay jsonb;
  v_rejected boolean;
  v_snapshot jsonb;
  v_count integer;
  v_status text;
  v_acl_table text;
  v_error text;
  v_input_epoch bigint;
  v_fresh_input_epoch bigint;
  v_approved_at timestamptz;
  v_paid_at timestamptz;
  v_archive_before timestamptz;
  v_archive_after timestamptz;
  v_cancelled_advance_created_at timestamptz;
  v_forged_status text;
  v_resolver_external_id text;
  v_resolver_employee_id uuid := gen_random_uuid();
  v_ambiguous_employee_id uuid := gen_random_uuid();
  v_resolution jsonb;
  v_resolution_replay jsonb;
  v_dismissal jsonb;
BEGIN
  SELECT ur.user_id
    INTO v_actor
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id AND p.approved = true
   WHERE ur.role::text IN ('admin', 'gerente', 'rh')
   ORDER BY CASE ur.role::text WHEN 'admin' THEN 1 WHEN 'gerente' THEN 2 ELSE 3 END,
            ur.user_id
   LIMIT 1;
  ASSERT v_actor IS NOT NULL,
    'Pré-condição: nenhum usuário admin/gerente/rh disponível para o teste';

  SELECT ws.id
    INTO v_schedule_id
    FROM public.work_schedules ws
   ORDER BY ws.is_default DESC NULLS LAST, ws.created_at, ws.id
   LIMIT 1;
  ASSERT v_schedule_id IS NOT NULL,
    'Pré-condição: nenhuma jornada disponível para o teste';

  -- Simula uma chamada autenticada de RH sem depender da sessão do SQL Editor.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);

  FOREACH v_forged_status IN ARRAY ARRAY['success', 'partial', 'error']
  LOOP
    v_rejected := false;
    BEGIN
      INSERT INTO public.time_import_logs (
        file_name, file_path, batch_id, start_date, end_date,
        imported_by, status, archive_status
      ) VALUES (
        'forjado-' || v_forged_status || '.txt',
        'e2e-forjado-' || gen_random_uuid()::text,
        'e2e-forjado-' || gen_random_uuid()::text,
        DATE '1999-01-01', DATE '1999-01-31', v_actor,
        v_forged_status, 'pending'
      );
    EXCEPTION WHEN SQLSTATE '22023' THEN
      v_rejected := position('Novo protocolo deve nascer pendente' IN SQLERRM) > 0;
    END;
    ASSERT v_rejected,
      format('INSERT forjado de protocolo % foi aceito', v_forged_status);
  END LOOP;

  ASSERT (
    SELECT c.data_type = 'uuid'
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name = 'time_import_logs'
       AND c.column_name = 'imported_by'
  ), 'time_import_logs.imported_by não é uuid';
  ASSERT NOT EXISTS (
    SELECT 1
      FROM (
        VALUES
          ('public.time_import_logs'::regclass, 'imported_by'),
          ('public.time_import_quarantine'::regclass, 'resolved_by'),
          ('public.time_record_manual_overrides'::regclass, 'created_by'),
          ('public.employee_advances'::regclass, 'created_by'),
          ('public.employee_advances'::regclass, 'settled_by'),
          ('public.employee_advances'::regclass, 'cancelled_by'),
          ('public.payroll_runs'::regclass, 'approved_by'),
          ('public.payroll_payments'::regclass, 'reversed_by'),
          ('public.weekly_balance_audit_log'::regclass, 'changed_by')
      ) AS history_column(relid, column_name)
      JOIN pg_attribute a
        ON a.attrelid = history_column.relid
       AND a.attname = history_column.column_name
      JOIN pg_constraint c
        ON c.conrelid = history_column.relid
       AND c.contype = 'f'
       AND a.attnum = ANY(c.conkey)
  ), 'autoria histórica ainda depende da existência da conta em auth.users';
  ASSERT COALESCE((
    SELECT c.confdeltype = 'r'
      FROM pg_constraint c
     WHERE c.conrelid = 'public.payroll_runs'::regclass
       AND c.conname = 'payroll_runs_employee_id_fkey'
       AND c.contype = 'f'
  ), false), 'folha ainda pode ser apagada em cascata com o funcionário';

  -- Policies permissivas são combinadas por OR. Portanto, o contrato seguro
  -- exige tanto a presença das novas policies quanto a remoção das antigas.
  ASSERT COALESCE((
    SELECT array_agg(p.policyname::text ORDER BY p.policyname::text)
      FROM pg_policies p
     WHERE p.schemaname = 'public' AND p.tablename = 'time_import_logs'
  ), ARRAY[]::text[]) = ARRAY[
    'time_import_logs_rh_insert',
    'time_import_logs_rh_select',
    'time_import_logs_rh_update'
  ]::text[], 'policies legadas sobreviveram em time_import_logs';
  ASSERT COALESCE((
    SELECT array_agg(p.policyname::text ORDER BY p.policyname::text)
      FROM pg_policies p
     WHERE p.schemaname = 'public' AND p.tablename = 'time_import_quarantine'
  ), ARRAY[]::text[]) = ARRAY[
    'time_import_quarantine_rh_select'
  ]::text[], 'quarentena possui policy fora do contrato de RH';
  ASSERT COALESCE((
    SELECT array_agg(p.policyname::text ORDER BY p.policyname::text)
      FROM pg_policies p
     WHERE p.schemaname = 'public' AND p.tablename = 'time_record_manual_overrides'
  ), ARRAY[]::text[]) = ARRAY[
    'time_record_manual_overrides_rh_select'
  ]::text[], 'overrides manuais ainda possuem policy de mutação';
  ASSERT COALESCE((
    SELECT array_agg(p.policyname::text ORDER BY p.policyname::text)
      FROM pg_policies p
     WHERE p.schemaname = 'public' AND p.tablename = 'payroll_runs'
  ), ARRAY[]::text[]) = ARRAY[
    'payroll_runs_read',
    'payroll_runs_write'
  ]::text[], 'policies legadas sobreviveram em payroll_runs';
  ASSERT COALESCE((
    SELECT array_agg(p.policyname::text ORDER BY p.policyname::text)
      FROM pg_policies p
     WHERE p.schemaname = 'public' AND p.tablename = 'employee_advances'
  ), ARRAY[]::text[]) = ARRAY[
    'employee_advances_rh_select'
  ]::text[], 'policies legadas sobreviveram em employee_advances';
  ASSERT COALESCE((
    SELECT array_agg(p.policyname::text ORDER BY p.policyname::text)
      FROM pg_policies p
     WHERE p.schemaname = 'public' AND p.tablename = 'payroll_payments'
  ), ARRAY[]::text[]) = ARRAY[
    'payroll_payments_read'
  ]::text[], 'policies legadas sobreviveram em payroll_payments';
  ASSERT NOT EXISTS (
    SELECT 1
      FROM pg_policies p
     WHERE p.schemaname = 'storage'
       AND p.tablename = 'objects'
       AND p.policyname IN (
         'timesheet_imports_authenticated_insert',
         'timesheet_imports_authenticated_select',
         'Approved users can read employee-receipts',
         'Approved users can upload employee-receipts',
         'Approved users can update employee receipts',
         'Approved users can delete employee-receipts',
         'Anyone can view receipts',
         'Auth users can view receipts',
         'Auth users can upload receipts',
         'Auth users can delete receipts'
       )
  ), 'policy ampla legada sobre arquivos de RH sobreviveu';
  ASSERT (
    SELECT count(*) = 6
      FROM pg_policies p
     WHERE p.schemaname = 'storage'
       AND p.tablename = 'objects'
       AND p.policyname IN (
         'timesheet_imports_rh_insert',
         'timesheet_imports_rh_select',
         'employee_receipts_rh_select',
         'employee_receipts_rh_insert',
         'employee_receipts_rh_update_unreferenced',
         'employee_receipts_rh_delete_unreferenced'
       )
  ), 'policies restritas dos arquivos de RH não foram instaladas';
  ASSERT EXISTS (
    SELECT 1
      FROM pg_policies p
     WHERE p.schemaname = 'storage'
       AND p.tablename = 'objects'
       AND p.policyname = 'employee_receipts_rh_update_unreferenced'
       AND p.qual LIKE '%payroll_payments%'
       AND p.qual LIKE '%employee_advances%'
       AND p.with_check LIKE '%payroll_payments%'
       AND p.with_check LIKE '%employee_advances%'
  ), 'policy de UPDATE/retry não protege todas as referências financeiras';
  ASSERT EXISTS (
    SELECT 1
      FROM pg_policies p
     WHERE p.schemaname = 'storage'
       AND p.tablename = 'objects'
       AND p.policyname = 'employee_receipts_rh_delete_unreferenced'
       AND p.qual LIKE '%payroll_payments%'
       AND p.qual LIKE '%employee_advances%'
  ), 'policy de DELETE/retry não protege todas as referências financeiras';

  FOREACH v_acl_table IN ARRAY ARRAY[
    'public.time_records',
    'public.time_import_logs',
    'public.time_import_quarantine',
    'public.time_record_manual_overrides',
    'public.timesheet_periods',
    'public.payroll_runs',
    'public.payroll_payments',
    'public.employee_advances',
    'public.employee_absences',
    'public.employees',
    'public.work_schedules',
    'public.holidays',
    'public.workday_swaps',
    'public.overtime_resolutions',
    'public.ficha_montadores'
  ] LOOP
    ASSERT NOT has_table_privilege('authenticated', v_acl_table, 'TRUNCATE'),
      format('authenticated ainda pode truncar %s', v_acl_table);
    ASSERT NOT has_table_privilege('anon', v_acl_table, 'TRUNCATE'),
      format('anon ainda pode truncar %s', v_acl_table);
  END LOOP;
  ASSERT NOT has_table_privilege('authenticated', 'public.time_records', 'DELETE')
     AND NOT has_table_privilege('anon', 'public.time_records', 'DELETE'),
    'DELETE direto continua liberado sobre time_records';
  ASSERT NOT has_table_privilege('authenticated', 'public.payroll_runs', 'DELETE')
     AND NOT has_table_privilege('anon', 'public.payroll_runs', 'DELETE'),
    'DELETE direto continua liberado sobre payroll_runs';
  ASSERT NOT has_table_privilege('authenticated', 'public.employee_advances', 'INSERT')
     AND NOT has_table_privilege('authenticated', 'public.employee_advances', 'UPDATE')
     AND NOT has_table_privilege('authenticated', 'public.employee_advances', 'DELETE')
     AND NOT has_table_privilege('anon', 'public.employee_advances', 'INSERT')
     AND NOT has_table_privilege('anon', 'public.employee_advances', 'UPDATE')
     AND NOT has_table_privilege('anon', 'public.employee_advances', 'DELETE'),
    'DML direto continua liberado sobre employee_advances';
  ASSERT NOT has_table_privilege('authenticated', 'public.payroll_payments', 'INSERT')
     AND NOT has_table_privilege('authenticated', 'public.payroll_payments', 'UPDATE')
     AND NOT has_table_privilege('authenticated', 'public.payroll_payments', 'DELETE')
     AND NOT has_table_privilege('anon', 'public.payroll_payments', 'INSERT')
     AND NOT has_table_privilege('anon', 'public.payroll_payments', 'UPDATE')
     AND NOT has_table_privilege('anon', 'public.payroll_payments', 'DELETE'),
    'DML direto continua liberado sobre payroll_payments';
  ASSERT NOT has_table_privilege('authenticated', 'public.time_record_manual_overrides', 'INSERT')
     AND NOT has_table_privilege('authenticated', 'public.time_record_manual_overrides', 'UPDATE')
     AND NOT has_table_privilege('authenticated', 'public.time_record_manual_overrides', 'DELETE')
     AND NOT has_table_privilege('anon', 'public.time_record_manual_overrides', 'INSERT')
     AND NOT has_table_privilege('anon', 'public.time_record_manual_overrides', 'UPDATE')
     AND NOT has_table_privilege('anon', 'public.time_record_manual_overrides', 'DELETE'),
    'mutação direta de overrides manuais continua liberada';

  ASSERT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.payroll_runs'::regclass
       AND tgname = 'trg_zzzy_guard_payroll_integrity' AND NOT tgisinternal
  ), 'guard final da folha não foi instalado';
  ASSERT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.payroll_runs'::regclass
       AND tgname = 'trg_zzzz_lock_closed_payroll_snapshot' AND NOT tgisinternal
  ), 'lock final do snapshot não foi instalado';
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.payroll_runs'::regclass
       AND tgname = 'trg_lock_closed_payroll_snapshot' AND NOT tgisinternal
  ), 'trigger legado de lock do snapshot sobreviveu';
  ASSERT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.payroll_payments'::regclass
       AND tgname = 'tg_sync_payroll_paid' AND NOT tgisinternal
  ), 'sincronização canônica dos pagamentos não foi instalada';
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.payroll_payments'::regclass
       AND tgname IN ('tg_ficha_stamp_payment', 'tg_ficha_unstamp_payment')
       AND NOT tgisinternal
  ), 'triggers legados de pagamento sobreviveram';
  ASSERT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.payroll_runs'::regclass
       AND tgname = 'tg_payroll_lock_finalized' AND NOT tgisinternal
  ), 'lock do documento salarial finalizado não está ativo';

  ASSERT has_function_privilege(
    'authenticated',
    'public.create_employee_advance(uuid,numeric,date,text,text,text,uuid)',
    'EXECUTE'
  ) AND NOT has_function_privilege(
    'anon',
    'public.create_employee_advance(uuid,numeric,date,text,text,text,uuid)',
    'EXECUTE'
  ), 'ACL do RPC de cadastro de adiantamento está incorreta';
  ASSERT has_function_privilege(
    'authenticated', 'public.resolve_time_import_quarantine(uuid)', 'EXECUTE'
  ) AND NOT has_function_privilege(
    'anon', 'public.resolve_time_import_quarantine(uuid)', 'EXECUTE'
  ), 'ACL do RPC de resolução da quarentena está incorreta';
  ASSERT has_function_privilege(
    'authenticated', 'public.dismiss_time_import_quarantine(uuid,text)', 'EXECUTE'
  ) AND NOT has_function_privilege(
    'anon', 'public.dismiss_time_import_quarantine(uuid,text)', 'EXECUTE'
  ), 'ACL do RPC de classificação auditada da quarentena está incorreta';
  ASSERT has_function_privilege(
    'authenticated', 'public.settle_employee_advance_external(uuid)', 'EXECUTE'
  ) AND has_function_privilege(
    'authenticated', 'public.cancel_employee_advance(uuid,text)', 'EXECUTE'
  ), 'RPCs de baixa/cancelamento de adiantamento não estão executáveis pelo RH';
  ASSERT has_function_privilege(
    'authenticated',
    'public.register_payroll_payment(uuid,uuid,numeric,text,date,text,text,text,text,integer,text,uuid)',
    'EXECUTE'
  ) AND has_function_privilege(
    'authenticated', 'public.reverse_payroll_payment(uuid,text)', 'EXECUTE'
  ), 'RPCs de registro/estorno de pagamento não estão executáveis pelo RH';

  ASSERT NOT EXISTS (
    SELECT 1 FROM public.payroll_runs
     WHERE status = 'aprovado'
       AND round(COALESCE(total_liquido, 0), 2) <= 0
  ), 'backfill não converteu folha aprovada de líquido zero para paga';

  INSERT INTO public.employees (
    id, name, salary, role, department, admission_date, active,
    external_id, work_schedule_id, payment_type
  ) VALUES
    (
      v_employee_id, 'E2E RH Folha Principal', 1000, 'Teste', 'RH',
      DATE '1999-01-01', true, v_external_id, v_schedule_id, 'mensalista'
    ),
    (
      v_other_employee_id, 'E2E RH Folha Secundário', 1000, 'Teste', 'RH',
      DATE '1999-01-01', true, v_other_external_id, v_schedule_id, 'mensalista'
    ),
    (
      v_zero_employee_id, 'E2E RH Folha Líquido Zero', 0, 'Teste', 'RH',
      DATE '1999-01-01', true, NULL, NULL, 'remoto'
    );

  INSERT INTO public.employee_absences (
    employee_id, start_date, end_date, absence_type,
    justified, paid, hours_per_day, notes
  ) VALUES
    (v_employee_id, '1999-01-10', '1999-01-10', 'atestado', false, true, NULL,
      'E2E paid vence justified legado'),
    (v_employee_id, '1999-01-11', '1999-01-11', 'suspensao', true, false, NULL,
      'E2E suspensão não remunerada'),
    (v_employee_id, '1999-01-12', '1999-01-12', 'atestado', true, true, 2,
      'E2E ausência parcial');
  ASSERT public.is_employee_absent_on(v_employee_id, DATE '1999-01-10'),
    'paid=true não venceu justified=false como no motor financeiro TS';
  ASSERT NOT public.is_employee_absent_on(v_employee_id, DATE '1999-01-11'),
    'suspensão não remunerada apareceu como dia abonado';
  ASSERT NOT public.is_employee_absent_on(v_employee_id, DATE '1999-01-12'),
    'ausência parcial apareceu como abono integral no helper booleano';

  -- A criação normal não exige que o cálculo definitivo já exista. O snapshot
  -- só se torna obrigatório e validado na transição atômica de fechamento.
  INSERT INTO public.payroll_runs (id, employee_id, period, status)
  VALUES (v_empty_draft_id, v_other_employee_id, '1998-11', 'rascunho');
  ASSERT (
    SELECT status = 'rascunho' AND calculation_snapshot IS NULL
      FROM public.payroll_runs WHERE id = v_empty_draft_id
  ), 'rascunho sem snapshot deixou de poder nascer';

  v_file_path := v_batch || '/ponto-e2e.txt';
  v_rejected := false;
  BEGIN
    INSERT INTO public.time_import_logs (
      file_name, file_path, batch_id, start_date, end_date,
      imported_by, archive_status, coverage_scope,
      covered_employee_external_ids
    ) VALUES (
      'escopo-incompleto.txt', 'e2e-escopo-incompleto-' || gen_random_uuid()::text,
      'e2e-escopo-incompleto-' || gen_random_uuid()::text,
      DATE '1999-01-01', DATE '1999-01-31', v_actor, 'pending',
      'all_employees', ARRAY[v_external_id]
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := position('não contém todas as matrículas vigentes' IN SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'protocolo global omitiu funcionário vigente e ainda poderia fabricar falta/cobertura';

  INSERT INTO storage.objects (
    bucket_id, name, owner, owner_id, metadata
  ) VALUES (
    'timesheet-imports', v_file_path, v_actor, v_actor::text,
    jsonb_build_object('size', 128, 'mimetype', 'text/plain')
  );
  INSERT INTO public.time_import_logs (
    file_name, file_path, file_size_bytes, mime_type, batch_id,
    start_date, end_date, imported_by, archive_status, archived_at,
    coverage_scope, covered_employee_external_ids
  ) VALUES (
    'ponto-e2e.txt', v_file_path, 128, 'text/plain', v_batch,
    DATE '1999-01-01', DATE '1999-01-31', v_actor, 'pending', NULL,
    'all_employees', ARRAY[v_external_id, v_other_external_id, v_orphan_external_id]
  )
  RETURNING id INTO v_log_id;
  v_archive_before := clock_timestamp();
  UPDATE public.time_import_logs
     SET archive_status = 'available', archived_at = TIMESTAMPTZ '2000-01-01 00:00:00+00',
         notes = 'Original E2E preservado; pronto para processar.'
   WHERE id = v_log_id;
  v_archive_after := clock_timestamp();
  ASSERT (
    SELECT l.archived_at BETWEEN v_archive_before AND v_archive_after
       AND l.archived_at IS DISTINCT FROM TIMESTAMPTZ '2000-01-01 00:00:00+00'
      FROM public.time_import_logs l
     WHERE l.id = v_log_id
  ), 'archived_at do cliente não foi substituído pelo relógio do servidor';

  ASSERT (
    SELECT pg_typeof(l.imported_by)::text = 'uuid' AND l.imported_by = v_actor
      FROM public.time_import_logs l
     WHERE l.id = v_log_id
  ), 'protocolo não preservou imported_by como UUID do usuário';

  -- O mesmo payload contém uma linha válida e uma matrícula órfã: a primeira é
  -- aplicada e a segunda fica em quarentena, com o arquivo/protocolo preservado.
  v_payload := jsonb_build_array(
    jsonb_build_object(
      'employee_name', 'E2E RH Folha Principal',
      'employee_external_id', v_external_id,
      'department', 'RH',
      'record_date', '1999-01-03',
      'punches', jsonb_build_array('08:00', '12:00', '13:00', '17:00')
    ),
    jsonb_build_object(
      'employee_name', 'E2E Sem Vínculo',
      'employee_external_id', v_orphan_external_id,
      'department', 'RH',
      'record_date', '1999-01-04',
      'punches', jsonb_build_array('08:00', '12:00')
    )
  );

  v_first := public.import_time_records_with_archive(v_payload, v_log_id, 2);
  ASSERT (v_first->>'inserted')::integer = 1,
    format('importação deveria inserir 1 registro: %s', v_first);
  ASSERT (v_first->>'unmatched')::integer = 1,
    format('importação deveria colocar 1 registro em quarentena: %s', v_first);
  ASSERT (v_first->>'skipped')::integer = 2,
    format('pré-descartes deveriam ser preservados: %s', v_first);
  ASSERT COALESCE((v_first->>'idempotent')::boolean, false) IS FALSE,
    'primeira execução não pode ser marcada como replay';

  ASSERT (
    SELECT l.status = 'partial'
       AND l.archive_status = 'available'
       AND l.batch_id = v_batch
       AND l.file_path = v_file_path
       AND l.payload_sha256 ~ '^[0-9a-f]{64}$'
       AND l.inserted_count = 1
       AND l.error_count = 1
      FROM public.time_import_logs l
     WHERE l.id = v_log_id
  ), 'protocolo final não corresponde aos efeitos da importação';

  ASSERT (
    SELECT tr.employee_id = v_employee_id
       AND tr.import_batch = v_batch
       AND tr.punches = jsonb_build_array('08:00', '12:00', '13:00', '17:00')
      FROM public.time_records tr
     WHERE tr.employee_external_id = v_external_id
       AND tr.record_date = DATE '1999-01-03'
  ), 'registro aceito perdeu funcionário, lote ou batidas';

  ASSERT (
    SELECT q.import_log_id = v_log_id
       AND q.batch_id = v_batch
       AND q.record_date = DATE '1999-01-04'
       AND q.resolved_at IS NULL
      FROM public.time_import_quarantine q
     WHERE q.import_log_id = v_log_id
  ), 'matrícula órfã não foi preservada na quarentena do lote';

  SELECT count(*) INTO v_count
    FROM public.time_records tr WHERE tr.import_batch = v_batch;
  ASSERT v_count = 1, 'lote deveria conter exatamente uma batida apta';

  SELECT tr.id INTO v_complete_record_id
  FROM public.time_records tr
  WHERE tr.import_batch = v_batch
    AND tr.employee_id = v_employee_id
    AND tr.record_date = DATE '1999-01-03';
  PERFORM public.complete_punches(
    v_complete_record_id,
    ARRAY['08:00', '12:00', '13:00', '17:15'],
    'E2E substituição auditada das batidas'
  );
  ASSERT (
    SELECT tr.punches = jsonb_build_array('08:00', '12:00', '13:00', '17:15*')
    FROM public.time_records tr WHERE tr.id = v_complete_record_id
  ), 'complete_punches não preservou reais e não marcou somente a nova batida';
  ASSERT EXISTS (
    SELECT 1 FROM public.time_record_manual_overrides o
    WHERE o.time_record_id = v_complete_record_id
      AND o.action = 'replace'
      AND o.reason = 'E2E substituição auditada das batidas'
      AND o.created_by = v_actor
      AND o.punches_before = jsonb_build_array('08:00', '12:00', '13:00', '17:00')
      AND o.punches_after = jsonb_build_array('08:00', '12:00', '13:00', '17:15*')
  ), 'complete_punches não gravou a auditoria before/after da substituição';
  ASSERT EXISTS (
    SELECT 1 FROM public.weekly_balance_audit_log a
    WHERE a.employee_id = v_employee_id
      AND a.changed_by = v_actor
      AND a.reason = 'E2E substituição auditada das batidas'
      AND a.metadata->>'time_record_id' = v_complete_record_id::text
  ), 'complete_punches não invalidou o saldo semanal com autoria histórica';

  v_rejected := false;
  BEGIN
    PERFORM public.complete_punches(
      v_complete_record_id,
      ARRAY['08:00', '12:00', '13:00', '17:15'],
      'E2E replay sem alteração real'
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := position('iguais às já registradas' IN SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'complete_punches aceitou replay sem alteração e duplicou auditoria';

  v_rejected := false;
  BEGIN
    PERFORM public.complete_punches(
      v_complete_record_id,
      ARRAY[
        ARRAY['00:01', '00:02', '00:03', '00:04', '00:05', '00:06', '00:07'],
        ARRAY['00:08', '00:09', '00:10', '00:11', '00:12', '00:13', '00:14']
      ],
      'E2E array multidimensional inválido'
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('entre 2 e 12 batidas' IN SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'complete_punches achatou array 2D e gravou mais de 12 batidas';

  v_rejected := false;
  BEGIN
    PERFORM public.complete_punches(
      v_complete_record_id,
      ARRAY['08:00', NULL]::text[],
      'E2E batida nula inválida'
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('Cada batida deve usar HH:MM' IN SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'complete_punches gravou null como batida/auditoria';

  v_replay := public.import_time_records_with_archive(v_payload, v_log_id, 2);
  ASSERT (v_replay->>'idempotent')::boolean IS TRUE,
    format('replay do mesmo payload não foi idempotente: %s', v_replay);
  ASSERT (v_replay->>'inserted')::integer = 1
     AND (v_replay->>'unmatched')::integer = 1,
    'replay não devolveu o recibo original';
  ASSERT (SELECT count(*) FROM public.time_records tr WHERE tr.import_batch = v_batch) = 1,
    'replay duplicou batidas';
  ASSERT (SELECT count(*) FROM public.time_import_quarantine q WHERE q.import_log_id = v_log_id) = 1,
    'replay duplicou a quarentena';

  v_rejected := false;
  BEGIN
    PERFORM public.import_time_records_with_archive(v_payload, v_log_id, 3);
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_rejected := position('outro payload' IN SQLERRM) > 0;
  END;
  ASSERT v_rejected,
    'replay com outra contagem de pré-descartes reutilizou o recibo idempotente';

  SELECT q.id, q.employee_external_id
    INTO v_quarantine_id, v_resolver_external_id
    FROM public.time_import_quarantine q
   WHERE q.import_log_id = v_log_id;

  v_rejected := false;
  BEGIN
    PERFORM public.resolve_time_import_quarantine(v_quarantine_id);
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_rejected := position('ainda não possui uma única ficha vigente' IN SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'resolver aceitou quarentena ainda sem vínculo em Pessoas';

  INSERT INTO public.employees (
    id, name, salary, role, department, admission_date, active,
    external_id, work_schedule_id, payment_type
  ) VALUES
    (
      v_resolver_employee_id, 'E2E RH Resolver Principal', 1000, 'Teste', 'RH',
      DATE '1998-01-01', true, v_resolver_external_id, v_schedule_id, 'mensalista'
    ),
    (
      v_ambiguous_employee_id, 'E2E RH Resolver Ambíguo', 1000, 'Teste', 'RH',
      DATE '1998-01-01', true, v_resolver_external_id, v_schedule_id, 'mensalista'
    );

  v_rejected := false;
  BEGIN
    PERFORM public.resolve_time_import_quarantine(v_quarantine_id);
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_rejected := position('ainda não possui uma única ficha vigente' IN SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'resolver escolheu arbitrariamente entre vínculos ambíguos';
  ASSERT (
    SELECT resolved_at IS NULL AND time_record_id IS NULL
      FROM public.time_import_quarantine WHERE id = v_quarantine_id
  ), 'rejeição sem vínculo único alterou a quarentena';

  UPDATE public.employees
     SET termination_date = DATE '1998-12-31'
   WHERE id = v_ambiguous_employee_id;
  v_resolution := public.resolve_time_import_quarantine(v_quarantine_id);
  ASSERT COALESCE((v_resolution->>'resolved')::boolean, false)
     AND COALESCE((v_resolution->>'idempotent')::boolean, true) IS FALSE
     AND (v_resolution->>'inserted')::integer = 1,
    format('resolver não aplicou a pendência após vínculo único: %s', v_resolution);
  ASSERT (
    SELECT q.resolved_at IS NOT NULL
       AND q.resolved_by = v_actor
       AND q.time_record_id IS NOT NULL
       AND tr.id = q.time_record_id
       AND tr.employee_id = v_resolver_employee_id
       AND tr.import_batch = v_batch
       AND tr.punches = jsonb_build_array('08:00', '12:00')
      FROM public.time_import_quarantine q
      JOIN public.time_records tr ON tr.id = q.time_record_id
     WHERE q.id = v_quarantine_id
  ), 'resolver não preservou autoria, lote, batidas ou vínculo canônico';

  v_resolution_replay := public.resolve_time_import_quarantine(v_quarantine_id);
  ASSERT COALESCE((v_resolution_replay->>'idempotent')::boolean, false)
     AND v_resolution_replay->>'time_record_id' = v_resolution->>'time_record_id'
     AND (SELECT count(*) FROM public.time_records tr WHERE tr.import_batch = v_batch) = 2,
    'replay do resolver duplicou batida ou trocou o vínculo resolvido';

  INSERT INTO public.time_import_quarantine (
    id, import_log_id, batch_id, employee_external_id, employee_name,
    department, record_date, punches, reason
  ) VALUES (
    v_dismiss_quarantine_id, v_log_id, v_batch,
    'TESTE-' || gen_random_uuid()::text, 'Crachá de Teste E2E', 'RH',
    DATE '1999-01-05', jsonb_build_array('08:00', '08:01'),
    'Linha externa ao quadro criada pelo teste transacional'
  );
  v_dismissal := public.dismiss_time_import_quarantine(
    v_dismiss_quarantine_id,
    '  crachá de teste do equipamento  '
  );
  ASSERT COALESCE((v_dismissal->>'dismissed')::boolean, false)
     AND COALESCE((v_dismissal->>'idempotent')::boolean, true) IS FALSE,
    'classificação auditada não encerrou a linha externa';
  ASSERT (
    SELECT q.resolution_status = 'dismissed'
       AND q.resolution_reason = 'crachá de teste do equipamento'
       AND q.resolved_at IS NOT NULL
       AND q.resolved_by = v_actor
       AND q.time_record_id IS NULL
      FROM public.time_import_quarantine q
     WHERE q.id = v_dismiss_quarantine_id
  ) AND NOT EXISTS (
    SELECT 1 FROM public.time_records tr
    WHERE tr.employee_external_id LIKE 'TESTE-%'
      AND tr.record_date = DATE '1999-01-05'
  ), 'classificação apagou evidência, criou batida ou perdeu autoria/motivo';
  ASSERT (
    public.dismiss_time_import_quarantine(
      v_dismiss_quarantine_id,
      'crachá de teste do equipamento'
    )->>'idempotent'
  )::boolean, 'replay da classificação auditada não foi idempotente';

  v_rejected := false;
  BEGIN
    PERFORM public.dismiss_time_import_quarantine(
      v_dismiss_quarantine_id,
      'justificativa divergente no replay'
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_rejected := position('justificativa diferente' IN SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'replay do descarte aceitou trocar a justificativa histórica';

  v_future_file_path := v_future_batch || '/ponto-futuro.txt';
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
  VALUES (
    'timesheet-imports', v_future_file_path, v_actor, v_actor::text,
    jsonb_build_object('size', 48, 'mimetype', 'text/plain')
  );
  INSERT INTO public.time_import_logs (
    file_name, file_path, file_size_bytes, mime_type, batch_id,
    start_date, end_date, imported_by, archive_status,
    coverage_scope, covered_employee_external_ids
  ) VALUES (
    'ponto-futuro.txt', v_future_file_path, 48, 'text/plain', v_future_batch,
    (now() AT TIME ZONE 'America/Sao_Paulo')::date,
    (now() AT TIME ZONE 'America/Sao_Paulo')::date + 1,
    v_actor, 'pending', 'listed_employees', ARRAY[v_external_id]
  ) RETURNING id INTO v_future_log_id;
  UPDATE public.time_import_logs
  SET archive_status = 'available'
  WHERE id = v_future_log_id;
  v_rejected := false;
  BEGIN
    PERFORM public.import_time_records_with_archive(
      jsonb_build_array(jsonb_build_object(
        'employee_name', 'E2E RH Folha Principal',
        'employee_external_id', v_external_id,
        'department', 'RH',
        'record_date', ((now() AT TIME ZONE 'America/Sao_Paulo')::date + 1)::text,
        'punches', jsonb_build_array('08:00', '12:00')
      )),
      v_future_log_id,
      0
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := position('futura em relação ao arquivamento' IN SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'RPC autenticada gravou batida futura por fora da interface';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.time_records tr
    WHERE tr.employee_id = v_employee_id
      AND tr.record_date = (now() AT TIME ZONE 'America/Sao_Paulo')::date + 1
  ), 'rejeição de batida futura deixou efeito parcial';

  -- JSON null não é ausência de batida nem instrução para apagar um dia já
  -- aplicado: todo o novo protocolo deve falhar e preservar a fonte anterior.
  v_null_file_path := v_null_batch || '/ponto-null.txt';
  INSERT INTO storage.objects (
    bucket_id, name, owner, owner_id, metadata
  ) VALUES (
    'timesheet-imports', v_null_file_path, v_actor, v_actor::text,
    jsonb_build_object('size', 32, 'mimetype', 'text/plain')
  );
  INSERT INTO public.time_import_logs (
    file_name, file_path, file_size_bytes, mime_type, batch_id,
    start_date, end_date, imported_by, archive_status, archived_at,
    coverage_scope, covered_employee_external_ids
  ) VALUES (
    'ponto-null.txt', v_null_file_path, 32, 'text/plain', v_null_batch,
    DATE '1999-01-01', DATE '1999-01-31', v_actor, 'pending', NULL,
    'listed_employees', ARRAY[v_external_id]
  )
  RETURNING id INTO v_null_log_id;
  UPDATE public.time_import_logs
     SET archive_status = 'available', archived_at = now(),
         notes = 'Original E2E nulo preservado; pronto para processar.'
   WHERE id = v_null_log_id;

  v_rejected := false;
  v_error := NULL;
  BEGIN
    PERFORM public.import_time_records_with_archive(
      jsonb_build_array(jsonb_build_object(
        'employee_name', 'E2E RH Folha Principal',
        'employee_external_id', v_external_id,
        'department', 'RH',
        'record_date', '1999-01-03',
        'punches', 'null'::jsonb
      )),
      v_null_log_id,
      0
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    v_rejected := position('punches deve ser array' in SQLERRM) > 0;
  END;
  ASSERT v_rejected,
    format('punches JSON null foi aceito sobre um dia já aplicado (erro: %s)', COALESCE(v_error, '<nenhum>'));
  ASSERT (
    SELECT status = 'processing' AND payload_sha256 IS NULL
      FROM public.time_import_logs WHERE id = v_null_log_id
  ), 'rejeição de punches nulo alterou o protocolo';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.time_records tr WHERE tr.import_batch = v_null_batch
  ), 'rejeição de punches nulo deixou batida parcial';
  ASSERT (
    SELECT tr.import_batch = v_batch
       AND tr.punches = jsonb_build_array('08:00', '12:00', '13:00', '17:15*')
      FROM public.time_records tr
     WHERE tr.employee_external_id = v_external_id
       AND tr.record_date = DATE '1999-01-03'
  ), 'punches nulo sobrescreveu a batida anteriormente aplicada';

  PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  v_rejected := false;
  BEGIN
    PERFORM public.import_time_records_with_archive(v_payload, v_log_id, 2);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := position('sem permissão' in SQLERRM) > 0;
  END;
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  ASSERT v_rejected, 'usuário autenticado sem papel de RH conseguiu importar';

  v_rejected := false;
  BEGIN
    PERFORM public.import_time_records_with_archive(
      v_payload || jsonb_build_array(jsonb_build_object(
        'employee_name', 'Payload divergente',
        'employee_external_id', v_external_id,
        'department', 'RH',
        'record_date', '1999-01-05',
        'punches', jsonb_build_array('08:00', '12:00')
      )),
      v_log_id,
      2
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_rejected := position('outro payload' in SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'protocolo finalizado aceitou payload divergente';

  v_rejected := false;
  BEGIN
    UPDATE public.time_import_logs
       SET notes = 'tentativa de alterar protocolo finalizado'
     WHERE id = v_log_id;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('importação finalizada é imutável' IN SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'protocolo finalizado foi alterado diretamente';

  -- batch_id e file_path são identidades one-shot independentes.
  v_rejected := false;
  BEGIN
    INSERT INTO public.time_import_logs (
      file_name, file_path, batch_id, start_date, end_date,
      imported_by, archive_status, archived_at
    ) VALUES (
      'outro.txt', 'outro/' || gen_random_uuid()::text, v_batch,
      DATE '1999-01-01', DATE '1999-01-31', v_actor, 'pending', NULL
    );
  EXCEPTION WHEN unique_violation THEN
    v_rejected := true;
  END;
  ASSERT v_rejected, 'batch_id foi reutilizado por outro protocolo';

  v_rejected := false;
  BEGIN
    INSERT INTO public.time_import_logs (
      file_name, file_path, batch_id, start_date, end_date,
      imported_by, archive_status, archived_at
    ) VALUES (
      'ponto-e2e.txt', v_file_path, 'outro-' || gen_random_uuid()::text,
      DATE '1999-01-01', DATE '1999-01-31', v_actor, 'pending', NULL
    );
  EXCEPTION WHEN unique_violation THEN
    v_rejected := true;
  END;
  ASSERT v_rejected, 'file_path foi reutilizado por outro protocolo';

  -- Marcar archive_status=available sem o objeto correspondente não basta.
  INSERT INTO public.time_import_logs (
    file_name, file_path, file_size_bytes, mime_type, batch_id,
    start_date, end_date, imported_by, archive_status, archived_at,
    coverage_scope, covered_employee_external_ids
  ) VALUES (
    'sem-arquivo.txt', v_missing_file_batch || '/sem-arquivo.txt', 32,
    'text/plain', v_missing_file_batch, DATE '1999-03-01', DATE '1999-03-31',
    v_actor, 'pending', NULL, 'listed_employees', ARRAY[v_external_id]
  )
  RETURNING id INTO v_missing_file_log_id;
  UPDATE public.time_import_logs
     SET archive_status = 'available', archived_at = now(),
         notes = 'Confirmação E2E sem objeto físico.'
   WHERE id = v_missing_file_log_id;

  v_rejected := false;
  BEGIN
    PERFORM public.import_time_records_with_archive(
      jsonb_build_array(jsonb_build_object(
        'employee_name', 'E2E RH Folha Principal',
        'employee_external_id', v_external_id,
        'department', 'RH',
        'record_date', '1999-03-03',
        'punches', jsonb_build_array('08:00', '12:00')
      )),
      v_missing_file_log_id,
      0
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('arquivo original confirmado' in SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'protocolo sem objeto no Storage foi processado';
  ASSERT (SELECT status FROM public.time_import_logs WHERE id = v_missing_file_log_id) = 'processing',
    'rejeição por arquivo ausente alterou o protocolo';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.time_records tr WHERE tr.import_batch = v_missing_file_batch
  ), 'rejeição por arquivo ausente deixou batida parcial';

  -- Qualquer erro de validação aborta o protocolo inteiro: nem a primeira linha
  -- válida, nem o período auxiliar, nem as contagens são gravados parcialmente.
  v_bad_file_path := v_bad_batch || '/ponto-invalido.txt';
  INSERT INTO storage.objects (
    bucket_id, name, owner, owner_id, metadata
  ) VALUES (
    'timesheet-imports', v_bad_file_path, v_actor, v_actor::text,
    jsonb_build_object('size', 64, 'mimetype', 'text/plain')
  );
  INSERT INTO public.time_import_logs (
    file_name, file_path, file_size_bytes, mime_type, batch_id,
    start_date, end_date, imported_by, archive_status, archived_at,
    coverage_scope, covered_employee_external_ids
  ) VALUES (
    'ponto-invalido.txt', v_bad_file_path, 64, 'text/plain', v_bad_batch,
    DATE '1999-02-01', DATE '1999-02-28', v_actor, 'pending', NULL,
    'listed_employees', ARRAY[v_external_id]
  )
  RETURNING id INTO v_bad_log_id;
  UPDATE public.time_import_logs
     SET archive_status = 'available', archived_at = now(),
         notes = 'Original E2E inválido preservado; pronto para processar.'
   WHERE id = v_bad_log_id;

  v_bad_payload := jsonb_build_array(
    jsonb_build_object(
      'employee_name', 'E2E RH Folha Principal',
      'employee_external_id', v_external_id,
      'department', 'RH',
      'record_date', '1999-02-03',
      'punches', jsonb_build_array('08:00', '12:00')
    ),
    jsonb_build_object(
      'employee_name', 'E2E RH Folha Principal',
      'employee_external_id', v_external_id,
      'department', 'RH',
      'record_date', '1999-02-04',
      'punches', jsonb_build_array('25:00')
    )
  );

  v_rejected := false;
  BEGIN
    PERFORM public.import_time_records_with_archive(v_bad_payload, v_bad_log_id, 0);
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('Horário inválido' in SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'payload com horário inválido não foi recusado';
  ASSERT (SELECT status FROM public.time_import_logs WHERE id = v_bad_log_id) = 'processing',
    'falha atômica alterou o status do protocolo';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.time_records tr WHERE tr.import_batch = v_bad_batch
  ), 'falha atômica deixou batida parcial';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.time_import_quarantine q WHERE q.import_log_id = v_bad_log_id
  ), 'falha atômica deixou quarentena parcial';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.timesheet_periods p
     WHERE p.start_date = DATE '1999-02-01' AND p.end_date = DATE '1999-02-28'
  ), 'falha atômica deixou período auxiliar parcial';

  UPDATE public.time_import_logs
     SET status = 'error', error_count = 1,
         notes = 'Erro E2E preservado para auditoria.'
   WHERE id = v_bad_log_id;
  v_rejected := false;
  BEGIN
    UPDATE public.time_import_logs
       SET notes = 'tentativa de alterar erro finalizado'
     WHERE id = v_bad_log_id;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('importação finalizada é imutável' IN SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'protocolo em erro foi alterado depois de finalizado';

  -- Adiantamento aberto entra no snapshot e é reivindicado atomically ao
  -- aprovar. O protocolo partial/available cobre todos os dias de janeiro.
  v_advance_id := public.create_employee_advance(
    v_employee_id, 100, DATE '1999-01-05', '08:00',
    'E2E claim/release', '', v_advance_key
  );
  ASSERT (
    SELECT status = 'pending'
       AND payroll_run_id IS NULL
       AND created_by = v_actor
       AND idempotency_key = v_advance_key
       AND created_at IS NOT NULL
      FROM public.employee_advances WHERE id = v_advance_id
  ), 'RPC de cadastro não criou adiantamento pendente com autoria do servidor';

  v_advance_replay_id := public.create_employee_advance(
    v_employee_id, 100, DATE '1999-01-05', '08:00',
    'E2E claim/release', '', v_advance_key
  );
  ASSERT v_advance_replay_id = v_advance_id AND (
    SELECT count(*) = 1 FROM public.employee_advances
     WHERE idempotency_key = v_advance_key
  ), 'replay do cadastro duplicou o adiantamento';

  v_rejected := false;
  BEGIN
    PERFORM public.create_employee_advance(
      v_employee_id, 101, DATE '1999-01-05', '08:00',
      'E2E payload conflitante', '', v_advance_key
    );
  EXCEPTION WHEN unique_violation THEN
    v_rejected := position('Chave de idempotência já usada' IN SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'mesma chave de adiantamento aceitou payload conflitante';
  ASSERT (
    SELECT amount = 100 AND description = 'E2E claim/release'
      FROM public.employee_advances WHERE id = v_advance_id
  ), 'conflito idempotente alterou o adiantamento original';

  v_rejected := false;
  BEGIN
    PERFORM public.create_employee_advance(
      v_employee_id, 10.001, DATE '1999-01-06', '08:00',
      'E2E subcentavo recusado', '', gen_random_uuid()
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := position('até dois decimais' IN SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'adiantamento com fração menor que um centavo foi aceito';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.employee_advances
     WHERE description = 'E2E subcentavo recusado'
  ), 'rejeição de subcentavo deixou adiantamento parcial';

  v_rejected := false;
  BEGIN
    PERFORM public.create_employee_advance(
      v_other_employee_id, 10, DATE '1999-01-06', '08:00',
      'E2E comprovante inexistente',
      'advances/comprovante-inexistente-' || gen_random_uuid()::text || '.pdf',
      gen_random_uuid()
    );
  EXCEPTION WHEN SQLSTATE '23503' THEN
    v_rejected := position('não existe no arquivo permanente' IN SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'adiantamento aceitou comprovante inexistente no Storage';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.employee_advances
     WHERE description = 'E2E comprovante inexistente'
  ), 'rejeição de comprovante inexistente deixou adiantamento parcial';

  v_rejected := false;
  BEGIN
    UPDATE public.employee_advances
       SET description = 'DML direto indevido'
     WHERE id = v_advance_id;
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := position('comandos auditados' in SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'UPDATE direto alterou adiantamento fora dos RPCs';

  v_settled_advance_id := public.create_employee_advance(
    v_other_employee_id, 25, DATE '1999-04-01', '09:00',
    'E2E baixa externa', '', v_settled_advance_key
  );
  PERFORM public.settle_employee_advance_external(v_settled_advance_id);
  ASSERT (
    SELECT status = 'baixado_externo'
       AND settled_at IS NOT NULL
       AND settled_by = v_actor
       AND payroll_run_id IS NULL
      FROM public.employee_advances WHERE id = v_settled_advance_id
  ), 'RPC de baixa externa não preservou a trilha terminal';

  v_cancelled_advance_id := public.create_employee_advance(
    v_other_employee_id, 30, DATE '1999-05-01', '10:00',
    'E2E cancelamento', '', v_cancelled_advance_key
  );
  SELECT created_at INTO v_cancelled_advance_created_at
    FROM public.employee_advances WHERE id = v_cancelled_advance_id;
  PERFORM public.cancel_employee_advance(
    v_cancelled_advance_id,
    '  lançamento duplicado E2E  '
  );
  ASSERT (
    SELECT status = 'cancelado'
       AND cancelled_at IS NOT NULL
       AND cancelled_by = v_actor
       AND cancellation_reason = 'lançamento duplicado E2E'
       AND created_at = v_cancelled_advance_created_at
       AND created_by = v_actor
       AND payroll_run_id IS NULL
      FROM public.employee_advances WHERE id = v_cancelled_advance_id
  ), 'RPC de cancelamento não preservou cadastro e trilha do adiantamento';

  v_rejected := false;
  BEGIN
    DELETE FROM public.employee_advances WHERE id = v_cancelled_advance_id;
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_rejected := position('não podem ser excluídos' in SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'DELETE apagou adiantamento cancelado';
  ASSERT EXISTS (
    SELECT 1 FROM public.employee_advances WHERE id = v_cancelled_advance_id
  ), 'tentativa de DELETE removeu a trilha do adiantamento';

  v_bulk_advance_id := public.create_employee_advance(
    v_other_employee_id, 35, DATE '1999-05-10', '11:00',
    'E2E baixa externa em lote', '', v_bulk_advance_key
  );
  v_count := public.settle_employee_advances_external(
    v_other_employee_id, DATE '1999-05-02', DATE '1999-06-01'
  );
  ASSERT v_count = 1 AND (
    SELECT status = 'baixado_externo' AND settled_by = v_actor
      FROM public.employee_advances WHERE id = v_bulk_advance_id
  ), 'RPC de baixa externa em lote atingiu conjunto incorreto';

  v_input_epoch := public.begin_payroll_calculation();
  ASSERT v_input_epoch IS NOT NULL AND v_input_epoch > 0,
    'begin_payroll_calculation não devolveu revisão válida';
  v_snapshot := jsonb_build_object(
    'schema_version', 1,
    'input_epoch', v_input_epoch,
    'rule_version', 'e2e-rh-v1',
    'period', jsonb_build_object('from', '1999-01-01', 'to', '1999-01-31'),
    'employee', jsonb_build_object(
      'id', v_employee_id,
      'payment_type', 'mensalista'
    ),
    'result', jsonb_build_object(
      'rule_version', 'e2e-rh-v1',
      'payment_type', 'mensalista',
      'advances_total', 100,
      'total_proventos', 1000,
      'total_descontos', 100,
      'gross_value', 1000,
      'net_value', 900,
      'pending_days', 0,
      'he_rate_missing', false
    )
  );

  -- Mesmo com um snapshot internamente coerente, INSERT não pode pular o
  -- trigger de UPDATE que reivindica adiantamentos e horas extras.
  v_rejected := false;
  BEGIN
    INSERT INTO public.payroll_runs (
      id, employee_id, period, base_salary, total_proventos,
      total_descontos, advances_total, total_liquido,
      calculation_rule_version, calculation_snapshot, status
    ) VALUES (
      v_run_id, v_employee_id, '1999-01', 1000, 1000,
      100, 100, 900, 'e2e-rh-v1', v_snapshot, 'aprovado'
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_rejected := position('nascer como rascunho' in SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'INSERT criou folha fechada sem executar o writer atômico';
  ASSERT NOT EXISTS (SELECT 1 FROM public.payroll_runs WHERE id = v_run_id),
    'INSERT fechado recusado deixou folha parcial';

  v_rejected := false;
  BEGIN
    INSERT INTO public.payroll_runs (
      id, employee_id, period, base_salary, total_proventos,
      total_descontos, advances_total, total_liquido,
      calculation_rule_version, calculation_snapshot, status
    ) VALUES (
      v_closed_insert_id, v_employee_id, '1999-01', 1000, 1000,
      100, 100, 900, 'e2e-rh-v1', v_snapshot, 'pago'
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_rejected := position('nascer como rascunho' in SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'INSERT criou folha paga sem executar o writer atômico';
  ASSERT NOT EXISTS (SELECT 1 FROM public.payroll_runs WHERE id = v_closed_insert_id),
    'INSERT pago recusado deixou folha parcial';

  v_rejected := false;
  BEGIN
    INSERT INTO public.payroll_runs (
      id, employee_id, period, base_salary, total_proventos,
      total_descontos, advances_total, total_liquido,
      calculation_rule_version, calculation_snapshot, status,
      approved_at, approved_by, paid_at
    ) VALUES (
      v_run_id, v_employee_id, '1999-01', 1000, 1000,
      100, 100, 900, 'e2e-rh-v1', v_snapshot, 'rascunho',
      TIMESTAMPTZ '2000-01-01 00:00:00+00', NULL,
      TIMESTAMPTZ '2000-01-02 00:00:00+00'
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_rejected := position('nascer como rascunho' in SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'rascunho nasceu com paid_at enviado pelo cliente';
  ASSERT NOT EXISTS (SELECT 1 FROM public.payroll_runs WHERE id = v_run_id),
    'rascunho com paid_at recusado deixou folha parcial';

  v_rejected := false;
  BEGIN
    INSERT INTO public.payroll_runs (
      id, employee_id, period, base_salary, total_proventos,
      total_descontos, advances_total, total_liquido,
      calculation_rule_version, calculation_snapshot, status,
      approved_at, approved_by
    ) VALUES (
      v_run_id, v_employee_id, '1999-01', 1000, 1000,
      100, 100, 900, 'e2e-rh-v1', v_snapshot, 'rascunho',
      TIMESTAMPTZ '2000-01-01 00:00:00+00', NULL
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_rejected := position('nascer como rascunho' in SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'rascunho nasceu com approved_at enviado pelo cliente';
  ASSERT NOT EXISTS (SELECT 1 FROM public.payroll_runs WHERE id = v_run_id),
    'rascunho com approved_at recusado deixou folha parcial';

  INSERT INTO public.payroll_runs (
    id, employee_id, period, base_salary, total_proventos,
    total_descontos, advances_total, total_liquido,
    calculation_rule_version, calculation_snapshot, status
  ) VALUES (
    v_run_id, v_employee_id, '1999-01', 1000, 1000,
    100, 100, 900, 'e2e-rh-v1', v_snapshot, 'rascunho'
  );

  -- Simula uma nova transação de escrita dentro do envelope ROLLBACK do E2E.
  -- A revisão obtida antes da mutação não pode fechar nem reivindicar vales.
  PERFORM set_config('app.payroll_input_epoch_bumped', '', true);
  UPDATE public.employees
     SET department = 'RH E2E atualizado'
   WHERE id = v_employee_id;
  v_fresh_input_epoch := public.begin_payroll_calculation();
  ASSERT v_fresh_input_epoch > v_input_epoch,
    'mutação de fonte não avançou payroll_input_epoch';

  v_rejected := false;
  BEGIN
    UPDATE public.payroll_runs SET status = 'aprovado' WHERE id = v_run_id;
  EXCEPTION WHEN SQLSTATE '40001' THEN
    v_rejected := position('mudaram desde o cálculo' in SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'snapshot obsoleto fechou a folha após mutação da fonte';
  ASSERT (SELECT status FROM public.payroll_runs WHERE id = v_run_id) = 'rascunho',
    'rejeição por frescor deixou a folha parcialmente fechada';
  ASSERT (
    SELECT status = 'pending' AND payroll_run_id IS NULL
      FROM public.employee_advances WHERE id = v_advance_id
  ), 'rejeição por frescor reivindicou adiantamento';

  v_input_epoch := v_fresh_input_epoch;
  v_snapshot := jsonb_set(v_snapshot, '{input_epoch}', to_jsonb(v_input_epoch));
  UPDATE public.payroll_runs
     SET calculation_snapshot = jsonb_set(
       v_snapshot,
       '{employee,id}',
       to_jsonb(v_other_employee_id::text)
     )
   WHERE id = v_run_id;

  v_rejected := false;
  BEGIN
    UPDATE public.payroll_runs SET status = 'aprovado' WHERE id = v_run_id;
  EXCEPTION WHEN SQLSTATE '22000' THEN
    v_rejected := position('Snapshot da folha diverge' in SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'snapshot de outra pessoa foi aceito no fechamento';
  ASSERT (
    SELECT status = 'pending' AND payroll_run_id IS NULL
      FROM public.employee_advances WHERE id = v_advance_id
  ), 'rejeição tardia do snapshot deixou reivindicação parcial';

  UPDATE public.payroll_runs
     SET total_liquido = 999,
         calculation_snapshot = jsonb_set(v_snapshot, '{result,net_value}', '999'::jsonb)
   WHERE id = v_run_id;

  v_rejected := false;
  BEGIN
    UPDATE public.payroll_runs SET status = 'aprovado' WHERE id = v_run_id;
  EXCEPTION WHEN SQLSTATE '22000' THEN
    v_rejected := position('Snapshot da folha diverge' in SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'líquido fora de proventos − descontos foi aceito';

  UPDATE public.payroll_runs
     SET total_liquido = 900,
         calculation_snapshot = v_snapshot
   WHERE id = v_run_id;
  UPDATE public.payroll_runs SET status = 'aprovado' WHERE id = v_run_id;
  SELECT approved_at INTO v_approved_at
    FROM public.payroll_runs WHERE id = v_run_id;
  ASSERT (
    SELECT approved_at = v_approved_at
       AND approved_at IS DISTINCT FROM TIMESTAMPTZ '2000-01-01 00:00:00+00'
       AND approved_by = v_actor
       AND paid_at IS NULL
      FROM public.payroll_runs WHERE id = v_run_id
  ), 'aprovação não substituiu relógio/autoria enviados pelo cliente';
  ASSERT (
    SELECT a.status = 'deducted'
       AND a.payroll_run_id = v_run_id
       AND a.pre_deduction_status = 'pending'
       AND a.deducted_at IS NOT NULL
      FROM public.employee_advances a WHERE a.id = v_advance_id
  ), 'aprovação não reivindicou o adiantamento com seu estado anterior';

  INSERT INTO public.time_import_quarantine (
    id, import_log_id, batch_id, employee_external_id, employee_name,
    department, record_date, punches, reason
  ) VALUES (
    v_closed_quarantine_id, v_log_id, v_batch, v_external_id,
    'E2E RH Folha Principal', 'RH', DATE '1999-01-07',
    jsonb_build_array('08:00', '12:00'),
    'E2E resolução bloqueada por folha fechada'
  );
  UPDATE public.timesheet_periods
     SET status = 'fechado'
   WHERE id = (SELECT period_id FROM public.time_import_logs WHERE id = v_log_id);
  ASSERT (SELECT status = 'fechado' FROM public.timesheet_periods
           WHERE id = (SELECT period_id FROM public.time_import_logs WHERE id = v_log_id)),
    'fixture não fechou o período de ponto antes de testar o resolver';
  v_rejected := false;
  BEGIN
    PERFORM public.resolve_time_import_quarantine(v_closed_quarantine_id);
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_rejected := position('período de ponto está fechado' IN SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'resolver inseriu batida dentro de período de ponto fechado';
  ASSERT (
    SELECT resolved_at IS NULL AND time_record_id IS NULL
      FROM public.time_import_quarantine WHERE id = v_closed_quarantine_id
  ) AND NOT EXISTS (
    SELECT 1 FROM public.time_records
     WHERE employee_external_id = v_external_id
       AND record_date = DATE '1999-01-07'
  ), 'rejeição por período de ponto fechado deixou resolução parcial';

  -- Reabre somente a fixture do ponto para que o próximo cenário prove o
  -- bloqueio independente da folha aprovada, sem ser interceptado antes pelo
  -- guard do período operacional.
  UPDATE public.timesheet_periods
     SET status = 'aberto'
   WHERE id = (SELECT period_id FROM public.time_import_logs WHERE id = v_log_id);

  v_rejected := false;
  BEGIN
    UPDATE public.payroll_runs
       SET approved_at = TIMESTAMPTZ '2001-01-01 00:00:00+00',
           approved_by = NULL
     WHERE id = v_run_id;
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := position('finalizada' in SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'cliente adulterou approved_at/approved_by após aprovação';
  ASSERT (
    SELECT approved_at = v_approved_at AND approved_by = v_actor
      FROM public.payroll_runs WHERE id = v_run_id
  ), 'tentativa de adulteração alterou a auditoria da aprovação';

  -- Líquido zero não exige pagamento fictício. A folha nasce em rascunho,
  -- fecha pelo mesmo writer e é derivada diretamente para paga.
  INSERT INTO public.payroll_runs (
    id, employee_id, period, base_salary, total_proventos,
    total_descontos, advances_total, total_liquido, status
  ) VALUES (
    v_zero_run_id, v_zero_employee_id, '1999-06', 0, 0,
    0, 0, 0, 'rascunho'
  );
  UPDATE public.payroll_runs
     SET calculation_rule_version = 'e2e-zero-v1',
         calculation_snapshot = jsonb_build_object(
           'schema_version', 1,
           'input_epoch', v_input_epoch,
           'rule_version', 'e2e-zero-v1',
           'period', jsonb_build_object('from', '1999-06-01', 'to', '1999-06-30'),
           'employee', jsonb_build_object(
             'id', v_zero_employee_id,
             'payment_type', 'remoto'
           ),
           'result', jsonb_build_object(
             'rule_version', 'e2e-zero-v1',
             'payment_type', 'remoto',
             'advances_total', 0,
             'total_proventos', 0,
             'total_descontos', 0,
             'gross_value', 0,
             'net_value', 0,
             'pending_days', 0,
             'he_rate_missing', false
           )
         )
   WHERE id = v_zero_run_id;
  UPDATE public.payroll_runs SET status = 'aprovado' WHERE id = v_zero_run_id;
  ASSERT (
    SELECT status = 'pago'
       AND paid_at IS NOT NULL
       AND paid_at IS DISTINCT FROM TIMESTAMPTZ '2000-02-02 00:00:00+00'
       AND approved_at IS DISTINCT FROM TIMESTAMPTZ '2000-02-01 00:00:00+00'
       AND approved_by = v_actor
       AND round(COALESCE(total_liquido, 0), 2) = 0
       AND round(COALESCE(total_proventos, 0) - COALESCE(total_descontos, 0), 2) = 0
      FROM public.payroll_runs WHERE id = v_zero_run_id
  ), 'folha de líquido zero não derivou para paga com equação íntegra';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.payroll_payments WHERE payroll_run_id = v_zero_run_id
  ), 'folha de líquido zero fabricou pagamento';

  v_rejected := false;
  BEGIN
    UPDATE public.time_records
       SET record_date = DATE '1999-02-03',
           employee_external_id = v_other_external_id
     WHERE employee_external_id = v_external_id
       AND record_date = DATE '1999-01-03';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_rejected := position('folha fechada' in SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'batida de folha fechada foi movida para pessoa/período aberto';
  ASSERT EXISTS (
    SELECT 1 FROM public.time_records tr
    WHERE tr.employee_external_id = v_external_id
      AND tr.record_date = DATE '1999-01-03'
  ), 'tentativa bloqueada alterou a fonte histórica do ponto';

  -- Cobertura é diária e deriva somente de protocolo finalizado + arquivo
  -- disponível. O protocolo de fevereiro permanece processing e não cobre nada.
  INSERT INTO public.payroll_runs (
    id, employee_id, period, base_salary, total_proventos,
    total_descontos, advances_total, total_liquido,
    calculation_rule_version, calculation_snapshot, status
  ) VALUES (
    v_uncovered_run_id, v_other_employee_id, '1999-02', 1000, 1000,
    0, 0, 1000, 'e2e-rh-v1',
    jsonb_build_object(
      'schema_version', 1,
      'input_epoch', v_input_epoch,
      'rule_version', 'e2e-rh-v1',
      'period', jsonb_build_object('from', '1999-02-01', 'to', '1999-02-28'),
      'employee', jsonb_build_object(
        'id', v_other_employee_id,
        'payment_type', 'mensalista'
      ),
      'result', jsonb_build_object(
        'rule_version', 'e2e-rh-v1',
        'payment_type', 'mensalista',
        'advances_total', 0,
        'total_proventos', 1000,
        'total_descontos', 0,
        'gross_value', 1000,
        'net_value', 1000,
        'pending_days', 0,
        'he_rate_missing', false
      )
    ),
    'rascunho'
  );

  v_rejected := false;
  BEGIN
    UPDATE public.payroll_runs SET status = 'aprovado' WHERE id = v_uncovered_run_id;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('Ponto sem arquivo de cobertura' in SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'folha sem cobertura diária foi aprovada';
  ASSERT (SELECT status FROM public.payroll_runs WHERE id = v_uncovered_run_id) = 'rascunho',
    'rejeição de cobertura deixou atualização parcial';

  -- Pagamento exige a mesma pessoa, é registrado/estornado por RPC e preserva
  -- recibo, autoria e chave. Somente linhas não estornadas compõem a quitação.
  v_receipt_path := v_run_id::text || '/recibo-e2e.pdf';
  INSERT INTO storage.objects (
    bucket_id, name, owner, owner_id, metadata
  ) VALUES
    (
      'employee-receipts', v_receipt_path, v_actor, v_actor::text,
      jsonb_build_object('size', 321, 'mimetype', 'application/pdf', 'e2e', 'referenced')
    ),
    (
      'employee-receipts', v_unreferenced_receipt_path, v_actor, v_actor::text,
      jsonb_build_object('size', 123, 'mimetype', 'application/pdf', 'e2e', 'orphan')
    );

  v_rejected := false;
  BEGIN
    PERFORM public.register_payroll_payment(
      v_run_id, v_employee_id, 10, 'pix', (now() AT TIME ZONE 'America/Sao_Paulo')::date + 1,
      'E2E data futura', '', '', '', NULL, '', gen_random_uuid()
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := position('não pode estar no futuro' IN SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'pagamento com data futura foi aceito e poderia quitar a folha antes da saída';

  v_rejected := false;
  BEGIN
    PERFORM public.register_payroll_payment(
      v_run_id, v_employee_id, 10.001, 'pix', (now() AT TIME ZONE 'America/Sao_Paulo')::date,
      'E2E subcentavo', '', '', '', NULL, '', gen_random_uuid()
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := position('até dois decimais' IN SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'pagamento com fração menor que um centavo foi aceito';

  v_rejected := false;
  BEGIN
    PERFORM public.register_payroll_payment(
      v_run_id, v_employee_id, 10, 'pix', (now() AT TIME ZONE 'America/Sao_Paulo')::date,
      'E2E recibo ausente', '', v_run_id::text || '/inexistente.pdf',
      'inexistente.pdf', 321, 'application/pdf', gen_random_uuid()
    );
  EXCEPTION WHEN SQLSTATE '23503' THEN
    v_rejected := position('não existe no arquivo permanente' IN SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'pagamento aceitou path de recibo inexistente';

  v_rejected := false;
  BEGIN
    PERFORM public.register_payroll_payment(
      v_run_id, v_employee_id, 10, 'pix', (now() AT TIME ZONE 'America/Sao_Paulo')::date,
      'E2E metadado divergente', '', v_receipt_path,
      'recibo-e2e.pdf', 999, 'application/pdf', gen_random_uuid()
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := position('tamanho do recibo não confere' IN SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'pagamento aceitou metadados divergentes do recibo';

  v_rejected := false;
  BEGIN
    PERFORM public.register_payroll_payment(
      v_run_id, v_other_employee_id, 10, 'pix', (now() AT TIME ZONE 'America/Sao_Paulo')::date,
      'E2E pessoa errada', '', '', '', NULL, '', gen_random_uuid()
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := position('não pertence ao funcionário' in SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'pagamento de outra pessoa foi aceito na folha';

  -- Mesmo um backend/service_role não pode agendar uma quitação no futuro por
  -- DML direto: a regra é do ledger, não apenas da interface/RPC.
  v_rejected := false;
  BEGIN
    INSERT INTO public.payroll_payments (
      payroll_run_id, employee_id, paid_on, amount, method, reference,
      created_by, idempotency_key
    ) VALUES (
      v_run_id, v_employee_id,
      (now() AT TIME ZONE 'America/Sao_Paulo')::date + 1,
      1, 'pix', 'E2E futuro direto', v_actor, gen_random_uuid()
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := position('não pode ser futura' IN SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'trigger aceitou pagamento futuro por DML direto';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.payroll_payments p
    WHERE p.payroll_run_id = v_run_id AND p.reference = 'E2E futuro direto'
  ), 'rejeição de pagamento futuro deixou lançamento parcial';

  v_payment_id := public.register_payroll_payment(
    v_run_id, v_employee_id, 600, 'pix', (now() AT TIME ZONE 'America/Sao_Paulo')::date,
    'E2E parcial', 'recibo preservado', v_receipt_path,
    'recibo-e2e.pdf', 321, 'application/pdf', v_payment_key
  );
  v_payment_replay_id := public.register_payroll_payment(
    v_run_id, v_employee_id, 600, 'pix', (now() AT TIME ZONE 'America/Sao_Paulo')::date,
    'E2E parcial', 'recibo preservado', v_receipt_path,
    'recibo-e2e.pdf', 321, 'application/pdf', v_payment_key
  );
  ASSERT v_payment_replay_id = v_payment_id AND (
    SELECT count(*) = 1 FROM public.payroll_payments
     WHERE idempotency_key = v_payment_key
  ), 'replay do RPC duplicou pagamento idempotente';
  ASSERT (
    SELECT p.created_by = v_actor
       AND p.idempotency_key = v_payment_key
       AND p.receipt_path = v_receipt_path
       AND p.receipt_name = 'recibo-e2e.pdf'
       AND p.receipt_size = 321
       AND p.receipt_mime = 'application/pdf'
       AND p.reversed_at IS NULL
      FROM public.payroll_payments p WHERE p.id = v_payment_id
  ), 'pagamento válido não preservou autoria, chave ou recibo';
  ASSERT (SELECT status FROM public.payroll_runs WHERE id = v_run_id) = 'aprovado',
    'pagamento parcial marcou a folha como paga';

  v_rejected := false;
  BEGIN
    UPDATE public.payroll_payments
       SET receipt_path = v_run_id::text || '/recibo-adulterado.pdf'
     WHERE id = v_payment_id;
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_rejected := position('recibo são imutáveis' in SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'UPDATE direto adulterou o recibo financeiro';
  ASSERT (
    SELECT receipt_path = v_receipt_path FROM public.payroll_payments
     WHERE id = v_payment_id
  ), 'tentativa de UPDATE alterou o path do recibo';

  v_rejected := false;
  BEGIN
    DELETE FROM public.payroll_payments WHERE id = v_payment_id;
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_rejected := position('não podem ser excluídos' in SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'DELETE apagou pagamento financeiro';

  v_rejected := false;
  BEGIN
    UPDATE public.payroll_runs SET status = 'pago' WHERE id = v_run_id;
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_rejected := position('pagamentos cobrem o saldo líquido' in SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'UPDATE direto marcou pagamento parcial como quitação';

  v_rejected := false;
  BEGIN
    PERFORM public.register_payroll_payment(
      v_run_id, v_employee_id, 301, 'pix', (now() AT TIME ZONE 'America/Sao_Paulo')::date,
      'E2E excesso', '', '', '', NULL, '', gen_random_uuid()
    );
  EXCEPTION WHEN SQLSTATE '22003' THEN
    v_rejected := position('excede o saldo' in SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'pagamento acima do saldo líquido foi aceito';
  ASSERT (
    SELECT COALESCE(sum(p.amount) FILTER (WHERE p.reversed_at IS NULL), 0) = 600
      FROM public.payroll_payments p WHERE p.payroll_run_id = v_run_id
  ), 'tentativa de excesso deixou pagamento parcial';

  v_final_payment_id := public.register_payroll_payment(
    v_run_id, v_employee_id, 300, 'pix', (now() AT TIME ZONE 'America/Sao_Paulo')::date,
    'E2E quitação', '', '', '', NULL, '', v_final_payment_key
  );
  SELECT paid_at INTO v_paid_at FROM public.payroll_runs WHERE id = v_run_id;
  ASSERT v_paid_at IS NOT NULL
     AND (SELECT status FROM public.payroll_runs WHERE id = v_run_id) = 'pago',
    'quitação integral não derivou status/paid_at do servidor';

  UPDATE public.payroll_runs
     SET paid_at = TIMESTAMPTZ '2001-02-01 00:00:00+00'
   WHERE id = v_run_id;
  ASSERT (SELECT paid_at = v_paid_at FROM public.payroll_runs WHERE id = v_run_id),
    'cliente adulterou paid_at de folha paga';

  PERFORM public.reverse_payroll_payment(
    v_final_payment_id,
    '  estorno parcial E2E  '
  );
  ASSERT (
    SELECT reversed_at IS NOT NULL
       AND reversed_by = v_actor
       AND reversal_reason = 'estorno parcial E2E'
      FROM public.payroll_payments WHERE id = v_final_payment_id
  ), 'RPC de estorno não gravou autoria/motivo';
  ASSERT (
    SELECT status = 'aprovado' AND paid_at IS NULL
      FROM public.payroll_runs WHERE id = v_run_id
  ), 'estorno parcial não reabriu automaticamente o saldo da folha';
  ASSERT (
    SELECT COALESCE(sum(amount), 0) = 900
       AND COALESCE(sum(amount) FILTER (WHERE reversed_at IS NULL), 0) = 600
      FROM public.payroll_payments WHERE payroll_run_id = v_run_id
  ), 'soma financeira incluiu pagamento estornado';

  -- Uma reposição integral precisa caber mesmo com a linha estornada preservada.
  v_replacement_payment_id := public.register_payroll_payment(
    v_run_id, v_employee_id, 300, 'pix', (now() AT TIME ZONE 'America/Sao_Paulo')::date,
    'E2E reposição', '', '', '', NULL, '', v_replacement_payment_key
  );
  ASSERT (
    SELECT status = 'pago' AND paid_at IS NOT NULL
      FROM public.payroll_runs WHERE id = v_run_id
  ), 'pagamento de reposição não quitou a folha pela soma ativa';
  ASSERT (
    SELECT COALESCE(sum(amount), 0) = 1200
       AND COALESCE(sum(amount) FILTER (WHERE reversed_at IS NULL), 0) = 900
      FROM public.payroll_payments WHERE payroll_run_id = v_run_id
  ), 'linhas estornadas interferiram no limite ou na quitação';

  PERFORM public.reverse_payroll_payment(v_replacement_payment_id, 'reabrir E2E');
  ASSERT (SELECT status FROM public.payroll_runs WHERE id = v_run_id) = 'aprovado',
    'estorno da reposição não reabriu a folha';
  PERFORM public.reverse_payroll_payment(v_payment_id, 'cancelar saldo E2E');
  ASSERT (
    SELECT count(*) = 3
       AND count(*) FILTER (WHERE reversed_at IS NULL) = 0
       AND bool_and(receipt_path = v_receipt_path OR receipt_path = '')
      FROM public.payroll_payments WHERE payroll_run_id = v_run_id
  ), 'estorno removeu linhas ou deixou saldo ativo';
  ASSERT (
    SELECT receipt_path = v_receipt_path
       AND receipt_name = 'recibo-e2e.pdf'
       AND receipt_size = 321
       AND receipt_mime = 'application/pdf'
      FROM public.payroll_payments WHERE id = v_payment_id
  ), 'estorno alterou o recibo do pagamento';

  -- Cancelar muda o ciclo de vida, nunca o documento salarial congelado.
  -- DML direto não é um comando de cancelamento e não pode aproveitar a
  -- transição para adulterar valores ou omitir a justificativa.
  v_rejected := false;
  BEGIN
    UPDATE public.payroll_runs
       SET status = 'cancelado', total_proventos = 9999
     WHERE id = v_run_id;
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := position('comando de cancelamento auditado' in SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'cancelamento alterou valores da folha finalizada';
  ASSERT (
    SELECT status = 'aprovado' AND total_proventos = 1000
      FROM public.payroll_runs WHERE id = v_run_id
  ), 'cancelamento inválido deixou mutação parcial';

  PERFORM public.cancel_payroll_run(v_run_id, '  recalcular folha E2E  ');
  SELECT status INTO v_status FROM public.payroll_runs WHERE id = v_run_id;
  ASSERT v_status = 'cancelado', 'folha aprovada sem pagamentos ativos não foi cancelada';
  ASSERT (
    SELECT reason = 'recalcular folha E2E'
       AND cancelled_by = v_actor
       AND cancelled_at IS NOT NULL
      FROM public.payroll_run_cancellations
     WHERE payroll_run_id = v_run_id
  ), 'cancelamento não gravou justificativa, autoria e data';
  ASSERT (
    SELECT employee_id = v_employee_id
       AND period = '1999-01'
       AND base_salary = 1000
       AND total_proventos = 1000
       AND total_descontos = 100
       AND advances_total = 100
       AND total_liquido = 900
       AND calculation_rule_version = 'e2e-rh-v1'
       AND calculation_snapshot = v_snapshot
       AND approved_at = v_approved_at
       AND approved_by = v_actor
       AND paid_at IS NULL
      FROM public.payroll_runs WHERE id = v_run_id
  ), 'cancelamento não preservou integralmente o documento salarial';
  ASSERT (
    SELECT a.status = 'pending'
       AND a.payroll_run_id IS NULL
       AND a.pre_deduction_status IS NULL
       AND a.deducted_at IS NULL
      FROM public.employee_advances a WHERE a.id = v_advance_id
  ), 'cancelamento não restaurou exatamente o estado aberto do adiantamento';

  INSERT INTO public.payroll_runs (
    id, employee_id, period, base_salary, total_proventos,
    total_descontos, advances_total, total_liquido, status
  ) VALUES (
    v_replacement_run_id, v_employee_id, '1999-01', 1000, 1000,
    100, 100, 900, 'rascunho'
  );
  ASSERT EXISTS (
    SELECT 1 FROM public.payroll_runs
     WHERE id = v_run_id AND status = 'cancelado'
  ) AND EXISTS (
    SELECT 1 FROM public.payroll_runs
     WHERE id = v_replacement_run_id AND status = 'rascunho'
  ), 'folha cancelada não liberou nova geração preservando o histórico';

  -- O bloco seguinte roda de fato como role authenticated e prova ACL/RLS.
  PERFORM set_config('app.e2e_advance_id', v_advance_id::text, true);
  PERFORM set_config('app.e2e_payment_id', v_payment_id::text, true);
  PERFORM set_config('app.e2e_employee_id', v_employee_id::text, true);
  PERFORM set_config('app.e2e_run_id', v_run_id::text, true);
  PERFORM set_config('app.e2e_receipt_path', v_receipt_path, true);
  PERFORM set_config('app.e2e_orphan_receipt_path', v_unreferenced_receipt_path, true);
  PERFORM set_config('app.e2e_quarantine_id', v_quarantine_id::text, true);

  RAISE NOTICE 'OK: importação, cobertura, epoch, adiantamentos, pagamentos e cancelamento validados';
END
$test$;

SET LOCAL ROLE authenticated;

DO $authenticated_acl$
DECLARE
  v_rejected boolean;
  v_count integer;
  v_advance_id uuid := current_setting('app.e2e_advance_id')::uuid;
  v_payment_id uuid := current_setting('app.e2e_payment_id')::uuid;
  v_employee_id uuid := current_setting('app.e2e_employee_id')::uuid;
  v_run_id uuid := current_setting('app.e2e_run_id')::uuid;
  v_quarantine_id uuid := current_setting('app.e2e_quarantine_id')::uuid;
  v_receipt_path text := current_setting('app.e2e_receipt_path');
  v_orphan_path text := current_setting('app.e2e_orphan_receipt_path');
BEGIN
  ASSERT COALESCE((
    public.resolve_time_import_quarantine(v_quarantine_id)->>'idempotent'
  )::boolean, false), 'role authenticated de RH não executou o resolver idempotente';

  v_rejected := false;
  BEGIN
    INSERT INTO public.employee_advances (
      employee_id, amount, advance_date, description, status
    ) VALUES (v_employee_id, 1, DATE '1999-07-01', 'DML negado', 'pending');
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := true;
  END;
  ASSERT v_rejected, 'role authenticated inseriu adiantamento sem RPC';

  v_rejected := false;
  BEGIN
    UPDATE public.employee_advances SET description = 'DML negado' WHERE id = v_advance_id;
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := true;
  END;
  ASSERT v_rejected, 'role authenticated atualizou adiantamento sem RPC';

  v_rejected := false;
  BEGIN
    DELETE FROM public.employee_advances WHERE id = v_advance_id;
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := true;
  END;
  ASSERT v_rejected, 'role authenticated excluiu adiantamento sem RPC';

  v_rejected := false;
  BEGIN
    INSERT INTO public.payroll_payments (
      payroll_run_id, employee_id, paid_on, amount, method
    ) VALUES (v_run_id, v_employee_id, DATE '1999-07-01', 1, 'pix');
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := true;
  END;
  ASSERT v_rejected, 'role authenticated inseriu pagamento sem RPC';

  v_rejected := false;
  BEGIN
    UPDATE public.payroll_payments SET notes = 'DML negado' WHERE id = v_payment_id;
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := true;
  END;
  ASSERT v_rejected, 'role authenticated atualizou pagamento sem RPC';

  v_rejected := false;
  BEGIN
    DELETE FROM public.payroll_payments WHERE id = v_payment_id;
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := true;
  END;
  ASSERT v_rejected, 'role authenticated excluiu pagamento sem RPC';

  UPDATE storage.objects
     SET metadata = metadata || jsonb_build_object('retry', 'bloqueado')
   WHERE bucket_id = 'employee-receipts' AND name = v_receipt_path;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  ASSERT v_count = 0, 'recibo referenciado foi substituído pela policy de retry';
  v_rejected := false;
  BEGIN
    DELETE FROM storage.objects
     WHERE bucket_id = 'employee-receipts' AND name = v_receipt_path;
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := position('Storage API' IN SQLERRM) > 0
      OR position('Direct deletion' IN SQLERRM) > 0;
  END;
  ASSERT v_rejected, 'DELETE SQL direto de recibo não foi bloqueado pelo Storage';
  ASSERT EXISTS (
    SELECT 1 FROM storage.objects
     WHERE bucket_id = 'employee-receipts'
       AND name = v_receipt_path
       AND metadata->>'retry' IS NULL
  ), 'teste de imutabilidade alterou o recibo referenciado';

  UPDATE storage.objects
     SET metadata = metadata || jsonb_build_object('retry', 'permitido')
   WHERE bucket_id = 'employee-receipts' AND name = v_orphan_path;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  ASSERT v_count = 1, 'upload órfão não pôde ser substituído no retry';
  ASSERT EXISTS (
    SELECT 1 FROM storage.objects
     WHERE bucket_id = 'employee-receipts'
       AND name = v_orphan_path
       AND metadata->>'retry' = 'permitido'
  ), 'retry não preservou a atualização do upload órfão';
  ASSERT EXISTS (
    SELECT 1
      FROM pg_policies p
     WHERE p.schemaname = 'storage'
       AND p.tablename = 'objects'
       AND p.policyname = 'employee_receipts_rh_delete_unreferenced'
       AND p.cmd = 'DELETE'
  ), 'upload órfão não tem policy de remoção para novo retry';
END
$authenticated_acl$;

RESET ROLE;

SET LOCAL ROLE anon;

DO $anon_acl$
DECLARE
  v_rejected boolean := false;
BEGIN
  BEGIN
    PERFORM public.resolve_time_import_quarantine(
      current_setting('app.e2e_quarantine_id')::uuid
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := true;
  END;
  ASSERT v_rejected, 'role anon executou o resolver da quarentena';
END
$anon_acl$;

RESET ROLE;

ROLLBACK;
