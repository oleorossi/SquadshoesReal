-- =============================================================================
-- authenticator/authenticated: elevar statement_timeout / lock_timeout
-- =============================================================================
-- Sintoma (PV-00168, 18/09/2026, pós-25500): Salvar Alterações com remoção de
-- itens ainda morria em ~8s com "canceling statement due to statement timeout".
-- Edge: POST 500 rpc/execute_sale_order_command em pares (~8s de intervalo);
-- toast: "O banco estava ocupado com estoque ou compras de outro pedido".
--
-- A 25500 injetou set_config('statement_timeout','90s',true) no prólogo de
-- execute_sale_order_command. current_setting DENTRO da função passa a 90s,
-- mas o alarme do Postgres já foi armado no INÍCIO do statement com o teto
-- da sessão — e a sessão do PostgREST herda do role `authenticator`:
--   authenticator: statement_timeout=8s, lock_timeout=8s
--   authenticated: statement_timeout=8s
-- Mudar o GUC no meio do statement (set_config, SET LOCAL, ou até
-- ALTER FUNCTION … SET statement_timeout) NÃO reagenda esse alarme.
-- Prova viva (18/09): com SET statement_timeout='8s' na sessão, pg_sleep(12)
-- dentro de SECURITY DEFINER com proconfig 90s ainda cancela aos 8s; com a
-- sessão já em 90s, o mesmo sleep completa.
--
-- Correção: elevar o teto no LOGIN dos roles que o PostgREST usa. 90s /
-- 30s — mesmo orçamento que a 25500 tentou aplicar por transação. anon
-- permanece em 3s (não chama execute_sale_order_command).
--
-- Marcador: raise_authenticator_statement_timeout_20270101025600
-- =============================================================================

ALTER ROLE authenticator SET statement_timeout = '90s';
ALTER ROLE authenticator SET lock_timeout = '30s';

ALTER ROLE authenticated SET statement_timeout = '90s';
ALTER ROLE authenticated SET lock_timeout = '30s';

DO $verify$
DECLARE
  v_authn text[];
  v_authed text[];
BEGIN
  SELECT coalesce(rolconfig, ARRAY[]::text[]) INTO v_authn
    FROM pg_roles WHERE rolname = 'authenticator';
  SELECT coalesce(rolconfig, ARRAY[]::text[]) INTO v_authed
    FROM pg_roles WHERE rolname = 'authenticated';

  IF NOT ('statement_timeout=90s' = ANY (v_authn)) THEN
    RAISE EXCEPTION 'authenticator sem statement_timeout=90s: %', v_authn;
  END IF;
  IF NOT ('lock_timeout=30s' = ANY (v_authn)) THEN
    RAISE EXCEPTION 'authenticator sem lock_timeout=30s: %', v_authn;
  END IF;
  IF NOT ('statement_timeout=90s' = ANY (v_authed)) THEN
    RAISE EXCEPTION 'authenticated sem statement_timeout=90s: %', v_authed;
  END IF;
  IF NOT ('lock_timeout=30s' = ANY (v_authed)) THEN
    RAISE EXCEPTION 'authenticated sem lock_timeout=30s: %', v_authed;
  END IF;
END;
$verify$;
