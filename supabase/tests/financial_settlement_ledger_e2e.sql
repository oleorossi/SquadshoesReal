-- =============================================================================
-- E2E transacional do ledger AP/AR 15900.
-- Ordem no dry-run: setup_financial_settlement_ledger_legacy.sql -> migration
-- 15900 -> este arquivo. Tudo termina em ROLLBACK.
-- =============================================================================

BEGIN;

SET LOCAL statement_timeout = '90s';
SET LOCAL lock_timeout = '15s';
SET LOCAL plpgsql.check_asserts = on;

-- Auth negativa sem criar usuario real.
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', pg_catalog.gen_random_uuid()::text, true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'role', 'authenticated',
    'sub', pg_catalog.current_setting('request.jwt.claim.sub', true)
  )::text,
  true
);
SET LOCAL ROLE authenticated;
DO $financial159_unapproved$
DECLARE
  v_rejected boolean := false;
BEGIN
  BEGIN
    PERFORM public.execute_financial_settlement(
      pg_catalog.gen_random_uuid(), 'register',
      '{"source_type":"manual","entries":[]}'::jsonb
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := true;
  END;
  ASSERT v_rejected,
    'authenticated sem profile aprovado executou liquidacao';
END;
$financial159_unapproved$;
RESET ROLE;

-- Service claim e UUID sintetico; nao depende de usuario/profile vivo.
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', pg_catalog.gen_random_uuid()::text, true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'role', 'service_role',
    'sub', pg_catalog.current_setting('request.jwt.claim.sub', true)
  )::text,
  true
);

DO $financial_settlement_ledger_e2e$
DECLARE
  v_suffix text := pg_catalog.gen_random_uuid()::text;
  v_payable_id uuid;
  v_receivable_id uuid;
  v_ofx_payable_id uuid;
  v_legacy_payable_id uuid;
  v_legacy_receivable_id uuid;
  v_legacy_cmv_receivable_id uuid;
  v_legacy_cmv_sale_order_id uuid;
  v_legacy_cmv_entry_id uuid;
  v_legacy_revenue_entry_id uuid;
  v_legacy_missing_cmv_receivable_id uuid;
  v_legacy_missing_cmv_sale_order_id uuid;
  v_bank_id uuid;
  v_bank_balance numeric;
  v_register_id uuid := pg_catalog.gen_random_uuid();
  v_reverse_id uuid := pg_catalog.gen_random_uuid();
  v_result jsonb;
  v_replay jsonb;
  v_history jsonb;
  v_cash_period jsonb;
  v_ap_event_id uuid;
  v_ar_event_id uuid;
  v_ofx_event_id uuid;
  v_rejected boolean;
  v_count bigint;
  v_amount numeric;
  v_status text;
  v_date date;
  v_category text;
  v_sale_order_id uuid;
  v_cmv_receivable_id uuid;
  v_cmv_event_ids uuid[] := ARRAY[]::uuid[];
  v_cmv_entry_id uuid;
  v_basis_reverse_event_id uuid;
  v_pending_sale_order_id uuid;
  v_pending_receivable_id uuid;
  v_pending_event_id uuid;
  v_pending_reverse_event_id uuid;
  v_today date := (pg_catalog.clock_timestamp()
    AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  ASSERT pg_catalog.to_regclass('pg_temp.e2e_financial159_legacy_fixture')
    IS NOT NULL,
    'Fixture legado pre-159 ausente';
  ASSERT NOT pg_catalog.has_table_privilege(
    'service_role', 'public.financial_settlement_events', 'INSERT'
  ), 'service_role ainda consegue inserir evento fora do core';
  ASSERT NOT pg_catalog.has_table_privilege(
    'service_role', 'public.financial_settlement_command_receipts', 'INSERT'
  ), 'service_role ainda consegue fabricar receipt';
  SELECT fixture.account_id INTO v_legacy_payable_id
    FROM e2e_financial159_legacy_fixture fixture
   WHERE fixture.fixture_kind = 'payable_undated';
  SELECT fixture.account_id INTO v_legacy_receivable_id
    FROM e2e_financial159_legacy_fixture fixture
   WHERE fixture.fixture_kind = 'receivable_dated';
  SELECT fixture.account_id, fixture.sale_order_id, fixture.cmv_entry_id,
         fixture.revenue_entry_id
    INTO v_legacy_cmv_receivable_id, v_legacy_cmv_sale_order_id,
         v_legacy_cmv_entry_id, v_legacy_revenue_entry_id
    FROM e2e_financial159_legacy_fixture fixture
   WHERE fixture.fixture_kind = 'receivable_cmv';
  SELECT fixture.account_id, fixture.sale_order_id
    INTO v_legacy_missing_cmv_receivable_id,
         v_legacy_missing_cmv_sale_order_id
    FROM e2e_financial159_legacy_fixture fixture
   WHERE fixture.fixture_kind = 'receivable_missing_cmv';

  -- Leitura de legado nao captura nem inventa movimento/data.
  v_history := public.get_financial_settlement_history(
    'payable', v_legacy_payable_id
  );
  ASSERT (v_history #>> '{head,captured}')::boolean IS FALSE,
    pg_catalog.format('Historico legado foi marcado como capturado: %s', v_history);
  ASSERT (v_history #>> '{head,opening_amount}')::numeric = 100,
    pg_catalog.format('Historico legado perdeu opening_amount=100: %s', v_history);
  ASSERT v_history #>> '{head,opening_payment_date}' IS NULL,
    pg_catalog.format('Historico legado inventou data de abertura: %s', v_history);
  ASSERT NULLIF(v_history #>> '{head,opening_history_warning}', '') IS NOT NULL,
    pg_catalog.format('Historico legado omitiu aviso de abertura: %s', v_history);
  ASSERT EXISTS (
    SELECT 1 FROM public.financial_settlement_cmv_pending pending
     WHERE pending.settlement_event_id = v_legacy_missing_cmv_receivable_id
       AND pending.receivable_id = v_legacy_missing_cmv_receivable_id
       AND pending.sale_order_id = v_legacy_missing_cmv_sale_order_id
       AND pending.effective_on = v_today - 15
       AND pending.received_amount = 20
  ), 'AR legada sem head/CMV nao ficou visivel como pendencia historica';
  v_rejected := false;
  BEGIN
    UPDATE public.accounts_receivable SET sale_order_id = NULL
     WHERE id = v_legacy_missing_cmv_receivable_id;
  EXCEPTION WHEN SQLSTATE '55000' THEN v_rejected := true;
  END;
  ASSERT v_rejected,
    'AR legada recebida perdeu PV e apagou pending antes de criar head';

  -- Sem head, cash legado nao pode ser apagado/reescrito nem por writer direto.
  v_rejected := false;
  BEGIN
    UPDATE public.accounts_payable
       SET amount_paid = 0, status = 'pending', payment_date = NULL
     WHERE id = v_legacy_payable_id;
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := true;
  END;
  ASSERT v_rejected, 'Reset direto apagou baixa legada sem head';
  v_rejected := false;
  BEGIN
    DELETE FROM public.accounts_receivable
     WHERE id = v_legacy_receivable_id;
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_rejected := true;
  END;
  ASSERT v_rejected, 'DELETE apagou AR legada recebida sem head';
  UPDATE public.accounts_receivable
     SET description = description || ' editavel'
   WHERE id = v_legacy_receivable_id;
  ASSERT (SELECT amount_received FROM public.accounts_receivable
           WHERE id = v_legacy_receivable_id) = 200;

  INSERT INTO public.bank_accounts (
    name, bank_name, account_type, initial_balance, current_balance, active
  ) VALUES (
    'E2E FIN159 ' || v_suffix, 'E2E', 'corrente', 50, 50, true
  ) RETURNING id, current_balance INTO v_bank_id, v_bank_balance;

  INSERT INTO public.accounts_payable (
    description, category, due_date, amount, status, notes
  ) VALUES (
    'E2E FIN159 AP ' || v_suffix, 'e2e_payable', v_today, 1000,
    'pending', 'rollback automatico'
  ) RETURNING id INTO v_payable_id;
  INSERT INTO public.accounts_receivable (
    description, client_name, category, due_date, amount, status, notes
  ) VALUES (
    'E2E FIN159 AR ' || v_suffix, 'E2E', 'e2e_receivable', v_today,
    1000, 'pending', 'rollback automatico'
  ) RETURNING id INTO v_receivable_id;
  INSERT INTO e2e_financial159_legacy_fixture(
    fixture_kind, account_id, sale_order_id, cmv_entry_id, revenue_entry_id
  ) VALUES ('authenticated_acl_target', v_payable_id, NULL, NULL, NULL);

  v_result := public.execute_financial_settlement(
    v_register_id,
    'register',
    pg_catalog.jsonb_build_object(
      'source_type', 'manual',
      'entries', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'kind', 'payable', 'account_id', v_payable_id,
          'amount', 400, 'settled_on', v_today, 'method', 'pix',
          'bank_account_id', v_bank_id, 'reference', 'E2E AP',
          'notes', 'parcial atomica'
        ),
        pg_catalog.jsonb_build_object(
          'kind', 'receivable', 'account_id', v_receivable_id,
          'amount', 250, 'settled_on', v_today, 'method', 'transferencia',
          'bank_account_id', v_bank_id, 'reference', 'E2E AR'
        )
      )
    )
  );
  ASSERT (v_result ->> 'ok')::boolean;
  ASSERT v_result ->> 'command' = 'register';
  ASSERT v_result ->> 'command_id' = v_register_id::text;
  ASSERT pg_catalog.jsonb_array_length(v_result -> 'event_ids') = 2;
  v_ap_event_id := (v_result #>> '{event_ids,0}')::uuid;
  v_ar_event_id := (v_result #>> '{event_ids,1}')::uuid;
  SELECT amount_paid, status, payment_date
    INTO v_amount, v_status, v_date
    FROM public.accounts_payable WHERE id = v_payable_id;
  ASSERT v_amount = 400 AND v_status = 'parcial' AND v_date = v_today;
  SELECT amount_received, status, payment_date
    INTO v_amount, v_status, v_date
    FROM public.accounts_receivable WHERE id = v_receivable_id;
  ASSERT v_amount = 250 AND v_status = 'parcial' AND v_date = v_today;
  ASSERT (SELECT current_balance FROM public.bank_accounts WHERE id = v_bank_id)
    = v_bank_balance,
    'Ledger alterou bank_accounts.current_balance';

  -- Mesmo command/payload devolve recibo; divergencia e rejeitada.
  v_replay := public.execute_financial_settlement(
    v_register_id,
    'register',
    pg_catalog.jsonb_build_object(
      'source_type', 'manual',
      'entries', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'kind', 'payable', 'account_id', v_payable_id,
          'amount', 400, 'settled_on', v_today, 'method', 'pix',
          'bank_account_id', v_bank_id, 'reference', 'E2E AP',
          'notes', 'parcial atomica'
        ),
        pg_catalog.jsonb_build_object(
          'kind', 'receivable', 'account_id', v_receivable_id,
          'amount', 250, 'settled_on', v_today, 'method', 'transferencia',
          'bank_account_id', v_bank_id, 'reference', 'E2E AR'
        )
      )
    )
  );
  ASSERT (v_replay ->> 'replayed')::boolean;
  ASSERT v_replay -> 'event_ids' = v_result -> 'event_ids';
  ASSERT (SELECT pg_catalog.count(*) FROM public.financial_settlement_events
           WHERE command_id = v_register_id) = 2;
  v_rejected := false;
  BEGIN
    PERFORM public.execute_financial_settlement(
      v_register_id, 'register',
      pg_catalog.jsonb_build_object(
        'source_type', 'manual',
        'entries', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'kind', 'payable', 'account_id', v_payable_id, 'amount', 1,
          'settled_on', v_today, 'method', 'pix'
        ))
      )
    );
  EXCEPTION WHEN SQLSTATE '23505' THEN v_rejected := true;
  END;
  ASSERT v_rejected, 'Replay divergente foi aceito';

  -- Lote acima do saldo falha inteiro; validacoes de centavo/data tambem.
  SELECT pg_catalog.count(*) INTO v_count
    FROM public.financial_settlement_events;
  v_rejected := false;
  BEGIN
    PERFORM public.execute_financial_settlement(
      pg_catalog.gen_random_uuid(), 'register',
      pg_catalog.jsonb_build_object('source_type', 'manual', 'entries',
        pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'kind', 'payable', 'account_id', v_payable_id, 'amount', 100,
            'settled_on', v_today, 'method', 'pix'
          ),
          pg_catalog.jsonb_build_object(
            'kind', 'receivable', 'account_id', v_receivable_id,
            'amount', 800, 'settled_on', v_today, 'method', 'pix'
          )
        ))
    );
  EXCEPTION WHEN SQLSTATE '23514' THEN v_rejected := true;
  END;
  ASSERT v_rejected AND (SELECT pg_catalog.count(*)
    FROM public.financial_settlement_events) = v_count,
    'Overpayment deixou efeito parcial';
  FOREACH v_amount IN ARRAY ARRAY['1.001'::numeric, 'NaN'::numeric] LOOP
    v_rejected := false;
    BEGIN
      PERFORM public.execute_financial_settlement(
        pg_catalog.gen_random_uuid(), 'register',
        pg_catalog.jsonb_build_object('source_type', 'manual', 'entries',
          pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'kind', 'payable', 'account_id', v_payable_id,
            'amount', v_amount, 'settled_on', v_today, 'method', 'pix'
          )))
      );
    EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected := true;
    END;
    ASSERT v_rejected, 'Valor nao-finito/fracionario foi aceito';
  END LOOP;
  v_rejected := false;
  BEGIN
    PERFORM public.execute_financial_settlement(
      pg_catalog.gen_random_uuid(), 'register',
      pg_catalog.jsonb_build_object('source_type', 'manual', 'entries',
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'kind', 'payable', 'account_id', v_payable_id, 'amount', 1,
          'settled_on', v_today + 1, 'method', 'pix'
        )))
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected := true;
  END;
  ASSERT v_rejected, 'Data futura foi aceita';
  v_rejected := false;
  BEGIN
    PERFORM public.execute_financial_settlement(
      pg_catalog.gen_random_uuid(), 'register',
      pg_catalog.jsonb_build_object('source_type', 'manual', 'entries',
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'kind', 'payable', 'account_id', v_payable_id, 'amount', 1,
          'settled_on', 'infinity', 'method', 'pix'
        )))
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected := true;
  END;
  ASSERT v_rejected, 'Data nao finita/fora de YYYY-MM-DD foi aceita';
  v_rejected := false;
  BEGIN
    PERFORM public.get_financial_settlement_cash_period(
      'infinity'::date, 'infinity'::date, NULL
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected := true;
  END;
  ASSERT v_rejected, 'Read model aceitou periodo nao finito';

  -- Categoria fica congelada no evento; colunas cash e ledger sao protegidos.
  UPDATE public.accounts_payable SET category = 'e2e_payable_editada'
   WHERE id = v_payable_id;
  SELECT movement.category INTO v_category
    FROM public.financial_cash_movements movement
   WHERE movement.id = v_ap_event_id::text;
  ASSERT v_category = 'e2e_payable';
  UPDATE public.accounts_payable SET amount = 400 WHERE id = v_payable_id;
  ASSERT (SELECT status FROM public.accounts_payable WHERE id = v_payable_id)
    = 'paid', 'Reducao do principal ate o pago nao fechou a projecao';
  UPDATE public.accounts_payable SET amount = 1000 WHERE id = v_payable_id;
  ASSERT (SELECT status FROM public.accounts_payable WHERE id = v_payable_id)
    = 'parcial', 'Aumento de titulo quitado manteve status paid';
  v_rejected := false;
  BEGIN
    UPDATE public.accounts_payable SET amount_paid = 401
     WHERE id = v_payable_id;
  EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected := true;
  END;
  ASSERT v_rejected, 'UPDATE direto alterou caixa projetado';
  v_rejected := false;
  BEGIN
    UPDATE public.financial_settlement_events SET notes = 'mutado'
     WHERE id = v_ap_event_id;
  EXCEPTION WHEN SQLSTATE '55000' THEN v_rejected := true;
  END;
  ASSERT v_rejected, 'Evento imutavel foi alterado';

  -- Estorno exato, replay e hard-delete bloqueado mesmo apos saldo voltar a zero.
  v_result := public.execute_financial_settlement(
    v_reverse_id, 'reverse',
    pg_catalog.jsonb_build_object(
      'source_type', 'manual',
      'entries', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'event_id', v_ap_event_id, 'reversed_on', v_today,
        'reason', 'E2E estorno integral'
      ))
    )
  );
  ASSERT (SELECT amount_paid FROM public.accounts_payable
           WHERE id = v_payable_id) = 0;
  ASSERT (SELECT status FROM public.accounts_payable
           WHERE id = v_payable_id) = 'pending';
  v_replay := public.execute_financial_settlement(
    v_reverse_id, 'reverse',
    pg_catalog.jsonb_build_object(
      'source_type', 'manual',
      'entries', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'event_id', v_ap_event_id, 'reversed_on', v_today,
        'reason', 'E2E estorno integral'
      ))
    )
  );
  ASSERT (v_replay ->> 'replayed')::boolean;
  UPDATE public.accounts_payable
     SET amount = 900, description = description || ' apos estorno'
   WHERE id = v_payable_id;
  v_rejected := false;
  BEGIN
    DELETE FROM public.accounts_payable WHERE id = v_payable_id;
  EXCEPTION WHEN SQLSTATE '55000' OR SQLSTATE '23503' THEN v_rejected := true;
  END;
  ASSERT v_rejected, 'Titulo com eventos estornados foi excluido';

  -- Origem manual nao estorna OFX. Conta bancaria inativa nao prende o estorno
  -- confiavel, e current_balance permanece fora deste ledger.
  INSERT INTO public.accounts_payable (
    description, category, due_date, amount, status
  ) VALUES ('E2E FIN159 OFX ' || v_suffix, 'e2e_ofx', v_today, 100, 'pending')
  RETURNING id INTO v_ofx_payable_id;
  v_result := private.execute_financial_settlement_core_159(
    pg_catalog.gen_random_uuid(), 'register',
    pg_catalog.jsonb_build_object('entries', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'kind', 'payable', 'account_id', v_ofx_payable_id, 'amount', 100,
        'settled_on', v_today, 'method', 'transferencia',
        'bank_account_id', v_bank_id, 'source_line_key', 'FITID-E2E:1'
      ))), 'ofx', 'bank:' || v_bank_id::text
  );
  v_ofx_event_id := (v_result #>> '{event_ids,0}')::uuid;
  v_rejected := false;
  BEGIN
    PERFORM public.execute_financial_settlement(
      pg_catalog.gen_random_uuid(), 'reverse',
      pg_catalog.jsonb_build_object('source_type', 'manual', 'entries',
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'event_id', v_ofx_event_id, 'reversed_on', v_today,
          'reason', 'manual nao pode'
        )))
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected := true;
  END;
  ASSERT v_rejected, 'Wrapper manual estornou evento OFX';
  UPDATE public.bank_accounts SET active = false WHERE id = v_bank_id;
  PERFORM private.execute_financial_settlement_core_159(
    pg_catalog.gen_random_uuid(), 'reverse',
    pg_catalog.jsonb_build_object('entries', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'event_id', v_ofx_event_id, 'reversed_on', v_today,
        'reason', 'unmatch OFX com banco inativo'
      ))), 'ofx', 'bank:' || v_bank_id::text
  );
  ASSERT (SELECT amount_paid FROM public.accounts_payable
           WHERE id = v_ofx_payable_id) = 0;
  ASSERT (SELECT current_balance FROM public.bank_accounts WHERE id = v_bank_id)
    = v_bank_balance;

  -- Primeira nova baixa em legado captura abertura, sem duplicar caixa antigo.
  v_result := public.execute_financial_settlement(
    pg_catalog.gen_random_uuid(), 'register',
    pg_catalog.jsonb_build_object('source_type', 'manual', 'entries',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'kind', 'receivable', 'account_id', v_legacy_receivable_id,
        'amount', 100, 'settled_on', v_today, 'method', 'pix'
      )))
  );
  ASSERT (SELECT amount_received FROM public.accounts_receivable
           WHERE id = v_legacy_receivable_id) = 300;
  v_history := public.get_financial_settlement_history(
    'receivable', v_legacy_receivable_id
  );
  ASSERT (v_history #>> '{head,captured}')::boolean;
  ASSERT (v_history #>> '{head,opening_amount}')::numeric = 200;
  ASSERT NULLIF(v_history #>> '{head,opening_history_warning}', '') IS NOT NULL;
  ASSERT (SELECT pg_catalog.count(*) FROM public.financial_cash_movements movement
           WHERE movement.account_id = v_legacy_receivable_id
             AND movement.legacy IS TRUE) = 1;

  -- O CMV legado ja reconhecido e congelado junto com o opening, sem ser
  -- refeito pela base corrente nem duplicado pela linha legada viva.
  v_result := public.execute_financial_settlement(
    pg_catalog.gen_random_uuid(), 'register',
    pg_catalog.jsonb_build_object('source_type', 'manual', 'entries',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'kind', 'receivable', 'account_id', v_legacy_cmv_receivable_id,
        'amount', 10, 'settled_on', v_today, 'method', 'pix'
      )))
  );
  ASSERT EXISTS (
    SELECT 1
      FROM public.financial_settlement_account_heads head
     WHERE head.receivable_id = v_legacy_cmv_receivable_id
       AND head.opening_amount = 50
       AND head.opening_cmv_sale_order_id = v_legacy_cmv_sale_order_id
       AND head.opening_cmv_amount = 30
       AND head.opening_cmv_date = v_today - 20
       AND head.opening_cmv_total_snapshot = 60
       AND head.opening_receivable_gross_snapshot = 100
  ), 'Head nao congelou o CMV legado original';
  ASSERT (
    SELECT pg_catalog.sum(movement.amount_signed)
      FROM public.financial_cash_cmv_movements movement
     WHERE movement.sale_order_id = v_legacy_cmv_sale_order_id
       AND movement.legacy IS TRUE
  ) = 30, 'Read model duplicou ou recalculou CMV legado depois do head';
  ASSERT (
    SELECT pg_catalog.sum(cmv.recognized_amount)
      FROM public.financial_settlement_cmv_events cmv
     WHERE cmv.sale_order_id = v_legacy_cmv_sale_order_id
       AND cmv.event_type = 'settlement'
  ) = 6, 'Nova baixa nao reconheceu CMV incremental sobre opening congelado';

  -- Cancelar a receita/CMV depois do head nao apaga retroativamente o custo
  -- legado nem o evento ja reconhecido.
  UPDATE public.financial_entries
     SET status = 'estornado'
   WHERE id = v_legacy_revenue_entry_id;
  ASSERT (SELECT status FROM public.financial_entries
           WHERE id = v_legacy_cmv_entry_id)
    IN ('cancelado', 'cancelled', 'estornado');
  ASSERT (
    SELECT head.opening_cmv_amount
      FROM public.financial_settlement_account_heads head
     WHERE head.receivable_id = v_legacy_cmv_receivable_id
  ) = 30;
  ASSERT (
    SELECT pg_catalog.sum(movement.amount_signed)
      FROM public.financial_cash_cmv_movements movement
     WHERE movement.sale_order_id = v_legacy_cmv_sale_order_id
       AND movement.legacy IS TRUE
  ) = 30, 'Cancelamento posterior apagou CMV de abertura';
  ASSERT (
    SELECT pg_catalog.sum(movement.amount_signed)
      FROM public.financial_cash_cmv_movements movement
     WHERE movement.sale_order_id = v_legacy_cmv_sale_order_id
       AND movement.legacy IS FALSE
  ) = 6, 'Cancelamento posterior reprecificou CMV do evento novo';

  -- CMV cumulativo: 3 x R$100 em AR de R$300 / CMV R$100 fecha 100,00;
  -- estornar o evento do meio desfaz seu efeito e ajusta residual para 66,67.
  INSERT INTO public.sale_orders (
    order_number, client_name, status, total, client_order_number
  ) VALUES (
    'E2E-FIN159-CMV-' || pg_catalog.left(v_suffix, 8),
    'E2E FIN159', 'Rascunho', 300, 'E2E-' || pg_catalog.left(v_suffix, 8)
  ) RETURNING id INTO v_sale_order_id;
  INSERT INTO public.accounts_receivable (
    description, client_name, sale_order_id, category, due_date, amount, status
  ) VALUES (
    'E2E FIN159 CMV', 'E2E FIN159', v_sale_order_id,
    'venda', v_today, 300, 'pending'
  ) RETURNING id INTO v_cmv_receivable_id;
  INSERT INTO public.financial_entries (
    entry_date, type, description, amount, reference_type, reference_id,
    status, category
  ) VALUES (
    v_today, 'despesa', 'E2E FIN159 CMV', 100, 'sale_order_cmv',
    v_sale_order_id::text, 'confirmado', 'cmv'
  ) RETURNING id INTO v_cmv_entry_id;
  FOR v_count IN 1..3 LOOP
    v_result := public.execute_financial_settlement(
      pg_catalog.gen_random_uuid(), 'register',
      pg_catalog.jsonb_build_object('source_type', 'manual', 'entries',
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'kind', 'receivable', 'account_id', v_cmv_receivable_id,
          'amount', 100, 'settled_on', v_today, 'method', 'pix'
        )))
    );
    v_cmv_event_ids := pg_catalog.array_append(
      v_cmv_event_ids, (v_result #>> '{event_ids,0}')::uuid
    );
  END LOOP;
  ASSERT (SELECT pg_catalog.sum(recognized_amount)
           FROM public.financial_settlement_cmv_events
           WHERE sale_order_id = v_sale_order_id) = 100;
  ASSERT (SELECT recognized_amount FROM public.financial_entries
           WHERE id = v_cmv_entry_id) = 100;
  PERFORM public.execute_financial_settlement(
    pg_catalog.gen_random_uuid(), 'reverse',
    pg_catalog.jsonb_build_object('source_type', 'manual', 'entries',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'event_id', v_cmv_event_ids[2], 'reversed_on', v_today,
        'reason', 'estorno evento intermediario CMV'
      )))
  );
  ASSERT (SELECT pg_catalog.sum(recognized_amount)
           FROM public.financial_settlement_cmv_events
           WHERE sale_order_id = v_sale_order_id) = 66.67;
  ASSERT EXISTS (
    SELECT 1 FROM public.financial_settlement_cmv_events
     WHERE sale_order_id = v_sale_order_id
       AND event_type = 'rounding_adjustment'
       AND recognized_amount = 0.01
  );

  -- Alterar a base depois dos fatos nao pode transformar dezenas de reais em
  -- "arredondamento". O estorno desfaz exatamente o evento original e deixa
  -- a mudanca de base como pendencia de qualidade explicita.
  UPDATE public.financial_entries SET amount = 200
   WHERE id = v_cmv_entry_id;
  v_result := public.execute_financial_settlement(
    pg_catalog.gen_random_uuid(), 'reverse',
    pg_catalog.jsonb_build_object('source_type', 'manual', 'entries',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'event_id', v_cmv_event_ids[1], 'reversed_on', v_today,
        'reason', 'estorno apos mudanca material na base CMV'
      )))
  );
  v_basis_reverse_event_id := (v_result #>> '{event_ids,0}')::uuid;
  ASSERT (
    SELECT reversal.recognized_amount
      FROM public.financial_settlement_cmv_events reversal
     WHERE reversal.settlement_event_id = v_basis_reverse_event_id
       AND reversal.event_type = 'reversal'
  ) = -33.33, 'Estorno CMV nao foi o oposto exato do fato original';
  ASSERT EXISTS (
    SELECT 1 FROM public.financial_settlement_cmv_events reversal
     WHERE reversal.settlement_event_id = v_basis_reverse_event_id
       AND reversal.event_type = 'reversal'
       AND reversal.quality_issue = 'cmv_basis_changed_since_original'
  );
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.financial_settlement_cmv_events adjustment
     WHERE adjustment.settlement_event_id = v_basis_reverse_event_id
       AND adjustment.event_type = 'rounding_adjustment'
  ), 'Mudanca material de base virou falso ajuste de centavos';
  ASSERT EXISTS (
    SELECT 1 FROM public.financial_settlement_cmv_pending pending
     WHERE pending.settlement_event_id = v_basis_reverse_event_id
  ), 'Mudanca de base no estorno nao ficou visivel como pendencia';

  -- Caixa sem base CMV fica explicitamente pendente e nunca recebe data/custo
  -- fabricado. O read model informa que a apuracao esta incompleta.
  INSERT INTO public.sale_orders (
    order_number, client_name, status, total, client_order_number
  ) VALUES (
    'E2E-FIN159-PENDING-' || pg_catalog.left(v_suffix, 8),
    'E2E FIN159', 'Rascunho', 100, 'PEND-' || pg_catalog.left(v_suffix, 8)
  ) RETURNING id INTO v_pending_sale_order_id;
  INSERT INTO public.accounts_receivable (
    description, client_name, sale_order_id, category, due_date, amount, status
  ) VALUES (
    'E2E FIN159 CMV PENDING', 'E2E FIN159', v_pending_sale_order_id,
    'venda', v_today, 100, 'pending'
  ) RETURNING id INTO v_pending_receivable_id;
  v_result := public.execute_financial_settlement(
    pg_catalog.gen_random_uuid(), 'register',
    pg_catalog.jsonb_build_object('source_type', 'manual', 'entries',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'kind', 'receivable', 'account_id', v_pending_receivable_id,
        'amount', 10, 'settled_on', v_today - 1, 'method', 'dinheiro'
      )))
  );
  v_pending_event_id := (v_result #>> '{event_ids,0}')::uuid;
  ASSERT EXISTS (
    SELECT 1 FROM public.financial_settlement_cmv_pending pending
     WHERE pending.receivable_id = v_pending_receivable_id
  );
  v_cash_period := public.get_financial_settlement_cash_period(
    v_today - 1, v_today - 1, NULL
  );
  ASSERT (v_cash_period ->> 'cmv_complete')::boolean IS FALSE;
  ASSERT pg_catalog.jsonb_array_length(v_cash_period -> 'cmv_pending') >= 1;
  v_result := public.execute_financial_settlement(
    pg_catalog.gen_random_uuid(), 'reverse',
    pg_catalog.jsonb_build_object('source_type', 'manual', 'entries',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'event_id', v_pending_event_id, 'reversed_on', v_today,
        'reason', 'estorno posterior sem base de CMV'
      )))
  );
  v_pending_reverse_event_id := (v_result #>> '{event_ids,0}')::uuid;
  ASSERT EXISTS (
    SELECT 1 FROM public.financial_settlement_cmv_pending pending
     WHERE pending.settlement_event_id = v_pending_event_id
       AND pending.effective_on = v_today - 1
  ), 'Estorno posterior apagou pendencia da competencia original';
  ASSERT EXISTS (
    SELECT 1 FROM public.financial_settlement_cmv_pending pending
     WHERE pending.settlement_event_id = v_pending_reverse_event_id
       AND pending.effective_on = v_today
  ), 'Estorno sem CMV original nao sinalizou a propria competencia';
  v_rejected := false;
  BEGIN
    UPDATE public.accounts_receivable SET sale_order_id = NULL
     WHERE id = v_pending_receivable_id;
  EXCEPTION WHEN SQLSTATE '55000' THEN v_rejected := true;
  END;
  ASSERT v_rejected,
    'Mudanca de PV apagaria a evidencia temporal do recebimento/estorno';
  ASSERT (
    SELECT pg_catalog.count(*)
      FROM public.financial_settlement_cmv_pending pending
     WHERE pending.settlement_event_id IN (
       v_pending_event_id, v_pending_reverse_event_id
     )
       AND pending.sale_order_id = v_pending_sale_order_id
  ) = 2, 'Pendencias perderam o PV historico';
  v_cash_period := public.get_financial_settlement_cash_period(
    v_today - 1, v_today - 1, NULL
  );
  ASSERT (v_cash_period ->> 'cmv_complete')::boolean IS FALSE;
  v_cash_period := public.get_financial_settlement_cash_period(
    v_today, v_today, NULL
  );
  ASSERT (v_cash_period ->> 'cmv_complete')::boolean IS FALSE;
END;
$financial_settlement_ledger_e2e$;

-- Prova a rota real authenticated + RLS sem criar/mutar usuarios: escolhe um
-- perfil aprovado financeiro e um aprovado sem admin/gerente, somente leitura.
CREATE TEMP TABLE e2e_financial159_auth_actor (
  actor_kind text PRIMARY KEY,
  actor_id uuid NOT NULL
) ON COMMIT DROP;
INSERT INTO e2e_financial159_auth_actor(actor_kind, actor_id)
SELECT 'financial', candidate.id
  FROM (
    SELECT profile.id,
           CASE WHEN role.role::text = 'admin' THEN 0 ELSE 1 END AS priority
      FROM public.profiles profile
      JOIN public.user_roles role ON role.user_id = profile.id
     WHERE profile.approved IS TRUE
       AND role.role::text IN ('admin', 'gerente')
     ORDER BY priority, profile.id
     LIMIT 1
  ) candidate
UNION ALL
SELECT 'non_financial', candidate.id
  FROM (
    SELECT profile.id
      FROM public.profiles profile
     WHERE profile.approved IS TRUE
       AND NOT EXISTS (
         SELECT 1 FROM public.user_roles role
          WHERE role.user_id = profile.id
            AND role.role::text IN ('admin', 'gerente')
       )
     ORDER BY profile.id
     LIMIT 1
  ) candidate;
DO $financial159_auth_fixture_guard$
BEGIN
  ASSERT (SELECT pg_catalog.count(*) FROM e2e_financial159_auth_actor) = 2,
    'E2E exige perfil aprovado financeiro e aprovado sem papel financeiro';
END;
$financial159_auth_fixture_guard$;
GRANT SELECT ON TABLE e2e_financial159_auth_actor,
  e2e_financial159_legacy_fixture TO authenticated;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  (SELECT actor_id::text FROM e2e_financial159_auth_actor
    WHERE actor_kind = 'financial'), true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'role', 'authenticated',
    'sub', pg_catalog.current_setting('request.jwt.claim.sub', true)
  )::text,
  true
);
SET LOCAL ROLE authenticated;
DO $financial159_approved_financial$
DECLARE
  v_result jsonb;
  v_target_id uuid;
  v_today date := (pg_catalog.clock_timestamp()
    AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  SELECT account_id INTO v_target_id
    FROM e2e_financial159_legacy_fixture
   WHERE fixture_kind = 'authenticated_acl_target';
  v_result := public.execute_financial_settlement(
    pg_catalog.gen_random_uuid(), 'register',
    pg_catalog.jsonb_build_object('source_type', 'manual', 'entries',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'kind', 'payable', 'account_id', v_target_id, 'amount', 1,
        'settled_on', v_today, 'method', 'pix'
      )))
  );
  ASSERT (v_result ->> 'ok')::boolean,
    'Aprovado financeiro nao conseguiu executar a RPC';
  ASSERT EXISTS (
    SELECT 1 FROM public.financial_cash_movements movement
     WHERE movement.account_id = v_target_id
  ), 'Aprovado financeiro nao conseguiu ler view sob RLS';
  ASSERT EXISTS (
    SELECT 1 FROM public.financial_cash_cmv_movements
  ), 'Aprovado financeiro nao conseguiu ler CMV sob RLS';
  ASSERT EXISTS (
    SELECT 1 FROM public.financial_settlement_cmv_pending
  ), 'Aprovado financeiro nao conseguiu ler pendencias sob RLS';
END;
$financial159_approved_financial$;
RESET ROLE;

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  (SELECT actor_id::text FROM e2e_financial159_auth_actor
    WHERE actor_kind = 'non_financial'), true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'role', 'authenticated',
    'sub', pg_catalog.current_setting('request.jwt.claim.sub', true)
  )::text,
  true
);
SET LOCAL ROLE authenticated;
DO $financial159_approved_non_financial$
DECLARE
  v_rejected boolean := false;
  v_target_id uuid;
  v_today date := (pg_catalog.clock_timestamp()
    AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  SELECT account_id INTO v_target_id
    FROM e2e_financial159_legacy_fixture
   WHERE fixture_kind = 'authenticated_acl_target';
  BEGIN
    PERFORM public.execute_financial_settlement(
      pg_catalog.gen_random_uuid(), 'register',
      pg_catalog.jsonb_build_object('source_type', 'manual', 'entries',
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'kind', 'payable', 'account_id', v_target_id, 'amount', 1,
          'settled_on', v_today, 'method', 'pix'
        )))
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := true;
  END;
  ASSERT v_rejected,
    'Perfil aprovado sem papel financeiro conseguiu executar a RPC';
  ASSERT (SELECT pg_catalog.count(*)
            FROM public.financial_cash_movements) = 0,
    'Perfil aprovado sem papel financeiro leu ledger sob RLS';
  ASSERT (SELECT pg_catalog.count(*)
            FROM public.financial_cash_cmv_movements) = 0,
    'Perfil aprovado sem papel financeiro leu CMV sob RLS';
  ASSERT (SELECT pg_catalog.count(*)
            FROM public.financial_settlement_cmv_pending) = 0,
    'Perfil aprovado sem papel financeiro leu pendencias sob RLS';
END;
$financial159_approved_non_financial$;
RESET ROLE;

SET CONSTRAINTS ALL IMMEDIATE;

SELECT pg_catalog.jsonb_build_object(
  'ok', true,
  'proof', 'auth_roles+legacy_head+legacy_cmv_freeze+atomic_batch+replay+guards+origin+inactive_bank_reverse+cmv_residual+cmv_basis_guard+cmv_temporal_pending',
  'rollback', true
) AS financial_settlement_ledger_e2e_result;

ROLLBACK;
