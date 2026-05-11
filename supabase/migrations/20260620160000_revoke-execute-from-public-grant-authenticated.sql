-- =============================================================================
-- Bloqueia execução anônima de funções SECURITY DEFINER
-- =============================================================================
-- A migration anterior (20260620150000) só revogava de `anon` direto, mas
-- todas as 134 funções tinham `GRANT EXECUTE TO PUBLIC` (default do Postgres
-- ao criar função). PUBLIC inclui anon → revogação anterior foi no-op
-- pra 131 das 134.
--
-- Estratégia correta:
--   1. REVOKE EXECUTE ... FROM PUBLIC  (remove acesso default)
--   2. GRANT EXECUTE ... TO authenticated  (preserva acesso de logados)
--   3. ALTER DEFAULT PRIVILEGES — mesma política pra funções futuras
--
-- Resultado verificado pós-aplicação: anon_executable = 0, authenticated = 135.
-- =============================================================================

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated;
