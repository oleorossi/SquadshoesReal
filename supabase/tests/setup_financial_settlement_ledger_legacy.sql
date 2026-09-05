-- =============================================================================
-- Setup PRE-migration 15900: saldos legados sinteticos, sempre sob ROLLBACK.
-- Deve executar imediatamente antes da migration e do E2E, na mesma transacao.
-- =============================================================================

SET LOCAL plpgsql.check_asserts = on;

CREATE TEMP TABLE e2e_financial159_legacy_fixture (
  fixture_kind text PRIMARY KEY,
  account_id uuid NOT NULL,
  sale_order_id uuid,
  cmv_entry_id uuid,
  revenue_entry_id uuid
) ON COMMIT DROP;

DO $setup_financial_settlement_ledger_legacy$
DECLARE
  v_suffix text := pg_catalog.gen_random_uuid()::text;
  v_payable_id uuid;
  v_receivable_id uuid;
  v_cmv_receivable_id uuid;
  v_sale_order_id uuid;
  v_cmv_entry_id uuid;
  v_revenue_entry_id uuid;
  v_missing_cmv_sale_order_id uuid;
  v_missing_cmv_receivable_id uuid;
BEGIN
  IF pg_catalog.to_regclass('public.financial_settlement_events') IS NOT NULL THEN
    RAISE EXCEPTION 'Setup legado 15900 deve rodar antes da migration do ledger';
  END IF;

  INSERT INTO public.accounts_payable (
    description, category, due_date, amount, amount_paid, status,
    payment_date, payment_method, notes
  ) VALUES (
    'E2E FIN159 AP LEGACY ' || v_suffix,
    'e2e_legacy_payable', CURRENT_DATE, 1000, 100, 'parcial',
    NULL, 'pix', 'fixture pre-migration; rollback automatico'
  ) RETURNING id INTO v_payable_id;

  INSERT INTO public.accounts_receivable (
    description, client_name, category, due_date, amount, amount_received,
    status, payment_date, payment_method, notes
  ) VALUES (
    'E2E FIN159 AR LEGACY ' || v_suffix,
    'E2E FIN159', 'e2e_legacy_receivable', CURRENT_DATE,
    1000, 200, 'parcial', CURRENT_DATE - 10, 'boleto',
    'fixture pre-migration; rollback automatico'
  ) RETURNING id INTO v_receivable_id;

  INSERT INTO public.sale_orders (
    order_number, client_name, status, total, client_order_number
  ) VALUES (
    'E2E-FIN159-LEGACY-CMV-' || pg_catalog.left(v_suffix, 8),
    'E2E FIN159', 'Rascunho', 100,
    'LEGACY-CMV-' || pg_catalog.left(v_suffix, 8)
  ) RETURNING id INTO v_sale_order_id;
  INSERT INTO public.accounts_receivable (
    description, client_name, sale_order_id, category, due_date, amount,
    amount_received, status, payment_date, payment_method, notes
  ) VALUES (
    'E2E FIN159 AR LEGACY CMV ' || v_suffix, 'E2E FIN159',
    v_sale_order_id, 'venda', CURRENT_DATE, 100, 50, 'parcial',
    CURRENT_DATE - 20, 'boleto',
    'fixture CMV pre-migration; rollback automatico'
  ) RETURNING id INTO v_cmv_receivable_id;
  INSERT INTO public.financial_entries (
    entry_date, type, description, amount, reference_type, reference_id,
    status, category
  ) VALUES (
    CURRENT_DATE - 20, 'receita', 'E2E FIN159 receita legada', 100,
    'sale_order', v_sale_order_id::text, 'confirmado', 'venda'
  ) RETURNING id INTO v_revenue_entry_id;
  INSERT INTO public.financial_entries (
    entry_date, type, description, amount, reference_type, reference_id,
    status, category
  ) VALUES (
    CURRENT_DATE - 20, 'despesa', 'E2E FIN159 CMV legado', 60,
    'sale_order_cmv', v_sale_order_id::text, 'confirmado', 'cmv'
  ) RETURNING id INTO v_cmv_entry_id;
  ASSERT (
    SELECT recognized.recognized_amount
      FROM public.sale_order_cmv_recognized recognized
     WHERE recognized.receivable_id = v_cmv_receivable_id
  ) = 30, 'Fixture pre-159 nao formou CMV legado esperado';

  INSERT INTO public.sale_orders (
    order_number, client_name, status, total, client_order_number
  ) VALUES (
    'E2E-FIN159-LEGACY-MISSING-' || pg_catalog.left(v_suffix, 8),
    'E2E FIN159', 'Rascunho', 100,
    'LEGACY-MISSING-' || pg_catalog.left(v_suffix, 8)
  ) RETURNING id INTO v_missing_cmv_sale_order_id;
  INSERT INTO public.accounts_receivable (
    description, client_name, sale_order_id, category, due_date, amount,
    amount_received, status, payment_date, payment_method, notes
  ) VALUES (
    'E2E FIN159 AR LEGACY SEM CMV ' || v_suffix, 'E2E FIN159',
    v_missing_cmv_sale_order_id, 'venda', CURRENT_DATE, 100, 20, 'parcial',
    CURRENT_DATE - 15, 'pix',
    'fixture sem evidencia CMV pre-migration; rollback automatico'
  ) RETURNING id INTO v_missing_cmv_receivable_id;

  INSERT INTO e2e_financial159_legacy_fixture(
    fixture_kind, account_id, sale_order_id, cmv_entry_id, revenue_entry_id
  ) VALUES
    ('payable_undated', v_payable_id, NULL, NULL, NULL),
    ('receivable_dated', v_receivable_id, NULL, NULL, NULL),
    ('receivable_cmv', v_cmv_receivable_id, v_sale_order_id,
      v_cmv_entry_id, v_revenue_entry_id),
    ('receivable_missing_cmv', v_missing_cmv_receivable_id,
      v_missing_cmv_sale_order_id, NULL, NULL);
END;
$setup_financial_settlement_ledger_legacy$;

-- DDL da migration nao pode encontrar eventos de constraint pendentes. Forca
-- a validacao do fixture e depois restaura somente o default originalmente
-- INITIALLY DEFERRED (sem desligar trigger nem fazer COMMIT intermediario).
SET CONSTRAINTS ALL IMMEDIATE;
DO $restore_initially_deferred_constraints$
DECLARE
  v_constraint record;
BEGIN
  FOR v_constraint IN
    SELECT namespace.nspname, constraint_info.conname
      FROM pg_catalog.pg_constraint constraint_info
      JOIN pg_catalog.pg_namespace namespace
        ON namespace.oid = constraint_info.connamespace
     WHERE constraint_info.condeferrable
       AND constraint_info.condeferred
  LOOP
    EXECUTE pg_catalog.format(
      'SET CONSTRAINTS %I.%I DEFERRED',
      v_constraint.nspname, v_constraint.conname
    );
  END LOOP;
END;
$restore_initially_deferred_constraints$;
