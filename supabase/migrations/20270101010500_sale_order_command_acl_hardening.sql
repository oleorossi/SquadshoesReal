-- Cutover de ACL, diagnósticos e contrato executável do command boundary de PV.

BEGIN;

-- Os writers legados são reutilizados somente por funções SECURITY DEFINER.
-- Quando o command boundary é chamado com a chave service_role, auth.uid() é
-- nulo; sem este tratamento os guards históricos internos recusariam a chamada
-- depois de o entrypoint já tê-la autorizado. Service role já é o principal
-- privilegiado do Supabase e continua sem acesso direto aos writers abaixo.
CREATE OR REPLACE FUNCTION public.is_approved_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
           current_setting('request.jwt.claim.role', true),
           ''
         ) = 'service_role'
      OR EXISTS (
        SELECT 1
          FROM public.profiles p
         WHERE p.id = auth.uid()
           AND p.approved = true
      );
$$;

CREATE OR REPLACE FUNCTION public.user_has_any_role(roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
           current_setting('request.jwt.claim.role', true),
           ''
         ) = 'service_role'
      OR EXISTS (
        SELECT 1
          FROM public.user_roles ur
         WHERE ur.user_id = auth.uid()
           AND ur.role::text = ANY(roles)
      );
$$;

-- Defesa adicional para qualquer função owner/interna que ainda toque as
-- tabelas. O cutover abaixo revoga todo DML do browser; o trigger mantém a
-- invariante caso um SECURITY DEFINER fiscal/logístico seja ampliado no futuro.
CREATE OR REPLACE FUNCTION public.tg_enforce_sale_order_command_boundary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
     OR COALESCE(
       current_setting('app.sale_order_command_internal', true),
       ''
     ) = '1' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'comercial'])
     OR NOT public.can_execute_sale_order_command('edit') THEN
    RAISE EXCEPTION
      'Permission denied: alteração de PV exige Comercial/Gerência e can_edit em /sales'
      USING ERRCODE = '42501';
  END IF;

  IF TG_TABLE_NAME = 'sale_orders' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION
        'Transição % -> % exige execute_sale_order_command e expected_version',
        OLD.status,
        NEW.status
        USING ERRCODE = 'PZ117';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Item de PV exige create/execute_sale_order_command; DML direto foi encerrado'
    USING ERRCODE = 'PZ117';
END;
$$;

REVOKE ALL ON FUNCTION public.tg_enforce_sale_order_command_boundary()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_000_enforce_sale_order_command_status
  ON public.sale_orders;
CREATE TRIGGER trg_000_enforce_sale_order_command_status
BEFORE UPDATE OF status ON public.sale_orders
FOR EACH ROW
EXECUTE FUNCTION public.tg_enforce_sale_order_command_boundary();

DROP TRIGGER IF EXISTS trg_000_enforce_active_sale_order_item_insert_delete
  ON public.sale_order_items;
CREATE TRIGGER trg_000_enforce_active_sale_order_item_insert_delete
BEFORE INSERT OR DELETE ON public.sale_order_items
FOR EACH ROW
EXECUTE FUNCTION public.tg_enforce_sale_order_command_boundary();

DROP TRIGGER IF EXISTS trg_000_enforce_active_sale_order_item_update
  ON public.sale_order_items;
CREATE TRIGGER trg_000_enforce_active_sale_order_item_update
BEFORE UPDATE ON public.sale_order_items
FOR EACH ROW
EXECUTE FUNCTION public.tg_enforce_sale_order_command_boundary();

-- Writers históricos continuam existindo como implementação para o owner das
-- funções SECURITY DEFINER, mas deixam de ser RPCs chamáveis pelo browser.
REVOKE ALL ON FUNCTION public.create_sale_order_atomic(jsonb, jsonb, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_sale_order_with_teardown(uuid, jsonb, jsonb, uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_sale_order_with_atomic_op_cancel(uuid, jsonb, jsonb, uuid[], uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.preflight_sale_order_atomic_op_cancel(uuid, jsonb, jsonb, uuid[], uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resync_op_atomic(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.promote_sale_order_partial_internal(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.promote_sale_order_atomic_internal(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cancel_sale_order_atomic_internal(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.promote_sale_order_item(uuid, text, text, date, boolean, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.restore_order_stock_for_safe_resync(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.can_execute_sale_order_command(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.can_execute_sale_order_finance_command()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.register_order_shipment(uuid[], uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.force_sale_order_production(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.restore_sale_order(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- A sobrecarga canônica de seis argumentos deixa de ser RPC genérica. O novo
-- entrypoint deriva identidade/quantidade/cor/grade da OP bloqueada, impedindo
-- que o cliente forje qualquer um desses parâmetros.
CREATE OR REPLACE FUNCTION public.initialize_order_material_reservations(
  p_order_id uuid,
  p_force_soft boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_result jsonb;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'p_order_id é obrigatório' USING ERRCODE = '22004';
  END IF;
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND COALESCE(
       current_setting('app.production_order_command_internal', true),
       ''
     ) <> '1'
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'producao'])
       OR NOT public.can_execute_sale_order_command('edit')
     ) THEN
    RAISE EXCEPTION
      'Inicialização de materiais exige Administração/Gerência/Produção e can_edit em /sales'
      USING ERRCODE = '42501';
  END IF;

  -- Mesma trava do motor canônico, adquirida antes da row lock. A segunda
  -- aquisição dentro de hybrid_debit é reentrante nesta transação.
  PERFORM pg_advisory_xact_lock(hashtext('hybrid_debit:' || p_order_id::text));
  SELECT * INTO v_order
    FROM public.orders o
   WHERE o.id = p_order_id
     AND o.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OP % não encontrada', p_order_id;
  END IF;
  IF v_order.status IN (
    'Cancelada', 'Cancelado', 'Finalizado', 'FINALIZADO',
    'Concluído', 'Concluido', 'Concluída'
  ) THEN
    RAISE EXCEPTION 'OP % está terminal e não aceita inicialização material', p_order_id
      USING ERRCODE = 'PZ105';
  END IF;

  v_result := public.hybrid_debit_stock_for_order(
    p_reference_id => v_order.reference_id,
    p_order_quantity => v_order.quantity::numeric,
    p_color => COALESCE(v_order.color, ''),
    p_order_id => v_order.id,
    p_order_grade => NULLIF(COALESCE(v_order.grade, '{}'::jsonb), '{}'::jsonb),
    p_force_soft => COALESCE(p_force_soft, true)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', v_order.id,
    'sale_order_id', v_order.sale_order_id,
    'force_soft', COALESCE(p_force_soft, true),
    'result', COALESCE(v_result, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.initialize_order_material_reservations(uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.initialize_order_material_reservations(uuid, boolean)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.hybrid_debit_stock_for_order(uuid, numeric, text, uuid, jsonb, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hybrid_debit_stock_for_order(uuid, numeric, text, uuid, jsonb, boolean)
  TO service_role;

-- Defesa em profundidade: não pode sobrar a sobrecarga de cinco argumentos,
-- pois ela não tem o guard idempotente/serializado da função canônica.
DO $drop_unsafe_hybrid$
BEGIN
  IF to_regprocedure(
       'public.hybrid_debit_stock_for_order(uuid,numeric,text,uuid,jsonb)'
     ) IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.hybrid_debit_stock_for_order(uuid,numeric,text,uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'DROP FUNCTION public.hybrid_debit_stock_for_order(uuid,numeric,text,uuid,jsonb)';
  END IF;
END;
$drop_unsafe_hybrid$;

-- O browser perde DML direto: CAS, receipt, outbox e regras de estado passam a
-- ser invariantes do banco, não convenção do hook. SELECT permanece inalterado.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.sale_orders
  FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.sale_order_items
  FROM PUBLIC, anon, authenticated;

-- GRANTs colunares sobrevivem ao REVOKE da tabela. Um motor histórico de
-- tiras concedeu INSERT/UPDATE em quase todas as colunas de sale_order_items;
-- revogamos cada coluna explicitamente (e fazemos o mesmo no cabeçalho por
-- defesa contra grants futuros/fora da baseline).
DO $revoke_sale_order_column_writes$
DECLARE
  v_table text;
  v_columns text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['sale_orders', 'sale_order_items']
  LOOP
    SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
      INTO v_columns
      FROM pg_attribute a
     WHERE a.attrelid = format('public.%I', v_table)::regclass
       AND a.attnum > 0
       AND NOT a.attisdropped;
    IF v_columns IS NOT NULL THEN
      EXECUTE format(
        'REVOKE INSERT (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        v_columns,
        v_table
      );
      EXECUTE format(
        'REVOKE UPDATE (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        v_columns,
        v_table
      );
    END IF;
  END LOOP;
END;
$revoke_sale_order_column_writes$;

-- Superfície RPC mínima.
REVOKE ALL ON FUNCTION public.execute_sale_order_command(uuid, text, bigint, text, jsonb, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_sale_order_command(uuid, text, bigint, text, jsonb, uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_sale_order_command(jsonb, jsonb, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sale_order_command(jsonb, jsonb, text, uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.preflight_sale_order_command(uuid, text, bigint, uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preflight_sale_order_command(uuid, text, bigint, uuid, jsonb)
  TO authenticated, service_role;

-- Alias vazio existiu apenas durante o rollout das migrations; o contrato
-- final exige payload explícito (inclusive target_status em transition).
REVOKE ALL ON FUNCTION public.preflight_sale_order_command(uuid, text, bigint, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preflight_sale_order_command(uuid, text, bigint, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.create_sale_order_readiness_override(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sale_order_readiness_override(uuid, text, text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.promote_sale_order_to_production(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.promote_sale_order_to_production(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.retry_sale_order_item_promotion(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Worker transacional da outbox. Claim usa SKIP LOCKED + lease recuperável;
-- complete/fail exigem o mesmo worker_id e somente service_role pode chamar.
-- ---------------------------------------------------------------------------

ALTER TABLE public.sale_order_command_outbox
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by text,
  ADD COLUMN IF NOT EXISTS lock_token uuid;
ALTER TABLE public.sale_order_command_outbox
  DROP CONSTRAINT IF EXISTS sale_order_command_outbox_status_check;
ALTER TABLE public.sale_order_command_outbox
  ADD CONSTRAINT sale_order_command_outbox_status_check
  CHECK (status IN (
    'pending', 'processing', 'published', 'failed', 'dead_letter'
  ));
ALTER TABLE public.sale_order_command_outbox
  DROP CONSTRAINT IF EXISTS sale_order_command_outbox_lock_state_check;
ALTER TABLE public.sale_order_command_outbox
  ADD CONSTRAINT sale_order_command_outbox_lock_state_check
  CHECK (
    (status = 'processing'
     AND locked_at IS NOT NULL
     AND locked_by IS NOT NULL
     AND lock_token IS NOT NULL)
    OR
    (status <> 'processing'
     AND locked_at IS NULL
     AND locked_by IS NULL
     AND lock_token IS NULL)
  );

CREATE INDEX IF NOT EXISTS sale_order_command_outbox_claim_idx
  ON public.sale_order_command_outbox(
    status,
    available_at,
    locked_at,
    created_at
  )
  WHERE status IN ('pending', 'failed', 'processing');

CREATE OR REPLACE FUNCTION public.claim_sale_order_command_outbox(
  p_worker_id text,
  p_limit integer DEFAULT 50,
  p_lease_seconds integer DEFAULT 300
)
RETURNS TABLE(
  id uuid,
  sale_order_id uuid,
  aggregate_key text,
  event_type text,
  aggregate_version bigint,
  payload jsonb,
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
    RAISE EXCEPTION 'Outbox worker exige service_role' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_worker_id, ''))) NOT BETWEEN 1 AND 200
     OR p_limit IS NULL
     OR p_limit NOT BETWEEN 1 AND 500
     OR p_lease_seconds IS NULL
     OR p_lease_seconds NOT BETWEEN 30 AND 3600 THEN
    RAISE EXCEPTION 'Parâmetros inválidos para claim da outbox'
      USING ERRCODE = '22023';
  END IF;

  -- Um worker que caiu na décima tentativa não conseguirá chamar fail(). A
  -- próxima aquisição sela a mensagem antes de procurar candidatos, evitando
  -- reclaim infinito de leases expirados.
  UPDATE public.sale_order_command_outbox o
     SET status = 'dead_letter',
         last_error = COALESCE(
           o.last_error,
           'Lease expirou após o limite de tentativas do worker'
         ),
         locked_at = NULL,
         locked_by = NULL,
         lock_token = NULL
   WHERE o.status = 'processing'
     AND o.attempts >= 10
     AND o.locked_at < now() - make_interval(secs => p_lease_seconds);

  RETURN QUERY
  WITH candidates AS (
    SELECT o.id
      FROM public.sale_order_command_outbox o
     WHERE o.available_at <= now()
       AND (
         o.status IN ('pending', 'failed')
         OR (
           o.status = 'processing'
           AND o.locked_at < now() - make_interval(secs => p_lease_seconds)
         )
       )
       AND o.attempts < 10
     ORDER BY o.available_at, o.created_at, o.id
     FOR UPDATE SKIP LOCKED
     LIMIT p_limit
  ), claimed AS (
    UPDATE public.sale_order_command_outbox o
       SET status = 'processing',
           attempts = o.attempts + 1,
           locked_at = now(),
           locked_by = btrim(p_worker_id),
           lock_token = gen_random_uuid()
      FROM candidates c
     WHERE o.id = c.id
    RETURNING o.id, o.sale_order_id, o.aggregate_key, o.event_type,
              o.aggregate_version, o.payload, o.attempts, o.locked_at,
              o.lock_token
  )
  SELECT c.id, c.sale_order_id, c.aggregate_key, c.event_type,
         c.aggregate_version, c.payload, c.attempts, c.locked_at,
         c.lock_token
    FROM claimed c;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_sale_order_command_outbox(
  p_outbox_id uuid,
  p_worker_id text,
  p_lock_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed integer;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Outbox worker exige service_role' USING ERRCODE = '42501';
  END IF;
  UPDATE public.sale_order_command_outbox
     SET status = 'published',
         published_at = now(),
         locked_at = NULL,
         locked_by = NULL,
         lock_token = NULL,
         last_error = NULL
   WHERE id = p_outbox_id
     AND status = 'processing'
     AND locked_by = btrim(p_worker_id)
     AND lock_token = p_lock_token;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_sale_order_command_outbox(
  p_outbox_id uuid,
  p_worker_id text,
  p_lock_token uuid,
  p_error text,
  p_retry_after_seconds integer DEFAULT 60,
  p_dead_letter boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed integer;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Outbox worker exige service_role' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_error, ''))) = 0
     OR p_retry_after_seconds IS NULL
     OR p_retry_after_seconds NOT BETWEEN 0 AND 86400 THEN
    RAISE EXCEPTION 'Falha da outbox exige erro e retry válido'
      USING ERRCODE = '22023';
  END IF;
  UPDATE public.sale_order_command_outbox
     SET status = CASE
           WHEN COALESCE(p_dead_letter, false) OR attempts >= 10
             THEN 'dead_letter'
           ELSE 'failed'
         END,
         available_at = CASE
           WHEN COALESCE(p_dead_letter, false) OR attempts >= 10
             THEN available_at
           ELSE now() + make_interval(secs => p_retry_after_seconds)
         END,
         last_error = left(btrim(p_error), 4000),
         locked_at = NULL,
         locked_by = NULL,
         lock_token = NULL
   WHERE id = p_outbox_id
     AND status = 'processing'
     AND locked_by = btrim(p_worker_id)
     AND lock_token = p_lock_token;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_sale_order_command_outbox(text, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_sale_order_command_outbox(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fail_sale_order_command_outbox(uuid, text, uuid, text, integer, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_sale_order_command_outbox(text, integer, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_sale_order_command_outbox(uuid, text, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_sale_order_command_outbox(uuid, text, uuid, text, integer, boolean)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Diagnóstico normalizado para /system-diagnostics. NULL = visão global.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_sale_order_command_diagnostics(
  p_sale_order_id uuid DEFAULT NULL
)
RETURNS TABLE(
  check_name text,
  category text,
  severity text,
  item_count bigint,
  sample text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'producao'])
       OR NOT public.can_execute_sale_order_command('edit')
     ) THEN
    RAISE EXCEPTION
      'Diagnóstico de PV exige Administração/Gerência/Produção e can_edit em /sales'
      USING ERRCODE = '42501';
  END IF;
  IF p_sale_order_id IS NULL
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND NOT public.user_has_any_role(ARRAY['admin', 'gerente']) THEN
    RAISE EXCEPTION 'Visão global de diagnóstico exige Administração/Gerência'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH
  stale_receipts AS (
    SELECT r.id, r.sale_order_id, r.command_name, r.started_at
      FROM public.sale_order_command_receipts r
     WHERE r.status = 'in_progress'
       AND r.started_at < now() - interval '15 minutes'
       AND (p_sale_order_id IS NULL OR r.sale_order_id = p_sale_order_id)
  ),
  readiness_blocked AS (
    SELECT pr.sale_order_id, pr.revision_no,
           jsonb_array_length(pr.blockers) AS blocker_count
      FROM public.sale_order_material_plan_revisions pr
     WHERE pr.is_current
       AND jsonb_array_length(pr.blockers) > 0
       AND (p_sale_order_id IS NULL OR pr.sale_order_id = p_sale_order_id)
  ),
  active_plan_candidates AS (
    SELECT DISTINCT so.id AS sale_order_id,
           so.order_number,
           pr.source_hash
      FROM public.sale_orders so
      JOIN public.orders o
        ON o.sale_order_id = so.id
       AND o.deleted_at IS NULL
       AND o.status NOT IN (
         'Cancelada', 'Cancelado', 'Finalizado', 'FINALIZADO',
         'Concluído', 'Concluido', 'Concluída'
       )
      LEFT JOIN public.sale_order_material_plan_revisions pr
        ON pr.sale_order_id = so.id
       AND pr.is_current
     WHERE so.deleted_at IS NULL
       AND (p_sale_order_id IS NULL OR so.id = p_sale_order_id)
  ),
  outdated_plans AS (
    SELECT c.sale_order_id, c.order_number
      FROM active_plan_candidates c
      CROSS JOIN LATERAL (
        SELECT public.build_sale_order_material_plan(c.sale_order_id) AS plan
      ) current_plan
     WHERE c.source_hash IS DISTINCT FROM current_plan.plan ->> 'source_hash'
  ),
  debit_missing AS (
    SELECT o.sale_order_id,
           r.order_number,
           r.product_name,
           round(r.esperado - r.debitado, 4) AS missing
      FROM public.debit_consistency_report(
             CURRENT_DATE - 90,
             CURRENT_DATE,
             true
           ) r
      JOIN public.orders o ON o.order_number = r.order_number
     WHERE r.delta < 0
       AND r.esperado - r.debitado > 0.01
       AND (p_sale_order_id IS NULL OR o.sale_order_id = p_sale_order_id)
  ),
  unsafe_overloads AS (
    SELECT p.oid,
           p.oid::regprocedure::text AS signature
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'hybrid_debit_stock_for_order'
       AND p.pronargs = 5
  ),
  partial_config AS (
    SELECT c.config_key
      FROM public.sale_order_command_config c
     WHERE c.promotion_atomicity_mode = 'partial'
        OR c.partial_promotion_enabled
  ),
  outbox_attention AS (
    SELECT o.id, o.sale_order_id, o.event_type, o.status
      FROM public.sale_order_command_outbox o
     WHERE (
       o.status IN ('failed', 'dead_letter')
       OR (o.status = 'pending' AND o.created_at < now() - interval '30 minutes')
       OR (o.status = 'processing' AND o.locked_at < now() - interval '10 minutes')
     )
       AND (p_sale_order_id IS NULL OR o.sale_order_id = p_sale_order_id)
  ),
  plan_commit_failures AS (
    SELECT o.id, o.sale_order_id, o.event_type
      FROM public.sale_order_command_outbox o
     WHERE o.event_type IN (
       'sale_order.material_plan_commit_failed',
       'sale_order.material_plan_compensation_required'
     )
       AND o.status IN ('pending', 'failed', 'dead_letter')
       AND (p_sale_order_id IS NULL OR o.sale_order_id = p_sale_order_id)
  )
  SELECT 'command_receipts_in_progress_stale'::text,
         'commands'::text,
         CASE WHEN count(*) > 0 THEN 'warning' ELSE 'ok' END::text,
         count(*)::bigint,
         (array_agg(concat(command_name, ':', id::text) ORDER BY started_at))[1:5]::text
    FROM stale_receipts
  UNION ALL
  SELECT 'material_plan_readiness_blocked',
         'material_plan',
         CASE WHEN count(*) > 0 THEN 'error' ELSE 'ok' END,
         count(*)::bigint,
         (array_agg(concat(sale_order_id::text, ':', blocker_count::text)
                    ORDER BY sale_order_id))[1:5]::text
    FROM readiness_blocked
  UNION ALL
  SELECT 'active_ops_outdated_plan',
         'material_plan',
         CASE WHEN count(*) > 0 THEN 'error' ELSE 'ok' END,
         count(*)::bigint,
         (array_agg(concat(order_number, ':', sale_order_id::text)
                    ORDER BY order_number))[1:5]::text
    FROM outdated_plans
  UNION ALL
  SELECT 'debit_delta_missing',
         'stock',
         CASE WHEN count(*) > 0 THEN 'error' ELSE 'ok' END,
         count(*)::bigint,
         (array_agg(concat(order_number, ':', product_name, ':', missing::text)
                    ORDER BY order_number, product_name))[1:5]::text
    FROM debit_missing
  UNION ALL
  SELECT 'unsafe_stock_debit_overloads',
         'security',
         CASE WHEN count(*) > 0 THEN 'critical' ELSE 'ok' END,
         count(*)::bigint,
         (array_agg(signature ORDER BY signature))[1:5]::text
    FROM unsafe_overloads
  UNION ALL
  SELECT 'partial_promotion_enabled',
         'commands',
         CASE WHEN count(*) > 0 THEN 'warning' ELSE 'ok' END,
         count(*)::bigint,
         (array_agg(config_key ORDER BY config_key))[1:5]::text
    FROM partial_config
  UNION ALL
  SELECT 'sale_order_outbox_pending',
         'integration',
         CASE WHEN count(*) > 0 THEN 'warning' ELSE 'ok' END,
         count(*)::bigint,
         (array_agg(concat(event_type, ':', id::text) ORDER BY id))[1:5]::text
    FROM outbox_attention
  UNION ALL
  SELECT 'material_plan_commit_failures',
         'material_plan',
         CASE WHEN count(*) > 0 THEN 'error' ELSE 'ok' END,
         count(*)::bigint,
         (array_agg(concat(event_type, ':', id::text) ORDER BY id))[1:5]::text
    FROM plan_commit_failures;
END;
$$;

-- ---------------------------------------------------------------------------
-- Guard live read-only: introspecção de catálogo/definições, sem dado sintético.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.run_sale_order_command_contract_tests()
RETURNS TABLE(case_name text, ok boolean, message text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pendencias text;
  v_resync text;
  v_execute text;
  v_preflight text;
  v_builder text;
  v_atomic text;
  v_wrapper_two text;
  v_wrapper_one text;
  v_permission_gate text;
  v_finance_permission_gate text;
  v_standalone_permission_gate text;
  v_create text;
  v_standalone text;
  v_price_resolver text;
  v_initialize_materials text;
  v_claim_outbox text;
  v_complete_outbox text;
  v_fail_outbox text;
  v_price_fixture_exact numeric;
  v_price_fixture_floor numeric;
  v_manual_price_floor numeric;
  v_manual_price_at_floor_allowed boolean;
  v_manual_price_below_floor_blocked boolean;
  v_missing_price_base_blocked boolean;
  v_mode text;
  v_partial boolean;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin', 'gerente'])
     ) THEN
    RAISE EXCEPTION 'Somente Administração/Gerência pode executar contratos de PV'
      USING ERRCODE = '42501';
  END IF;

  v_pendencias := pg_get_functiondef(
    'public.get_sale_order_pendencias(integer)'::regprocedure
  );
  v_resync := pg_get_functiondef('public.resync_op_atomic(uuid)'::regprocedure);
  v_execute := pg_get_functiondef(
    'public.execute_sale_order_command(uuid,text,bigint,text,jsonb,uuid)'::regprocedure
  );
  v_preflight := pg_get_functiondef(
    'public.preflight_sale_order_command(uuid,text,bigint,uuid,jsonb)'::regprocedure
  );
  v_builder := pg_get_functiondef(
    'public.build_sale_order_material_plan(uuid)'::regprocedure
  );
  v_atomic := pg_get_functiondef(
    'public.promote_sale_order_atomic_internal(uuid,text)'::regprocedure
  );
  v_wrapper_two := pg_get_functiondef(
    'public.promote_sale_order_to_production(uuid,text)'::regprocedure
  );
  v_wrapper_one := pg_get_functiondef(
    'public.promote_sale_order_to_production(uuid)'::regprocedure
  );
  v_permission_gate := pg_get_functiondef(
    'public.can_execute_sale_order_command(text)'::regprocedure
  );
  v_finance_permission_gate := pg_get_functiondef(
    'public.can_execute_sale_order_finance_command()'::regprocedure
  );
  v_standalone_permission_gate := pg_get_functiondef(
    'public.can_execute_standalone_nfe_create()'::regprocedure
  );
  v_create := pg_get_functiondef(
    'public.create_sale_order_command(jsonb,jsonb,text,uuid)'::regprocedure
  );
  v_standalone := pg_get_functiondef(
    'public.create_standalone_sale_order_draft_internal(jsonb,jsonb,uuid,text)'::regprocedure
  );
  v_price_resolver := pg_get_functiondef(
    'public.resolve_sale_order_item_commercial_price(uuid,text,numeric,uuid,uuid,date)'::regprocedure
  );
  v_initialize_materials := pg_get_functiondef(
    'public.initialize_order_material_reservations(uuid,boolean)'::regprocedure
  );
  v_claim_outbox := pg_get_functiondef(
    'public.claim_sale_order_command_outbox(text,integer,integer)'::regprocedure
  );
  v_complete_outbox := pg_get_functiondef(
    'public.complete_sale_order_command_outbox(uuid,text,uuid)'::regprocedure
  );
  v_fail_outbox := pg_get_functiondef(
    'public.fail_sale_order_command_outbox(uuid,text,uuid,text,integer,boolean)'::regprocedure
  );
  SELECT promotion_atomicity_mode, partial_promotion_enabled
    INTO v_mode, v_partial
    FROM public.sale_order_command_config
   WHERE config_key = 'default';

  -- Fixtures puramente relacionais do mesmo ORDER BY do resolver: cor vence
  -- default; maior faixa <= quantidade; abaixo de todas usa a menor faixa.
  WITH rules(color, min_quantity, unit_price) AS (VALUES
    ('PRETO'::text, 10::numeric, 91::numeric),
    ('PRETO'::text, 20::numeric, 85::numeric),
    (NULL::text, 0::numeric, 80::numeric)
  )
  SELECT r.unit_price INTO v_price_fixture_exact
    FROM rules r
   WHERE r.color IS NULL OR upper(r.color) = 'PRETO'
   ORDER BY
     (r.color IS NOT NULL) DESC,
     (r.min_quantity <= 15) DESC,
     CASE WHEN r.min_quantity <= 15 THEN r.min_quantity END DESC NULLS LAST,
     CASE WHEN r.min_quantity > 15 THEN r.min_quantity END ASC NULLS LAST
   LIMIT 1;

  WITH rules(min_quantity, unit_price) AS (VALUES
    (10::numeric, 91::numeric),
    (20::numeric, 85::numeric)
  )
  SELECT r.unit_price INTO v_price_fixture_floor
    FROM rules r
   ORDER BY
     (r.min_quantity <= 5) DESC,
     CASE WHEN r.min_quantity <= 5 THEN r.min_quantity END DESC NULLS LAST,
     CASE WHEN r.min_quantity > 5 THEN r.min_quantity END ASC NULLS LAST
   LIMIT 1;

  v_manual_price_floor := 100::numeric * (1 - 10::numeric / 100);
  v_manual_price_at_floor_allowed := 90::numeric >= v_manual_price_floor - 0.01;
  v_manual_price_below_floor_blocked := 89.98::numeric < v_manual_price_floor - 0.01;
  v_missing_price_base_blocked := 0::numeric <= 0;

  case_name := 'pendencias_delta';
  ok := position('r.delta < 0' IN v_pendencias) > 0
    AND position('r.esperado - r.debitado' IN v_pendencias) > 0
    AND position('r.delta > 0' IN v_pendencias) = 0;
  message := CASE WHEN ok
    THEN 'falta usa delta<0 e esperado-debitado'
    ELSE 'get_sale_order_pendencias regrediu o sinal do delta' END;
  RETURN NEXT;

  case_name := 'resync_safe_overload';
  ok := to_regprocedure(
      'public.hybrid_debit_stock_for_order(uuid,numeric,text,uuid,jsonb)'
    ) IS NULL
    AND position('restore_order_stock_for_safe_resync' IN v_resync) > 0
    AND position('p_force_soft => true' IN v_resync) > 0
    AND position('debit_packaging_for_order' IN v_resync) > 0
    AND position('p_force_soft => false' IN v_resync) > 0
    AND NOT has_function_privilege(
      'authenticated',
      'public.resync_op_atomic(uuid)',
      'EXECUTE'
    );
  message := CASE WHEN ok
    THEN 'resync restaura antes, usa soft/soft + embalagem hard e não é RPC direta'
    ELSE 'resync/overload/grants não atendem ao contrato seguro' END;
  RETURN NEXT;

  case_name := 'grants_hardened';
  ok := has_function_privilege(
      'authenticated',
      'public.execute_sale_order_command(uuid,text,bigint,text,jsonb,uuid)',
      'EXECUTE'
    )
    AND has_function_privilege(
      'authenticated',
      'public.create_sale_order_command(jsonb,jsonb,text,uuid)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon',
      'public.execute_sale_order_command(uuid,text,bigint,text,jsonb,uuid)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated',
      'public.create_sale_order_atomic(jsonb,jsonb,uuid)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated',
      'public.update_sale_order_with_teardown(uuid,jsonb,jsonb,uuid[])',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated',
      'public.promote_sale_order_partial_internal(uuid,text)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated',
      'public.hybrid_debit_stock_for_order(uuid,numeric,text,uuid,jsonb,boolean)',
      'EXECUTE'
    )
    AND (
      -- No ponto desta migration o orquestrador autenticado ainda chama o
      -- inicializador. A 115 fecha a fronteira e o torna owner-only; o contrato
      -- precisa continuar executável no estado final da cadeia.
      has_function_privilege(
        'authenticated',
        'public.initialize_order_material_reservations(uuid,boolean)',
        'EXECUTE'
      )
      OR (
        to_regprocedure(
          'public.run_command_boundary_compatibility_contract_tests()'
        ) IS NOT NULL
        AND NOT has_function_privilege(
          'authenticated',
          'public.initialize_order_material_reservations(uuid,boolean)',
          'EXECUTE'
        )
        AND NOT has_function_privilege(
          'service_role',
          'public.initialize_order_material_reservations(uuid,boolean)',
          'EXECUTE'
        )
      )
    )
    AND NOT has_function_privilege(
      'authenticated',
      'public.promote_sale_order_to_production(uuid,text)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated',
      'public.promote_sale_order_to_production(uuid)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated',
      'public.retry_sale_order_item_promotion(uuid)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated',
      'public.register_order_shipment(uuid[],uuid,text)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated',
      'public.force_sale_order_production(uuid)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated',
      'public.restore_sale_order(uuid)',
      'EXECUTE'
    )
    AND NOT has_table_privilege(
      'authenticated', 'public.sale_orders', 'INSERT,UPDATE,DELETE'
    )
    AND NOT has_table_privilege(
      'authenticated', 'public.sale_order_items', 'INSERT,UPDATE,DELETE'
    )
    AND NOT EXISTS (
      SELECT 1
        FROM (VALUES ('authenticated'::text), ('anon'::text)) principal(role_name)
        CROSS JOIN (VALUES
          ('public.sale_orders'::regclass),
          ('public.sale_order_items'::regclass)
        ) target(relid)
        JOIN pg_attribute a
          ON a.attrelid = target.relid
         AND a.attnum > 0
         AND NOT a.attisdropped
       WHERE has_column_privilege(
               principal.role_name,
               target.relid,
               a.attname,
               'INSERT'
             )
          OR has_column_privilege(
               principal.role_name,
               target.relid,
               a.attname,
               'UPDATE'
             )
    )
    AND NOT has_function_privilege(
      'authenticated',
      'public.claim_sale_order_command_outbox(text,integer,integer)',
      'EXECUTE'
    );
  message := CASE WHEN ok
    THEN 'somente commands e RPC estreita de materiais estão expostos'
    ELSE 'writer interno ou command possui ACL incompatível' END;
  RETURN NEXT;

  case_name := 'promotion_single_engine';
  ok := v_mode = 'all_or_nothing'
    AND NOT v_partial
    AND position('execute_sale_order_command' IN v_wrapper_two) > 0
    AND position('execute_sale_order_command' IN v_wrapper_one) > 0
    AND position('Corte Fibra' IN v_atomic) > 0
    AND position('Corte Cabedal' IN v_atomic) = 0
    AND position('grade = public.scale_grade_to_total' IN v_atomic) = 0
    AND position('v_item.fichas' IN v_atomic) > 0;
  message := CASE WHEN ok
    THEN 'wrappers convergem no motor atômico, rota e grade canônicas'
    ELSE 'há drift de motor, configuração, rota default ou grade' END;
  RETURN NEXT;

  case_name := 'readiness_gate';
  ok := position('client_inactive' IN v_preflight) > 0
    AND position('commercial_orders_blocked' IN v_preflight) > 0
    AND position('active_nfe_blocks_cancel' IN v_preflight) > 0
    AND position('resolve_sale_order_item_commercial_price' IN v_preflight) > 0
    AND position('sale_order_total_mismatch' IN v_preflight) > 0
    AND position('stale_order_version' IN v_preflight) > 0
    AND position('status_ficha IS DISTINCT FROM ''publicada''' IN v_builder) > 0
    AND position('p_expected_order_version IS NULL' IN v_execute) > 0;
  message := CASE WHEN ok
    THEN 'readiness cobre versão, cliente, política, NF-e e ficha publicada'
    ELSE 'readiness server-side está incompleto' END;
  RETURN NEXT;

  case_name := 'command_receipts';
  ok := to_regclass('public.sale_order_command_receipts') IS NOT NULL
    AND to_regclass('public.sale_order_command_outbox') IS NOT NULL
    AND to_regclass('public.sale_order_material_plan_revisions') IS NOT NULL
    AND position('status = ''failed''' IN v_execute) > 0
    AND position('sale_order.command_failed' IN v_execute) > 0
    AND position('idempotent_replay' IN v_execute) > 0;
  message := CASE WHEN ok
    THEN 'receipt, revisão e outbox cobrem sucesso/falha/replay'
    ELSE 'fundação de receipt/outbox/idempotência está incompleta' END;
  RETURN NEXT;

  case_name := 'command_coverage';
  ok := position('''transition''' IN v_execute) > 0
    AND position('''billing''' IN v_execute) > 0
    AND position('''factoring''' IN v_execute) > 0
    AND to_regprocedure(
      'public.create_sale_order_command(jsonb,jsonb,text,uuid)'
    ) IS NOT NULL
    AND position('update_sale_order_with_atomic_op_cancel' IN v_execute) > 0
    AND position('cancel_sale_order_atomic_internal' IN v_execute) > 0
    AND position('sale_order.transitioned' IN v_execute) > 0
    AND position('sale_order.billing_updated' IN v_execute) > 0
    AND position('sale_order.factoring_updated' IN v_execute) > 0
    AND position('target_status' IN v_preflight) > 0;
  message := CASE WHEN ok
    THEN 'create/update/confirm/promote/resync/cancel/transition/billing/factoring cobertos'
    ELSE 'command boundary não cobre todas as ações do RFC' END;
  RETURN NEXT;

  case_name := 'granular_permissions';
  ok := position('up.can_view' IN v_permission_gate) > 0
    AND position('up.can_create' IN v_permission_gate) > 0
    AND position('up.can_edit' IN v_permission_gate) > 0
    AND position('up.module = ''/sales''' IN v_permission_gate) > 0
    AND position('up.module = ''vendas''' IN v_permission_gate) > 0
    AND position('can_execute_sale_order_command(''create'')' IN v_create) > 0
    AND position('can_execute_standalone_nfe_create' IN v_create) > 0
    AND position('up.can_create' IN v_standalone_permission_gate) > 0
    AND position('''nfe''' IN v_standalone_permission_gate) > 0
    AND position('''/nfe''' IN v_standalone_permission_gate) > 0
    AND position('can_execute_sale_order_command(''edit'')' IN v_execute) > 0
    AND position('can_execute_sale_order_command(''edit'')' IN v_preflight) > 0
    AND position('up.can_edit' IN v_finance_permission_gate) > 0
    AND position('''/financeiro''' IN v_finance_permission_gate) > 0
    AND position('can_execute_sale_order_finance_command' IN v_execute) > 0;
  message := CASE WHEN ok
    THEN 'allow-list granular exige can_create/can_edit de /sales; RBAC fica como fallback'
    ELSE 'command boundary não espelha as permissões granulares de /sales' END;
  RETURN NEXT;

  case_name := 'commercial_price_parity';
  ok := position('get_effective_price' IN v_price_resolver) = 0
    AND position('price_lists' IN v_price_resolver) > 0
    AND position('valid_from' IN v_price_resolver) > 0
    AND position('valid_to' IN v_price_resolver) > 0
    AND position('table_color' IN v_price_resolver) > 0
    AND position('min_quantity' IN v_price_resolver) > 0
    AND position('unit_price_override' IN v_price_resolver) > 0
    AND position('sale_price' IN v_price_resolver) > 0
    AND position('cost_price' IN v_price_resolver) = 0
    AND position('item_price_below_floor' IN v_preflight) > 0
    AND position('item_manual_price' IN v_preflight) > 0
    AND position('v_commercial.discount_pct' IN v_preflight) > 0
    AND v_price_fixture_exact = 91
    AND v_price_fixture_floor = 91
    AND v_manual_price_floor = 90
    AND v_manual_price_at_floor_allowed
    AND v_manual_price_below_floor_blocked
    AND v_missing_price_base_blocked;
  message := CASE WHEN ok
    THEN 'preço segue cadeia canônica e manual respeita piso/teto server-side'
    ELSE 'resolver server-side divergiu da cadeia comercial canônica' END;
  RETURN NEXT;

  case_name := 'standalone_nfe_draft';
  ok := position('nfe_operator' IN v_create) > 0
    AND position('create_standalone_sale_order_draft_internal' IN v_create) > 0
    AND position('is_standalone_nfe' IN v_standalone) > 0
    AND position('product_id' IN v_standalone) > 0
    AND position('reference_id' IN v_standalone) > 0
    AND position('''Rascunho''' IN v_standalone) > 0
    AND position('fichas' IN v_standalone) > 0
    AND position('strap_payload_hash' IN v_create) > 0;
  message := CASE WHEN ok
    THEN 'NF avulsa nasce product-only em Rascunho, idempotente e sem produção'
    ELSE 'writer dedicado de NF avulsa está incompleto' END;
  RETURN NEXT;

  case_name := 'material_reservation_boundary';
  ok := position('FROM public.orders' IN v_initialize_materials) > 0
    AND position('FOR UPDATE' IN v_initialize_materials) > 0
    AND position('p_reference_id => v_order.reference_id' IN v_initialize_materials) > 0
    AND position('p_order_grade => NULLIF' IN v_initialize_materials) > 0
    AND position('hybrid_debit_stock_for_order' IN v_initialize_materials) > 0
    AND position('app.production_order_command_internal' IN v_initialize_materials) > 0;
  message := CASE WHEN ok
    THEN 'RPC estreita deriva parâmetros da OP bloqueada'
    ELSE 'inicialização material ainda aceita identidade forjada' END;
  RETURN NEXT;

  case_name := 'outbox_worker';
  ok := position('FOR UPDATE SKIP LOCKED' IN v_claim_outbox) > 0
    AND position('status = ''processing''' IN v_claim_outbox) > 0
    AND position('attempts < 10' IN v_claim_outbox) > 0
    AND position('status = ''dead_letter''' IN v_claim_outbox) > 0
    AND position('lock_token = gen_random_uuid()' IN v_claim_outbox) > 0
    AND position('locked_by = btrim(p_worker_id)' IN v_complete_outbox) > 0
    AND position('lock_token = p_lock_token' IN v_complete_outbox) > 0
    AND position('lock_token = p_lock_token' IN v_fail_outbox) > 0
    AND position('''dead_letter''' IN v_fail_outbox) > 0
    AND position('request.jwt.claim.role' IN v_claim_outbox) > 0;
  message := CASE WHEN ok
    THEN 'outbox possui claim leaseado, ack e retry/dead-letter service-role'
    ELSE 'outbox não possui worker transacional completo' END;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.get_sale_order_command_diagnostics(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sale_order_command_diagnostics(uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.run_sale_order_command_contract_tests()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_sale_order_command_contract_tests()
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_sale_order_command_diagnostics(uuid) IS
  'CheckRow normalizado (check_name/category/severity/item_count/sample). NULL produz visão global; UUID restringe ao PV.';
COMMENT ON FUNCTION public.run_sale_order_command_contract_tests() IS
  'Guard live read-only do command boundary, delta, resync, ACL, promoção, readiness e receipts.';

COMMIT;

NOTIFY pgrst, 'reload schema';
