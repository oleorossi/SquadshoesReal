-- =============================================================================
-- E2E transacional: setup -> migration 159 -> migration 160 -> este arquivo.
-- Fixtures sao locais, nenhum provedor bancario/fiscal e chamado; termina rollback.
-- =============================================================================

BEGIN;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '15s';
SET LOCAL plpgsql.check_asserts = on;

-- Um authenticated sem perfil aprovado nao importa nem concilia.
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
DO $ofx160_unapproved$
DECLARE
  v_rejected boolean := false;
BEGIN
  BEGIN
    PERFORM public.execute_bank_reconciliation_command(
      pg_catalog.gen_random_uuid(), 'import', '{}'::jsonb
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := true;
  END;
  ASSERT v_rejected,
    'authenticated sem papel financeiro executou comando OFX';
END;
$ofx160_unapproved$;
RESET ROLE;

-- Claim de servico com ator sintetico, igual aos demais E2Es financeiros.
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

DO $bank_reconciliation_ofx_e2e$
DECLARE
  v_suffix text := pg_catalog.gen_random_uuid()::text;
  v_today date := (pg_catalog.clock_timestamp()
    AT TIME ZONE 'America/Sao_Paulo')::date;
  v_bank_id uuid;
  v_payable_id uuid;
  v_receivable_id uuid;
  v_too_small_receivable_id uuid;
  v_import_id uuid := pg_catalog.gen_random_uuid();
  v_match_id uuid := pg_catalog.gen_random_uuid();
  v_unmatch_id uuid := pg_catalog.gen_random_uuid();
  v_rematch_id uuid := pg_catalog.gen_random_uuid();
  v_reconciliation_id uuid;
  v_debit_item_id uuid;
  v_credit_item_id uuid;
  v_debit_event_id uuid;
  v_credit_event_id uuid;
  v_reversal_event_id uuid;
  v_rematch_event_id uuid;
  v_statement jsonb;
  v_payload jsonb;
  v_result jsonb;
  v_replay jsonb;
  v_bad_entry jsonb;
  v_rejected boolean;
  v_before bigint;
BEGIN
  ASSERT pg_catalog.to_regprocedure(
    'public.execute_bank_reconciliation_command(uuid,text,jsonb,uuid)'
  ) IS NOT NULL;
  ASSERT NOT pg_catalog.has_table_privilege(
    'authenticated', 'public.bank_reconciliations', 'INSERT'
  );
  ASSERT NOT pg_catalog.has_table_privilege(
    'authenticated', 'public.bank_reconciliation_items', 'UPDATE'
  );
  ASSERT NOT pg_catalog.has_table_privilege(
    'authenticated', 'public.bank_reconciliation_actions', 'DELETE'
  );
  ASSERT pg_catalog.has_function_privilege(
    'authenticated',
    'public.execute_bank_reconciliation_command(uuid,text,jsonb,uuid)',
    'EXECUTE'
  );
  ASSERT NOT pg_catalog.has_function_privilege(
    'authenticated',
    'private.execute_financial_settlement_core_159(uuid,text,jsonb,text,text)',
    'EXECUTE'
  );
  v_rejected := false;
  BEGIN
    PERFORM public.execute_bank_reconciliation_command(
      pg_catalog.gen_random_uuid(), 'import', '{}'::jsonb,
      pg_catalog.gen_random_uuid()
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected := true;
  END;
  ASSERT v_rejected, 'Comando OFX aceitou ator diferente da sessao';

  INSERT INTO public.bank_accounts (
    name, bank_name, agency, account_number, account_type,
    initial_balance, current_balance, active
  ) VALUES (
    'E2E OFX160 ' || v_suffix, 'Banco E2E', '0001', '000012-3',
    'corrente', 1000, 1000, true
  ) RETURNING id INTO v_bank_id;
  INSERT INTO public.accounts_payable (
    description, category, due_date, amount, status, notes
  ) VALUES (
    'E2E OFX160 AP ' || v_suffix, 'e2e_ofx', v_today, 100,
    'pending', 'rollback automatico'
  ) RETURNING id INTO v_payable_id;
  INSERT INTO public.accounts_receivable (
    description, client_name, category, due_date, amount, status, notes
  ) VALUES (
    'E2E OFX160 AR ' || v_suffix, 'Cliente E2E', 'e2e_ofx',
    v_today, 60, 'pending', 'rollback automatico'
  ) RETURNING id INTO v_receivable_id;
  INSERT INTO public.accounts_receivable (
    description, client_name, category, due_date, amount, status, notes
  ) VALUES (
    'E2E OFX160 AR pequeno ' || v_suffix, 'Cliente E2E', 'e2e_ofx',
    v_today, 50, 'pending', 'rollback automatico'
  ) RETURNING id INTO v_too_small_receivable_id;

  v_statement := pg_catalog.jsonb_build_object(
    'version', 1,
    'account', pg_catalog.jsonb_build_object(
      'kind', 'bank', 'institution_id', '["E2E","001"]',
      'bank_id', '001', 'branch_id', '0001',
      'account_id', '0000123', 'account_type', 'CHECKING',
      'currency', 'BRL'
    ),
    'transactions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'fit_id', 'FIT-AP-' || v_suffix,
        'posted_date', v_today,
        'posted_at_raw', pg_catalog.to_char(v_today, 'YYYYMMDD') || '120000[-3:BRT]',
        'amount_cents', -4000,
        'transaction_type', 'DEBIT',
        'name', 'Fornecedor E2E', 'memo', 'PIX parcial AP',
        'check_number', '', 'reference_number', 'REF-AP'
      ),
      pg_catalog.jsonb_build_object(
        'fit_id', 'FIT-AR-' || v_suffix,
        'posted_date', v_today,
        'posted_at_raw', pg_catalog.to_char(v_today, 'YYYYMMDD') || '130000[-3:BRT]',
        'amount_cents', 6000,
        'transaction_type', 'CREDIT',
        'name', 'Cliente E2E', 'memo', 'Recebimento integral',
        'check_number', '', 'reference_number', 'REF-AR'
      )
    ),
    'balance', pg_catalog.jsonb_build_object(
      'amount_cents', 102000,
      'as_of_date', v_today,
      'as_of_raw', pg_catalog.to_char(v_today, 'YYYYMMDD') || '235959[-3:BRT]'
    ),
    'pending_count', 2,
    'duplicate_count', 1
  );
  v_payload := pg_catalog.jsonb_build_object(
    'bank_account_id', v_bank_id,
    'statement', v_statement
  );
  v_result := public.execute_bank_reconciliation_command(
    v_import_id, 'import', v_payload
  );
  ASSERT (v_result ->> 'ok')::boolean;
  ASSERT v_result ->> 'command' = 'import';
  ASSERT (v_result ->> 'item_count')::integer = 2;
  ASSERT pg_catalog.jsonb_array_length(v_result -> 'event_ids') = 0;
  v_reconciliation_id := (v_result ->> 'reconciliation_id')::uuid;
  ASSERT (SELECT total_debits FROM public.bank_reconciliations
           WHERE id = v_reconciliation_id) = 40;
  ASSERT (SELECT total_credits FROM public.bank_reconciliations
           WHERE id = v_reconciliation_id) = 60;
  ASSERT (SELECT transaction_count FROM public.bank_reconciliations
           WHERE id = v_reconciliation_id) = 2;
  ASSERT (SELECT unmatched_count FROM public.bank_reconciliations
           WHERE id = v_reconciliation_id) = 2;
  ASSERT (SELECT pending_count FROM public.bank_reconciliations
           WHERE id = v_reconciliation_id) = 2;
  ASSERT (SELECT duplicate_count FROM public.bank_reconciliations
           WHERE id = v_reconciliation_id) = 1;
  ASSERT (SELECT ledger_balance FROM public.bank_reconciliations
           WHERE id = v_reconciliation_id) = 1020;
  SELECT id INTO v_debit_item_id
    FROM public.bank_reconciliation_items
   WHERE reconciliation_id = v_reconciliation_id
     AND movement_type = 'debito';
  SELECT id INTO v_credit_item_id
    FROM public.bank_reconciliation_items
   WHERE reconciliation_id = v_reconciliation_id
     AND movement_type = 'credito';
  ASSERT v_debit_item_id IS NOT NULL AND v_credit_item_id IS NOT NULL;
  ASSERT (SELECT amount FROM public.bank_reconciliation_items
           WHERE id = v_debit_item_id) = 40;
  ASSERT (SELECT amount_cents FROM public.bank_reconciliation_items
           WHERE id = v_debit_item_id) = -4000;

  -- Saldo em fracao de centavo ou data especial nao e normalizado por cast.
  FOREACH v_bad_entry IN ARRAY ARRAY[
    pg_catalog.jsonb_set(v_statement, '{balance,amount_cents}', '100.5'::jsonb),
    pg_catalog.jsonb_set(
      v_statement, '{balance,as_of_date}', pg_catalog.to_jsonb('infinity'::text)
    )
  ]
  LOOP
    v_rejected := false;
    BEGIN
      PERFORM public.execute_bank_reconciliation_command(
        pg_catalog.gen_random_uuid(), 'import',
        pg_catalog.jsonb_build_object(
          'bank_account_id', v_bank_id, 'statement', v_bad_entry
        )
      );
    EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected := true;
    END;
    ASSERT v_rejected, 'Importacao aceitou saldo/data ambiguo';
  END LOOP;
  ASSERT (SELECT pg_catalog.count(*) FROM public.bank_reconciliations
           WHERE bank_account_id = v_bank_id) = 1;

  -- Tipos JSON ambiguos nunca atravessam o CAS ou viram arredondamento implicito.
  FOREACH v_bad_entry IN ARRAY ARRAY[
    pg_catalog.jsonb_build_object(
      'item_id', v_debit_item_id, 'expected_revision', NULL,
      'kind', 'payable', 'account_id', v_payable_id
    ),
    pg_catalog.jsonb_build_object(
      'item_id', v_debit_item_id, 'expected_revision', '0',
      'kind', 'payable', 'account_id', v_payable_id
    ),
    pg_catalog.jsonb_build_object(
      'item_id', v_debit_item_id, 'expected_revision', 0.5,
      'kind', 'payable', 'account_id', v_payable_id
    )
  ]
  LOOP
    v_rejected := false;
    BEGIN
      PERFORM public.execute_bank_reconciliation_command(
        pg_catalog.gen_random_uuid(), 'match',
        pg_catalog.jsonb_build_object(
          'reconciliation_id', v_reconciliation_id,
          'entries', pg_catalog.jsonb_build_array(v_bad_entry)
        )
      );
    EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected := true;
    END;
    ASSERT v_rejected, 'expected_revision ambiguo atravessou o CAS';
  END LOOP;

  -- Retry igual reproduz recibo; command divergente e sobreposicao nao deixam linhas.
  v_replay := public.execute_bank_reconciliation_command(
    v_import_id, 'import', v_payload
  );
  ASSERT (v_replay ->> 'replayed')::boolean;
  ASSERT v_replay ->> 'reconciliation_id' = v_reconciliation_id::text;
  ASSERT (SELECT pg_catalog.count(*) FROM public.bank_reconciliation_items
           WHERE reconciliation_id = v_reconciliation_id) = 2;
  v_rejected := false;
  BEGIN
    PERFORM public.execute_bank_reconciliation_command(
      v_import_id, 'import',
      pg_catalog.jsonb_set(v_payload, '{statement,pending_count}', '3'::jsonb)
    );
  EXCEPTION WHEN SQLSTATE '23505' THEN v_rejected := true;
  END;
  ASSERT v_rejected, 'Replay divergente reutilizou command_id';

  v_result := public.execute_bank_reconciliation_command(
    pg_catalog.gen_random_uuid(), 'import', v_payload
  );
  ASSERT (v_result ->> 'reused')::boolean;
  ASSERT v_result ->> 'reconciliation_id' = v_reconciliation_id::text;

  SELECT pg_catalog.count(*) INTO v_before
    FROM public.bank_reconciliation_items;
  v_rejected := false;
  BEGIN
    PERFORM public.execute_bank_reconciliation_command(
      pg_catalog.gen_random_uuid(), 'import',
      pg_catalog.jsonb_build_object(
        'bank_account_id', v_bank_id,
        'statement', pg_catalog.jsonb_set(
          v_statement,
          '{transactions,1,fit_id}',
          pg_catalog.to_jsonb('FIT-NEW-' || v_suffix)
        )
      )
    );
  EXCEPTION WHEN SQLSTATE '23505' THEN v_rejected := true;
  END;
  ASSERT v_rejected;
  ASSERT (SELECT pg_catalog.count(*) FROM public.bank_reconciliation_items) = v_before,
    'Importacao sobreposta deixou linha parcial';

  -- Direcao errada e lote com overpayment falham antes de qualquer evento/item.
  SELECT pg_catalog.count(*) INTO v_before
    FROM public.financial_settlement_events;
  v_rejected := false;
  BEGIN
    PERFORM public.execute_bank_reconciliation_command(
      pg_catalog.gen_random_uuid(), 'match',
      pg_catalog.jsonb_build_object(
        'reconciliation_id', v_reconciliation_id,
        'entries', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'item_id', v_credit_item_id, 'expected_revision', 0,
            'kind', 'payable', 'account_id', v_payable_id
          )
        )
      )
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN v_rejected := true;
  END;
  ASSERT v_rejected;
  ASSERT (SELECT pg_catalog.count(*) FROM public.financial_settlement_events) = v_before;

  v_rejected := false;
  BEGIN
    PERFORM public.execute_bank_reconciliation_command(
      pg_catalog.gen_random_uuid(), 'match',
      pg_catalog.jsonb_build_object(
        'reconciliation_id', v_reconciliation_id,
        'entries', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'item_id', v_debit_item_id, 'expected_revision', 0,
            'kind', 'payable', 'account_id', v_payable_id
          ),
          pg_catalog.jsonb_build_object(
            'item_id', v_credit_item_id, 'expected_revision', 0,
            'kind', 'receivable', 'account_id', v_too_small_receivable_id
          )
        )
      )
    );
  EXCEPTION WHEN SQLSTATE '23514' THEN v_rejected := true;
  END;
  ASSERT v_rejected;
  ASSERT (SELECT pg_catalog.count(*) FROM public.financial_settlement_events) = v_before,
    'Lote OFX acima do saldo deixou evento parcial';
  ASSERT (SELECT pg_catalog.sum(revision) FROM public.bank_reconciliation_items
           WHERE reconciliation_id = v_reconciliation_id) = 0;

  -- Um unico lote deriva valor/data/banco/FITID e projeta parcial + integral.
  v_payload := pg_catalog.jsonb_build_object(
    'reconciliation_id', v_reconciliation_id,
    'entries', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'item_id', v_debit_item_id, 'expected_revision', 0,
        'kind', 'payable', 'account_id', v_payable_id
      ),
      pg_catalog.jsonb_build_object(
        'item_id', v_credit_item_id, 'expected_revision', 0,
        'kind', 'receivable', 'account_id', v_receivable_id
      )
    )
  );
  v_result := public.execute_bank_reconciliation_command(
    v_match_id, 'match', v_payload
  );
  ASSERT pg_catalog.jsonb_array_length(v_result -> 'event_ids') = 2;
  v_debit_event_id := (v_result #>> '{event_ids,0}')::uuid;
  v_credit_event_id := (v_result #>> '{event_ids,1}')::uuid;
  ASSERT (SELECT amount_paid FROM public.accounts_payable
           WHERE id = v_payable_id) = 40;
  ASSERT (SELECT status FROM public.accounts_payable
           WHERE id = v_payable_id) = 'parcial';
  ASSERT (SELECT amount_received FROM public.accounts_receivable
           WHERE id = v_receivable_id) = 60;
  ASSERT (SELECT status FROM public.accounts_receivable
           WHERE id = v_receivable_id) = 'received';
  ASSERT (SELECT revision FROM public.bank_reconciliation_items
           WHERE id = v_debit_item_id) = 1;
  ASSERT (SELECT status FROM public.bank_reconciliation_items
           WHERE id = v_debit_item_id) = 'conciliado';
  ASSERT (SELECT matched_count FROM public.bank_reconciliations
           WHERE id = v_reconciliation_id) = 2;
  ASSERT (SELECT status FROM public.bank_reconciliations
           WHERE id = v_reconciliation_id) = 'conciliada';
  ASSERT (SELECT source_type FROM public.financial_settlement_events
           WHERE id = v_debit_event_id) = 'ofx';
  ASSERT (SELECT bank_account_id FROM public.financial_settlement_events
           WHERE id = v_debit_event_id) = v_bank_id;
  ASSERT (SELECT effective_on FROM public.financial_settlement_events
           WHERE id = v_debit_event_id) = v_today;
  ASSERT (SELECT source_line_key FROM public.financial_settlement_events
           WHERE id = v_debit_event_id)
    = 'FIT-AP-' || v_suffix || ':r0:payable:' || v_payable_id::text;

  -- Motivo nao textual e data especial/nao ISO nunca viram estorno implicito.
  SELECT pg_catalog.count(*) INTO v_before
    FROM public.financial_settlement_events;
  FOREACH v_bad_entry IN ARRAY ARRAY[
    pg_catalog.jsonb_build_object(
      'item_id', v_debit_item_id, 'expected_revision', 1,
      'reversed_on', v_today, 'reason', true
    ),
    pg_catalog.jsonb_build_object(
      'item_id', v_debit_item_id, 'expected_revision', 1,
      'reversed_on', 'infinity', 'reason', 'data nao ISO'
    )
  ]
  LOOP
    v_rejected := false;
    BEGIN
      PERFORM public.execute_bank_reconciliation_command(
        pg_catalog.gen_random_uuid(), 'unmatch',
        pg_catalog.jsonb_build_object(
          'reconciliation_id', v_reconciliation_id,
          'entries', pg_catalog.jsonb_build_array(v_bad_entry)
        )
      );
    EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected := true;
    END;
    ASSERT v_rejected, 'Unmatch aceitou motivo/data com tipo ambiguo';
  END LOOP;
  ASSERT (SELECT pg_catalog.count(*) FROM public.financial_settlement_events) = v_before;
  ASSERT (SELECT revision FROM public.bank_reconciliation_items
           WHERE id = v_debit_item_id) = 1;

  v_replay := public.execute_bank_reconciliation_command(
    v_match_id, 'match', v_payload
  );
  ASSERT (v_replay ->> 'replayed')::boolean;
  ASSERT v_replay -> 'event_ids' = v_result -> 'event_ids';
  ASSERT (SELECT pg_catalog.count(*) FROM public.bank_reconciliation_actions
           WHERE command_id = v_match_id) = 2;

  -- A RPC manual nao pode separar o evento OFX de sua linha persistida.
  v_rejected := false;
  BEGIN
    PERFORM public.execute_financial_settlement(
      pg_catalog.gen_random_uuid(), 'reverse',
      pg_catalog.jsonb_build_object(
        'entries', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'event_id', v_debit_event_id,
            'reversed_on', v_today,
            'reason', 'bypass manual'
          )
        )
      )
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected := true;
  END;
  ASSERT v_rejected, 'Wrapper manual estornou evento OFX';

  -- Um segundo command com revision velha falha, sem novo evento.
  SELECT pg_catalog.count(*) INTO v_before
    FROM public.financial_settlement_events;
  v_rejected := false;
  BEGIN
    PERFORM public.execute_bank_reconciliation_command(
      pg_catalog.gen_random_uuid(), 'match',
      pg_catalog.jsonb_build_object(
        'reconciliation_id', v_reconciliation_id,
        'entries', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'item_id', v_debit_item_id, 'expected_revision', 0,
            'kind', 'payable', 'account_id', v_payable_id
          )
        )
      )
    );
  EXCEPTION WHEN SQLSTATE '40001' THEN v_rejected := true;
  END;
  ASSERT v_rejected;
  ASSERT (SELECT pg_catalog.count(*) FROM public.financial_settlement_events) = v_before;

  -- Unmatch reverte exatamente o evento e libera a linha na mesma transacao.
  v_payload := pg_catalog.jsonb_build_object(
    'reconciliation_id', v_reconciliation_id,
    'entries', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'item_id', v_debit_item_id, 'expected_revision', 1,
        'reversed_on', v_today, 'reason', 'E2E vinculo incorreto'
      )
    )
  );
  v_result := public.execute_bank_reconciliation_command(
    v_unmatch_id, 'unmatch', v_payload
  );
  v_reversal_event_id := (v_result #>> '{event_ids,0}')::uuid;
  ASSERT (SELECT reverses_event_id FROM public.financial_settlement_events
           WHERE id = v_reversal_event_id) = v_debit_event_id;
  ASSERT (SELECT amount_paid FROM public.accounts_payable
           WHERE id = v_payable_id) = 0;
  ASSERT (SELECT revision FROM public.bank_reconciliation_items
           WHERE id = v_debit_item_id) = 2;
  ASSERT (SELECT status FROM public.bank_reconciliation_items
           WHERE id = v_debit_item_id) = 'nao_conciliado';
  ASSERT (SELECT settlement_event_id FROM public.bank_reconciliation_items
           WHERE id = v_debit_item_id) IS NULL;
  ASSERT (SELECT matched_count FROM public.bank_reconciliations
           WHERE id = v_reconciliation_id) = 1;
  v_replay := public.execute_bank_reconciliation_command(
    v_unmatch_id, 'unmatch', v_payload
  );
  ASSERT (v_replay ->> 'replayed')::boolean;

  -- Rematch legitimo usa a revisao 2 e outra chave externa; o fato antigo fica.
  v_payload := pg_catalog.jsonb_build_object(
    'reconciliation_id', v_reconciliation_id,
    'entries', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'item_id', v_debit_item_id, 'expected_revision', 2,
        'kind', 'payable', 'account_id', v_payable_id
      )
    )
  );
  v_result := public.execute_bank_reconciliation_command(
    v_rematch_id, 'match', v_payload
  );
  v_rematch_event_id := (v_result #>> '{event_ids,0}')::uuid;
  ASSERT v_rematch_event_id <> v_debit_event_id;
  ASSERT (SELECT source_line_key FROM public.financial_settlement_events
           WHERE id = v_rematch_event_id)
    = 'FIT-AP-' || v_suffix || ':r2:payable:' || v_payable_id::text;
  ASSERT (SELECT revision FROM public.bank_reconciliation_items
           WHERE id = v_debit_item_id) = 3;
  ASSERT (SELECT amount_paid FROM public.accounts_payable
           WHERE id = v_payable_id) = 40;
  ASSERT (SELECT pg_catalog.count(*)
            FROM public.bank_reconciliation_actions match_action
           WHERE match_action.item_id = v_debit_item_id
             AND match_action.action_type = 'match'
             AND NOT EXISTS (
               SELECT 1 FROM public.bank_reconciliation_actions unmatch_action
                WHERE unmatch_action.reverses_action_id = match_action.id
             )) = 1,
    'Linha OFX ficou com mais de um match ativo';

  -- Desativar a conta nao pode prender a correcao de um fato historico.
  UPDATE public.bank_accounts SET active = false WHERE id = v_bank_id;
  v_result := public.execute_bank_reconciliation_command(
    pg_catalog.gen_random_uuid(), 'unmatch',
    pg_catalog.jsonb_build_object(
      'reconciliation_id', v_reconciliation_id,
      'entries', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'item_id', v_debit_item_id, 'expected_revision', 3,
          'reversed_on', v_today, 'reason', 'E2E conta depois inativa'
        )
      )
    )
  );
  ASSERT (SELECT amount_paid FROM public.accounts_payable
           WHERE id = v_payable_id) = 0;
  ASSERT (SELECT revision FROM public.bank_reconciliation_items
           WHERE id = v_debit_item_id) = 4;
  ASSERT (SELECT current_balance FROM public.bank_accounts WHERE id = v_bank_id) = 1000,
    'Conciliacao alterou saldo manual de bank_accounts';

  -- Evidencias e auditoria sao imutaveis mesmo para owner; clientes nao tem DML.
  v_rejected := false;
  BEGIN
    UPDATE public.bank_reconciliation_items
       SET amount = 0.01
     WHERE id = v_credit_item_id;
  EXCEPTION WHEN SQLSTATE '55000' OR SQLSTATE '23514' THEN v_rejected := true;
  END;
  ASSERT v_rejected, 'Evidencia monetaria OFX foi alterada';
  v_rejected := false;
  BEGIN
    DELETE FROM public.bank_reconciliation_actions
     WHERE item_id = v_credit_item_id;
  EXCEPTION WHEN SQLSTATE '55000' THEN v_rejected := true;
  END;
  ASSERT v_rejected, 'Auditoria OFX foi apagada';

  ASSERT (SELECT pg_catalog.count(*) FROM public.financial_settlement_events
           WHERE source_type = 'ofx'
             AND source_reference = v_bank_id::text || ':' || v_reconciliation_id::text) = 5;
  ASSERT v_credit_event_id IS NOT NULL;
END;
$bank_reconciliation_ofx_e2e$;

SET CONSTRAINTS ALL IMMEDIATE;

SELECT pg_catalog.jsonb_build_object(
  'ok', true,
  'proof', 'acl+fitid+import_replay+overlap_atomic+batch_atomic+derived_source+manual_reverse_blocked+cas+unmatch+rematch+inactive_bank_reverse+immutable',
  'rollback', true
) AS bank_reconciliation_ofx_e2e_result;

ROLLBACK;

SELECT pg_catalog.jsonb_build_object(
  'marker', 'bank_reconciliation_ofx_e2e_rollback',
  'bank_residue', (SELECT pg_catalog.count(*) FROM public.bank_accounts
    WHERE name LIKE 'E2E OFX160 %'),
  'payable_residue', (SELECT pg_catalog.count(*) FROM public.accounts_payable
    WHERE description LIKE 'E2E OFX160 %'),
  'receivable_residue', (SELECT pg_catalog.count(*) FROM public.accounts_receivable
    WHERE description LIKE 'E2E OFX160 %')
) AS bank_reconciliation_ofx_e2e_rollback_result;
