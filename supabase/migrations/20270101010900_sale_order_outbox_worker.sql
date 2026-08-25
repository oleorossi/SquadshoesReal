-- Consumidor durável da outbox de Pedido de Venda.
--
-- A fila preserva ordem por agregado, usa lease cercado por token e mantém os
-- efeitos de compra como uma contribuição versionada por (PV, fornecedor).
-- Somente OCs automáticas ainda em suggested/draft e sem edição humana podem
-- ser substituídas; qualquer estado factual vira atenção operacional.

BEGIN;

ALTER TABLE public.sale_order_command_outbox
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by text,
  ADD COLUMN IF NOT EXISTS lock_token uuid,
  ADD COLUMN IF NOT EXISTS effect_result jsonb;

CREATE INDEX IF NOT EXISTS sale_order_command_outbox_claim_idx
  ON public.sale_order_command_outbox(
    status, available_at, locked_at, aggregate_key, aggregate_version, created_at
  )
  WHERE status IN ('pending', 'failed', 'processing');

CREATE TABLE IF NOT EXISTS public.sale_order_outbox_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ran_at timestamptz NOT NULL DEFAULT now(),
  worker_id text NOT NULL,
  claimed integer NOT NULL DEFAULT 0 CHECK (claimed >= 0),
  published integer NOT NULL DEFAULT 0 CHECK (published >= 0),
  failed integer NOT NULL DEFAULT 0 CHECK (failed >= 0),
  dead_letter integer NOT NULL DEFAULT 0 CHECK (dead_letter >= 0),
  duration_ms integer NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  maintenance_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text
);

ALTER TABLE public.sale_order_outbox_runs
  ADD COLUMN IF NOT EXISTS maintenance_result jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.sale_order_purchase_shortage_effects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_order_id uuid NOT NULL
    REFERENCES public.sale_orders(id) ON DELETE CASCADE,
  supplier_key text NOT NULL CHECK (length(btrim(supplier_key)) > 0),
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  purchase_order_id uuid UNIQUE
    REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  source_order_version bigint NOT NULL CHECK (source_order_version >= 0),
  desired_digest text,
  applied_digest text,
  desired_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  effect_status text NOT NULL DEFAULT 'editable'
    CHECK (effect_status IN (
      'editable', 'attention_required', 'no_shortage', 'superseded'
    )),
  attention_reason text,
  last_applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sale_order_id, supplier_key)
);

CREATE INDEX IF NOT EXISTS sale_order_purchase_shortage_effects_attention_idx
  ON public.sale_order_purchase_shortage_effects(updated_at, sale_order_id)
  WHERE effect_status = 'attention_required';

ALTER TABLE public.sale_order_outbox_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_order_purchase_shortage_effects ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.sale_order_outbox_runs
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.sale_order_purchase_shortage_effects
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.sale_order_outbox_runs TO service_role;
GRANT ALL ON TABLE public.sale_order_purchase_shortage_effects TO service_role;

-- O mesmo segredo autentica os dispatchers internos de NF-e, financeiro e
-- outbox. SECURITY DEFINER sem ACL fechada permitiria que qualquer usuário
-- autenticado lesse o X-Cron-Secret e chamasse handlers verify_jwt=false.
-- A função existia no banco vivo sem migration correspondente; recriá-la aqui
-- torna o replay do histórico determinístico e mantém a leitura do mesmo
-- secret já usado pelos outros dispatchers.
CREATE OR REPLACE FUNCTION public.get_nfe_sync_cron_secret()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = vault, public
AS $$
DECLARE v_secret text;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'get_nfe_sync_cron_secret exige service_role'
      USING ERRCODE = '42501';
  END IF;
  SELECT decrypted_secret
    INTO v_secret
    FROM vault.decrypted_secrets
   WHERE name = 'nfe_sync_cron_secret'
   LIMIT 1;
  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'nfe_sync_cron_secret não encontrado no vault';
  END IF;
  RETURN v_secret;
END;
$$;

REVOKE ALL ON FUNCTION public.get_nfe_sync_cron_secret()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_nfe_sync_cron_secret()
  TO service_role;

-- 105 introduziu uma API provisória de worker. Ela permanece no catálogo para
-- compatibilidade de migration, porém sem consumidor autorizado: duas APIs de
-- claim válidas poderiam furar a ordem por agregado.
REVOKE ALL ON FUNCTION public.claim_sale_order_command_outbox(text, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_sale_order_command_outbox(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fail_sale_order_command_outbox(
  uuid, text, uuid, text, integer, boolean
) FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.claim_sale_order_outbox(text, integer);
DROP FUNCTION IF EXISTS public.complete_sale_order_outbox(uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.fail_sale_order_outbox(uuid, text, text, integer);

CREATE OR REPLACE FUNCTION public.claim_sale_order_outbox(
  p_worker_id text,
  p_limit integer DEFAULT 20,
  p_lease_seconds integer DEFAULT 300
)
RETURNS TABLE(
  id uuid,
  sale_order_id uuid,
  event_type text,
  aggregate_key text,
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
    RAISE EXCEPTION 'claim_sale_order_outbox exige service_role'
      USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_worker_id, ''))) NOT BETWEEN 1 AND 120
     OR p_limit NOT BETWEEN 1 AND 100
     OR p_lease_seconds NOT BETWEEN 30 AND 3600 THEN
    RAISE EXCEPTION 'Parâmetros inválidos para claim da outbox'
      USING ERRCODE = '22023';
  END IF;

  -- Um lease que já esgotou tentativas é encerrado antes de selecionar novos
  -- candidatos. O dead-letter continua bloqueando versões posteriores do PV
  -- até intervenção humana, preservando causalidade.
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
     AND o.attempts >= 8
     AND o.locked_at < now() - make_interval(secs => p_lease_seconds);

  RETURN QUERY
  WITH candidates AS (
    SELECT o.id
      FROM public.sale_order_command_outbox o
     WHERE o.available_at <= now()
       AND o.event_type NOT IN (
         'sale_order.material_plan_commit_failed',
         'sale_order.material_plan_compensation_required',
         'sale_order.purchase_attention_required'
       )
       AND (
         o.status IN ('pending', 'failed')
         OR (
           o.status = 'processing'
           AND o.locked_at < now() - make_interval(secs => p_lease_seconds)
         )
       )
       AND o.attempts < 8
       AND NOT EXISTS (
         SELECT 1
           FROM public.sale_order_command_outbox earlier
          WHERE earlier.aggregate_key = o.aggregate_key
            AND earlier.event_type NOT IN (
              'sale_order.material_plan_commit_failed',
              'sale_order.material_plan_compensation_required',
              'sale_order.purchase_attention_required'
            )
            AND earlier.status IN (
              'pending', 'failed', 'processing', 'dead_letter'
            )
            AND (
              earlier.aggregate_version,
              earlier.created_at,
              earlier.id
            ) < (
              o.aggregate_version,
              o.created_at,
              o.id
            )
       )
     ORDER BY o.available_at, o.created_at, o.id
     FOR UPDATE OF o SKIP LOCKED
     LIMIT p_limit
  ), claimed AS (
    UPDATE public.sale_order_command_outbox o
       SET status = 'processing',
           attempts = o.attempts + 1,
           locked_at = now(),
           locked_by = btrim(p_worker_id),
           lock_token = gen_random_uuid(),
           last_error = NULL
      FROM candidates c
     WHERE o.id = c.id
    RETURNING o.id, o.sale_order_id, o.event_type, o.aggregate_key,
              o.aggregate_version, o.payload, o.attempts, o.locked_at,
              o.lock_token
  )
  SELECT c.id, c.sale_order_id, c.event_type, c.aggregate_key,
         c.aggregate_version, c.payload, c.attempts, c.locked_at,
         c.lock_token
    FROM claimed c
   ORDER BY c.aggregate_key, c.aggregate_version, c.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_sale_order_outbox(
  p_event_id uuid,
  p_worker_id text,
  p_lock_token uuid,
  p_effect_result jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_changed integer;
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
         lock_token = NULL,
         last_error = NULL,
         effect_result = COALESCE(p_effect_result, '{}'::jsonb)
   WHERE id = p_event_id
     AND status = 'processing'
     AND locked_by = btrim(p_worker_id)
     AND lock_token = p_lock_token;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_sale_order_outbox(
  p_event_id uuid,
  p_worker_id text,
  p_lock_token uuid,
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
  IF p_max_attempts NOT BETWEEN 1 AND 30
     OR length(btrim(COALESCE(p_error, ''))) = 0 THEN
    RAISE EXCEPTION 'Erro/max_attempts inválido para retry da outbox'
      USING ERRCODE = '22023';
  END IF;

  SELECT o.attempts
    INTO v_attempts
    FROM public.sale_order_command_outbox o
   WHERE o.id = p_event_id
     AND o.status = 'processing'
     AND o.locked_by = btrim(p_worker_id)
     AND o.lock_token = p_lock_token
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_claimed';
  END IF;

  v_status := CASE
    WHEN v_attempts >= p_max_attempts THEN 'dead_letter'
    ELSE 'failed'
  END;
  v_delay_seconds := LEAST(
    3600,
    (15 * power(2, GREATEST(v_attempts - 1, 0)))::integer
  );

  UPDATE public.sale_order_command_outbox
     SET status = v_status,
         available_at = CASE
           WHEN v_status = 'failed'
             THEN now() + make_interval(secs => v_delay_seconds)
           ELSE available_at
         END,
         locked_at = NULL,
         locked_by = NULL,
         lock_token = NULL,
         last_error = left(btrim(p_error), 4000)
   WHERE id = p_event_id
     AND status = 'processing'
     AND locked_by = btrim(p_worker_id)
     AND lock_token = p_lock_token;
  RETURN v_status;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_sale_order_outbox(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_sale_order_outbox(uuid, text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_sale_order_outbox(uuid, text, uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sale_order_outbox(text, integer, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_sale_order_outbox(uuid, text, uuid, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_sale_order_outbox(
  uuid, text, uuid, text, integer
) TO service_role;

-- Digest do conteúdo que o worker controla. Metadados gerados por outros
-- módulos (ETA, datas, PDF) ficam fora; itens, fornecedor e total detectam
-- qualquer edição comercial humana antes de uma substituição automática.
CREATE OR REPLACE FUNCTION public.sale_order_outbox_purchase_order_digest(
  p_purchase_order_id uuid
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT md5(COALESCE((
    SELECT jsonb_build_object(
      'supplier_id', po.supplier_id,
      'supplier_name', po.supplier_name,
      'total_value', po.total_value,
      'source_pv_ids', po.source_pv_ids,
      'linked_sale_order_ids', po.linked_sale_order_ids,
      'approval_preflight_token', po.approval_preflight_token,
      'approval_preflight_by', po.approval_preflight_by,
      'approval_preflight_actor_name', po.approval_preflight_actor_name,
      'approval_preflight_at', po.approval_preflight_at,
      'approval_preflight_revision', po.approval_preflight_revision,
      'approval_preflight_digest', po.approval_preflight_digest,
      'items', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', poi.id,
            'product_id', poi.product_id,
            'quantity', poi.quantity,
            'suggested_quantity', poi.suggested_quantity,
            'unit_price', poi.unit_price,
            'unit', poi.unit,
            'current_stock', poi.current_stock,
            'min_stock', poi.min_stock,
            'max_stock', poi.max_stock,
            'grade', poi.grade,
            'color', poi.color,
            'received_quantity', poi.received_quantity
          )
          ORDER BY poi.product_id, COALESCE(poi.color, ''), poi.id
        )
          FROM public.purchase_order_items poi
         WHERE poi.purchase_order_id = po.id
      ), '[]'::jsonb)
    )::text
      FROM public.purchase_orders po
     WHERE po.id = p_purchase_order_id
  ), 'missing'));
$$;

REVOKE ALL ON FUNCTION public.sale_order_outbox_purchase_order_digest(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sale_order_outbox_purchase_order_digest(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.emit_sale_order_purchase_attention(
  p_sale_order_id uuid,
  p_order_version bigint,
  p_reason text,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_version bigint;
  v_key text;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'emit_sale_order_purchase_attention exige service_role'
      USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'Atenção de compra exige motivo' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(p_order_version, so.order_version, 0)
    INTO v_version
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV não encontrado para atenção de compra';
  END IF;

  v_key := 'purchase-attention:v' || v_version::text || ':' ||
           md5(btrim(p_reason) || COALESCE(p_details, '{}'::jsonb)::text);
  INSERT INTO public.sale_order_command_outbox(
    sale_order_id, aggregate_key, event_type, aggregate_version,
    idempotency_key, payload
  ) VALUES (
    p_sale_order_id, p_sale_order_id::text,
    'sale_order.purchase_attention_required', v_version,
    v_key,
    jsonb_build_object(
      'sale_order_id', p_sale_order_id,
      'order_version', v_version,
      'reason', btrim(p_reason),
      'details', COALESCE(p_details, '{}'::jsonb)
    )
  )
  ON CONFLICT (event_type, aggregate_key, idempotency_key)
  DO UPDATE SET payload = EXCLUDED.payload
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.emit_sale_order_purchase_attention(
  uuid, bigint, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emit_sale_order_purchase_attention(
  uuid, bigint, text, jsonb
) TO service_role;

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
  v_order_version bigint;
  v_desired_groups jsonb := '[]'::jsonb;
  v_blocked jsonb := '[]'::jsonb;
  v_group record;
  v_group_data jsonb;
  v_item jsonb;
  v_effect public.sale_order_purchase_shortage_effects%ROWTYPE;
  v_po public.purchase_orders%ROWTYPE;
  v_supplier_key text;
  v_supplier_id uuid;
  v_supplier_name text;
  v_idem text;
  v_desired_digest text;
  v_current_digest text;
  v_po_id uuid;
  v_conflict_po_id uuid;
  v_total numeric;
  v_is_new boolean;
  v_is_editable boolean;
  v_created integer := 0;
  v_updated integer := 0;
  v_reused integer := 0;
  v_cancelled integer := 0;
  v_attention integer := 0;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'process_sale_order_purchase_shortages exige service_role'
      USING ERRCODE = '42501';
  END IF;
  IF p_sale_order_id IS NULL THEN
    RAISE EXCEPTION 'sale_order_id obrigatório' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'sale-order-purchase-shortages:' || p_sale_order_id::text,
    0
  ));

  SELECT so.status, so.order_version
    INTO v_status, v_order_version
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id
     AND so.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'sale_order_not_found');
  END IF;

  IF v_status IN ('Aprovado', 'Em Produção') THEN
    WITH material_rows AS (
      SELECT need.*, p.min_stock, p.max_stock, p.active,
             COALESCE(NULLIF(btrim(need.unit), ''), p.unit, 'un') AS input_unit
        FROM public.compute_materials_per_pv(ARRAY[p_sale_order_id]) need
        LEFT JOIN public.products p ON p.id = need.material_id
       WHERE COALESCE(need.shortage, 0) > 0
    ), valid_rows AS (
      SELECT m.*,
             n.out_qty,
             n.out_unit,
             n.out_unit_price
        FROM material_rows m
        CROSS JOIN LATERAL public.po_normalize_line(
          m.material_id,
          m.shortage,
          m.input_unit,
          COALESCE(m.last_unit_price, 0)
        ) n
       WHERE m.active
         AND NOT COALESCE(m.is_artisanal, false)
         AND NOT COALESCE(m.color_mismatch, false)
         AND COALESCE(m.last_unit_price, 0) > 0
         AND NULLIF(btrim(COALESCE(m.conversion_warning, '')), '') IS NULL
    ), grouped AS (
      SELECT CASE
               WHEN v.supplier_id IS NULL THEN 'none'
               ELSE 'supplier:' || v.supplier_id::text
             END AS supplier_key,
             v.supplier_id,
             COALESCE(NULLIF(btrim(max(v.supplier_name)), ''), 'A definir')
               AS supplier_name,
             jsonb_agg(
               jsonb_build_object(
                 'product_id', v.material_id,
                 'product_name', v.product_name,
                 'quantity', v.out_qty,
                 'unit_price', v.out_unit_price,
                 'unit', v.out_unit,
                 'current_stock', COALESCE(v.stock_qty, 0),
                 'min_stock', COALESCE(v.min_stock, 0),
                 'max_stock', COALESCE(v.max_stock, 0),
                 'grade', v.grade,
                 'color', NULLIF(v.color, '')
               )
               ORDER BY v.product_name, v.material_id, COALESCE(v.color, '')
             ) AS items
        FROM valid_rows v
       WHERE v.out_qty > 0
       GROUP BY v.supplier_id
    )
    SELECT COALESCE(jsonb_agg(
             jsonb_build_object(
               'supplier_key', g.supplier_key,
               'supplier_id', g.supplier_id,
               'supplier_name', g.supplier_name,
               'items', g.items
             ) ORDER BY g.supplier_key
           ), '[]'::jsonb)
      INTO v_desired_groups
      FROM grouped g;

    SELECT COALESCE(jsonb_agg(
             jsonb_build_object(
               'product_id', need.material_id,
               'product_name', need.product_name,
               'color', need.color,
               'shortage', need.shortage,
               'reason', CASE
                 WHEN p.id IS NULL OR NOT COALESCE(p.active, false)
                   THEN 'produto_inativo_ou_ausente'
                 WHEN COALESCE(need.is_artisanal, false)
                   THEN 'material_artesanal'
                 WHEN COALESCE(need.color_mismatch, false)
                   THEN 'cor_sem_produto_exato'
                 WHEN COALESCE(need.last_unit_price, 0) <= 0
                   THEN 'preco_de_compra_ausente'
                 ELSE need.conversion_warning
               END
             ) ORDER BY need.product_name, need.material_id
           ), '[]'::jsonb)
      INTO v_blocked
      FROM public.compute_materials_per_pv(ARRAY[p_sale_order_id]) need
      LEFT JOIN public.products p ON p.id = need.material_id
     WHERE COALESCE(need.shortage, 0) > 0
       AND (
         p.id IS NULL
         OR NOT COALESCE(p.active, false)
         OR COALESCE(need.is_artisanal, false)
         OR COALESCE(need.color_mismatch, false)
         OR COALESCE(need.last_unit_price, 0) <= 0
         OR NULLIF(btrim(COALESCE(need.conversion_warning, '')), '') IS NOT NULL
       );
  END IF;

  IF jsonb_array_length(v_blocked) > 0 THEN
    PERFORM public.emit_sale_order_purchase_attention(
      p_sale_order_id,
      v_order_version,
      'materiais_bloqueados_para_compra_automatica',
      jsonb_build_object('blocked', v_blocked)
    );
    v_attention := v_attention + 1;
  END IF;

  FOR v_group IN
    SELECT value AS data
      FROM jsonb_array_elements(v_desired_groups)
  LOOP
    v_group_data := v_group.data;
    v_supplier_key := v_group_data ->> 'supplier_key';
    v_supplier_id := NULLIF(v_group_data ->> 'supplier_id', '')::uuid;
    v_supplier_name := COALESCE(
      NULLIF(btrim(v_group_data ->> 'supplier_name'), ''),
      'A definir'
    );
    v_idem := 'auto_pv:outbox:' || v_supplier_key || ':' ||
              p_sale_order_id::text;
    v_desired_digest := md5(v_group_data::text);
    v_po_id := NULL;
    v_conflict_po_id := NULL;
    v_is_new := false;

    SELECT e.*
      INTO v_effect
      FROM public.sale_order_purchase_shortage_effects e
     WHERE e.sale_order_id = p_sale_order_id
       AND e.supplier_key = v_supplier_key
     FOR UPDATE;
    IF v_effect.id IS NOT NULL THEN
      v_po_id := v_effect.purchase_order_id;
    END IF;

    -- Uma sugestão que o próprio worker cancelou por falta resolvida pode
    -- nascer novamente se uma edição posterior recriar a necessidade. A OC
    -- cancelada permanece histórica; só o vínculo da contribuição migra para
    -- uma nova OC.
    IF v_effect.effect_status = 'no_shortage'
       AND v_po_id IS NOT NULL
       AND EXISTS (
         SELECT 1
           FROM public.purchase_orders closed_po
          WHERE closed_po.id = v_po_id
            AND closed_po.status = 'cancelled'
            AND strpos(
              COALESCE(closed_po.idempotency_key, ''),
              v_idem || ':closed:'
            ) = 1
       ) THEN
      v_po_id := NULL;
    END IF;

    -- Uma OC manual/legada já vinculada ao mesmo PV e fornecedor é uma decisão
    -- humana existente. Não se cria nem se reescreve outra automaticamente.
    SELECT po.id
      INTO v_conflict_po_id
      FROM public.purchase_orders po
     WHERE po.id IS DISTINCT FROM v_po_id
       AND po.status NOT IN ('cancelled', 'received', 'receiving')
       AND po.supplier_id IS NOT DISTINCT FROM v_supplier_id
       AND (
         COALESCE(po.source_pv_ids, ARRAY[]::uuid[]) @> ARRAY[p_sale_order_id]
         OR COALESCE(po.linked_sale_order_ids, ARRAY[]::uuid[])
              @> ARRAY[p_sale_order_id]
       )
     ORDER BY po.created_at, po.id
     LIMIT 1
     FOR UPDATE;

    IF v_conflict_po_id IS NOT NULL THEN
      INSERT INTO public.sale_order_purchase_shortage_effects(
        sale_order_id, supplier_key, supplier_id, purchase_order_id,
        source_order_version, desired_digest, applied_digest,
        desired_payload, effect_status, attention_reason, updated_at
      ) VALUES (
        p_sale_order_id, v_supplier_key, v_supplier_id, v_po_id,
        v_order_version, v_desired_digest, v_effect.applied_digest,
        v_group_data, 'attention_required',
        'existing_linked_purchase_order', now()
      )
      ON CONFLICT (sale_order_id, supplier_key) DO UPDATE SET
        supplier_id = EXCLUDED.supplier_id,
        source_order_version = EXCLUDED.source_order_version,
        desired_digest = EXCLUDED.desired_digest,
        desired_payload = EXCLUDED.desired_payload,
        effect_status = EXCLUDED.effect_status,
        attention_reason = EXCLUDED.attention_reason,
        updated_at = now();
      PERFORM public.emit_sale_order_purchase_attention(
        p_sale_order_id,
        v_order_version,
        'oc_ja_vinculada_ao_pv_exige_reconciliacao',
        jsonb_build_object(
          'supplier_key', v_supplier_key,
          'conflicting_purchase_order_id', v_conflict_po_id,
          'managed_purchase_order_id', v_po_id,
          'desired_digest', v_desired_digest
        )
      );
      v_attention := v_attention + 1;
      CONTINUE;
    END IF;

    IF v_po_id IS NULL THEN
      SELECT po.id
        INTO v_conflict_po_id
        FROM public.purchase_orders po
       WHERE po.idempotency_key = v_idem
         AND po.status NOT IN ('cancelled', 'received', 'receiving')
       LIMIT 1
       FOR UPDATE;
      IF v_conflict_po_id IS NOT NULL THEN
        INSERT INTO public.sale_order_purchase_shortage_effects(
          sale_order_id, supplier_key, supplier_id, source_order_version,
          desired_digest, desired_payload, effect_status, attention_reason,
          updated_at
        ) VALUES (
          p_sale_order_id, v_supplier_key, v_supplier_id, v_order_version,
          v_desired_digest, v_group_data, 'attention_required',
          'untracked_automatic_purchase_order', now()
        )
        ON CONFLICT (sale_order_id, supplier_key) DO UPDATE SET
          supplier_id = EXCLUDED.supplier_id,
          source_order_version = EXCLUDED.source_order_version,
          desired_digest = EXCLUDED.desired_digest,
          desired_payload = EXCLUDED.desired_payload,
          effect_status = EXCLUDED.effect_status,
          attention_reason = EXCLUDED.attention_reason,
          updated_at = now();
        PERFORM public.emit_sale_order_purchase_attention(
          p_sale_order_id,
          v_order_version,
          'oc_automatica_sem_contribuicao_rastreada',
          jsonb_build_object(
            'supplier_key', v_supplier_key,
            'purchase_order_id', v_conflict_po_id,
            'desired_digest', v_desired_digest
          )
        );
        v_attention := v_attention + 1;
        CONTINUE;
      END IF;

      INSERT INTO public.purchase_orders(
        supplier_id, supplier_name, notes, total_value, auto_generated,
        status, approval_status, source_type, source_pv_ids,
        linked_sale_order_ids, idempotency_key
      ) VALUES (
        v_supplier_id,
        v_supplier_name,
        'Sugestão versionada pela outbox do PV ' || p_sale_order_id::text,
        0,
        true,
        CASE WHEN v_supplier_id IS NULL THEN 'draft' ELSE 'suggested' END,
        'pendente_aprovacao',
        'per_pv',
        ARRAY[p_sale_order_id],
        ARRAY[p_sale_order_id],
        v_idem
      ) RETURNING id INTO v_po_id;
      v_is_new := true;
      v_created := v_created + 1;
    END IF;

    SELECT po.*
      INTO v_po
      FROM public.purchase_orders po
     WHERE po.id = v_po_id
     FOR UPDATE;
    IF v_po.id IS NULL THEN
      UPDATE public.sale_order_purchase_shortage_effects
         SET purchase_order_id = NULL,
             source_order_version = v_order_version,
             desired_digest = v_desired_digest,
             desired_payload = v_group_data,
             effect_status = 'attention_required',
             attention_reason = 'managed_purchase_order_missing',
             updated_at = now()
       WHERE sale_order_id = p_sale_order_id
         AND supplier_key = v_supplier_key;
      PERFORM public.emit_sale_order_purchase_attention(
        p_sale_order_id,
        v_order_version,
        'oc_automatica_rastreada_nao_encontrada',
        jsonb_build_object('supplier_key', v_supplier_key)
      );
      v_attention := v_attention + 1;
      CONTINUE;
    END IF;

    v_current_digest := public.sale_order_outbox_purchase_order_digest(v_po_id);
    v_is_editable :=
      v_po.auto_generated
      AND v_po.source_type = 'per_pv'
      AND v_po.idempotency_key = v_idem
      AND v_po.status IN ('suggested', 'draft')
      AND COALESCE(v_po.approval_status, 'pendente_aprovacao') =
          'pendente_aprovacao'
      AND v_po.snapshot_locked_at IS NULL
      AND v_po.approved_by IS NULL
      AND v_po.approved_at IS NULL
      AND NOT EXISTS (
        SELECT 1
          FROM public.purchase_order_approvals a
         WHERE a.purchase_order_id = v_po_id
      )
      AND NOT EXISTS (
        SELECT 1
          FROM public.purchase_order_items poi
         WHERE poi.purchase_order_id = v_po_id
           AND COALESCE(poi.received_quantity, 0) > 0
      )
      AND (
        v_is_new
        OR (
          v_effect.applied_digest IS NOT NULL
          AND v_current_digest = v_effect.applied_digest
        )
      );

    IF NOT v_is_editable THEN
      INSERT INTO public.sale_order_purchase_shortage_effects(
        sale_order_id, supplier_key, supplier_id, purchase_order_id,
        source_order_version, desired_digest, applied_digest,
        desired_payload, effect_status, attention_reason, updated_at
      ) VALUES (
        p_sale_order_id, v_supplier_key, v_supplier_id, v_po_id,
        v_order_version, v_desired_digest, v_current_digest,
        v_group_data, 'attention_required',
        'purchase_order_not_system_editable', now()
      )
      ON CONFLICT (sale_order_id, supplier_key) DO UPDATE SET
        supplier_id = EXCLUDED.supplier_id,
        purchase_order_id = EXCLUDED.purchase_order_id,
        source_order_version = EXCLUDED.source_order_version,
        desired_digest = EXCLUDED.desired_digest,
        desired_payload = EXCLUDED.desired_payload,
        effect_status = EXCLUDED.effect_status,
        attention_reason = EXCLUDED.attention_reason,
        updated_at = now();
      PERFORM public.emit_sale_order_purchase_attention(
        p_sale_order_id,
        v_order_version,
        'oc_nao_editavel_exige_reconciliacao_manual',
        jsonb_build_object(
          'supplier_key', v_supplier_key,
          'purchase_order_id', v_po_id,
          'purchase_order_status', v_po.status,
          'approval_status', v_po.approval_status,
          'expected_applied_digest', v_effect.applied_digest,
          'current_digest', v_current_digest,
          'desired_digest', v_desired_digest
        )
      );
      v_attention := v_attention + 1;
      CONTINUE;
    END IF;

    IF NOT v_is_new
       AND v_effect.desired_digest = v_desired_digest
       AND v_effect.effect_status = 'editable' THEN
      UPDATE public.sale_order_purchase_shortage_effects
         SET source_order_version = v_order_version,
             desired_payload = v_group_data,
             attention_reason = NULL,
             updated_at = now()
       WHERE id = v_effect.id;
      v_reused := v_reused + 1;
      CONTINUE;
    END IF;

    DELETE FROM public.purchase_order_items
     WHERE purchase_order_id = v_po_id;
    v_total := 0;
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(v_group_data -> 'items')
    LOOP
      INSERT INTO public.purchase_order_items(
        purchase_order_id, product_id, quantity, suggested_quantity,
        unit_price, unit, current_stock, min_stock, max_stock, grade, color
      ) VALUES (
        v_po_id,
        (v_item ->> 'product_id')::uuid,
        COALESCE((v_item ->> 'quantity')::numeric, 0),
        COALESCE((v_item ->> 'quantity')::numeric, 0),
        COALESCE((v_item ->> 'unit_price')::numeric, 0),
        COALESCE(NULLIF(v_item ->> 'unit', ''), 'un'),
        COALESCE((v_item ->> 'current_stock')::numeric, 0),
        COALESCE((v_item ->> 'min_stock')::numeric, 0),
        COALESCE((v_item ->> 'max_stock')::numeric, 0),
        NULLIF(v_item -> 'grade', 'null'::jsonb),
        NULLIF(v_item ->> 'color', '')
      );
      v_total := v_total
        + COALESCE((v_item ->> 'quantity')::numeric, 0)
        * COALESCE((v_item ->> 'unit_price')::numeric, 0);
    END LOOP;

    UPDATE public.purchase_orders
       SET supplier_id = v_supplier_id,
           supplier_name = v_supplier_name,
           total_value = v_total,
           source_pv_ids = ARRAY[p_sale_order_id],
           linked_sale_order_ids = ARRAY[p_sale_order_id],
           approval_status = 'pendente_aprovacao',
           approved_by = NULL,
           approved_at = NULL,
           rejection_reason = '',
           approval_preflight_token = NULL,
           approval_preflight_by = NULL,
           approval_preflight_actor_name = NULL,
           approval_preflight_at = NULL,
           approval_preflight_revision = NULL,
           approval_preflight_digest = NULL,
           commercial_revision = COALESCE(commercial_revision, 0) + 1,
           commercial_digest = NULL,
           updated_at = now()
     WHERE id = v_po_id;

    v_current_digest := public.sale_order_outbox_purchase_order_digest(v_po_id);
    INSERT INTO public.sale_order_purchase_shortage_effects(
      sale_order_id, supplier_key, supplier_id, purchase_order_id,
      source_order_version, desired_digest, applied_digest,
      desired_payload, effect_status, attention_reason,
      last_applied_at, updated_at
    ) VALUES (
      p_sale_order_id, v_supplier_key, v_supplier_id, v_po_id,
      v_order_version, v_desired_digest, v_current_digest,
      v_group_data, 'editable', NULL, now(), now()
    )
    ON CONFLICT (sale_order_id, supplier_key) DO UPDATE SET
      supplier_id = EXCLUDED.supplier_id,
      purchase_order_id = EXCLUDED.purchase_order_id,
      source_order_version = EXCLUDED.source_order_version,
      desired_digest = EXCLUDED.desired_digest,
      applied_digest = EXCLUDED.applied_digest,
      desired_payload = EXCLUDED.desired_payload,
      effect_status = 'editable',
      attention_reason = NULL,
      last_applied_at = now(),
      updated_at = now();
    IF NOT v_is_new THEN
      v_updated := v_updated + 1;
    END IF;
  END LOOP;

  -- Fornecedor removido, falta resolvida, PV cancelado/faturado: a contribuição
  -- deixa de existir. Cancela somente a sugestão que ainda é byte-a-byte a que
  -- o sistema aplicou; estado humano/factual é preservado e sinalizado.
  FOR v_effect IN
    SELECT e.*
      FROM public.sale_order_purchase_shortage_effects e
     WHERE e.sale_order_id = p_sale_order_id
       AND NOT EXISTS (
         SELECT 1
           FROM jsonb_array_elements(v_desired_groups) d
          WHERE d ->> 'supplier_key' = e.supplier_key
       )
     FOR UPDATE
  LOOP
    IF v_effect.purchase_order_id IS NULL THEN
      UPDATE public.sale_order_purchase_shortage_effects
         SET source_order_version = v_order_version,
             desired_digest = NULL,
             desired_payload = '{}'::jsonb,
             effect_status = 'no_shortage',
             attention_reason = NULL,
             updated_at = now()
       WHERE id = v_effect.id;
      CONTINUE;
    END IF;

    SELECT po.*
      INTO v_po
      FROM public.purchase_orders po
     WHERE po.id = v_effect.purchase_order_id
     FOR UPDATE;
    IF v_po.id IS NULL THEN
      UPDATE public.sale_order_purchase_shortage_effects
         SET purchase_order_id = NULL,
             source_order_version = v_order_version,
             desired_digest = NULL,
             desired_payload = '{}'::jsonb,
             effect_status = 'superseded',
             attention_reason = NULL,
             updated_at = now()
       WHERE id = v_effect.id;
      CONTINUE;
    END IF;

    IF v_po.status = 'cancelled'
       AND v_effect.effect_status = 'no_shortage'
       AND strpos(
         COALESCE(v_po.idempotency_key, ''),
         'auto_pv:outbox:' || v_effect.supplier_key || ':' ||
           p_sale_order_id::text || ':closed:'
       ) = 1 THEN
      UPDATE public.sale_order_purchase_shortage_effects
         SET source_order_version = v_order_version,
             updated_at = now()
       WHERE id = v_effect.id;
      CONTINUE;
    END IF;

    IF v_po.status IN ('cancelled', 'received', 'receiving') THEN
      UPDATE public.sale_order_purchase_shortage_effects
         SET source_order_version = v_order_version,
             desired_digest = NULL,
             desired_payload = '{}'::jsonb,
             effect_status = 'superseded',
             attention_reason = NULL,
             updated_at = now()
       WHERE id = v_effect.id;
      CONTINUE;
    END IF;

    v_current_digest := public.sale_order_outbox_purchase_order_digest(v_po.id);
    v_idem := 'auto_pv:outbox:' || v_effect.supplier_key || ':' ||
              p_sale_order_id::text;
    v_is_editable :=
      v_po.auto_generated
      AND v_po.source_type = 'per_pv'
      AND v_po.idempotency_key = v_idem
      AND v_po.status IN ('suggested', 'draft')
      AND COALESCE(v_po.approval_status, 'pendente_aprovacao') =
          'pendente_aprovacao'
      AND v_po.snapshot_locked_at IS NULL
      AND v_po.approved_by IS NULL
      AND v_po.approved_at IS NULL
      AND v_effect.applied_digest IS NOT NULL
      AND v_current_digest = v_effect.applied_digest
      AND NOT EXISTS (
        SELECT 1 FROM public.purchase_order_approvals a
         WHERE a.purchase_order_id = v_po.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.purchase_order_items poi
         WHERE poi.purchase_order_id = v_po.id
           AND COALESCE(poi.received_quantity, 0) > 0
      );

    IF v_is_editable THEN
      UPDATE public.purchase_orders
         SET status = 'cancelled',
             cancelled_at = now(),
             idempotency_key = v_idem || ':closed:v' ||
               v_order_version::text,
             notes = concat_ws(
               E'\n',
               NULLIF(notes, ''),
               '[SISTEMA] Sugestão automática supersedida pelo PV v' ||
                 v_order_version::text
             ),
             updated_at = now()
       WHERE id = v_po.id;
      UPDATE public.sale_order_purchase_shortage_effects
         SET source_order_version = v_order_version,
             desired_digest = NULL,
             desired_payload = '{}'::jsonb,
             effect_status = 'no_shortage',
             attention_reason = NULL,
             updated_at = now()
       WHERE id = v_effect.id;
      v_cancelled := v_cancelled + 1;
    ELSE
      UPDATE public.sale_order_purchase_shortage_effects
         SET source_order_version = v_order_version,
             desired_digest = NULL,
             desired_payload = '{}'::jsonb,
             effect_status = 'attention_required',
             attention_reason = 'obsolete_purchase_order_not_system_editable',
             updated_at = now()
       WHERE id = v_effect.id;
      PERFORM public.emit_sale_order_purchase_attention(
        p_sale_order_id,
        v_order_version,
        'oc_obsoleta_exige_reconciliacao_manual',
        jsonb_build_object(
          'supplier_key', v_effect.supplier_key,
          'purchase_order_id', v_po.id,
          'purchase_order_status', v_po.status,
          'approval_status', v_po.approval_status,
          'expected_applied_digest', v_effect.applied_digest,
          'current_digest', v_current_digest
        )
      );
      v_attention := v_attention + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'skipped', false,
    'sale_order_status', v_status,
    'source_order_version', v_order_version,
    'desired_supplier_groups', jsonb_array_length(v_desired_groups),
    'created', v_created,
    'updated', v_updated,
    'reused', v_reused,
    'cancelled', v_cancelled,
    'attention_required', v_attention,
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
  p_maintenance_result jsonb DEFAULT '{}'::jsonb,
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
  IF length(btrim(COALESCE(p_worker_id, ''))) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'worker_id inválido' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.sale_order_outbox_runs(
    worker_id, claimed, published, failed, dead_letter, duration_ms,
    maintenance_result, error
  ) VALUES (
    btrim(p_worker_id),
    GREATEST(COALESCE(p_claimed, 0), 0),
    GREATEST(COALESCE(p_published, 0), 0),
    GREATEST(COALESCE(p_failed, 0), 0),
    GREATEST(COALESCE(p_dead_letter, 0), 0),
    GREATEST(COALESCE(p_duration_ms, 0), 0),
    COALESCE(p_maintenance_result, '{}'::jsonb),
    left(NULLIF(btrim(COALESCE(p_error, '')), ''), 4000)
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_sale_order_outbox_run(
  text, integer, integer, integer, integer, integer, jsonb, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_sale_order_outbox_run(
  text, integer, integer, integer, integer, integer, jsonb, text
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
    'pending', count(*) FILTER (
      WHERE o.status = 'pending'
        AND o.event_type <> 'sale_order.purchase_attention_required'
    ),
    'processing', count(*) FILTER (WHERE o.status = 'processing'),
    'failed', count(*) FILTER (WHERE o.status = 'failed'),
    'dead_letter', count(*) FILTER (WHERE o.status = 'dead_letter'),
    'attention_required',
      count(*) FILTER (
        WHERE o.event_type IN (
          'sale_order.purchase_attention_required',
          'sale_order.material_plan_commit_failed',
          'sale_order.material_plan_compensation_required'
        )
          AND o.status IN ('pending', 'failed', 'dead_letter')
      ) + (
        SELECT count(*)
          FROM public.sale_order_purchase_shortage_effects e
         WHERE e.effect_status = 'attention_required'
      ),
    'oldest_available_at', min(o.available_at) FILTER (
      WHERE o.status IN ('pending', 'failed')
        AND o.event_type NOT IN (
          'sale_order.purchase_attention_required',
          'sale_order.material_plan_commit_failed',
          'sale_order.material_plan_compensation_required'
        )
    ),
    'last_run', (
      SELECT to_jsonb(r)
        FROM public.sale_order_outbox_runs r
       ORDER BY r.ran_at DESC
       LIMIT 1
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
  SELECT decrypted_secret
    INTO v_secret
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
         to_regprocedure(
           'public.claim_sale_order_outbox(text,integer,integer)'
         ) IS NOT NULL
         AND to_regprocedure(
           'public.complete_sale_order_outbox(uuid,text,uuid,jsonb)'
         ) IS NOT NULL
         AND to_regprocedure(
           'public.fail_sale_order_outbox(uuid,text,uuid,text,integer)'
         ) IS NOT NULL,
         'claim/complete/fail finais precisam existir com lock_token'
  UNION ALL
  SELECT 'outbox_single_consumer_api',
         has_function_privilege(
           'service_role',
           'public.claim_sale_order_outbox(text,integer,integer)',
           'EXECUTE'
         )
         AND NOT has_function_privilege(
           'service_role',
           'public.claim_sale_order_command_outbox(text,integer,integer)',
           'EXECUTE'
         )
         AND NOT has_function_privilege(
           'service_role',
           'public.complete_sale_order_command_outbox(uuid,text,uuid)',
           'EXECUTE'
         )
         AND NOT has_function_privilege(
           'service_role',
           'public.fail_sale_order_command_outbox(uuid,text,uuid,text,integer,boolean)',
           'EXECUTE'
         ),
         'somente a API final pode consumir a fila'
  UNION ALL
  SELECT 'outbox_service_role_only',
         NOT has_function_privilege(
           'authenticated',
           'public.claim_sale_order_outbox(text,integer,integer)',
           'EXECUTE'
         )
         AND NOT has_function_privilege(
           'authenticated',
           'public.complete_sale_order_outbox(uuid,text,uuid,jsonb)',
           'EXECUTE'
         )
         AND NOT has_function_privilege(
           'authenticated',
           'public.fail_sale_order_outbox(uuid,text,uuid,text,integer)',
           'EXECUTE'
         ),
         'authenticated não pode controlar a fila'
  UNION ALL
  SELECT 'cron_secret_service_role_only',
         NOT has_function_privilege(
           'authenticated',
           'public.get_nfe_sync_cron_secret()',
           'EXECUTE'
         )
         AND NOT has_function_privilege(
           'anon',
           'public.get_nfe_sync_cron_secret()',
           'EXECUTE'
         )
         AND has_function_privilege(
           'service_role',
           'public.get_nfe_sync_cron_secret()',
           'EXECUTE'
         )
         AND EXISTS (
           SELECT 1
             FROM pg_proc p
            WHERE p.oid = to_regprocedure(
              'public.get_nfe_sync_cron_secret()'
            )
              AND p.prosecdef
              AND p.prosrc LIKE '%request.jwt.claim.role%'
              AND p.prosrc LIKE '%nfe_sync_cron_secret%'
         ),
         'segredo dos handlers verify_jwt=false não pode ser lido pelo cliente'
  UNION ALL
  SELECT 'purchase_shortage_versioned_effect',
         to_regclass('public.sale_order_purchase_shortage_effects') IS NOT NULL
         AND NOT has_table_privilege(
           'authenticated',
           'public.sale_order_purchase_shortage_effects',
           'SELECT'
         )
         AND NOT has_function_privilege(
           'authenticated',
           'public.process_sale_order_purchase_shortages(uuid)',
           'EXECUTE'
         ),
         'efeito de compra versionado precisa ser interno'
  UNION ALL
  SELECT 'purchase_digest_protects_human_state',
         EXISTS (
           SELECT 1
             FROM pg_proc p
            WHERE p.oid = to_regprocedure(
              'public.sale_order_outbox_purchase_order_digest(uuid)'
            )
              AND p.prosrc LIKE '%source_pv_ids%'
              AND p.prosrc LIKE '%linked_sale_order_ids%'
              AND p.prosrc LIKE '%approval_preflight_token%'
              AND p.prosrc LIKE '%approval_preflight_by%'
              AND p.prosrc LIKE '%approval_preflight_actor_name%'
              AND p.prosrc LIKE '%approval_preflight_at%'
              AND p.prosrc LIKE '%approval_preflight_revision%'
              AND p.prosrc LIKE '%approval_preflight_digest%'
         ),
         'digest precisa detectar vínculos e preflight antes de qualquer overwrite'
  UNION ALL
  SELECT 'outbox_cron_registered',
         NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
         OR EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sale-order-outbox'),
         'cron precisa disparar o worker quando pg_cron existe';
$$;

REVOKE ALL ON FUNCTION public.run_sale_order_outbox_contract_tests()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_sale_order_outbox_contract_tests()
  TO authenticated, service_role;

COMMENT ON TABLE public.sale_order_purchase_shortage_effects IS
  'Contribuição versionada de falta por PV/fornecedor. Só a OC automática ainda editável pode ser substituída; estados humanos/factuais viram atenção.';

COMMIT;
