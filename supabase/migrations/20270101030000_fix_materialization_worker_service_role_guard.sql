-- A migration 20270101028800 criou claim/complete/fail da fila de
-- materialização com o guard legado:
--   current_setting('request.jwt.claim.role') = 'service_role'
-- As chaves modernas sb_secret_* NÃO preenchem esse GUC — só o setting
-- `role` (via SET LOCAL ROLE do PostgREST). Resultado: o Edge worker e o
-- cron falhavam 100% dos claims com 42501, e o PV ficava preso em
-- command_phase='processing' (ex.: PV-00196).
--
-- O helper canônico is_service_role_request_128() (mig 12800) aceita os
-- dois sinais. A 28800 nasceu DEPOIS do patch em massa e ficou de fora.

BEGIN;

CREATE OR REPLACE FUNCTION public.claim_sale_order_materialization_jobs(
  p_worker_id text,
  p_limit integer DEFAULT 1,
  p_lease_seconds integer DEFAULT 180
)
RETURNS TABLE (
  id uuid,
  sale_order_id uuid,
  command_name text,
  target_status text,
  expected_order_version bigint,
  payload jsonb,
  override_id uuid,
  idempotency_key text,
  attempts integer,
  locked_at timestamptz,
  lock_token uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_service_role_request_128() THEN
    RAISE EXCEPTION 'Materialization worker exige service_role' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_worker_id, ''))) NOT BETWEEN 1 AND 200
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 5
     OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 3600 THEN
    RAISE EXCEPTION 'Parâmetros inválidos para claim de materialização'
      USING ERRCODE = '22023';
  END IF;

  -- Serial global: no máximo 1 job processing por vez (anti-deadlock products).
  IF EXISTS (
    SELECT 1
      FROM public.sale_order_materialization_jobs j
     WHERE j.status = 'processing'
       AND j.locked_at >= now() - make_interval(secs => p_lease_seconds)
  ) THEN
    RETURN;
  END IF;

  -- Lease expirado com tentativas esgotadas → dead_letter + PV failed.
  UPDATE public.sale_order_materialization_jobs j
     SET status = 'dead_letter',
         last_error = COALESCE(j.last_error, 'Lease expirou após o limite de tentativas'),
         completed_at = now(),
         updated_at = now(),
         locked_at = NULL,
         locked_by = NULL,
         lock_token = NULL
   WHERE j.status = 'processing'
     AND j.attempts >= j.max_attempts
     AND j.locked_at < now() - make_interval(secs => p_lease_seconds);

  UPDATE public.sale_orders so
     SET command_phase = 'failed',
         command_error = COALESCE(so.command_error, 'Materialização esgotou tentativas'),
         updated_at = now()
    FROM public.sale_order_materialization_jobs j
   WHERE so.command_job_id = j.id
     AND j.status = 'dead_letter'
     AND so.command_phase = 'processing';

  RETURN QUERY
  WITH candidates AS (
    SELECT j.id
      FROM public.sale_order_materialization_jobs j
     WHERE j.available_at <= now()
       AND (
         j.status IN ('pending', 'failed')
         OR (
           j.status = 'processing'
           AND j.locked_at < now() - make_interval(secs => p_lease_seconds)
         )
       )
       AND j.attempts < j.max_attempts
     ORDER BY j.available_at, j.created_at, j.id
     FOR UPDATE SKIP LOCKED
     LIMIT p_limit
  ), claimed AS (
    UPDATE public.sale_order_materialization_jobs j
       SET status = 'processing',
           attempts = j.attempts + 1,
           locked_at = now(),
           locked_by = btrim(p_worker_id),
           lock_token = gen_random_uuid(),
           updated_at = now()
      FROM candidates c
     WHERE j.id = c.id
    RETURNING j.id, j.sale_order_id, j.command_name, j.target_status,
              j.expected_order_version, j.payload, j.override_id,
              j.idempotency_key, j.attempts, j.locked_at, j.lock_token
  )
  SELECT c.id, c.sale_order_id, c.command_name, c.target_status,
         c.expected_order_version, c.payload, c.override_id,
         c.idempotency_key, c.attempts, c.locked_at, c.lock_token
    FROM claimed c;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_sale_order_materialization_job(
  p_job_id uuid,
  p_worker_id text,
  p_lock_token uuid,
  p_receipt_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.sale_order_materialization_jobs%ROWTYPE;
  v_changed integer;
BEGIN
  IF NOT public.is_service_role_request_128() THEN
    RAISE EXCEPTION 'Materialization worker exige service_role' USING ERRCODE = '42501';
  END IF;

  UPDATE public.sale_order_materialization_jobs j
     SET status = 'succeeded',
         completed_at = now(),
         updated_at = now(),
         receipt_id = COALESCE(p_receipt_id, j.receipt_id),
         last_error = NULL,
         locked_at = NULL,
         locked_by = NULL,
         lock_token = NULL
   WHERE j.id = p_job_id
     AND j.status = 'processing'
     AND j.locked_by = btrim(p_worker_id)
     AND j.lock_token = p_lock_token
  RETURNING * INTO v_job;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  IF v_changed <> 1 THEN
    RETURN false;
  END IF;

  UPDATE public.sale_orders
     SET command_phase = 'idle',
         command_target_status = NULL,
         command_error = NULL,
         command_job_id = NULL,
         command_started_at = NULL,
         updated_at = now()
   WHERE id = v_job.sale_order_id
     AND command_job_id = v_job.id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_sale_order_materialization_job(
  p_job_id uuid,
  p_worker_id text,
  p_lock_token uuid,
  p_error text,
  p_retry_after_seconds integer DEFAULT 5,
  p_dead_letter boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.sale_order_materialization_jobs%ROWTYPE;
  v_next text;
BEGIN
  IF NOT public.is_service_role_request_128() THEN
    RAISE EXCEPTION 'Materialization worker exige service_role' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_error, ''))) = 0 THEN
    RAISE EXCEPTION 'fail exige mensagem de erro' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_job
    FROM public.sale_order_materialization_jobs j
   WHERE j.id = p_job_id
     AND j.status = 'processing'
     AND j.locked_by = btrim(p_worker_id)
     AND j.lock_token = p_lock_token
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'missing';
  END IF;

  IF COALESCE(p_dead_letter, false) OR v_job.attempts >= v_job.max_attempts THEN
    v_next := 'dead_letter';
  ELSE
    v_next := 'failed';
  END IF;

  UPDATE public.sale_order_materialization_jobs
     SET status = v_next,
         last_error = left(btrim(p_error), 4000),
         available_at = CASE
           WHEN v_next = 'failed'
             THEN now() + make_interval(secs => GREATEST(0, COALESCE(p_retry_after_seconds, 5)))
           ELSE available_at
         END,
         completed_at = CASE WHEN v_next = 'dead_letter' THEN now() ELSE NULL END,
         updated_at = now(),
         locked_at = NULL,
         locked_by = NULL,
         lock_token = NULL
   WHERE id = p_job_id;

  -- Auto-retry: PV permanece processing enquanto houver tentativas.
  -- Só marca failed na UI quando esgota (dead_letter) ou dead_letter forçado.
  IF v_next = 'dead_letter' THEN
    UPDATE public.sale_orders
       SET command_phase = 'failed',
           command_error = left(btrim(p_error), 4000),
           updated_at = now()
     WHERE id = v_job.sale_order_id
       AND command_job_id = v_job.id;
  END IF;

  RETURN v_next;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_sale_order_materialization_jobs(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sale_order_materialization_jobs(text, integer, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.complete_sale_order_materialization_job(uuid, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_sale_order_materialization_job(uuid, text, uuid, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.fail_sale_order_materialization_job(uuid, text, uuid, text, integer, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_sale_order_materialization_job(uuid, text, uuid, text, integer, boolean)
  TO service_role;

COMMIT;
