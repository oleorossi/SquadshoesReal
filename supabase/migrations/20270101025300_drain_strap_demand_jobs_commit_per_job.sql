-- Anti-deadlock: drain de tiras não pode segurar locks de dezenas de jobs
-- numa única transação. Em 16/09/2026 o cron job 15
-- (drain_strap_demand_jobs(100)) rodou ~94s e deadlockou com a transição
-- Em Produção → Faturado do PV-00169 (finalize_orders_on_sale_order_billed →
-- convert_reservation_to_out vs reconcile_strap_variant nos mesmos products).
--
-- PROCEDURE + COMMIT por job libera ShareLock entre iterações. Função PL/pgSQL
-- não permite COMMIT no meio do loop.

DROP FUNCTION IF EXISTS public.drain_strap_demand_jobs(integer, text);

CREATE OR REPLACE PROCEDURE public.drain_strap_demand_jobs(
  IN p_limit integer DEFAULT 50,
  IN p_worker_id text DEFAULT 'pg_cron'
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
  v_processed integer := 0;
  v_completed integer := 0;
  v_retry integer := 0;
BEGIN
  IF auth.role() <> 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin')
     AND NOT public.user_has_any_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Permission denied';
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

  RAISE LOG 'drain_strap_demand_jobs worker=% processed=% completed=% retry=%',
    p_worker_id, v_processed, v_completed, v_retry;
END;
$$;

REVOKE ALL ON PROCEDURE public.drain_strap_demand_jobs(integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON PROCEDURE public.drain_strap_demand_jobs(integer, text)
  TO service_role;
-- pg_cron roda como postgres / supabase_admin — EXECUTE implícito ao owner.

DO $$
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
    PERFORM cron.schedule(
      'artisanal-strap-demand-worker',
      '* * * * *',
      $cron$CALL public.drain_strap_demand_jobs(100, 'pg_cron');$cron$
    );
  ELSE
    RAISE WARNING 'pg_cron ausente: configure dispatcher externo para CALL drain_strap_demand_jobs';
  END IF;
EXCEPTION
  WHEN insufficient_privilege OR undefined_table OR undefined_function THEN
    RAISE WARNING 'Nao foi possivel reinstalar cron de tiras: %', SQLERRM;
END;
$$;
