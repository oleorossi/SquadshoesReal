-- =============================================================================
-- drain de tira cede a vez ao save interativo (teto de tempo no comando do cron)
-- =============================================================================
-- Sintoma persistente (PV-00168, 18/09/2026): mesmo depois da 25600 elevar
-- `statement_timeout` do PostgREST para 90s, "Salvar Alterações" continuava
-- devolvendo "O banco estava ocupado com estoque ou compras de outro pedido".
--
-- As falhas que o dono reportou (12:48–12:54 UTC) são ANTERIORES à 25600, que só
-- entrou 13:02:37 — então não desmentem a 25600. Depois dela o timeout de 8s
-- sumiu de fato: as RPCs do PV passaram a COMPLETAR em 12–25s onde antes morriam.
-- Mas o save seguia recusado, por dois motivos independentes que sobraram.
--
-- 1) O WORKER DE TIRA SEGURA `products FOR UPDATE` POR ATÉ 54s.
--    `reconcile_strap_variant` trava as napas-base do componente
--    (`PERFORM 1 FROM products WHERE id = ANY(v_base_ids) FOR UPDATE`) e só as
--    solta no fim da transação. Medido em `cron.job_run_details` job 66, com o
--    worker já saudável: 5s, 5,8s, 6,4s, 9,3s, 11,4s, 12s, 17,7s, 23,1s por
--    passada — de minuto em minuto, ininterruptamente. E `reconcile_strap_variant`
--    isolado apareceu com `duration: 54553.759 ms` em 13:04:58.
--
--    A 25800 apostou que ~12s seria "atravessável" pelo save porque a 25600 deu
--    `lock_timeout=30s` ao PostgREST. A premissa vale para 12s e QUEBRA em 54s:
--    acima de 30s o save espera a napa, estoura o lock_timeout e cai exatamente
--    no toast de banco ocupado. O orçamento de tempo da 25800 não fecha essa
--    fresta porque ele só decide se dá pra COMEÇAR outro job — o job em curso
--    roda até o fim, sem teto.
--
-- 2) O RETRY DO CLIENTE ERA CURTO DEMAIS PARA A JANELA DE CONTENÇÃO.
--    `useSaleOrders` tentava 1 vez, esperava 1500ms fixos e tentava de novo —
--    caindo dentro da MESMA passada do worker, que dura 5–23s. É o par de
--    falhas coladas visível no log (12:48:35,99 e 12:48:46,62). Corrigido no
--    lado TS, fora desta migration.
--
-- CORREÇÃO AQUI: dar teto de tempo à transação do worker, para que a espera do
-- save pela napa seja sempre menor que a tolerância dele.
--
--   teto do worker (25s)  <  lock_timeout do PostgREST (30s, mig 25600)
--
-- Com isso um save que chega no meio da passada ESPERA e passa; nunca estoura.
--
-- ⚠ O TETO TEM QUE VIR NO COMANDO DO CRON, NÃO EM `SET` NA FUNÇÃO.
--    `statement_timeout` é armado no início do statement de fora; mudar o GUC
--    depois (por `set_config` no corpo — foi o que a 25500 tentou — ou por
--    cláusula `SET` na assinatura) NÃO reagenda o alarme. Medido agora, direto:
--
--      função com `SET statement_timeout TO '2s'` + `pg_sleep(6)`
--        -> "slept 6s without being cut"      (proconfig NÃO limita)
--      `SET statement_timeout='2s'; SELECT <mesma função sem proconfig>;`
--        -> 57014 canceling statement due to statement timeout   (limita)
--
--    Por isso o `SET` vai como statement próprio antes do `SELECT` na string do
--    job. Não mova para a assinatura da função "por organização": vira no-op
--    silencioso e o teto desaparece sem quebrar teste nenhum.
--
-- `lock_timeout=2s` no worker é o outro lado da prioridade: trabalho de fundo
-- desiste rápido e tenta no tick seguinte, em vez de entrar na fila atrás de um
-- save e ainda por cima segurar as napas enquanto espera. Interativo ganha,
-- fundo cede. (`lock_timeout` é avaliado a cada espera de lock, então aqui
-- proconfig funcionaria — mas fica junto do outro para os dois serem lidos e
-- alterados no mesmo lugar.)
--
-- Travado por src/__tests__/strapDrainYieldsToInteractiveSave.contract.test.ts.
-- =============================================================================

-- Passada abortada por contenção deixa de ser invisível. Sem isto, um tick que
-- perde o lock volta a "succeeded / 1 row" sem processar nada — foi assim que
-- 89 jobs ficaram presos com attempts=0 por dois dias na era do 2D000.
CREATE OR REPLACE FUNCTION public.drain_strap_demand_jobs(
  p_limit integer DEFAULT 100,
  p_worker_id text DEFAULT 'pg_cron',
  p_time_budget_ms integer DEFAULT 3000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
  v_processed integer := 0;
  v_completed integer := 0;
  v_retry integer := 0;
  v_blocked integer := 0;
  v_blocked_state text;
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

    BEGIN
      v_result := public.process_next_strap_demand_job(p_worker_id);
    EXCEPTION
      -- Contenção com trabalho interativo (save de PV segurando a napa). Encerra
      -- a passada preservando os jobs já concluídos nela, em vez de deixar a
      -- exceção derrubar a transação inteira e jogar fora o tick.
      WHEN lock_not_available OR serialization_failure OR deadlock_detected THEN
        v_blocked_state := SQLSTATE;
        v_blocked := v_blocked + 1;
        EXIT;
    END;

    EXIT WHEN NOT coalesce((v_result ->> 'claimed')::boolean, true);

    v_processed := v_processed + 1;
    IF v_result ->> 'status' = 'retry' OR v_result ? 'error' THEN
      v_retry := v_retry + 1;
    ELSE
      v_completed := v_completed + 1;
    END IF;
  END LOOP;

  IF v_blocked > 0 THEN
    -- ⚠ A subtransação que rolou atrás desfez o claim do job (attempts NÃO
    -- incrementa), então a visibilidade tem que vir daqui e não da linha do job.
    RAISE WARNING 'drain_strap_demand_jobs cedeu a vez: worker=% sqlstate=% processados=%',
      p_worker_id, v_blocked_state, v_processed;
  END IF;

  RETURN jsonb_build_object(
    'worker_id', p_worker_id,
    'processed', v_processed,
    'completed', v_completed,
    'retry', v_retry,
    'blocked', v_blocked,
    'blocked_sqlstate', v_blocked_state,
    'elapsed_ms', round(extract(epoch FROM clock_timestamp() - v_started) * 1000)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.drain_strap_demand_jobs(integer, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.drain_strap_demand_jobs(integer, text, integer)
  TO service_role;

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
    -- Os dois SET são statements próprios de propósito (ver cabeçalho): é a
    -- única forma de o teto valer para o SELECT que vem depois.
    PERFORM cron.schedule(
      'artisanal-strap-demand-worker',
      '* * * * *',
      $sql$SET lock_timeout='2s'; SET statement_timeout='25s'; SELECT public.drain_strap_demand_jobs(100, 'pg_cron', 3000);$sql$
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
  v_body text;
  v_command text;
  v_authed text[];
BEGIN
  SELECT p.prokind, pg_get_functiondef(p.oid)
    INTO v_kind, v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'drain_strap_demand_jobs';

  IF v_kind IS DISTINCT FROM 'f' THEN
    RAISE EXCEPTION 'drain_strap_demand_jobs deve ser FUNCTION (prokind=%): pg_cron nao aceita COMMIT', v_kind;
  END IF;
  IF v_body ~* '(^|\s)COMMIT\s*;' THEN
    RAISE EXCEPTION 'drain_strap_demand_jobs voltou a ter COMMIT no corpo';
  END IF;
  IF v_body NOT LIKE '%lock_not_available%' THEN
    RAISE EXCEPTION 'drain_strap_demand_jobs sem handler de contencao';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT command INTO v_command
      FROM cron.job WHERE jobname = 'artisanal-strap-demand-worker';
    IF v_command IS NULL THEN
      RAISE EXCEPTION 'cron artisanal-strap-demand-worker ausente';
    END IF;
    IF v_command NOT LIKE '%statement_timeout%' THEN
      RAISE EXCEPTION 'cron do worker sem teto de statement_timeout: %', v_command;
    END IF;
    IF v_command NOT LIKE '%lock_timeout%' THEN
      RAISE EXCEPTION 'cron do worker sem lock_timeout: %', v_command;
    END IF;
    IF v_command LIKE '%CALL %' THEN
      RAISE EXCEPTION 'cron do worker voltou a usar CALL: %', v_command;
    END IF;
  END IF;

  -- O teto do worker só protege o save se for MENOR que a espera que o save
  -- tolera. Se alguém baixar o lock_timeout do PostgREST, isto acusa.
  SELECT coalesce(rolconfig, ARRAY[]::text[]) INTO v_authed
    FROM pg_roles WHERE rolname = 'authenticated';
  IF NOT ('lock_timeout=30s' = ANY (v_authed)) THEN
    RAISE EXCEPTION
      'authenticated sem lock_timeout=30s: teto de 25s do worker deixa de cobrir o save (%)',
      v_authed;
  END IF;
END;
$verify$;
