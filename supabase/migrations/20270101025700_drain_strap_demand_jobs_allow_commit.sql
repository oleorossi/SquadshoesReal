-- =============================================================================
-- drain_strap_demand_jobs: destravar o COMMIT (era 2D000 a cada minuto)
-- =============================================================================
-- Sintoma reportado (PV-00168, 18/09/2026): "Salvar Alterações" recusado com
-- "O banco estava ocupado com estoque ou compras de outro pedido". A 25500 e a
-- 25600 subiram o teto de tempo (90s/30s no role do PostgREST) e o save CONTINUOU
-- falhando — porque o problema nunca foi só o teto: era contenção real, gerada
-- por este worker.
--
-- Medido em 18/09/2026, com a 25300 já em produção:
--   cron.job_run_details job 64 → 359 de 360 execuções `failed` em 6h
--     "ERROR: invalid transaction termination
--      CONTEXT: PL/pgSQL function drain_strap_demand_jobs(integer,text) line 27 at COMMIT"
--   postgres_logs → 1.440 erros 2D000 em 24h (um por minuto, sem interrupção)
--   strap_demand_jobs → 89 linhas `queued`, a mais velha de 16/09 09:20,
--     TODAS com attempts=0; último job `completed` em 16/09 07:30
--   duração medida de uma passada: reconcile_strap_variant = 54.553 ms
--
-- CAUSA: a 25300 trocou a FUNCTION por PROCEDURE para poder dar COMMIT entre
-- jobs, mas manteve `SET search_path TO 'public'` na assinatura. O Postgres
-- PROÍBE controle de transação em rotina que carrega cláusula SET — para
-- restaurar o GUC no fim ele precisaria de um subtransação, e é justamente isso
-- que COMMIT/ROLLBACK não podem atravessar. Então, a cada minuto:
--   1. claim_next_strap_demand_job marca `processing` e attempts+1
--   2. process_strap_demand_job roda o trabalho pesado (reconcile_strap_variant)
--   3. COMMIT estoura 2D000 → a transação INTEIRA volta atrás
--   4. o job renasce `queued` com attempts=0 e é reprocessado no minuto seguinte
-- O rollback desfaz até a escrita do EXCEPTION handler (retry/dead_letter), então
-- o backoff exponencial e o teto de max_attempts nunca entram em jogo: não existe
-- pílula envenenada que consiga parar o loop.
--
-- POR QUE ISSO DERRUBA O SAVE DO PV: reconcile_strap_variant pega
-- `pg_advisory_xact_lock('strap-base-netting:<base>')`, faz
-- `SELECT ... FROM products WHERE id = ANY(bases) FOR UPDATE` e reescreve
-- material_reservations — exatamente as linhas que o teardown do
-- execute_sale_order_command precisa para remover item de PV Aprovado. O toast
-- estava descrevendo o fato com precisão: o banco estava ocupado com estoque de
-- outro pedido, ~54s por minuto, havia dois dias.
--
-- CORREÇÃO: recriar a PROCEDURE sem cláusula SET. O corpo já qualifica tudo
-- (`auth.role()`, `public.user_has_any_role`, `public.process_next_strap_demand_job`);
-- o resto resolve em pg_catalog, que é pesquisado primeiro e não pode ser
-- sombreado. EXECUTE segue restrito a service_role.
--
-- ⚠ NÃO devolva `SET search_path` a esta procedure: o COMMIT morre de novo e o
-- worker volta ao loop silencioso. Se precisar de search_path fixo, qualifique
-- no corpo — nunca na assinatura. Travado por
-- src/__tests__/drainStrapDemandAllowCommit.contract.test.ts.
--
-- Marcador: drain_strap_demand_jobs_allow_commit_20270101025700
-- =============================================================================

CREATE OR REPLACE PROCEDURE public.drain_strap_demand_jobs(
  IN p_limit integer DEFAULT 50,
  IN p_worker_id text DEFAULT 'pg_cron'
)
LANGUAGE plpgsql
SECURITY DEFINER
-- SEM `SET search_path`: cláusula SET impede COMMIT (ver cabeçalho).
AS $$
DECLARE
  v_result jsonb;
  v_processed integer := 0;
  v_completed integer := 0;
  v_retry integer := 0;
  v_singleton_key bigint := hashtextextended('strap-demand-drain:singleton', 0);
  v_has_singleton boolean := false;
BEGIN
  IF auth.role() <> 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin')
     AND NOT public.user_has_any_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  -- Enquanto a fila estava travada acumulou backlog, e uma passada pode passar
  -- de 60s — a janela do cron. Sem esta porteira o tick seguinte abre um segundo
  -- drain que disputa o MESMO advisory lock de netting, e as passadas empilham
  -- backends esperando em vez de drenar. Lock de SESSÃO (não `_xact_`): o
  -- COMMIT do loop liberaria a versão transacional na primeira iteração.
  v_has_singleton := pg_try_advisory_lock(v_singleton_key);
  IF NOT v_has_singleton THEN
    RAISE LOG 'drain_strap_demand_jobs worker=% ignorado: outro drain em curso',
      p_worker_id;
    RETURN;
  END IF;

  LOOP
    EXIT WHEN v_processed >= greatest(1, least(coalesce(p_limit, 50), 500));
    v_result := public.process_next_strap_demand_job(p_worker_id);
    EXIT WHEN NOT coalesce((v_result ->> 'claimed')::boolean, true);

    v_processed := v_processed + 1;
    IF v_result ->> 'status' = 'retry' OR v_result ? 'error' THEN
      v_retry := v_retry + 1;
    ELSE
      v_completed := v_completed + 1;
    END IF;

    -- Libera row locks (products, demands, reservations) antes do próximo job.
    COMMIT;
  END LOOP;

  PERFORM pg_advisory_unlock(v_singleton_key);

  RAISE LOG 'drain_strap_demand_jobs worker=% processed=% completed=% retry=%',
    p_worker_id, v_processed, v_completed, v_retry;
END;
$$;

-- Determinístico: garante proconfig limpo mesmo que o CREATE OR REPLACE
-- preservasse a cláusula SET da definição anterior.
ALTER PROCEDURE public.drain_strap_demand_jobs(integer, text) RESET ALL;

REVOKE ALL ON PROCEDURE public.drain_strap_demand_jobs(integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON PROCEDURE public.drain_strap_demand_jobs(integer, text)
  TO service_role;
-- pg_cron roda como postgres / supabase_admin — EXECUTE implícito ao owner.

DO $verify$
DECLARE
  v_kind "char";
  v_config text[];
BEGIN
  SELECT p.prokind, p.proconfig
    INTO v_kind, v_config
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'drain_strap_demand_jobs';

  IF v_kind IS DISTINCT FROM 'p' THEN
    RAISE EXCEPTION 'drain_strap_demand_jobs deixou de ser PROCEDURE: prokind=%', v_kind;
  END IF;
  -- A verificação que importa: com proconfig preenchido o COMMIT do loop
  -- estoura 2D000 e o worker volta a abortar de minuto em minuto.
  IF v_config IS NOT NULL THEN
    RAISE EXCEPTION
      'drain_strap_demand_jobs ainda tem cláusula SET (%) — COMMIT vai falhar com 2D000',
      v_config;
  END IF;
END;
$verify$;
