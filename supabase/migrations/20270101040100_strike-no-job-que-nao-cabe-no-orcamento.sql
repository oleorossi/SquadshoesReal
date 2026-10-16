-- =============================================================================
-- Strike no job que nao cabe no orcamento: a fila anda mesmo com job pesado
-- =============================================================================
-- ERRATA DA 040000, medida em producao no mesmo dia.
--
-- A 040000 acrescentou `query_canceled` ao EXCEPTION do drain. O efeito foi
-- MAIOR do que o previsto e mudou o sinal de falha:
--
--   * antes: o statement timeout de 25s matava a transacao inteira, a execucao
--     do cron ficava `failed` e TUDO voltava atras;
--   * depois: o drain CAPTURA o cancelamento. A subtransacao do job pesado
--     volta atras sozinha, o que outros jobs ja completaram na mesma passada
--     COMMITA, e a execucao do cron reporta `succeeded`.
--
-- Ganho real de vazao — e um buraco novo. Medido em 13/10/2026 08:48–08:52:
-- quatro execucoes seguidas de 25,0s exatos, todas `succeeded`, com ZERO jobs
-- completados e 8 presos. A cabeca era o `direct_production` do PV-00232, que
-- nao cabe em 25s. Como a subtransacao volta atras, o `attempts++` que
-- `claim_next_strap_demand_job` grava e desfeito: attempts fica em 0, o job
-- continua sendo o primeiro do `ORDER BY next_attempt_at, created_at, id` e
-- bloqueia a fila de novo — agora SEM nenhuma execucao `failed`, entao o
-- watchdog da 040000 (que conta falhas em `cron.job_run_details`) nunca arma.
--
-- A CORRECAO. O escopo EXTERNO sobrevive ao rollback da subtransacao: o que o
-- drain escreve DEPOIS de capturar a excecao commita junto com a passada. Entao
-- o drain passa a:
--   1. espiar, ANTES do laco, qual job seria reivindicado agora (mesma
--      ordenacao e mesmos filtros do claim);
--   2. se a passada terminou por cancelamento SEM completar nada
--      (`v_processed = 0`), creditar um strike nesse job: `attempts + 1`,
--      `last_error` dizendo o que houve e `next_attempt_at` empurrado;
--   3. ao atingir `max_attempts`, mandar pra `dead_letter`.
--
-- ⚠ O empurrao do `next_attempt_at` e o que destrava a fila, nao o
--    `dead_letter`: tirando o job pesado da CABECA, os outros drenam no minuto
--    seguinte. O dead_letter so encerra o caso depois de 8 tentativas.
--
-- ⚠ O strike so vale com `v_processed = 0`. Com algum job completado na
--    passada, o cancelado NAO e mais o que foi espiado no inicio — creditar
--    strike ali puniria um job inocente.
--
-- ⚠ O watchdog da 040000 FICA, como rede pra falha que escapa do EXCEPTION
--    (cancelamento fora do bloco protegido, queda de conexao): ali a execucao
--    realmente fica `failed` e e so isso que ele enxerga. Os dois mecanismos
--    cobrem sinais diferentes; remover um nao e simplificacao.
--
-- Marcador: strike_job_sem_orcamento_20270101040100
-- =============================================================================

CREATE OR REPLACE FUNCTION public.drain_strap_demand_jobs(
  p_limit integer DEFAULT 100,
  p_worker_id text DEFAULT 'pg_cron',
  p_time_budget_ms integer DEFAULT 3000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  v_falhas_seguidas integer := 0;
  v_suspeito uuid;
  -- Job que seria reivindicado agora. Espiado ANTES do laco pra que, se a
  -- passada morrer por cancelamento sem completar nada, saibamos a quem
  -- creditar o strike.
  v_cabeca uuid;
  v_cabeca_attempts integer;
  v_cabeca_max integer;
  c_strikes constant integer := 3;
BEGIN
  IF auth.role() <> 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin')
     AND NOT public.user_has_any_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF NOT pg_try_advisory_xact_lock(
    hashtextextended('strap-demand-drain:singleton', 0)
  ) THEN
    RETURN jsonb_build_object(
      'worker_id', p_worker_id, 'skipped', true, 'reason', 'drain_in_progress');
  END IF;

  -- WATCHDOG (040000): rede pra falha que escapa do EXCEPTION e deixa a
  -- execucao `failed` em cron.job_run_details.
  IF p_worker_id = 'pg_cron' THEN
    WITH recentes AS (
      SELECT d.status, d.start_time
        FROM cron.job_run_details d
        JOIN cron.job j ON j.jobid = d.jobid
       WHERE j.command ILIKE '%drain_strap_demand_jobs%'
         AND d.status IN ('succeeded', 'failed')
         AND d.start_time > now() - interval '2 hours'
       ORDER BY d.start_time DESC
       LIMIT 40
    ), marcadas AS (
      SELECT status,
             bool_or(status = 'succeeded') OVER (
               ORDER BY start_time DESC
               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
             ) AS ja_teve_sucesso
        FROM recentes
    )
    SELECT count(*) INTO v_falhas_seguidas
      FROM marcadas WHERE NOT ja_teve_sucesso;

    IF v_falhas_seguidas >= c_strikes THEN
      SELECT j.id INTO v_suspeito
        FROM public.strap_demand_jobs j
        LEFT JOIN public.sale_order_strap_demand_clocks clock
               ON j.source_type = 'sale_order'
              AND clock.sale_order_id = j.source_id
       WHERE j.status IN ('queued', 'retry')
         AND j.next_attempt_at <= now()
         AND NOT EXISTS (
           SELECT 1 FROM public.strap_demand_jobs ativo
            WHERE ativo.source_type = j.source_type
              AND ativo.source_id = j.source_id
              AND ativo.status = 'processing')
         AND (j.source_type <> 'sale_order'
              OR j.source_revision >= coalesce(clock.revision, 0))
       ORDER BY j.next_attempt_at, j.created_at, j.id
       LIMIT 1;

      IF v_suspeito IS NOT NULL THEN
        UPDATE public.strap_demand_jobs
           SET status = 'dead_letter',
               last_error = format(
                 'watchdog: %s execucoes seguidas do worker falharam sem commit; '
                 'job isolado para destravar a fila',
                 v_falhas_seguidas),
               result = jsonb_build_object(
                 'watchdog_quarantined', true,
                 'consecutive_worker_failures', v_falhas_seguidas),
               completed_at = now(),
               updated_at = now()
         WHERE id = v_suspeito
           AND status IN ('queued', 'retry');

        RETURN jsonb_build_object(
          'worker_id', p_worker_id,
          'watchdog', 'quarantined',
          'quarantined_job_id', v_suspeito,
          'consecutive_failures', v_falhas_seguidas,
          'processed', 0,
          'elapsed_ms', round(
            extract(epoch FROM clock_timestamp() - v_started) * 1000));
      END IF;
    END IF;
  END IF;

  -- Espia a cabeca da fila. Mesma ordenacao e mesmos filtros do claim.
  SELECT j.id, j.attempts, j.max_attempts
    INTO v_cabeca, v_cabeca_attempts, v_cabeca_max
    FROM public.strap_demand_jobs j
    LEFT JOIN public.sale_order_strap_demand_clocks clock
           ON j.source_type = 'sale_order'
          AND clock.sale_order_id = j.source_id
   WHERE j.status IN ('queued', 'retry')
     AND j.next_attempt_at <= now()
     AND NOT EXISTS (
       SELECT 1 FROM public.strap_demand_jobs ativo
        WHERE ativo.source_type = j.source_type
          AND ativo.source_id = j.source_id
          AND ativo.status = 'processing')
     AND (j.source_type <> 'sale_order'
          OR j.source_revision >= coalesce(clock.revision, 0))
   ORDER BY j.next_attempt_at, j.created_at, j.id
   LIMIT 1;

  LOOP
    EXIT WHEN v_processed >= greatest(1, least(coalesce(p_limit, 100), 500));
    EXIT WHEN v_processed > 0 AND clock_timestamp() - v_started >= v_budget;

    BEGIN
      v_result := public.process_next_strap_demand_job(p_worker_id);
    EXCEPTION
      WHEN lock_not_available OR serialization_failure OR deadlock_detected
        OR query_canceled THEN
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

  -- STRIKE. Escopo externo: sobrevive ao rollback da subtransacao e commita
  -- junto com a passada. So com v_processed = 0 o cancelado e, de fato, a
  -- cabeca espiada no inicio.
  IF v_blocked > 0 AND v_processed = 0 AND v_cabeca IS NOT NULL THEN
    UPDATE public.strap_demand_jobs
       SET attempts = coalesce(v_cabeca_attempts, 0) + 1,
           status = CASE
             WHEN coalesce(v_cabeca_attempts, 0) + 1 >= coalesce(v_cabeca_max, 8)
               THEN 'dead_letter' ELSE 'retry' END,
           -- O empurrao e o que destrava: tira o job pesado da CABECA e deixa
           -- os outros drenarem no minuto seguinte.
           next_attempt_at = now() + make_interval(
             mins => least(60, 5 * (coalesce(v_cabeca_attempts, 0) + 1))),
           last_error = format(
             'o trabalho deste job nao coube no orcamento do worker (sqlstate %s); '
             'tentativa %s de %s',
             coalesce(v_blocked_state, '57014'),
             coalesce(v_cabeca_attempts, 0) + 1,
             coalesce(v_cabeca_max, 8)),
           completed_at = CASE
             WHEN coalesce(v_cabeca_attempts, 0) + 1 >= coalesce(v_cabeca_max, 8)
               THEN now() ELSE completed_at END,
           updated_at = now()
     WHERE id = v_cabeca
       AND status IN ('queued', 'retry', 'processing');
  END IF;

  IF v_blocked > 0 THEN
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
    'struck_job_id', CASE WHEN v_blocked > 0 AND v_processed = 0 THEN v_cabeca END,
    'consecutive_failures_seen', v_falhas_seguidas,
    'elapsed_ms', round(extract(epoch FROM clock_timestamp() - v_started) * 1000)
  );
END;
$function$;
