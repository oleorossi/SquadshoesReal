-- =============================================================================
-- Enforce single active primary company
-- =============================================================================
-- Audit-37 finding [8]: useSetPrimaryCompany does a clear-all THEN set-new in
-- two separate UPDATE statements. Two concurrent callers (two browser tabs or
-- double-click) can race: both clear, both set → two rows with is_primary=true.
-- emit-nfe then picks whichever PostgreSQL returns first from
--   .eq('is_primary', true).eq('active', true).limit(1)
-- — a non-deterministic CNPJ on the fiscal NF-e document.
--
-- Fix: partial unique index on (is_primary) WHERE is_primary = true AND active = true.
-- The second concurrent SET raises 23505 (unique_violation) instead of silently
-- committing a duplicate primary. The two-step client-side flow becomes self-correcting:
-- clear succeeds, set succeeds for one caller; the other caller's set is rejected.
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_companies_single_primary
  ON public.companies (is_primary)
  WHERE is_primary = true AND active = true;

COMMENT ON INDEX public.uq_companies_single_primary IS
  'Enforces at most one active primary company. '
  'Prevents concurrent useSetPrimaryCompany calls from committing two is_primary=true rows, '
  'which would cause emit-nfe to pick a non-deterministic CNPJ on fiscal NF-e documents.';
