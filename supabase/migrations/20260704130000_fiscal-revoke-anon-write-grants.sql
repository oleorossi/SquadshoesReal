-- =============================================================================
-- AUDITORIA FISCAL (segurança · defense-in-depth): REVOKE escrita do anon
-- =============================================================================
-- O role anon tem GRANTs de escrita default do Supabase nas tabelas fiscais.
-- Hoje o RLS bloqueia (sem policy pra anon), mas o grant é camada única-de-falha:
-- se o RLS for desabilitado numa migration futura, os dados fiscais ficam
-- expostos. anon não tem caso de uso de escrita fiscal. RLS segue como 1ª defesa.
-- Aplicada via Supabase MCP em 2026-06-01. Idempotente.
-- =============================================================================
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON
  public.nfe_emitidas, public.nfe_cce, public.nfe_devolucoes,
  public.fiscal_tax_profiles, public.sped_exports, public.fiscal_config
FROM anon;
