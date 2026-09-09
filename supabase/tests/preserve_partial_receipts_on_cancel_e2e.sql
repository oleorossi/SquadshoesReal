-- =============================================================================
-- E2E transacional — cancelamento fiscal preserva toda baixa de AR
--
-- Pre-requisito: migration
--   20270101015800_preservar_baixas_parciais_no_cancelamento.sql
--
-- Os tres PVs, as duas NF-e e as 18 AR deste ensaio sao sinteticos. Nenhum
-- documento real e selecionado ou alterado e nenhuma chamada ao provedor
-- fiscal e feita: o primeiro caso exercita somente o commit local confirmado,
-- o segundo o command de reversao local e o terceiro o trigger de fallback.
-- Tudo fica na mesma transacao e termina em ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL statement_timeout = '90s';
SET LOCAL lock_timeout = '15s';
SET LOCAL plpgsql.check_asserts = on;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  (
    SELECT user_role.user_id::text
      FROM public.user_roles user_role
      JOIN public.profiles profile
        ON profile.id = user_role.user_id
       AND profile.approved = true
     WHERE user_role.role::text = 'admin'
     ORDER BY user_role.user_id
     LIMIT 1
  ),
  true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'role', 'service_role',
    'sub', pg_catalog.current_setting('request.jwt.claim.sub', true)
  )::text,
  true
);

DO $test_preserve_partial_receipts$
DECLARE
  v_suffix text := pg_catalog.gen_random_uuid()::text;
  v_cancel_so_id uuid := pg_catalog.gen_random_uuid();
  v_cancel_nfe_id uuid := pg_catalog.gen_random_uuid();
  v_revert_so_id uuid := pg_catalog.gen_random_uuid();
  v_trigger_so_id uuid := pg_catalog.gen_random_uuid();
  v_trigger_nfe_id uuid := pg_catalog.gen_random_uuid();
  v_revert_order_version bigint;
  v_result jsonb;
  v_definition text;
  v_signature text;
  v_previous_internal text;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('e2e:preserve-partial-receipts-on-cancel', 0)
  );

  ASSERT auth.uid() IS NOT NULL,
    'Pre-condicao: nenhum usuario Admin aprovado disponivel';

  -- Contrato central: status parcial/recebido OU qualquer valor recebido torna
  -- a AR imutavel para fins de cancelamento.
  ASSERT private.ar_has_recorded_receipt('received', 0);
  ASSERT private.ar_has_recorded_receipt('recebido', 0);
  ASSERT private.ar_has_recorded_receipt('partial', 0);
  ASSERT private.ar_has_recorded_receipt('parcial', 0);
  ASSERT private.ar_has_recorded_receipt('pending', 0.01);
  ASSERT NOT private.ar_has_recorded_receipt('pending', 0);
  ASSERT NOT private.ar_has_recorded_receipt('pendente', NULL);

  ASSERT NOT pg_catalog.has_function_privilege(
    'anon', 'private.ar_has_recorded_receipt(text,numeric)', 'EXECUTE'
  ), 'Helper interno ficou executavel por anon';
  ASSERT NOT pg_catalog.has_function_privilege(
    'authenticated', 'private.ar_has_recorded_receipt(text,numeric)', 'EXECUTE'
  ), 'Helper interno ficou executavel diretamente por authenticated';
  ASSERT NOT pg_catalog.has_function_privilege(
    'service_role', 'private.ar_has_recorded_receipt(text,numeric)', 'EXECUTE'
  ), 'Helper interno ficou executavel diretamente por service_role';

  FOREACH v_signature IN ARRAY ARRAY[
    'public.complete_nfe_cancellation_command_impl_126(uuid,text,text)',
    'public.tg_reverse_revenue_on_untracked_cancel()',
    'public.revert_invoiced_sale_order_internal_108(uuid,text)'
  ]
  LOOP
    SELECT pg_catalog.pg_get_functiondef(
             pg_catalog.to_regprocedure(v_signature)
           )
      INTO v_definition;
    ASSERT v_definition IS NOT NULL,
      pg_catalog.format('Writer esperado ausente: %s', v_signature);
    ASSERT pg_catalog.strpos(
      v_definition,
      'private.ar_has_recorded_receipt'
    ) > 0, pg_catalog.format('Writer sem guard de caixa: %s', v_signature);
  END LOOP;

  -- Fixtures integralmente sinteticas. IDs e numeros explicitos evitam
  -- consumir a sequencia real de PV, que nao seria desfeita pelo ROLLBACK.
  v_previous_internal := pg_catalog.current_setting(
    'app.sale_order_command_internal', true
  );
  PERFORM pg_catalog.set_config('app.sale_order_command_internal', '1', true);
  INSERT INTO public.sale_orders (
    id, order_number, client_name, status, total, is_standalone_nfe
  ) VALUES
    (
      v_cancel_so_id, 'E2E158-COMPLETE-' || v_suffix,
      'E2E 158 synthetic', 'Faturado', 100, false
    ),
    (
      v_revert_so_id, 'E2E158-REVERT-' || v_suffix,
      'E2E 158 synthetic', 'Faturado', 100, false
    ),
    (
      v_trigger_so_id, 'E2E158-TRIGGER-' || v_suffix,
      'E2E 158 synthetic', 'Faturado', 100, false
    );
  PERFORM pg_catalog.set_config(
    'app.sale_order_command_internal', COALESCE(v_previous_internal, ''), true
  );

  INSERT INTO public.nfe_emitidas (
    id, sale_order_id, ref_nfe, status, numero, valor_total
  ) VALUES
    (
      v_cancel_nfe_id, v_cancel_so_id,
      'E2E158-COMPLETE-' || v_suffix, 'cancelando', '', 100
    ),
    (
      v_trigger_nfe_id, v_trigger_so_id,
      'E2E158-TRIGGER-' || v_suffix, 'autorizada', '', 100
    );

  -- 1) Commit local depois da confirmacao do provedor. A fixture ja nasce em
  -- `cancelando`; o teste nao chama Edge Function, SEFAZ ou provider algum.
  INSERT INTO public.accounts_receivable (
    description, client_name, sale_order_id, due_date, amount,
    amount_received, status, payment_date, installment_number,
    total_installments
  )
  SELECT
    'E2E158 complete ' || fixture.label || ' ' || v_suffix,
    'E2E 158', v_cancel_so_id, DATE '1999-01-01', 100,
    fixture.received, fixture.status, fixture.payment_date,
    fixture.installment, 1
  FROM (VALUES
    ('pending-zero', 'pending', 0::numeric, NULL::date, 1580001),
    ('pending-cash', 'pending', 25::numeric, DATE '1998-01-02', 1580002),
    ('partial-status', 'partial', 0::numeric, NULL::date, 1580003),
    ('parcial-status', 'parcial', 0::numeric, NULL::date, 1580004),
    ('received-status', 'received', 100::numeric, DATE '1998-01-05', 1580005),
    ('recebido-status', 'recebido', 0::numeric, NULL::date, 1580006)
  ) AS fixture(label, status, received, payment_date, installment);

  v_result := public.complete_nfe_cancellation_command_impl_126(
    v_cancel_nfe_id,
    'Cancelamento E2E transacional 158',
    'E2E-158'
  );
  ASSERT COALESCE((v_result ->> 'ok')::boolean, false),
    'complete_nfe_cancellation_command_impl_126 nao concluiu';
  ASSERT EXISTS (
    SELECT 1 FROM public.nfe_emitidas nfe
     WHERE nfe.id = v_cancel_nfe_id AND nfe.status = 'cancelada'
  ), 'Commit local nao concluiu a NF-e sintetica';

  -- 2) Command real de reversao de um PV local sem NF autorizada.
  INSERT INTO public.accounts_receivable (
    description, client_name, sale_order_id, due_date, amount,
    amount_received, status, payment_date, installment_number,
    total_installments
  )
  SELECT
    'E2E158 revert ' || fixture.label || ' ' || v_suffix,
    'E2E 158', v_revert_so_id, DATE '1999-02-01', 100,
    fixture.received, fixture.status, fixture.payment_date,
    fixture.installment, 1
  FROM (VALUES
    ('pending-zero', 'pending', 0::numeric, NULL::date, 1580011),
    ('pending-cash', 'pending', 25::numeric, DATE '1998-02-02', 1580012),
    ('partial-status', 'partial', 0::numeric, NULL::date, 1580013),
    ('parcial-status', 'parcial', 0::numeric, NULL::date, 1580014),
    ('received-status', 'received', 100::numeric, DATE '1998-02-05', 1580015),
    ('recebido-status', 'recebido', 0::numeric, NULL::date, 1580016)
  ) AS fixture(label, status, received, payment_date, installment);

  SELECT sale_order.order_version
    INTO v_revert_order_version
    FROM public.sale_orders sale_order
   WHERE sale_order.id = v_revert_so_id;
  ASSERT v_revert_order_version IS NOT NULL,
    'PV sintetico de reversao desapareceu';

  v_result := public.revert_invoiced_sale_order_command(
    v_revert_so_id,
    v_revert_order_version,
    'Reversao E2E transacional 158',
    pg_catalog.gen_random_uuid()
  );
  ASSERT COALESCE((v_result ->> 'ok')::boolean, false),
    'revert_invoiced_sale_order_command nao concluiu';

  -- 3) Cancelamento detectado fora do comando oficial. A transicao ocorre na
  -- propria NF-e sintetica e comprova tambem que o trigger vivo esta ligado.
  INSERT INTO public.accounts_receivable (
    description, client_name, sale_order_id, due_date, amount,
    amount_received, status, payment_date, installment_number,
    total_installments
  )
  SELECT
    'E2E158 trigger ' || fixture.label || ' ' || v_suffix,
    'E2E 158', v_trigger_so_id, DATE '1999-03-01', 100,
    fixture.received, fixture.status, fixture.payment_date,
    fixture.installment, 1
  FROM (VALUES
    ('pending-zero', 'pending', 0::numeric, NULL::date, 1580021),
    ('pending-cash', 'pending', 25::numeric, DATE '1998-03-02', 1580022),
    ('partial-status', 'partial', 0::numeric, NULL::date, 1580023),
    ('parcial-status', 'parcial', 0::numeric, NULL::date, 1580024),
    ('received-status', 'received', 100::numeric, DATE '1998-03-05', 1580025),
    ('recebido-status', 'recebido', 0::numeric, NULL::date, 1580026)
  ) AS fixture(label, status, received, payment_date, installment);

  UPDATE public.nfe_emitidas nfe
     SET status = 'cancelada', updated_at = pg_catalog.now()
   WHERE nfe.id = v_trigger_nfe_id
     AND nfe.status = 'autorizada';
  ASSERT FOUND, 'NF-e sintetica nao disparou a transicao de fallback';

  -- Oracle unica, independente dos writers: as 18 fixtures continuam
  -- presentes; exatamente as tres pending sem caixa cancelam. Todas as demais
  -- preservam status, valor recebido e data originais.
  ASSERT (
    SELECT pg_catalog.count(*) = 18
      FROM public.accounts_receivable ar
     WHERE ar.description LIKE 'E2E158 % ' || v_suffix
  ), 'Algum writer removeu ou duplicou uma AR sintetica';

  ASSERT (
    SELECT pg_catalog.count(*) = 3
      FROM public.accounts_receivable ar
     WHERE ar.description LIKE 'E2E158 % pending-zero ' || v_suffix
       AND ar.status = 'cancelled'
       AND ar.amount_received = 0
       AND ar.payment_date IS NULL
  ), 'Uma AR realmente vazia deixou de ser cancelada';

  ASSERT NOT EXISTS (
    WITH expected(phase, label, status, received, payment_date) AS (
      VALUES
        ('complete', 'pending-cash', 'pending', 25::numeric, DATE '1998-01-02'),
        ('complete', 'partial-status', 'partial', 0::numeric, NULL::date),
        ('complete', 'parcial-status', 'parcial', 0::numeric, NULL::date),
        ('complete', 'received-status', 'received', 100::numeric, DATE '1998-01-05'),
        ('complete', 'recebido-status', 'recebido', 0::numeric, NULL::date),
        ('revert', 'pending-cash', 'pending', 25::numeric, DATE '1998-02-02'),
        ('revert', 'partial-status', 'partial', 0::numeric, NULL::date),
        ('revert', 'parcial-status', 'parcial', 0::numeric, NULL::date),
        ('revert', 'received-status', 'received', 100::numeric, DATE '1998-02-05'),
        ('revert', 'recebido-status', 'recebido', 0::numeric, NULL::date),
        ('trigger', 'pending-cash', 'pending', 25::numeric, DATE '1998-03-02'),
        ('trigger', 'partial-status', 'partial', 0::numeric, NULL::date),
        ('trigger', 'parcial-status', 'parcial', 0::numeric, NULL::date),
        ('trigger', 'received-status', 'received', 100::numeric, DATE '1998-03-05'),
        ('trigger', 'recebido-status', 'recebido', 0::numeric, NULL::date)
    )
    SELECT 1
      FROM expected
      LEFT JOIN public.accounts_receivable ar
        ON ar.description =
             'E2E158 ' || expected.phase || ' ' || expected.label || ' ' || v_suffix
     WHERE ar.id IS NULL
        OR ar.status IS DISTINCT FROM expected.status
        OR ar.amount_received IS DISTINCT FROM expected.received
        OR ar.payment_date IS DISTINCT FROM expected.payment_date
  ), 'Um writer alterou status, valor ou data de uma AR com caixa registrado';

  RAISE NOTICE
    'preserve_partial_receipts_on_cancel_e2e PASS: 3 PVs/2 NF-e sinteticos, 3 writers, 18 AR; sem provider; rollback pendente';
END;
$test_preserve_partial_receipts$;

-- Forca constraints/triggers adiados a rodarem enquanto os ASSERTs e o erro
-- ainda podem invalidar a prova; ROLLBACK sozinho descartaria esses eventos.
SET CONSTRAINTS ALL IMMEDIATE;

SELECT 'preserve_partial_receipts_on_cancel_e2e: PASS' AS proof;

ROLLBACK;
