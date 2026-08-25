-- Consumidor durável da outbox de Pedido de Venda.
--
-- Fecha a janela em que o command confirmava o commit e deixava financeiro/OC
-- apenas como best-effort no navegador. O worker Edge usa claim com
-- FOR UPDATE SKIP LOCKED, efeitos idempotentes e retry exponencial.

BEGIN;

ALTER TABLE public.sale_order_command_outbox
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by text,
  ADD COLUMN IF NOT EXISTS effect_result jsonb;

CREATE INDEX IF NOT EXISTS sale_order_command_outbox_claim_idx
  ON public.sale_order_command_outbox(status, available_at, created_at)
  WHERE status IN ('pending', 'failed');

CREATE TABLE IF NOT EXISTS public.sale_order_outbox_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ran_at timestamptz NOT NULL DEFAULT now(),
  worker_id text NOT NULL,
  claimed integer NOT NULL DEFAULT 0 CHECK (claimed >= 0),
  published integer NOT NULL DEFAULT 0 CHECK (published >= 0),
  failed integer NOT NULL DEFAULT 0 CHECK (failed >= 0),
  dead_letter integer NOT NULL DEFAULT 0 CHECK (dead_letter >= 0),
  duration_ms integer NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  error text
);

ALTER TABLE public.sale_order_outbox_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sale_order_outbox_runs
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.sale_order_outbox_runs TO service_role;

CREATE OR REPLACE FUNCTION public.claim_sale_order_outbox(
  p_worker_id text,
  p_limit integer DEFAULT 20
)
RETURNS TABLE(
  id uuid,
  sale_order_id uuid,
  event_type text,
  aggregate_key text,
  aggregate_version bigint,
  payload jsonb,
  attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'claim_sale_order_outbox exige service_role'
      USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_worker_id, ''))) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'worker_id inválido' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH eligible AS (
    SELECT o.id,
           row_number() OVER (
             PARTITION BY o.aggregate_key
             ORDER BY o.aggregate_version, o.created_at, o.id
           ) AS aggregate_position
      FROM public.sale_order_command_outbox o
     WHERE o.status IN ('pending', 'failed')
       AND o.available_at <= now()
       AND (o.locked_at IS NULL OR o.locked_at < now() - interval '5 minutes')
       -- Eventos de atenção exigem decisão humana e permanecem visíveis no
       -- diagnóstico; não podem ser publicados automaticamente.
       AND o.event_type NOT IN (
         'sale_order.material_plan_commit_failed',
         'sale_order.material_plan_compensation_required',
         'sale_order.purchase_attention_required'
       )
       -- Não ultrapassa um evento anterior do mesmo agregado que ainda está
       -- em retry ou sendo processado por outro worker.
       AND NOT EXISTS (
         SELECT 1
           FROM public.sale_order_command_outbox earlier
          WHERE earlier.aggregate_key = o.aggregate_key
            AND earlier.status IN ('pending', 'failed')
            AND earlier.event_type NOT IN (
              'sale_order.material_plan_commit_failed',
              'sale_order.material_plan_compensation_required',
              'sale_order.purchase_attention_required'
            )
            AND (earlier.aggregate_version, earlier.created_at, earlier.id)
                < (o.aggregate_version, o.created_at, o.id)
       )
  ), picked AS (
    SELECT o.id
      FROM public.sale_order_command_outbox o
      JOIN eligible e ON e.id = o.id AND e.aggregate_position = 1
     ORDER BY o.available_at, o.created_at, o.id
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
     FOR UPDATE OF o SKIP LOCKED
  ), claimed AS (
    UPDATE public.sale_order_command_outbox o
       SET locked_at = now(),
           locked_by = btrim(p_worker_id),
           attempts = o.attempts + 1,
           last_error = NULL
      FROM picked p
     WHERE o.id = p.id
    RETURNING o.id, o.sale_order_id, o.event_type, o.aggregate_key,
              o.aggregate_version, o.payload, o.attempts
  )
  SELECT c.id, c.sale_order_id, c.event_type, c.aggregate_key,
         c.aggregate_version, c.payload, c.attempts
    FROM claimed c
   ORDER BY c.aggregate_key, c.aggregate_version, c.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_sale_order_outbox(
  p_event_id uuid,
  p_worker_id text,
  p_effect_result jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'complete_sale_order_outbox exige service_role'
      USING ERRCODE = '42501';
  END IF;
  UPDATE public.sale_order_command_outbox
     SET status = 'published',
         published_at = now(),
         locked_at = NULL,
         locked_by = NULL,
         last_error = NULL,
         effect_result = COALESCE(p_effect_result, '{}'::jsonb)
   WHERE id = p_event_id
     AND locked_by = btrim(p_worker_id)
     AND status IN ('pending', 'failed');
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_sale_order_outbox(
  p_event_id uuid,
  p_worker_id text,
  p_error text,
  p_max_attempts integer DEFAULT 8
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempts integer;
  v_status text;
  v_delay_seconds integer;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'fail_sale_order_outbox exige service_role'
      USING ERRCODE = '42501';
  END IF;
  SELECT attempts INTO v_attempts
    FROM public.sale_order_command_outbox
   WHERE id = p_event_id
     AND locked_by = btrim(p_worker_id)
   FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_claimed'; END IF;

  v_status := CASE
    WHEN v_attempts >= LEAST(GREATEST(COALESCE(p_max_attempts, 8), 1), 30)
      THEN 'dead_letter'
    ELSE 'failed'
  END;
  v_delay_seconds := LEAST(3600, (15 * power(2, GREATEST(v_attempts - 1, 0)))::integer);

  UPDATE public.sale_order_command_outbox
     SET status = v_status,
         available_at = CASE WHEN v_status = 'failed'
           THEN now() + make_interval(secs => v_delay_seconds)
           ELSE available_at END,
         locked_at = NULL,
         locked_by = NULL,
         last_error = left(COALESCE(NULLIF(btrim(p_error), ''), 'erro desconhecido'), 4000)
   WHERE id = p_event_id;
  RETURN v_status;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_sale_order_outbox(text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_sale_order_outbox(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_sale_order_outbox(uuid, text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sale_order_outbox(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_sale_order_outbox(uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_sale_order_outbox(uuid, text, text, integer) TO service_role;

-- Recalcula a necessidade no motor canônico do PV e materializa OCs de falta.
-- A função é idempotente por (PV, fornecedor): upsert_open_purchase_order já
-- recusa somar duas vezes o mesmo PV, e o balde sem fornecedor usa key única.
CREATE OR REPLACE FUNCTION public.process_sale_order_purchase_shortages(
  p_sale_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_group record;
  v_item jsonb;
  v_items jsonb;
  v_po_id uuid;
  v_qty numeric;
  v_unit text;
  v_price numeric;
  v_total numeric := 0;
  v_created_or_reused integer := 0;
  v_blocked jsonb := '[]'::jsonb;
  v_idem text;
  v_new_unsupplied boolean;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'process_sale_order_purchase_shortages exige service_role'
      USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'sale-order-purchase-shortages:' || p_sale_order_id::text,
    0
  ));

  SELECT so.status INTO v_status
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id
     AND so.deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'sale_order_not_found');
  END IF;
  IF v_status NOT IN ('Aprovado', 'Em Produção') THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'status_' || v_status);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product_id', need.material_id,
           'product_name', need.product_name,
           'color', need.color,
           'shortage', need.shortage,
           'reason', CASE
             WHEN need.is_artisanal THEN 'material_artesanal'
             WHEN need.color_mismatch THEN 'cor_sem_produto_exato'
             ELSE need.conversion_warning
           END
         ) ORDER BY need.product_name, need.material_id), '[]'::jsonb)
    INTO v_blocked
    FROM public.compute_materials_per_pv(ARRAY[p_sale_order_id]) need
   WHERE COALESCE(need.shortage, 0) > 0
     AND (
       COALESCE(need.is_artisanal, false)
       OR COALESCE(need.color_mismatch, false)
       OR NULLIF(btrim(COALESCE(need.conversion_warning, '')), '') IS NOT NULL
     );

  FOR v_group IN
    SELECT need.supplier_id,
           COALESCE(NULLIF(btrim(need.supplier_name), ''), 'A definir') AS supplier_name,
           jsonb_agg(jsonb_build_object(
             'product_id', need.material_id,
             'quantity', need.shortage,
             'unit_price', COALESCE(need.last_unit_price, 0),
             'unit', COALESCE(NULLIF(need.unit, ''), p.unit, 'un'),
             'current_stock', COALESCE(need.stock_qty, 0),
             'min_stock', COALESCE(p.min_stock, 0),
             'max_stock', COALESCE(p.max_stock, 0),
             'grade', need.grade,
             'color', NULLIF(need.color, '')
           ) ORDER BY need.product_name, need.material_id) AS items
      FROM public.compute_materials_per_pv(ARRAY[p_sale_order_id]) need
      JOIN public.products p ON p.id = need.material_id AND p.active
     WHERE COALESCE(need.shortage, 0) > 0
       AND NOT COALESCE(need.is_artisanal, false)
       AND NOT COALESCE(need.color_mismatch, false)
       AND NULLIF(btrim(COALESCE(need.conversion_warning, '')), '') IS NULL
     GROUP BY need.supplier_id,
              COALESCE(NULLIF(btrim(need.supplier_name), ''), 'A definir')
     ORDER BY need.supplier_id NULLS LAST
  LOOP
    v_items := v_group.items;
    IF v_group.supplier_id IS NOT NULL THEN
      v_po_id := public.upsert_open_purchase_order(
        v_group.supplier_id,
        v_group.supplier_name,
        p_sale_order_id,
        'Falta reconciliada pela outbox do PV ' || p_sale_order_id::text,
        v_items
      );
      v_created_or_reused := v_created_or_reused + 1;
      CONTINUE;
    END IF;

    -- Sem fornecedor: preserva a intenção como draft, sem contaminar contas a
    -- pagar. Não acumula novamente no replay do mesmo PV.
    v_idem := 'auto_pv:none:' || p_sale_order_id::text;
    v_new_unsupplied := false;
    SELECT po.id INTO v_po_id
      FROM public.purchase_orders po
     WHERE po.idempotency_key = v_idem
       AND po.status NOT IN ('received', 'receiving', 'cancelled')
     LIMIT 1
     FOR UPDATE;
    IF v_po_id IS NULL THEN
      INSERT INTO public.purchase_orders(
        supplier_name, supplier_id, notes, total_value, auto_generated,
        status, source_type, source_pv_ids, linked_sale_order_ids,
        idempotency_key
      ) VALUES (
        'A definir', NULL,
        'Falta sem fornecedor — reconciliada pela outbox do PV ' || p_sale_order_id::text,
        0, true, 'draft', 'auto_pv', ARRAY[p_sale_order_id],
        ARRAY[p_sale_order_id], v_idem
      ) RETURNING id INTO v_po_id;
      v_new_unsupplied := true;
    END IF;

    IF v_new_unsupplied THEN
      v_total := 0;
      FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
      LOOP
        SELECT n.out_qty, n.out_unit, n.out_unit_price
          INTO v_qty, v_unit, v_price
          FROM public.po_normalize_line(
            (v_item ->> 'product_id')::uuid,
            COALESCE((v_item ->> 'quantity')::numeric, 0),
            v_item ->> 'unit',
            COALESCE((v_item ->> 'unit_price')::numeric, 0)
          ) n;
        INSERT INTO public.purchase_order_items(
          purchase_order_id, product_id, quantity, suggested_quantity,
          unit_price, unit, current_stock, min_stock, max_stock, grade, color
        ) VALUES (
          v_po_id, (v_item ->> 'product_id')::uuid, v_qty, v_qty,
          v_price, v_unit,
          COALESCE((v_item ->> 'current_stock')::numeric, 0),
          COALESCE((v_item ->> 'min_stock')::numeric, 0),
          COALESCE((v_item ->> 'max_stock')::numeric, 0),
          v_item -> 'grade', v_item ->> 'color'
        );
        v_total := v_total + v_qty * v_price;
      END LOOP;
      UPDATE public.purchase_orders
         SET total_value = v_total, updated_at = now()
       WHERE id = v_po_id;
    END IF;
    v_created_or_reused := v_created_or_reused + 1;
  END LOOP;

  IF jsonb_array_length(v_blocked) > 0 THEN
    INSERT INTO public.sale_order_command_outbox(
      sale_order_id, aggregate_key, event_type, aggregate_version,
      idempotency_key, payload
    )
    SELECT p_sale_order_id, p_sale_order_id::text,
           'sale_order.purchase_attention_required', so.order_version,
           'purchase-attention:v' || so.order_version::text,
           jsonb_build_object('sale_order_id', p_sale_order_id, 'blocked', v_blocked)
      FROM public.sale_orders so
     WHERE so.id = p_sale_order_id
    ON CONFLICT (event_type, aggregate_key, idempotency_key)
    DO UPDATE SET payload = EXCLUDED.payload;
  END IF;

  RETURN jsonb_build_object(
    'skipped', false,
    'purchase_orders_created_or_reused', v_created_or_reused,
    'blocked', v_blocked
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_sale_order_purchase_shortages(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_sale_order_purchase_shortages(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.record_sale_order_outbox_run(
  p_worker_id text,
  p_claimed integer,
  p_published integer,
  p_failed integer,
  p_dead_letter integer,
  p_duration_ms integer,
  p_error text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id bigint;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'record_sale_order_outbox_run exige service_role'
      USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.sale_order_outbox_runs(
    worker_id, claimed, published, failed, dead_letter, duration_ms, error
  ) VALUES (
    left(btrim(p_worker_id), 120), GREATEST(COALESCE(p_claimed, 0), 0),
    GREATEST(COALESCE(p_published, 0), 0), GREATEST(COALESCE(p_failed, 0), 0),
    GREATEST(COALESCE(p_dead_letter, 0), 0), GREATEST(COALESCE(p_duration_ms, 0), 0),
    left(NULLIF(btrim(COALESCE(p_error, '')), ''), 4000)
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_sale_order_outbox_run(
  text, integer, integer, integer, integer, integer, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_sale_order_outbox_run(
  text, integer, integer, integer, integer, integer, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.get_sale_order_outbox_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin', 'gerente']) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'pending', count(*) FILTER (WHERE o.status = 'pending'),
    'failed', count(*) FILTER (WHERE o.status = 'failed'),
    'dead_letter', count(*) FILTER (WHERE o.status = 'dead_letter'),
    'attention_required', count(*) FILTER (
      WHERE o.event_type = 'sale_order.purchase_attention_required'
        AND o.status IN ('pending', 'failed', 'dead_letter')
    ),
    'oldest_available_at', min(o.available_at) FILTER (
      WHERE o.status IN ('pending', 'failed')
    ),
    'last_run', (
      SELECT to_jsonb(r) FROM public.sale_order_outbox_runs r
       ORDER BY r.ran_at DESC LIMIT 1
    )
  ) INTO v_result
  FROM public.sale_order_command_outbox o;
  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.get_sale_order_outbox_health()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sale_order_outbox_health()
  TO authenticated;

CREATE OR REPLACE FUNCTION public.trigger_sale_order_outbox_cron()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
AS $$
DECLARE v_secret text; v_request_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
   WHERE name = 'nfe_sync_cron_secret'
   LIMIT 1;
  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'nfe_sync_cron_secret não encontrado no vault';
  END IF;
  SELECT net.http_post(
    url := 'https://ssvxfoybzmjlypnipqzn.supabase.co/functions/v1/process-sale-order-outbox',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', v_secret
    ),
    body := '{"limit":20}'::jsonb,
    timeout_milliseconds := 55000
  ) INTO v_request_id;
  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_sale_order_outbox_cron()
  FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sale-order-outbox') THEN
      PERFORM cron.unschedule('sale-order-outbox');
    END IF;
    PERFORM cron.schedule(
      'sale-order-outbox',
      '* * * * *',
      $cron$SELECT public.trigger_sale_order_outbox_cron();$cron$
    );
  ELSE
    RAISE WARNING 'pg_cron/pg_net ausente: configure dispatcher externo para process-sale-order-outbox';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.run_sale_order_outbox_contract_tests()
RETURNS TABLE(case_name text, ok boolean, message text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'outbox_worker_functions',
         to_regprocedure('public.claim_sale_order_outbox(text,integer)') IS NOT NULL
         AND to_regprocedure('public.complete_sale_order_outbox(uuid,text,jsonb)') IS NOT NULL
         AND to_regprocedure('public.fail_sale_order_outbox(uuid,text,text,integer)') IS NOT NULL,
         'claim/complete/fail precisam existir'
  UNION ALL
  SELECT 'outbox_service_role_only',
         NOT has_function_privilege('authenticated',
           'public.claim_sale_order_outbox(text,integer)', 'EXECUTE')
         AND NOT has_function_privilege('authenticated',
           'public.complete_sale_order_outbox(uuid,text,jsonb)', 'EXECUTE')
         AND NOT has_function_privilege('authenticated',
           'public.fail_sale_order_outbox(uuid,text,text,integer)', 'EXECUTE'),
         'authenticated não pode controlar a fila'
  UNION ALL
  SELECT 'outbox_cron_registered',
         NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
         OR EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sale-order-outbox'),
         'cron precisa disparar o worker quando pg_cron existe'
  UNION ALL
  SELECT 'purchase_shortage_service_only',
         NOT has_function_privilege('authenticated',
           'public.process_sale_order_purchase_shortages(uuid)', 'EXECUTE'),
         'efeito de compra não pode ser chamado pelo browser';
$$;

REVOKE ALL ON FUNCTION public.run_sale_order_outbox_contract_tests()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_sale_order_outbox_contract_tests()
  TO authenticated, service_role;

COMMIT;
