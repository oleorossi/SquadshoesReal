-- Abre a transacao antes das migrations 159/160 no dry-run concatenado.
BEGIN;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '15s';
SET LOCAL plpgsql.check_asserts = on;

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('e2e-bank-reconciliation-ofx-160', 160)
);

DO $setup_ofx160$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.bank_reconciliations),
    'A base de validacao possui conciliacao legada sem FITID';
  ASSERT NOT EXISTS (SELECT 1 FROM public.bank_reconciliation_items),
    'A base de validacao possui linha legada sem FITID';
END;
$setup_ofx160$;
