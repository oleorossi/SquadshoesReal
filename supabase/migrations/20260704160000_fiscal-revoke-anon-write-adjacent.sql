-- =============================================================================
-- RE-AUDITORIA FISCAL: estende o REVOKE de escrita do anon às tabelas fiscais
-- adjacentes que ficaram de fora do 20260704130000 (fecha inconsistência de
-- defense-in-depth). RLS segue como 1ª defesa; anon não loga e não bypassa RLS.
-- Aplicada via Supabase MCP em 2026-06-01. Idempotente (só revoga se a tabela existir).
-- =============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cte_emissions','mdfe_emissions','invoices','invoice_items','ncm_change_log'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM anon', t);
    END IF;
  END LOOP;
END $$;
