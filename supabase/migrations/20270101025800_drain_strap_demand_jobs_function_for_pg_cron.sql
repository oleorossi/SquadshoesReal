-- =============================================================================
-- drain de demanda de tira: volta a ser FUNCTION porque pg_cron não deixa COMMIT
-- =============================================================================
-- ERRATA DA 25700. A 25700 atribuiu o `2D000 invalid transaction termination` do
-- worker à cláusula `SET search_path` da PROCEDURE (o Postgres proíbe controle de
-- transação em rotina com cláusula SET). A hipótese estava ERRADA — ou, no
-- mínimo, incompleta. Medido em produção depois de aplicar a 25700, com
-- `proconfig` comprovadamente NULL:
--
--   cron.job_run_details job 64
--     10:15 failed  ... line 27 at COMMIT   <- corpo da 25300
--     10:16 failed  ... line 36 at COMMIT   <- corpo da 25700, já sem SET
--     10:17 failed  ... line 36 at COMMIT
--     10:18 failed  ... line 36 at COMMIT
--
-- O mesmo `CALL public.drain_strap_demand_jobs(1, ...)` numa sessão comum
-- (top level) rodou SEM erro. Ou seja: quem recusa o COMMIT é o contexto do
-- **pg_cron**, que executa o comando do job via SPI dentro de uma transação já
-- aberta. Não existe cláusula SET a remover que conserte isso: enquanto o
-- disparo for pg_cron, controle de transação é proibido, ponto.
--
-- Portanto a 25300 nasceu inviável — trocou FUNCTION por PROCEDURE para dar
-- COMMIT entre jobs sob um agendador que nunca poderia executá-la. Consequência
-- medida: 1.440 abortos em 24h (um por minuto, ininterruptos desde 16/09), com
-- ~11s de trabalho pesado jogado fora em cada um, e 89 jobs presos em `queued`
-- com attempts=0 — o rollback desfazia até a escrita do EXCEPTION handler, então
-- backoff e dead_letter nunca entravam em jogo.
--
-- CORREÇÃO: voltar a FUNCTION (sem controle de transação) e obter a granularidade
-- que a 25300 queria pelo FIM DA TRANSAÇÃO, não por COMMIT no meio — o cron
-- comita quando a função retorna. Para não reintroduzir o lote gigante que
-- deadlockou com o faturamento do PV-00169 em 16/09 (limit=100 num único
-- transação, ~94s), o lote agora é limitado por TEMPO:
--
--   * o orçamento decide se dá pra COMEÇAR outro job, nunca interrompe o job
--     em curso — cada job continua atômico;
--   * job lento fica sozinho na transação (medido: 11,6s para 13 linhas /
--     7 variantes), que é exatamente o "um commit por job" pretendido;
--   * job barato (no-op, supersedido, cancelamento) ainda agrupa vários por
--     passada, então a vazão não cai para 1/minuto.
--
-- Com `lock_timeout=30s` nos roles do PostgREST (25600), uma transação de ~12s
-- do worker é atravessável pelo save do PV; as de ~94s não eram.
--
-- ⚠ NÃO reintroduza PROCEDURE + COMMIT aqui enquanto o disparo for pg_cron.
-- ⚠ NÃO troque o orçamento de tempo por lote grande em contagem: o que
--    deadlockou em 16/09 foi o TEMPO que a transação segurou
--    `products FOR UPDATE` + advisory lock de netting, não o número de jobs.
-- Travado por src/__tests__/drainStrapDemandCommitPerJob.contract.test.ts.
--
-- Marcador: drain_strap_demand_jobs_function_for_pg_cron_20270101025800
-- =============================================================================

DROP PROCEDURE IF EXISTS public.drain_strap_demand_jobs(integer, text);

CREATE OR REPLACE FUNCTION public.drain_strap_demand_jobs(
  p_limit integer DEFAULT 100,
  p_worker_id text DEFAULT 'pg_cron',
  p_time_budget_ms integer DEFAULT 3000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
-- FUNCTION não faz controle de transação, então a cláusula SET volta a ser
-- permitida (e desejável: SECURITY DEFINER sem search_path fixo é injetável).
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
  v_processed integer := 0;
  v_completed integer := 0;
  v_retry integer := 0;
  v_started timestamptz := clock_timestamp();
  v_budget interval := make_interval(
    secs => greatest(0, coalesce(p_time_budget_ms, 3000)) / 1000.0);
BEGIN
  IF auth.role() <> 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin')
     AND NOT public.user_has_any_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  -- Passada longa atravessa o tick seguinte. Sem esta porteira o segundo drain
  -- disputa o MESMO advisory lock de netting e as passadas empilham backends
  -- esperando em vez de drenar. `_xact_` porque a transação é a passada inteira.
  IF NOT pg_try_advisory_xact_lock(
    hashtextextended('strap-demand-drain:singleton', 0)
  ) THEN
    RETURN jsonb_build_object(
      'worker_id', p_worker_id, 'skipped', true, 'reason', 'drain_in_progress');
  END IF;

  LOOP
    EXIT WHEN v_processed >= greatest(1, least(coalesce(p_limit, 100), 500));
    -- Orçamento só barra o INÍCIO de mais um job: o primeiro sempre roda e
    -- nenhum é cortado no meio.
    EXIT WHEN v_processed > 0 AND clock_timestamp() - v_started >= v_budget;

    v_result := public.process_next_strap_demand_job(p_worker_id);
    EXIT WHEN NOT coalesce((v_result ->> 'claimed')::boolean, true);

    v_processed := v_processed + 1;
    IF v_result ->> 'status' = 'retry' OR v_result ? 'error' THEN
      v_retry := v_retry + 1;
    ELSE
      v_completed := v_completed + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'worker_id', p_worker_id,
    'processed', v_processed,
    'completed', v_completed,
    'retry', v_retry,
    'elapsed_ms', round(extract(epoch FROM clock_timestamp() - v_started) * 1000)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.drain_strap_demand_jobs(integer, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.drain_strap_demand_jobs(integer, text, integer)
  TO service_role;
-- pg_cron roda como postgres / supabase_admin — EXECUTE implícito ao owner.

DO $cron$
DECLARE
  v_job_id bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT jobid INTO v_job_id
      FROM cron.job
     WHERE jobname = 'artisanal-strap-demand-worker';
    IF v_job_id IS NOT NULL THEN
      PERFORM cron.unschedule(v_job_id);
    END IF;
    -- SELECT, não CALL: pg_cron não executa rotina com controle de transação.
    PERFORM cron.schedule(
      'artisanal-strap-demand-worker',
      '* * * * *',
      $sql$SELECT public.drain_strap_demand_jobs(100, 'pg_cron', 3000);$sql$
    );
  ELSE
    RAISE WARNING 'pg_cron ausente: configure dispatcher externo para drain_strap_demand_jobs';
  END IF;
EXCEPTION
  WHEN insufficient_privilege OR undefined_table OR undefined_function THEN
    RAISE WARNING 'Nao foi possivel reinstalar cron de tiras: %', SQLERRM;
END;
$cron$;

DO $verify$
DECLARE
  v_kind "char";
  v_config text[];
  v_command text;
BEGIN
  SELECT p.prokind, p.proconfig
    INTO v_kind, v_config
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'drain_strap_demand_jobs';

  IF v_kind IS DISTINCT FROM 'f' THEN
    RAISE EXCEPTION
      'drain_strap_demand_jobs precisa ser FUNCTION (pg_cron nao aceita COMMIT): prokind=%',
      v_kind;
  END IF;
  IF v_config IS NULL OR NOT ('search_path=public' = ANY (v_config)) THEN
    RAISE EXCEPTION 'drain_strap_demand_jobs sem search_path fixo: %', v_config;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT command INTO v_command
      FROM cron.job WHERE jobname = 'artisanal-strap-demand-worker';
    IF v_command IS NULL THEN
      RAISE EXCEPTION 'cron artisanal-strap-demand-worker ausente';
    END IF;
    -- `CALL` aqui é o bug de 16/09 voltando: aborta 2D000 a cada minuto.
    IF v_command ILIKE '%CALL %drain_strap_demand_jobs%' THEN
      RAISE EXCEPTION 'cron ainda usa CALL (aborta 2D000 no pg_cron): %', v_command;
    END IF;
    IF v_command NOT ILIKE '%SELECT public.drain_strap_demand_jobs%' THEN
      RAISE EXCEPTION 'cron nao chama o drain por SELECT: %', v_command;
    END IF;
  END IF;
END;
$verify$;
