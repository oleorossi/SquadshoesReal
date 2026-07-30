-- =============================================================================
-- Auditoria visual 11/06/2026 — KPIs do Banco de Horas zerados/traço
-- =============================================================================
-- O frontend (BankHours.tsx) lê total_employees / employees_with_credit /
-- employees_with_debit / employees_balanced / sector_count, mas a view live
-- ainda tinha o schema antigo (employee_count / employees_in_credit / ...),
-- da era pré-20260629140000. Como CREATE OR REPLACE VIEW não renomeia
-- colunas, é preciso DROP + CREATE.
-- ✅ APLICADA via Supabase MCP em 11/06/2026.

DROP VIEW IF EXISTS public.v_bank_hours_summary;

CREATE VIEW public.v_bank_hours_summary AS
SELECT
  COUNT(DISTINCT e.id)                                                                    AS total_employees,
  COUNT(DISTINCT e.id) FILTER (WHERE COALESCE(b.balance_min, 0) > 0)                      AS employees_with_credit,
  COUNT(DISTINCT e.id) FILTER (WHERE COALESCE(b.balance_min, 0) < 0)                      AS employees_with_debit,
  COUNT(DISTINCT e.id) FILTER (WHERE COALESCE(b.balance_min, 0) = 0)                      AS employees_balanced,
  COALESCE(SUM(b.balance_min), 0)::int                                                    AS total_balance_min,
  COALESCE(SUM(b.balance_min) FILTER (WHERE b.balance_min > 0), 0)::int                   AS total_credit_min,
  COALESCE(SUM(b.balance_min) FILTER (WHERE b.balance_min < 0), 0)::int                   AS total_debit_min,
  COUNT(DISTINCT e.department)                                                            AS sector_count
FROM public.employees e
LEFT JOIN public.bank_hours_balance b ON b.employee_id = e.id
WHERE e.active = true;

GRANT SELECT ON public.v_bank_hours_summary TO authenticated;
