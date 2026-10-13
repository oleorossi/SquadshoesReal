-- =============================================================================
-- Watchdog da fila de tiras: job venenoso se isola em vez de travar a fila
-- =============================================================================
-- INCIDENTE 13/10/2026. O worker `artisanal-strap-demand-worker` falhou 4.311
-- vezes seguidas entre 11/10 13:47 e 13/10 08:36 com
-- `57014 canceling statement due to statement timeout`, deixando 82 jobs em
-- `queued` e 9 PVs vivos sem demanda de tira — entre eles o PV-00232, que o
-- chao de fabrica ja estava produzindo. O sintoma visivel foi outro: a Ordem
-- de Compra por Pedido saiu sem NENHUMA tira, porque o canal per_pv exclui
-- tira de proposito (`excludeStrapsFromPerPvDrafts`) e manda pro motor — que
-- estava parado.
--
-- MECANICA (medida, nao inferida):
--   1. `claim_next_strap_demand_job` grava `attempts = attempts + 1` no ato da
--      reivindicacao, ANTES do trabalho pesado.
--   2. O trabalho de um job excedeu os 25s de `statement_timeout` do comando do
--      cron. Medido ao vivo: pid 1753882 `active`, `wait_event = NULL`, 24,8s de
--      CPU real — nao estava bloqueado, estava trabalhando.
--   3. O timeout mata o statement de TOPO. A transacao inteira volta atras,
--      inclusive o `attempts++`. O job voltou a `retry` com attempts congelado
--      em 3/8: nunca chegou aos 8 do `dead_letter`, nunca sofreu backoff.
--   4. `claim_next_strap_demand_job` ordena por
--      `next_attempt_at, created_at, id`. O mesmo job era escolhido toda vez,
--      e os 81 atras dele nunca foram vistos. Cabeca de fila envenenada, sem
--      auto-cura possivel.
--
-- POR QUE NAO E "timeout por job". A correcao obvia — `SET LOCAL
-- statement_timeout` menor em volta de cada job — NAO funciona: o
-- `statement_timeout` conta a partir do inicio do statement de TOPO, e os
-- comandos internos de uma funcao plpgsql nao sao cronometrados em separado.
-- Baixar o valor no meio da passada encurtaria a passada inteira, nao o job.
-- Nao reintroduza isso achando que da granularidade por job.
--
-- A CORRECAO. A unica evidencia da falha que sobrevive ao rollback mora FORA da
-- transacao: `cron.job_run_details`, escrito pelo proprio pg_cron. Entao o
-- watchdog le de la. Quando a janela recente acumula
-- WATCHDOG_STRIKES execucoes falhas seguidas sem nenhum sucesso, a passada
-- seguinte NAO tenta trabalhar: ela isola o job que seria reivindicado agora
-- (mesma ordenacao e os mesmos filtros do claim, pra nao punir um job que o
-- claim pularia) em `dead_letter` e RETORNA na hora. Transacao curta, commit
-- garantido, quarentena gravada — e o proximo minuto ja drena a fila.
--
-- ⚠ O retorno imediato e load-bearing. Se o watchdog isolasse o job e seguisse
--    processando na mesma passada, o trabalho pesado podia estourar o timeout
--    de novo e levar a quarentena junto no rollback — exatamente o laco que
--    este arquivo existe pra quebrar.
--
-- ⚠ Custo aceito: se o worker falhar 3x por motivo alheio ao job da vez (reboot
--    do banco, manutencao), um job inocente vai pra `dead_letter`. Ele fica
--    VISIVEL no alarme de jobs mortos e volta com o `retry_strap_demand_job`
--    que ja existe. Fila morta em silencio por 2 dias e pior que um job isolado
--    com aviso na tela.
--
-- ⚠ O watchdog so vale pro disparo do pg_cron (`p_worker_id = 'pg_cron'`).
--    Chamada manual de admin nunca isola nada: ela nao tem historico de
--    execucao em `cron.job_run_details` que a descreva.
--
-- Tambem adiciona `query_canceled` a lista de SQLSTATEs que cedem a vez com
-- elegancia: cobre o caso em que um comando INTERNO e cancelado (lock_timeout
-- de 2s do comando do cron), que hoje escapava do EXCEPTION e abortava a
-- passada inteira.
--
-- Marcador: watchdog_strap_demand_queue_20270101040000
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
  -- Quantas execucoes seguidas do cron falharam sem nenhum sucesso no meio.
  v_falhas_seguidas integer := 0;
  v_suspeito uuid;
  -- 3 minutos de fila parada e o bastante pra agir e pouco pra nao reagir a
  -- um soluco unico. Nao suba sem motivo: cada strike custa um minuto de fila.
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

  -- ---------------------------------------------------------------------
  -- WATCHDOG. Le a evidencia que sobrevive ao rollback (ver cabecalho).
  -- ---------------------------------------------------------------------
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
      -- Mesma ordenacao e mesmos filtros de `claim_next_strap_demand_job`:
      -- isolar um job que o claim pularia (superseded, fonte ja em processing)
      -- puniria o inocente e deixaria o venenoso na frente.
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
                 'consecutive_worker_failures', v_falhas_seguidas,
                 'detail',
                   'O trabalho deste job nao coube no statement_timeout do cron. '
                   'O rollback desfazia o attempts++ do claim, entao backoff e '
                   'dead_letter nunca entravam em jogo e a fila inteira parava '
                   'atras dele. Reprocesse com retry_strap_demand_job depois de '
                   'entender por que ele e pesado.'),
               completed_at = now(),
               updated_at = now()
         WHERE id = v_suspeito
           AND status IN ('queued', 'retry');

        -- Retorno IMEDIATO: commit curto garante a quarentena (ver cabecalho).
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
    'consecutive_failures_seen', v_falhas_seguidas,
    'elapsed_ms', round(extract(epoch FROM clock_timestamp() - v_started) * 1000)
  );
END;
$function$;
