-- =============================================================================
-- Cutoff do banco de horas — ignora tudo antes de 2026-04-15
-- =============================================================================
-- Decisão tomada em 2026-05-24 após auditoria identificar dados antigos
-- (out/2025-mar/2026) cheios de batidas inconsistentes que distorciam
-- saldo. Em vez de deletar registros (perde rastreabilidade), filtra no
-- cálculo. Dados crus em time_records preservados.
--
-- Centraliza a data numa função pra mudança futura ser 1-linha.
-- Aplicada via MCP em ssvxfoybzmjlypnipqzn em 2026-05-24.
-- Resultado: 1.883 registros pré-cutoff ignorados, 1.303 considerados,
-- pendências caíram de 245 → 126.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_bank_hours_cutoff()
RETURNS date
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path TO 'public'
AS $fn$
  SELECT '2026-04-15'::date;
$fn$;

GRANT EXECUTE ON FUNCTION public.get_bank_hours_cutoff() TO authenticated;

-- v_time_pendings + calculate_employee_bank_balance recriadas com filtro
-- WHERE tr.record_date >= public.get_bank_hours_cutoff() — ver MCP source
-- via pg_get_functiondef('public.calculate_employee_bank_balance(uuid,date,date)').
-- Apuração label: 'semanal_individual_schedule_v3_cutoff'.
-- Calculation result expõe novas chaves: cutoff_date, effective_from.
