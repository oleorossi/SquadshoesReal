-- Prova isolada do writer de pagamento do ciclo apos a migration 15900.
-- Executar somente em dry-run transacional. Nao executa fechamento/accruals:
-- o fixture insere ciclos closed sinteticos para isolar closed -> paid.
-- Um administrador aprovado existente e apenas lido; nenhum perfil e alterado.
-- Os ciclos paid sinteticos reproduzem os hashes/snapshots da implementacao
-- pre-159, sem reexecutar o writer antigo nem fabricar caixa por UPDATE.
-- Este arquivo nao foi executado pelo autor. A migration 15900 atual ja contem
-- as correcoes de hash legado/metodo explicito que os ASSERTs abaixo verificam.
-- Setup posterior a migration: o unico DDL e esta tabela TEMP; nao cria funcao,
-- trigger, tabela permanente nem altera/desativa guardas existentes.

BEGIN;
SET LOCAL statement_timeout = '90s';
SET LOCAL lock_timeout = '15s';
SET LOCAL plpgsql.check_asserts = on;

CREATE TEMP TABLE e2e_financial159_cycle_fixture (
  scenario text PRIMARY KEY,
  cycle_id uuid NOT NULL,
  payable_id uuid,
  admin_id uuid NOT NULL
) ON COMMIT DROP;

DO $setup_financial159_cycles$
DECLARE
  v_admin uuid;
  v_contractor uuid;
  v_calendar uuid;
  v_schedule uuid;
  v_cycle uuid;
  v_payable uuid;
  v_scenario text;
  v_position integer := 0;
  v_method text;
  v_today date := (pg_catalog.clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  ASSERT pg_catalog.to_regclass('public.financial_settlement_events') IS NOT NULL,
    'A prova do ciclo exige a migration 15900 aplicada na transacao';
  SELECT profile.id INTO v_admin
    FROM public.profiles profile
    JOIN public.user_roles user_role ON user_role.user_id = profile.id
   WHERE profile.approved IS TRUE AND user_role.role::text = 'admin'
   ORDER BY profile.id LIMIT 1;
  ASSERT v_admin IS NOT NULL, 'Fixture exige administrador aprovado existente; nao cria usuario';
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object(
    'role', 'authenticated', 'sub', v_admin::text
  )::text, true);

  INSERT INTO public.contractors(name, notes)
  VALUES ('E2E FIN159 ciclo ' || pg_catalog.gen_random_uuid()::text, 'Somente rollback')
  RETURNING id INTO v_contractor;
  INSERT INTO public.strap_operational_calendars(name, calendar_type)
  VALUES ('E2E FIN159 banco ' || pg_catalog.gen_random_uuid()::text, 'banking')
  RETURNING id INTO v_calendar;
  INSERT INTO public.contractor_payment_schedules(
    contractor_id, frequency, cutoff_iso_weekday, payment_offset_days,
    bank_calendar_id, version, valid_from
  ) VALUES (v_contractor, 'weekly', 5, 1, v_calendar, 1, v_today - 100)
  RETURNING id INTO v_schedule;

  FOREACH v_scenario IN ARRAY ARRAY['partial', 'late_failure', 'unknown_method', 'legacy_pix', 'legacy_null'] LOOP
    v_position := v_position + 1;
    v_cycle := pg_catalog.gen_random_uuid();
    v_payable := NULL;
    IF v_scenario <> 'legacy_null' THEN
      INSERT INTO public.accounts_payable(
        description, category, due_date, amount, status, contractor_id, notes
      ) VALUES (
        'E2E FIN159 ciclo ' || v_scenario, 'service', v_today - 1,
        100, 'pending', v_contractor, 'Somente rollback'
      ) RETURNING id INTO v_payable;
      -- A parcial e registrada pela API publica, nunca por UPDATE de acumulado.
      PERFORM public.execute_financial_settlement(
        pg_catalog.gen_random_uuid(), 'register',
        pg_catalog.jsonb_build_object('entries', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'kind', 'payable', 'account_id', v_payable,
            'amount', CASE WHEN v_scenario = 'legacy_pix' THEN 100 ELSE 40 END,
            'settled_on', v_today - 2, 'method', 'dinheiro'
          )
        ))
      );
    END IF;
    IF v_scenario IN ('legacy_pix', 'legacy_null') THEN
      v_method := CASE WHEN v_scenario = 'legacy_pix' THEN 'PIX' ELSE NULL END;
      INSERT INTO public.contractor_payment_cycles(
        id, contractor_id, schedule_version_id, cycle_start, cycle_end,
        payment_date, gross_amount, net_amount, accounts_payable_id,
        status, closed_by, closed_at, paid_by, paid_at,
        payment_date_snapshot, payment_method_snapshot,
        payment_idempotency_key, payment_payload_hash
      ) VALUES (
        v_cycle, v_contractor, v_schedule, v_today - 30 + v_position,
        v_today - 30 + v_position, v_today - 1,
        CASE WHEN v_payable IS NULL THEN 0 ELSE 100 END,
        CASE WHEN v_payable IS NULL THEN 0 ELSE 100 END, v_payable,
        'paid', v_admin, pg_catalog.now(), v_admin, pg_catalog.now(),
        v_today - 1, v_method, 'contractor-cycle-paid:' || v_cycle::text,
        public.strap_payload_hash(pg_catalog.jsonb_build_object(
          'cycle_id', v_cycle, 'accounts_payable_id', v_payable,
          'payment_date', v_today - 1, 'payment_method', v_method
        ))
      );
    ELSE
      INSERT INTO public.contractor_payment_cycles(
        id, contractor_id, schedule_version_id, cycle_start, cycle_end,
        payment_date, gross_amount, net_amount, accounts_payable_id,
        status, closed_by, closed_at
      ) VALUES (
        v_cycle, v_contractor, v_schedule, v_today - 30 + v_position,
        v_today - 30 + v_position, v_today - 1,
        100, 100, v_payable, 'closed', v_admin, pg_catalog.now()
      );
    END IF;
    IF v_payable IS NOT NULL THEN
      UPDATE public.accounts_payable
         SET contractor_payment_cycle_id = v_cycle,
             reference_type = 'contractor_payment_cycle', reference_id = v_cycle
       WHERE id = v_payable;
    END IF;
    INSERT INTO e2e_financial159_cycle_fixture VALUES (v_scenario, v_cycle, v_payable, v_admin);
  END LOOP;
END;
$setup_financial159_cycles$;

GRANT SELECT ON TABLE e2e_financial159_cycle_fixture TO authenticated;
SET LOCAL ROLE authenticated;

DO $financial159_cycle_partial_and_replay$
DECLARE
  v_fixture e2e_financial159_cycle_fixture%ROWTYPE;
  v_result jsonb;
  v_before jsonb;
  v_command uuid := pg_catalog.gen_random_uuid();
  v_other_command uuid := pg_catalog.gen_random_uuid();
  v_rejected boolean := false;
  v_today date := (pg_catalog.clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  SELECT * INTO STRICT v_fixture FROM e2e_financial159_cycle_fixture WHERE scenario = 'partial';
  SELECT pg_catalog.to_jsonb(cycle) INTO v_before
    FROM public.contractor_payment_cycles cycle WHERE id = v_fixture.cycle_id;
  v_result := public.mark_contractor_payment_cycle_paid(v_fixture.cycle_id, v_today, 'pix', v_command);
  ASSERT v_result ->> 'status' = 'paid';
  ASSERT (v_result ->> 'replayed')::boolean IS FALSE;
  ASSERT (SELECT amount_paid FROM public.accounts_payable WHERE id = v_fixture.payable_id) = 100;
  ASSERT (SELECT status FROM public.accounts_payable WHERE id = v_fixture.payable_id) = 'paid';
  ASSERT EXISTS (
    SELECT 1 FROM public.financial_settlement_events event
     WHERE event.command_id = v_command AND event.payable_id = v_fixture.payable_id
       AND event.amount = 60 AND event.method = 'pix' AND event.effective_on = v_today
       AND event.source_type = 'contractor_cycle'
       AND event.source_reference = v_fixture.cycle_id::text
       AND event.source_line_key = v_fixture.cycle_id::text
  ), 'Ciclo deve baixar somente saldo 60, com origem/linha server-side';
  ASSERT (SELECT pg_catalog.count(*) FROM public.financial_settlement_events
           WHERE payable_id = v_fixture.payable_id) = 2,
    'A baixa do ciclo duplicou a parcial preexistente';
  ASSERT (SELECT pg_catalog.sum(amount_signed) FROM public.financial_cash_movements
           WHERE account_id = v_fixture.payable_id) = -100;
  ASSERT (SELECT pg_catalog.to_jsonb(cycle)
      - 'status' - 'paid_by' - 'paid_at' - 'payment_date_snapshot'
      - 'payment_method_snapshot' - 'payment_idempotency_key'
      - 'payment_payload_hash' - 'updated_at'
    FROM public.contractor_payment_cycles cycle WHERE id = v_fixture.cycle_id)
    = v_before - 'status' - 'paid_by' - 'paid_at' - 'payment_date_snapshot'
      - 'payment_method_snapshot' - 'payment_idempotency_key'
      - 'payment_payload_hash' - 'updated_at', 'Baixa alterou competencia congelada';
  ASSERT EXISTS (
    SELECT 1 FROM public.artisanal_strap_operational_audit_log audit
     WHERE audit.entity_id = v_fixture.cycle_id AND audit.correlation_id = v_command
       AND audit.before_data ->> 'status' = 'closed'
       AND audit.after_data ->> 'status' = 'paid'
  ), 'Ciclo baixado sem auditoria atomica';

  -- O hook nao envia correlation_id: retry pode ter novo UUID no servidor.
  v_result := public.mark_contractor_payment_cycle_paid(v_fixture.cycle_id, v_today, 'pix', v_other_command);
  ASSERT (v_result ->> 'replayed')::boolean IS TRUE;
  ASSERT (SELECT pg_catalog.count(*) FROM public.financial_settlement_events
           WHERE payable_id = v_fixture.payable_id) = 2;
  ASSERT NOT EXISTS (SELECT 1 FROM public.financial_settlement_command_receipts
                     WHERE command_id = v_other_command), 'Replay criou novo receipt financeiro';
  ASSERT (SELECT pg_catalog.count(*) FROM public.artisanal_strap_operational_audit_log
           WHERE entity_id = v_fixture.cycle_id AND action = 'update') = 1;
  BEGIN
    PERFORM public.mark_contractor_payment_cycle_paid(v_fixture.cycle_id, v_today - 1, 'pix');
  EXCEPTION WHEN unique_violation THEN v_rejected := true;
  END;
  ASSERT v_rejected, 'Replay divergente alterou pagamento ja confirmado';
END;
$financial159_cycle_partial_and_replay$;

RESET ROLE;

DO $financial159_cycle_late_failure$
DECLARE
  v_fixture e2e_financial159_cycle_fixture%ROWTYPE;
  v_missing_actor uuid := pg_catalog.gen_random_uuid();
  v_command uuid := pg_catalog.gen_random_uuid();
  v_constraint text;
  v_rejected boolean := false;
  v_today date := (pg_catalog.clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  SELECT * INTO STRICT v_fixture FROM e2e_financial159_cycle_fixture WHERE scenario = 'late_failure';
  ASSERT NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_missing_actor);
  -- Core permite service claim, mas o paid_by do ciclo exige FK de profile.
  -- A falha ocorre APOS a chamada do core; deve reverter o evento e o receipt.
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_missing_actor::text, true);
  PERFORM pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object(
    'role', 'service_role', 'sub', v_missing_actor::text
  )::text, true);
  BEGIN
    PERFORM public.mark_contractor_payment_cycle_paid(v_fixture.cycle_id, v_today, 'pix', v_command);
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    v_rejected := true;
  END;
  ASSERT v_rejected AND v_constraint = 'contractor_payment_cycles_paid_by_fkey',
    'O fixture nao provocou a falha tardia esperada no paid_by';
  ASSERT (SELECT status FROM public.contractor_payment_cycles WHERE id = v_fixture.cycle_id) = 'closed';
  ASSERT (SELECT amount_paid FROM public.accounts_payable WHERE id = v_fixture.payable_id) = 40;
  ASSERT NOT EXISTS (SELECT 1 FROM public.financial_settlement_events WHERE command_id = v_command);
  ASSERT NOT EXISTS (SELECT 1 FROM public.financial_settlement_command_receipts WHERE command_id = v_command);
  ASSERT NOT EXISTS (SELECT 1 FROM public.artisanal_strap_operational_audit_log WHERE correlation_id = v_command);
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_fixture.admin_id::text, true);
  PERFORM pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object(
    'role', 'authenticated', 'sub', v_fixture.admin_id::text
  )::text, true);
END;
$financial159_cycle_late_failure$;

SET LOCAL ROLE authenticated;

DO $financial159_cycle_method_and_legacy$
DECLARE
  v_fixture e2e_financial159_cycle_fixture%ROWTYPE;
  v_result jsonb;
  v_before jsonb;
  v_hash text;
  v_rejected boolean := false;
  v_command uuid := pg_catalog.gen_random_uuid();
  v_today date := (pg_catalog.clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  SELECT * INTO STRICT v_fixture FROM e2e_financial159_cycle_fixture WHERE scenario = 'unknown_method';
  BEGIN
    v_result := public.mark_contractor_payment_cycle_paid(v_fixture.cycle_id, v_today, 'TED', v_command);
  EXCEPTION WHEN invalid_parameter_value THEN v_rejected := true;
  END;
  IF v_rejected THEN
    ASSERT (SELECT status FROM public.contractor_payment_cycles WHERE id = v_fixture.cycle_id) = 'closed';
    ASSERT (SELECT amount_paid FROM public.accounts_payable WHERE id = v_fixture.payable_id) = 40;
    ASSERT NOT EXISTS (SELECT 1 FROM public.financial_settlement_events WHERE command_id = v_command);
  ELSE
    ASSERT EXISTS (SELECT 1 FROM public.financial_settlement_events
                   WHERE command_id = v_command AND method = 'transferencia'),
      'TED informado explicitamente foi substituido silenciosamente por dinheiro/outro';
  END IF;

  FOR v_fixture IN SELECT * FROM e2e_financial159_cycle_fixture
                   WHERE scenario IN ('legacy_pix', 'legacy_null') ORDER BY scenario
  LOOP
    SELECT pg_catalog.to_jsonb(cycle), cycle.payment_payload_hash
      INTO v_before, v_hash FROM public.contractor_payment_cycles cycle
     WHERE id = v_fixture.cycle_id;
    v_result := public.mark_contractor_payment_cycle_paid(
      v_fixture.cycle_id, v_today - 1,
      CASE WHEN v_fixture.scenario = 'legacy_pix' THEN 'PIX' ELSE NULL END
    );
    ASSERT (v_result ->> 'replayed')::boolean IS TRUE,
      'Pagamento pre-159 identico deve continuar sendo replay';
    ASSERT (SELECT payment_payload_hash FROM public.contractor_payment_cycles
             WHERE id = v_fixture.cycle_id) = v_hash, 'Replay reescreveu hash legado';
    ASSERT (SELECT pg_catalog.to_jsonb(cycle) FROM public.contractor_payment_cycles cycle
             WHERE id = v_fixture.cycle_id) = v_before, 'Replay modificou snapshot legado';
    ASSERT NOT EXISTS (SELECT 1 FROM public.financial_settlement_events
                       WHERE source_type = 'contractor_cycle'
                         AND source_reference = v_fixture.cycle_id::text),
      'Replay pre-159 fabricou um novo pagamento';
  END LOOP;
END;
$financial159_cycle_method_and_legacy$;

RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT pg_catalog.jsonb_build_object(
  'ok', true, 'rollback', true,
  'proof', 'contractor_cycle_partial+replay+late_failure_atomicity+legacy_hash+explicit_method'
) AS financial_settlement_contractor_cycle_e2e_result;
ROLLBACK;
