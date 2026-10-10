-- Fila de materialização de status pesado do PV (confirm/promote/cancel/Aprovado→Rascunho).
-- Clique só enfileira (<1s); worker Edge materializa OP/estoque e só então o status muda.
-- command_phase fica em paralelo a sale_orders.status (Q10 do grill).

-- ---------------------------------------------------------------------------
-- 1. Fase de comando no PV
-- ---------------------------------------------------------------------------

ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS command_phase text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS command_target_status text,
  ADD COLUMN IF NOT EXISTS command_error text,
  ADD COLUMN IF NOT EXISTS command_job_id uuid,
  ADD COLUMN IF NOT EXISTS command_started_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'sale_orders_command_phase_check'
       AND conrelid = 'public.sale_orders'::regclass
  ) THEN
    ALTER TABLE public.sale_orders
      ADD CONSTRAINT sale_orders_command_phase_check
      CHECK (command_phase IN ('idle', 'processing', 'failed'));
  END IF;
END;
$$;

COMMENT ON COLUMN public.sale_orders.command_phase IS
  'idle|processing|failed — meio-tempo de materialização async; status só muda no sucesso.';
COMMENT ON COLUMN public.sale_orders.command_target_status IS
  'Status alvo do job de materialização em voo ou falho.';

CREATE INDEX IF NOT EXISTS sale_orders_command_phase_idx
  ON public.sale_orders (command_phase)
  WHERE command_phase <> 'idle';

-- ---------------------------------------------------------------------------
-- 2. Fila dedicada (separada da outbox financeira/OC)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.sale_order_materialization_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_order_id uuid NOT NULL REFERENCES public.sale_orders(id) ON DELETE CASCADE,
  command_name text NOT NULL
    CHECK (command_name IN ('confirm', 'promote', 'cancel', 'transition')),
  target_status text NOT NULL,
  expected_order_version bigint NOT NULL CHECK (expected_order_version >= 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  override_id uuid,
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) > 0),
  requested_by uuid,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'discarded', 'dead_letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 4 CHECK (max_attempts BETWEEN 1 AND 20),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  lock_token uuid,
  last_error text,
  receipt_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (sale_order_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS sale_order_materialization_jobs_claim_idx
  ON public.sale_order_materialization_jobs (available_at, created_at, id)
  WHERE status IN ('pending', 'failed', 'processing');

CREATE INDEX IF NOT EXISTS sale_order_materialization_jobs_order_idx
  ON public.sale_order_materialization_jobs (sale_order_id, created_at DESC);

ALTER TABLE public.sale_order_materialization_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sale_order_materialization_jobs
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.sale_order_materialization_jobs TO service_role;

ALTER TABLE public.sale_orders
  DROP CONSTRAINT IF EXISTS sale_orders_command_job_id_fkey;
ALTER TABLE public.sale_orders
  ADD CONSTRAINT sale_orders_command_job_id_fkey
  FOREIGN KEY (command_job_id)
  REFERENCES public.sale_order_materialization_jobs(id)
  ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 3. Wake do worker (pg_net) — não espera o tick do cron
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trigger_sale_order_materialization_worker()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
AS $$
DECLARE
  v_secret text;
  v_request_id bigint;
  v_project_url text;
BEGIN
  SELECT max(decrypted_secret) FILTER (WHERE name = 'nfe_sync_cron_secret'),
         max(decrypted_secret) FILTER (WHERE name = 'project_url')
    INTO v_secret, v_project_url
    FROM vault.decrypted_secrets
   WHERE name IN ('nfe_sync_cron_secret', 'project_url');
  IF v_secret IS NULL OR v_project_url IS NULL THEN
    RETURN NULL;
  END IF;
  v_project_url := regexp_replace(btrim(v_project_url), '/+$', '');
  IF v_project_url !~ '^https://[a-z0-9-]+[.]supabase[.]co$' THEN
    RETURN NULL;
  END IF;
  SELECT net.http_post(
    url := v_project_url || '/functions/v1/process-sale-order-materialization',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', v_secret
    ),
    body := '{"limit":1}'::jsonb,
    timeout_milliseconds := 120000
  ) INTO v_request_id;
  RETURN v_request_id;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trigger_sale_order_materialization_worker: %', SQLERRM;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_sale_order_materialization_worker()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trigger_sale_order_materialization_worker()
  TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Enqueue / retry / discard (authenticated)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enqueue_sale_order_materialization(
  p_sale_order_id uuid,
  p_command text,
  p_target_status text,
  p_expected_order_version bigint,
  p_idempotency_key text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_override_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_so public.sale_orders%ROWTYPE;
  v_command text := lower(btrim(COALESCE(p_command, '')));
  v_target text := btrim(COALESCE(p_target_status, ''));
  v_job public.sale_order_materialization_jobs%ROWTYPE;
  v_wake bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não autorizado' USING ERRCODE = '42501';
  END IF;
  IF v_command NOT IN ('confirm', 'promote', 'cancel', 'transition') THEN
    RAISE EXCEPTION 'Comando de materialização inválido: %', v_command
      USING ERRCODE = '22023';
  END IF;
  IF length(v_target) = 0 THEN
    RAISE EXCEPTION 'target_status obrigatório' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(COALESCE(p_idempotency_key, ''))) < 8 THEN
    RAISE EXCEPTION 'idempotency_key inválida' USING ERRCODE = '22023';
  END IF;
  IF p_expected_order_version IS NULL OR p_expected_order_version < 0 THEN
    RAISE EXCEPTION 'expected_order_version inválida' USING ERRCODE = '22023';
  END IF;

  -- Só a transição compensatória Aprovado→Rascunho usa transition na fila.
  IF v_command = 'transition' AND v_target IS DISTINCT FROM 'Rascunho' THEN
    RAISE EXCEPTION 'transition na fila só cobre Aprovado→Rascunho'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_so
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id
     AND so.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV % não encontrado', p_sale_order_id;
  END IF;

  IF v_so.status = v_target AND COALESCE(v_so.command_phase, 'idle') = 'idle' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_current', true,
      'sale_order_id', p_sale_order_id,
      'status', v_so.status,
      'command_phase', 'idle'
    );
  END IF;

  IF COALESCE(v_so.command_phase, 'idle') = 'processing' THEN
    IF v_so.command_target_status IS NOT DISTINCT FROM v_target
       AND v_so.command_job_id IS NOT NULL THEN
      SELECT * INTO v_job
        FROM public.sale_order_materialization_jobs j
       WHERE j.id = v_so.command_job_id;
      RETURN jsonb_build_object(
        'ok', true,
        'enqueued', true,
        'replayed', true,
        'sale_order_id', p_sale_order_id,
        'job_id', v_so.command_job_id,
        'command_phase', 'processing',
        'command_target_status', v_target,
        'status', v_so.status
      );
    END IF;
    RAISE EXCEPTION 'PV % já tem materialização em andamento (→ %)',
      COALESCE(v_so.order_number, p_sale_order_id::text),
      COALESCE(v_so.command_target_status, '?')
      USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(v_so.order_version, 0) IS DISTINCT FROM p_expected_order_version THEN
    RAISE EXCEPTION 'Versão do PV desatualizada (esperada %, atual %)',
      p_expected_order_version, COALESCE(v_so.order_version, 0)
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.sale_order_materialization_jobs (
    sale_order_id,
    command_name,
    target_status,
    expected_order_version,
    payload,
    override_id,
    idempotency_key,
    requested_by,
    status
  ) VALUES (
    p_sale_order_id,
    v_command,
    v_target,
    p_expected_order_version,
    COALESCE(p_payload, '{}'::jsonb),
    p_override_id,
    btrim(p_idempotency_key),
    auth.uid(),
    'pending'
  )
  ON CONFLICT (sale_order_id, idempotency_key) DO UPDATE
    SET updated_at = now()
  RETURNING * INTO v_job;

  UPDATE public.sale_orders
     SET command_phase = 'processing',
         command_target_status = v_target,
         command_error = NULL,
         command_job_id = v_job.id,
         command_started_at = now(),
         updated_at = now()
   WHERE id = p_sale_order_id;

  BEGIN
    v_wake := public.trigger_sale_order_materialization_worker();
  EXCEPTION WHEN OTHERS THEN
    v_wake := NULL;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'enqueued', true,
    'sale_order_id', p_sale_order_id,
    'job_id', v_job.id,
    'command_phase', 'processing',
    'command_target_status', v_target,
    'status', v_so.status,
    'wake_request_id', v_wake
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_sale_order_materialization(
  p_sale_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_so public.sale_orders%ROWTYPE;
  v_job public.sale_order_materialization_jobs%ROWTYPE;
  v_new_key text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não autorizado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_so
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id
     AND so.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV % não encontrado', p_sale_order_id;
  END IF;
  IF COALESCE(v_so.command_phase, 'idle') IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'Só é possível retentar PV em command_phase=failed'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_so.command_job_id IS NULL THEN
    RAISE EXCEPTION 'PV sem job de materialização para retentar'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_job
    FROM public.sale_order_materialization_jobs j
   WHERE j.id = v_so.command_job_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job de materialização não encontrado';
  END IF;

  v_new_key := v_job.idempotency_key || ':retry:' || gen_random_uuid()::text;

  RETURN public.enqueue_sale_order_materialization(
    p_sale_order_id,
    v_job.command_name,
    v_job.target_status,
    COALESCE(v_so.order_version, 0),
    v_new_key,
    COALESCE(v_job.payload, '{}'::jsonb),
    v_job.override_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.discard_sale_order_materialization(
  p_sale_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_so public.sale_orders%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não autorizado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_so
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id
     AND so.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV % não encontrado', p_sale_order_id;
  END IF;
  IF COALESCE(v_so.command_phase, 'idle') IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'Só é possível descartar PV em command_phase=failed'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_so.command_job_id IS NOT NULL THEN
    UPDATE public.sale_order_materialization_jobs
       SET status = 'discarded',
           completed_at = now(),
           updated_at = now(),
           locked_at = NULL,
           locked_by = NULL,
           lock_token = NULL
     WHERE id = v_so.command_job_id
       AND status IN ('failed', 'pending', 'dead_letter');
  END IF;

  UPDATE public.sale_orders
     SET command_phase = 'idle',
         command_target_status = NULL,
         command_error = NULL,
         command_job_id = NULL,
         command_started_at = NULL,
         updated_at = now()
   WHERE id = p_sale_order_id;

  RETURN jsonb_build_object(
    'ok', true,
    'discarded', true,
    'sale_order_id', p_sale_order_id,
    'status', v_so.status,
    'command_phase', 'idle'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_sale_order_materialization(uuid, text, text, bigint, text, jsonb, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_sale_order_materialization(uuid, text, text, bigint, text, jsonb, uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.retry_sale_order_materialization(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_sale_order_materialization(uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.discard_sale_order_materialization(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.discard_sale_order_materialization(uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Claim / complete / fail (service_role — Edge worker)
-- ---------------------------------------------------------------------------

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
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
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
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
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
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
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

-- ---------------------------------------------------------------------------
-- 6. Cron de segurança (a cada minuto) + wake no enqueue
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')
     AND EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'nfe_sync_cron_secret')
     AND EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'project_url') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sale-order-materialization') THEN
      PERFORM cron.unschedule('sale-order-materialization');
    END IF;
    PERFORM cron.schedule(
      'sale-order-materialization',
      '* * * * *',
      $cron$SELECT public.trigger_sale_order_materialization_worker();$cron$
    );
  ELSE
    RAISE WARNING 'pg_cron/pg_net/vault ausentes: materialization worker sem cron; enqueue ainda tenta wake via pg_net.';
  END IF;
END;
$$;
