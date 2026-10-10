-- =============================================================================
-- authenticator: elevar statement_timeout p/ schema cache do PostgREST
-- =============================================================================
-- Incidente 28/09/2026 (~13:58–17:xx UTC): o site na Vercel servia HTML/JS,
-- mas a API REST do Supabase devolvia 503 PGRST002 em TODA query:
--   "Could not query the database for the schema cache. Retrying."
--
-- Logs do PostgREST:
--   Failed to load the schema cache using db-schemas=public,graphql_public
--   {"code":"57014","message":"canceling statement due to statement timeout"}
--
-- Causa: o schema `public` tem ~1209 funções. A introspecção do PostgREST
-- (base_types recursivo + catálogo) passou a levar >90s — o teto que a
-- migration 20270101025600 tinha colocado no role `authenticator`. Com o
-- cache fora, Storage também caía em DatabaseTimeout (HTTP 544) e crons
-- falhavam em "job startup timeout". O frontend (Vercel) estava íntegro.
--
-- Correção imediata aplicada ao vivo: ALTER ROLE authenticator SET
-- statement_timeout = '300s' + pause/restore do projeto pra limpar conexões
-- travadas. Esta migration persiste o teto de 300s.
--
-- anon permanece em 3s (não dispara schema cache). authenticated fica em
-- 90s (queries de usuário); só o role de bootstrap do PostgREST precisa
-- do orçamento maior.
--
-- Marcador: raise_authenticator_timeout_schema_cache_20270101029500
-- =============================================================================

ALTER ROLE authenticator SET statement_timeout = '300s';
ALTER ROLE authenticator SET lock_timeout = '30s';

DO $verify$
DECLARE
  v_authn text[];
BEGIN
  SELECT coalesce(rolconfig, ARRAY[]::text[]) INTO v_authn
    FROM pg_roles WHERE rolname = 'authenticator';

  IF NOT ('statement_timeout=300s' = ANY (v_authn)) THEN
    RAISE EXCEPTION 'authenticator sem statement_timeout=300s: %', v_authn;
  END IF;
  IF NOT ('lock_timeout=30s' = ANY (v_authn)) THEN
    RAISE EXCEPTION 'authenticator sem lock_timeout=30s: %', v_authn;
  END IF;
END;
$verify$;

NOTIFY pgrst, 'reload schema';
