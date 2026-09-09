-- Fronteira transacional da NF-e de devolução.
--
-- O provedor fiscal não participa da transação Postgres. Por isso o fluxo é
-- dividido em quatro passos idempotentes e persistidos:
--   begin -> claim do POST -> registro do resultado -> commit local.
-- O último passo aplica, numa única transação, grade/estoque, qty_devolvida,
-- contas a receber, lançamento financeiro e o estado fiscal visível.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Estado durável do comando e trilha dos efeitos
-- ---------------------------------------------------------------------------

ALTER TABLE public.nfe_devolucoes
  ADD COLUMN IF NOT EXISTS request_hash text,
  ADD COLUMN IF NOT EXISTS provider_request_hash text,
  ADD COLUMN IF NOT EXISTS provider_request_payload jsonb,
  ADD COLUMN IF NOT EXISTS provider_response jsonb,
  ADD COLUMN IF NOT EXISTS provider_status text,
  ADD COLUMN IF NOT EXISTS provider_submission_state text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS provider_submission_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_result_recorded_at timestamptz,
  ADD COLUMN IF NOT EXISTS effects_applied_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciliation_reason text;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
     WHERE conrelid = 'public.nfe_devolucoes'::regclass
       AND conname = 'nfe_devolucoes_request_hash_ck'
  ) THEN
    ALTER TABLE public.nfe_devolucoes
      ADD CONSTRAINT nfe_devolucoes_request_hash_ck
      CHECK (request_hash IS NULL OR length(request_hash) = 32);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
     WHERE conrelid = 'public.nfe_devolucoes'::regclass
       AND conname = 'nfe_devolucoes_provider_request_hash_ck'
  ) THEN
    ALTER TABLE public.nfe_devolucoes
      ADD CONSTRAINT nfe_devolucoes_provider_request_hash_ck
      CHECK (provider_request_hash IS NULL OR length(provider_request_hash) = 32);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
     WHERE conrelid = 'public.nfe_devolucoes'::regclass
       AND conname = 'nfe_devolucoes_provider_submission_state_ck'
  ) THEN
    ALTER TABLE public.nfe_devolucoes
      ADD CONSTRAINT nfe_devolucoes_provider_submission_state_ck
      CHECK (provider_submission_state IN (
        'not_started', 'inflight', 'recorded', 'rejected',
        'reconciliation_required', 'completed'
      ));
  END IF;
END;
$constraints$;

-- Qualquer linha anterior a esta fronteira fica explicitamente para
-- reconciliação; nunca inferimos se os efeitos laterais antigos terminaram.
UPDATE public.nfe_devolucoes
   SET provider_submission_state = 'reconciliation_required',
       reconciliation_reason = COALESCE(
         reconciliation_reason,
         'Registro legado anterior à fronteira atômica; conferir provedor, estoque e financeiro.'
       )
 WHERE request_hash IS NULL
   AND provider_submission_state = 'not_started';

CREATE UNIQUE INDEX IF NOT EXISTS nfe_devolucoes_provider_nfe_id_uq
  ON public.nfe_devolucoes(provider_nfe_id)
  WHERE provider_nfe_id IS NOT NULL AND btrim(provider_nfe_id) <> '';

CREATE TABLE public.nfe_devolucao_item_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nfe_devolucao_id uuid NOT NULL
    REFERENCES public.nfe_devolucoes(id) ON DELETE RESTRICT,
  sale_order_item_id uuid NOT NULL
    REFERENCES public.sale_order_items(id) ON DELETE RESTRICT,
  quantity numeric NOT NULL CHECK (
    quantity > 0 AND quantity = trunc(quantity)
  ),
  grade jsonb NOT NULL CHECK (jsonb_typeof(grade) = 'object'),
  reference_id uuid REFERENCES public.technical_sheets(id) ON DELETE RESTRICT,
  product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT,
  material_variant_id uuid
    REFERENCES public.reference_material_variants(id) ON DELETE RESTRICT,
  color text NOT NULL DEFAULT '',
  unit_price numeric NOT NULL CHECK (unit_price >= 0),
  status text NOT NULL DEFAULT 'claimed'
    CHECK (status IN ('claimed', 'applied', 'released', 'reconciliation_required')),
  applied_at timestamptz,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (nfe_devolucao_id, sale_order_item_id),
  CHECK (reference_id IS NOT NULL OR product_id IS NOT NULL),
  CHECK (
    (status = 'applied' AND applied_at IS NOT NULL AND released_at IS NULL)
    OR (status = 'released' AND released_at IS NOT NULL AND applied_at IS NULL)
    OR (status IN ('claimed', 'reconciliation_required')
        AND applied_at IS NULL AND released_at IS NULL)
  )
);

CREATE INDEX nfe_devolucao_item_claims_active_item_idx
  ON public.nfe_devolucao_item_claims(sale_order_item_id, status)
  WHERE status IN ('claimed', 'reconciliation_required');

CREATE TABLE public.nfe_devolucao_ready_stock_effects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL
    REFERENCES public.nfe_devolucao_item_claims(id) ON DELETE RESTRICT,
  ready_stock_id uuid NOT NULL
    REFERENCES public.ready_stock(id) ON DELETE RESTRICT,
  size text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  previous_quantity integer NOT NULL CHECK (previous_quantity >= 0),
  new_quantity integer NOT NULL CHECK (new_quantity >= previous_quantity),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (claim_id, size)
);

CREATE TABLE public.nfe_devolucao_ar_effects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nfe_devolucao_id uuid NOT NULL
    REFERENCES public.nfe_devolucoes(id) ON DELETE RESTRICT,
  accounts_receivable_id uuid NOT NULL
    REFERENCES public.accounts_receivable(id) ON DELETE RESTRICT,
  reduction numeric(14,2) NOT NULL CHECK (reduction > 0),
  previous_amount numeric NOT NULL,
  new_amount numeric NOT NULL,
  previous_status text NOT NULL,
  new_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (nfe_devolucao_id, accounts_receivable_id)
);

ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS nfe_devolucao_item_claim_id uuid
    REFERENCES public.nfe_devolucao_item_claims(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_nfe_devolucao_claim_uq
  ON public.stock_movements(nfe_devolucao_item_claim_id)
  WHERE nfe_devolucao_item_claim_id IS NOT NULL;

-- Pronta-entrega passa a preservar a variante comercial do produto acabado.
-- O banco de produção está vazio nesta tabela no rollout, mas a alteração é
-- retrocompatível: writers antigos continuam gravando variante NULL.
ALTER TABLE public.ready_stock
  ADD COLUMN IF NOT EXISTS material_variant_id uuid
    REFERENCES public.reference_material_variants(id) ON DELETE RESTRICT;

DROP INDEX IF EXISTS public.ready_stock_ref_color_size_idx;
DROP INDEX IF EXISTS public.idx_ready_stock_ref_color_size;
CREATE UNIQUE INDEX ready_stock_ref_variant_color_size_uq
  ON public.ready_stock(reference_id, material_variant_id, color, size)
  NULLS NOT DISTINCT;

CREATE OR REPLACE FUNCTION public.upsert_ready_stock_atomic(
  p_reference_id uuid,
  p_color text,
  p_size text,
  p_qty_delta numeric,
  p_location text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado'
      USING ERRCODE = '42501';
  END IF;
  IF p_qty_delta::text IN ('NaN', 'Infinity', '-Infinity')
     OR p_qty_delta <> trunc(p_qty_delta) THEN
    RAISE EXCEPTION 'Quantidade de pronta-entrega deve ser inteira'
      USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.ready_stock(
    reference_id, material_variant_id, color, size, quantity, location, notes
  ) VALUES (
    p_reference_id, NULL, COALESCE(p_color, ''), COALESCE(p_size, ''),
    GREATEST(p_qty_delta, 0)::integer, p_location, p_notes
  )
  ON CONFLICT (reference_id, material_variant_id, color, size) DO UPDATE
    SET quantity = GREATEST(public.ready_stock.quantity + p_qty_delta, 0)::integer,
        location = COALESCE(p_location, public.ready_stock.location),
        notes = COALESCE(p_notes, public.ready_stock.notes),
        updated_at = pg_catalog.now();
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_ready_stock_atomic(
  uuid, text, text, numeric, text, text
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_ready_stock_atomic(
  uuid, text, text, numeric, text, text
) TO authenticated;

ALTER TABLE public.nfe_devolucao_item_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfe_devolucao_ready_stock_effects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfe_devolucao_ar_effects ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.nfe_devolucao_item_claims,
  public.nfe_devolucao_ready_stock_effects,
  public.nfe_devolucao_ar_effects
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.nfe_devolucao_item_claims,
  public.nfe_devolucao_ready_stock_effects,
  public.nfe_devolucao_ar_effects
  TO service_role;

-- A tabela fiscal é leitura para o app; toda mutação passa pelos comandos.
DROP POLICY IF EXISTS rls_nfe_devolucoes_all ON public.nfe_devolucoes;
DROP POLICY IF EXISTS nfe_devolucoes_select_roles ON public.nfe_devolucoes;
CREATE POLICY nfe_devolucoes_select_roles ON public.nfe_devolucoes
  FOR SELECT TO authenticated
  USING (
    public.is_approved_user()
    AND public.user_has_any_role(ARRAY['admin','gerente','nfe_operator'])
  );
REVOKE INSERT, UPDATE, DELETE ON TABLE public.nfe_devolucoes FROM authenticated;
GRANT SELECT ON TABLE public.nfe_devolucoes TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Validação de grade e proteção do snapshot já reclamado
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.nfe_devolucao_grade_total(p_grade jsonb)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  v_entry record;
  v_value numeric;
  v_total numeric := 0;
BEGIN
  IF jsonb_typeof(COALESCE(p_grade, '{}'::jsonb)) <> 'object' THEN
    RETURN NULL;
  END IF;
  FOR v_entry IN SELECT e.key, e.value FROM jsonb_each(COALESCE(p_grade, '{}'::jsonb)) e
  LOOP
    CONTINUE WHEN left(v_entry.key, 1) = '_';
    IF jsonb_typeof(v_entry.value) <> 'number' THEN
      RETURN NULL;
    END IF;
    v_value := (v_entry.value #>> '{}')::numeric;
    IF v_value::text IN ('NaN', 'Infinity', '-Infinity')
       OR v_value < 0 OR v_value <> trunc(v_value) THEN
      RETURN NULL;
    END IF;
    v_total := v_total + v_value;
  END LOOP;
  RETURN v_total;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.nfe_devolucao_grade_total(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nfe_devolucao_grade_total(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.tg_block_sale_order_item_with_active_return()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_item_id uuid := COALESCE(NEW.id, OLD.id);
  v_relevant_change boolean := TG_OP = 'DELETE';
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_relevant_change := NEW.sale_order_id IS DISTINCT FROM OLD.sale_order_id
      OR NEW.reference_id IS DISTINCT FROM OLD.reference_id
      OR NEW.product_id IS DISTINCT FROM OLD.product_id
      OR NEW.material_variant_id IS DISTINCT FROM OLD.material_variant_id
      OR NEW.material_variant_commercial_snapshot IS DISTINCT FROM OLD.material_variant_commercial_snapshot
      OR NEW.color IS DISTINCT FROM OLD.color
      OR NEW.grade IS DISTINCT FROM OLD.grade
      OR NEW.quantity IS DISTINCT FROM OLD.quantity
      OR NEW.unit_price IS DISTINCT FROM OLD.unit_price;
  END IF;
  IF v_relevant_change AND EXISTS (
    SELECT 1 FROM public.nfe_devolucao_item_claims c
     WHERE c.sale_order_item_id = v_item_id
       AND c.status IN ('claimed', 'reconciliation_required', 'applied')
  ) THEN
    RAISE EXCEPTION
      'Item possui devolução fiscal em andamento/reconciliação; conclua-a antes de editar ou remover'
      USING ERRCODE = 'PZ230';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_sale_order_item_with_active_return
  ON public.sale_order_items;
CREATE TRIGGER trg_block_sale_order_item_with_active_return
BEFORE UPDATE OR DELETE ON public.sale_order_items
FOR EACH ROW EXECUTE FUNCTION public.tg_block_sale_order_item_with_active_return();

REVOKE ALL ON FUNCTION public.tg_block_sale_order_item_with_active_return()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_block_original_nfe_with_active_return()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF (TG_OP = 'DELETE' OR NEW.status IS DISTINCT FROM OLD.status)
     AND EXISTS (
       SELECT 1
         FROM public.nfe_devolucoes d
         JOIN public.nfe_devolucao_item_claims c ON c.nfe_devolucao_id = d.id
        WHERE d.nfe_original_id = OLD.id
          AND c.status IN ('claimed', 'reconciliation_required', 'applied')
     ) THEN
    RAISE EXCEPTION
      'NF-e possui devolução em andamento/reconciliação; cancelamento ou remoção bloqueado'
      USING ERRCODE = 'PZ230';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_original_nfe_with_active_return
  ON public.nfe_emitidas;
CREATE TRIGGER trg_block_original_nfe_with_active_return
BEFORE UPDATE OF status OR DELETE ON public.nfe_emitidas
FOR EACH ROW EXECUTE FUNCTION public.tg_block_original_nfe_with_active_return();

REVOKE ALL ON FUNCTION public.tg_block_original_nfe_with_active_return()
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Begin: valida o snapshot e reclama a quantidade antes do provedor
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.begin_nfe_devolucao_command(
  p_request_id uuid,
  p_nfe_original_id uuid,
  p_items jsonb,
  p_motivo text,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_core jsonb;
  v_request_hash text;
  v_existing public.nfe_devolucoes%ROWTYPE;
  v_nfe public.nfe_emitidas%ROWTYPE;
  v_sale_order public.sale_orders%ROWTYPE;
  v_item public.sale_order_items%ROWTYPE;
  v_request record;
  v_devolucao_id uuid;
  v_grade_total numeric;
  v_item_effective_grade jsonb;
  v_active_quantity numeric;
  v_size record;
  v_used_size numeric;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Função interna: service_role obrigatório'
      USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_nfe_original_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'request_id, nfe_original_id e actor_id são obrigatórios'
      USING ERRCODE = '22004';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.user_roles ur
      JOIN public.profiles profile ON profile.id = ur.user_id
     WHERE ur.user_id = p_actor_id
       AND profile.approved IS TRUE
       AND ur.role IN ('admin', 'gerente', 'nfe_operator')
  ) THEN
    RAISE EXCEPTION 'Ator não aprovado ou sem permissão para NF-e de devolução'
      USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_motivo, ''))) < 15 THEN
    RAISE EXCEPTION 'Motivo deve ter ao menos 15 caracteres'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_items, 'null'::jsonb)) <> 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos um item da devolução'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    SELECT jsonb_agg(jsonb_build_object(
             'sale_order_item_id', (e.value ->> 'sale_order_item_id')::uuid,
             'qty', (e.value ->> 'qty')::numeric,
             'grade', COALESCE(e.value -> 'grade', '{}'::jsonb)
           ) ORDER BY (e.value ->> 'sale_order_item_id')::uuid)
      INTO v_core
      FROM jsonb_array_elements(p_items) e;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Payload de itens da devolução inválido'
      USING ERRCODE = '22023';
  END;
  IF jsonb_array_length(v_core) <> (
    SELECT count(DISTINCT (e.value ->> 'sale_order_item_id')::uuid)
      FROM jsonb_array_elements(v_core) e
  ) THEN
    RAISE EXCEPTION 'Item repetido na devolução' USING ERRCODE = '22023';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'nfe_original_id', p_nfe_original_id,
    'items', v_core,
    'motivo', btrim(p_motivo)
  )::text);

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'nfe-devolucao-request:' || p_request_id::text, 0
  ));

  SELECT * INTO v_existing
    FROM public.nfe_devolucoes d
   WHERE d.idempotency_key = p_request_id
   FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'Replay divergente para a mesma idempotency_key'
        USING ERRCODE = 'PZ231';
    END IF;
    RETURN jsonb_build_object(
      'ok', v_existing.effects_applied_at IS NOT NULL,
      'idempotent_replay', true,
      'devolucao_id', v_existing.id,
      'status', v_existing.status,
      'provider_submission_state', v_existing.provider_submission_state,
      'provider_nfe_id', v_existing.provider_nfe_id,
      'effects_applied', v_existing.effects_applied_at IS NOT NULL,
      'completed', v_existing.provider_submission_state = 'completed',
      'rejected', v_existing.provider_submission_state = 'rejected',
      'error', CASE WHEN v_existing.provider_submission_state = 'rejected'
        THEN COALESCE(v_existing.motivo_rejeicao, 'Devolução rejeitada')
        ELSE NULL END,
      'reconciliation_required',
        v_existing.provider_submission_state = 'reconciliation_required',
      'reconciliation_reason', v_existing.reconciliation_reason
    );
  END IF;

  SELECT * INTO v_nfe
    FROM public.nfe_emitidas ne
   WHERE ne.id = p_nfe_original_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NF-e original não encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_nfe.sale_order_id IS NULL THEN
    RAISE EXCEPTION 'NF-e original sem PV vinculado' USING ERRCODE = 'PZ230';
  END IF;

  -- Ordem fiscal compartilhada com cancelamento/expedição: todas as NFs do PV
  -- antes do PV e dos itens.
  PERFORM ne.id FROM public.nfe_emitidas ne
   WHERE ne.sale_order_id = v_nfe.sale_order_id
   ORDER BY ne.id FOR UPDATE;
  SELECT * INTO v_nfe FROM public.nfe_emitidas ne
   WHERE ne.id = p_nfe_original_id FOR UPDATE;
  IF lower(btrim(COALESCE(v_nfe.status, ''))) <> 'autorizada'
     OR length(COALESCE(v_nfe.chave_acesso, '')) <> 44 THEN
    RAISE EXCEPTION 'Somente NF-e original autorizada e com chave pode ser devolvida'
      USING ERRCODE = 'PZ230';
  END IF;

  SELECT * INTO v_sale_order
    FROM public.sale_orders so
   WHERE so.id = v_nfe.sale_order_id
     AND so.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND OR v_sale_order.status <> 'Faturado' THEN
    RAISE EXCEPTION 'PV da NF-e precisa estar Faturado para receber devolução'
      USING ERRCODE = 'PZ230';
  END IF;

  INSERT INTO public.nfe_devolucoes(
    nfe_original_id, sale_order_id, status, ref_nfe, valor_total, itens,
    motivo, cnpj_emitente, company_id, created_by, idempotency_key,
    request_hash, provider_submission_state
  ) VALUES (
    p_nfe_original_id, v_nfe.sale_order_id, 'processando',
    'nfe-dev-' || p_request_id::text,
    0, p_items, btrim(p_motivo), v_nfe.cnpj_emitente,
    v_nfe.company_id, p_actor_id, p_request_id,
    v_request_hash, 'not_started'
  ) RETURNING id INTO v_devolucao_id;

  FOR v_request IN
    SELECT e.value AS payload,
           (e.value ->> 'sale_order_item_id')::uuid AS item_id,
           (e.value ->> 'qty')::numeric AS qty,
           COALESCE(e.value -> 'grade', '{}'::jsonb) AS grade
      FROM jsonb_array_elements(p_items) e
     ORDER BY (e.value ->> 'sale_order_item_id')::uuid
  LOOP
    SELECT * INTO v_item FROM public.sale_order_items soi
     WHERE soi.id = v_request.item_id FOR UPDATE;
    IF NOT FOUND OR v_item.sale_order_id <> v_nfe.sale_order_id THEN
      RAISE EXCEPTION 'Item % não pertence ao PV da NF-e', v_request.item_id
        USING ERRCODE = 'PZ230';
    END IF;
    IF v_request.qty::text IN ('NaN', 'Infinity', '-Infinity')
       OR v_request.qty <= 0 OR v_request.qty <> trunc(v_request.qty) THEN
      RAISE EXCEPTION 'Quantidade inválida no item %', v_request.item_id
        USING ERRCODE = '22023';
    END IF;
    v_grade_total := public.nfe_devolucao_grade_total(v_request.grade);
    IF v_grade_total IS NULL OR v_grade_total <> v_request.qty THEN
      RAISE EXCEPTION 'Grade devolvida do item % deve ser inteira e somar %',
        v_request.item_id, v_request.qty USING ERRCODE = 'PZ230';
    END IF;
    v_item_effective_grade := public.resolve_effective_op_grade(
      v_item.grade, v_item.quantity
    );
    IF public.nfe_devolucao_grade_total(v_item_effective_grade) IS NULL
       OR public.nfe_devolucao_grade_total(v_item_effective_grade) <> v_item.quantity THEN
      RAISE EXCEPTION 'Grade original do item % está inconsistente', v_request.item_id
        USING ERRCODE = 'PZ230';
    END IF;

    -- O payload Edge precisa representar exatamente a linha que acabou de ser
    -- travada. Isso fecha a janela leitura->begin sem confiar no cliente.
    IF NULLIF(v_request.payload ->> 'reference_id', '')::uuid
         IS DISTINCT FROM v_item.reference_id
       OR NULLIF(v_request.payload ->> 'product_id', '')::uuid
         IS DISTINCT FROM v_item.product_id
       OR NULLIF(v_request.payload ->> 'material_variant_id', '')::uuid
         IS DISTINCT FROM v_item.material_variant_id
       OR COALESCE(v_request.payload ->> 'stock_color', '')
         IS DISTINCT FROM COALESCE(v_item.color, '')
       OR (v_request.payload ->> 'valor_unit')::numeric
         IS DISTINCT FROM v_item.unit_price THEN
      RAISE EXCEPTION 'Snapshot do item % mudou antes do begin; refaça a devolução',
        v_request.item_id USING ERRCODE = '40001';
    END IF;

    SELECT COALESCE(sum(c.quantity), 0) INTO v_active_quantity
      FROM public.nfe_devolucao_item_claims c
     WHERE c.sale_order_item_id = v_item.id
       AND c.status IN ('claimed', 'reconciliation_required');
    IF COALESCE(v_item.qty_devolvida, 0) + v_active_quantity + v_request.qty
       > v_item.quantity THEN
      RAISE EXCEPTION 'Saldo de devolução excedido no item %', v_item.id
        USING ERRCODE = 'PZ232';
    END IF;

    FOR v_size IN
      SELECT e.key AS size_key, (e.value #>> '{}')::numeric AS qty
        FROM jsonb_each(v_request.grade) e
       WHERE left(e.key, 1) <> '_' AND (e.value #>> '{}')::numeric > 0
       ORDER BY e.key
    LOOP
      SELECT COALESCE(sum((c.grade ->> v_size.size_key)::numeric), 0)
        INTO v_used_size
        FROM public.nfe_devolucao_item_claims c
       WHERE c.sale_order_item_id = v_item.id
         AND c.status <> 'released'
         AND c.grade ? v_size.size_key;
      IF v_used_size + v_size.qty
         > COALESCE((v_item_effective_grade ->> v_size.size_key)::numeric, 0) THEN
        RAISE EXCEPTION 'Saldo da numeração % excedido no item %',
          v_size.size_key, v_item.id USING ERRCODE = 'PZ232';
      END IF;
    END LOOP;

    INSERT INTO public.nfe_devolucao_item_claims(
      nfe_devolucao_id, sale_order_item_id, quantity, grade,
      reference_id, product_id, material_variant_id, color, unit_price
    ) VALUES (
      v_devolucao_id, v_item.id, v_request.qty, v_request.grade,
      v_item.reference_id, v_item.product_id, v_item.material_variant_id,
      COALESCE(v_item.color, ''), v_item.unit_price
    );
  END LOOP;

  UPDATE public.nfe_devolucoes d
     SET valor_total = x.total,
         updated_at = now()
    FROM (
      SELECT round(sum(c.quantity * c.unit_price), 2) AS total
        FROM public.nfe_devolucao_item_claims c
       WHERE c.nfe_devolucao_id = v_devolucao_id
    ) x
   WHERE d.id = v_devolucao_id;

  RETURN jsonb_build_object(
    'ok', true, 'idempotent_replay', false,
    'devolucao_id', v_devolucao_id,
    'status', 'processando',
    'provider_submission_state', 'not_started',
    'effects_applied', false,
    'reconciliation_required', false
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) Claim e registro do provedor: nenhum retry refaz o POST de criação
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_nfe_devolucao_provider_submission(
  p_request_id uuid,
  p_provider_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_return public.nfe_devolucoes%ROWTYPE;
  v_payload_hash text;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Função interna: service_role obrigatório'
      USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR jsonb_typeof(COALESCE(p_provider_payload, 'null'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'request_id e payload fiscal são obrigatórios'
      USING ERRCODE = '22023';
  END IF;
  v_payload_hash := md5(p_provider_payload::text);
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'nfe-devolucao-request:' || p_request_id::text, 0
  ));
  SELECT * INTO v_return FROM public.nfe_devolucoes d
   WHERE d.idempotency_key = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Begin da devolução não encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF v_return.effects_applied_at IS NOT NULL
     OR v_return.provider_submission_state = 'completed' THEN
    RETURN jsonb_build_object(
      'ok', true, 'provider_call_required', false,
      'idempotent_replay', true, 'completed', true,
      'devolucao_id', v_return.id,
      'provider_nfe_id', v_return.provider_nfe_id,
      'provider_request_payload', v_return.provider_request_payload
    );
  END IF;
  IF v_return.provider_submission_state = 'rejected' THEN
    RETURN jsonb_build_object(
      'ok', false, 'provider_call_required', false,
      'idempotent_replay', true, 'rejected', true,
      'devolucao_id', v_return.id,
      'error', COALESCE(v_return.motivo_rejeicao, 'Devolução rejeitada')
    );
  END IF;
  IF v_return.provider_submission_state = 'reconciliation_required'
     AND v_return.provider_status IS DISTINCT FROM 'autorizada' THEN
    RETURN jsonb_build_object(
      'ok', false, 'provider_call_required', false,
      'reconciliation_required', true,
      'devolucao_id', v_return.id,
      'provider_nfe_id', v_return.provider_nfe_id,
      'reconciliation_reason', v_return.reconciliation_reason,
      'provider_request_payload', v_return.provider_request_payload
    );
  END IF;

  IF v_return.provider_request_hash IS NOT NULL
     AND v_return.provider_request_hash IS DISTINCT FROM v_payload_hash THEN
    RAISE EXCEPTION 'Payload fiscal mudou no replay da devolução'
      USING ERRCODE = 'PZ231';
  END IF;

  IF v_return.provider_submission_state = 'not_started' THEN
    UPDATE public.nfe_devolucoes
       SET provider_submission_state = 'inflight',
           provider_submission_started_at = now(),
           provider_request_hash = v_payload_hash,
           provider_request_payload = p_provider_payload,
           reconciliation_reason = NULL,
           updated_at = now()
     WHERE id = v_return.id;
    RETURN jsonb_build_object(
      'ok', true, 'provider_call_required', true,
      'idempotent_replay', false, 'completed', false,
      'devolucao_id', v_return.id,
      'provider_request_payload', p_provider_payload
    );
  END IF;

  IF v_return.provider_submission_state = 'inflight'
     AND NULLIF(btrim(COALESCE(v_return.provider_nfe_id, '')), '') IS NULL THEN
    -- O POST pode ter chegado ao provedor e a resposta ter se perdido. Nunca
    -- repetimos uma criação externa ambígua.
    UPDATE public.nfe_devolucoes
       SET provider_submission_state = 'reconciliation_required',
           reconciliation_reason = COALESCE(
             reconciliation_reason,
             'POST de criação ficou sem resposta persistida; localizar a NF no provedor antes de continuar.'
           ),
           updated_at = now()
     WHERE id = v_return.id;
    UPDATE public.nfe_devolucao_item_claims
       SET status = 'reconciliation_required', updated_at = now()
     WHERE nfe_devolucao_id = v_return.id AND status = 'claimed';
    RETURN jsonb_build_object(
      'ok', false, 'provider_call_required', false,
      'reconciliation_required', true,
      'devolucao_id', v_return.id,
      'reconciliation_reason',
        'POST de criação ficou sem resposta persistida; localizar a NF no provedor antes de continuar.'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'provider_call_required', false,
    'idempotent_replay', true, 'completed', false,
    'devolucao_id', v_return.id,
    'provider_nfe_id', v_return.provider_nfe_id,
    'provider_request_payload', v_return.provider_request_payload
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_nfe_devolucao_provider_creation(
  p_request_id uuid,
  p_provider_nfe_id text,
  p_provider_response jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_return public.nfe_devolucoes%ROWTYPE;
  v_provider_id text := btrim(COALESCE(p_provider_nfe_id, ''));
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Função interna: service_role obrigatório'
      USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR v_provider_id = '' THEN
    RAISE EXCEPTION 'request_id e provider_nfe_id são obrigatórios'
      USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'nfe-devolucao-request:' || p_request_id::text, 0
  ));
  SELECT * INTO v_return FROM public.nfe_devolucoes d
   WHERE d.idempotency_key = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolução não encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_return.provider_nfe_id IS NOT NULL
     AND v_return.provider_nfe_id IS DISTINCT FROM v_provider_id THEN
    RAISE EXCEPTION 'Provider retornou dois IDs para a mesma devolução'
      USING ERRCODE = 'PZ231';
  END IF;
  IF v_return.provider_submission_state NOT IN (
    'inflight', 'recorded', 'reconciliation_required'
  ) THEN
    RAISE EXCEPTION 'Estado % não aceita registro da criação',
      v_return.provider_submission_state USING ERRCODE = 'PZ230';
  END IF;
  UPDATE public.nfe_devolucoes
     SET provider_nfe_id = v_provider_id,
         provider_submission_state = 'recorded',
         provider_response = COALESCE(provider_response, '{}'::jsonb)
           || jsonb_build_object('create', COALESCE(p_provider_response, '{}'::jsonb)),
         provider_result_recorded_at = now(),
         reconciliation_reason = NULL,
         updated_at = now()
   WHERE id = v_return.id;
  RETURN jsonb_build_object(
    'ok', true, 'idempotent_replay', v_return.provider_nfe_id IS NOT NULL,
    'devolucao_id', v_return.id, 'provider_nfe_id', v_provider_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_nfe_devolucao_reconciliation_required(
  p_request_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_return public.nfe_devolucoes%ROWTYPE;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Função interna: service_role obrigatório'
      USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'Motivo de reconciliação deve ter ao menos 10 caracteres'
      USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'nfe-devolucao-request:' || p_request_id::text, 0
  ));
  SELECT * INTO v_return FROM public.nfe_devolucoes d
   WHERE d.idempotency_key = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Devolução não encontrada' USING ERRCODE = 'P0002'; END IF;
  IF v_return.effects_applied_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'idempotent_replay', true, 'completed', true);
  END IF;
  UPDATE public.nfe_devolucoes
     SET provider_submission_state = 'reconciliation_required',
         reconciliation_reason = left(btrim(p_reason), 1000),
         updated_at = now()
   WHERE id = v_return.id;
  UPDATE public.nfe_devolucao_item_claims
     SET status = 'reconciliation_required', updated_at = now()
   WHERE nfe_devolucao_id = v_return.id AND status = 'claimed';
  RETURN jsonb_build_object(
    'ok', false, 'reconciliation_required', true,
    'devolucao_id', v_return.id,
    'reconciliation_reason', left(btrim(p_reason), 1000)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_nfe_devolucao_provider_result(
  p_request_id uuid,
  p_provider_nfe_id text,
  p_provider_status text,
  p_chave_acesso text DEFAULT NULL,
  p_protocolo text DEFAULT NULL,
  p_numero text DEFAULT NULL,
  p_serie text DEFAULT NULL,
  p_data_emissao timestamptz DEFAULT NULL,
  p_error text DEFAULT NULL,
  p_provider_response jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_return public.nfe_devolucoes%ROWTYPE;
  v_status text := lower(btrim(COALESCE(p_provider_status, '')));
  v_local_status text;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Função interna: service_role obrigatório'
      USING ERRCODE = '42501';
  END IF;
  IF v_status NOT IN ('autorizada', 'processando', 'rejeitada') THEN
    RAISE EXCEPTION 'Status do provedor inválido: %', p_provider_status
      USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'nfe-devolucao-request:' || p_request_id::text, 0
  ));
  SELECT * INTO v_return FROM public.nfe_devolucoes d
   WHERE d.idempotency_key = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Devolução não encontrada' USING ERRCODE = 'P0002'; END IF;
  IF v_return.effects_applied_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true, 'idempotent_replay', true, 'completed', true,
      'devolucao_id', v_return.id, 'status', v_return.status
    );
  END IF;
  IF NULLIF(btrim(COALESCE(v_return.provider_nfe_id, '')), '') IS NULL
     OR v_return.provider_nfe_id IS DISTINCT FROM btrim(COALESCE(p_provider_nfe_id, '')) THEN
    RAISE EXCEPTION 'Resultado não corresponde ao ID de provedor reclamado'
      USING ERRCODE = 'PZ231';
  END IF;
  IF v_return.provider_submission_state = 'reconciliation_required'
     AND v_return.provider_status IS DISTINCT FROM 'autorizada' THEN
    RETURN jsonb_build_object(
      'ok', false, 'reconciliation_required', true,
      'devolucao_id', v_return.id,
      'reconciliation_reason', v_return.reconciliation_reason
    );
  END IF;

  v_local_status := CASE WHEN v_status = 'rejeitada' THEN 'rejeitada' ELSE 'processando' END;
  UPDATE public.nfe_devolucoes
     SET status = v_local_status,
         provider_status = v_status,
         chave_acesso = NULLIF(btrim(COALESCE(p_chave_acesso, '')), ''),
         protocolo = NULLIF(btrim(COALESCE(p_protocolo, '')), ''),
         numero = NULLIF(btrim(COALESCE(p_numero, '')), ''),
         serie = NULLIF(btrim(COALESCE(p_serie, '')), ''),
         data_emissao = p_data_emissao,
         motivo_rejeicao = CASE WHEN v_status = 'rejeitada'
           THEN left(COALESCE(NULLIF(btrim(p_error), ''), 'Rejeitada pelo provedor'), 1000)
           ELSE NULL END,
         provider_submission_state = CASE WHEN v_status = 'rejeitada'
           THEN 'rejected' ELSE 'recorded' END,
         provider_response = COALESCE(provider_response, '{}'::jsonb)
           || jsonb_build_object('result', COALESCE(p_provider_response, '{}'::jsonb)),
         provider_result_recorded_at = now(),
         updated_at = now()
   WHERE id = v_return.id;

  IF v_status = 'rejeitada' THEN
    UPDATE public.nfe_devolucao_item_claims
       SET status = 'released', released_at = now(), updated_at = now()
     WHERE nfe_devolucao_id = v_return.id
       AND status IN ('claimed', 'reconciliation_required');
  END IF;
  RETURN jsonb_build_object(
    'ok', v_status <> 'rejeitada',
    'devolucao_id', v_return.id,
    'provider_status', v_status,
    'ready_to_complete', v_status = 'autorizada',
    'rejected', v_status = 'rejeitada'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.abort_nfe_devolucao_before_provider(
  p_request_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_return public.nfe_devolucoes%ROWTYPE;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Função interna: service_role obrigatório'
      USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'Motivo de rejeição inválido' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'nfe-devolucao-request:' || p_request_id::text, 0
  ));
  SELECT * INTO v_return FROM public.nfe_devolucoes d
   WHERE d.idempotency_key = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Devolução não encontrada' USING ERRCODE = 'P0002'; END IF;
  IF v_return.provider_nfe_id IS NOT NULL
     OR v_return.provider_submission_state NOT IN ('not_started', 'inflight') THEN
    RAISE EXCEPTION 'Abort só aceita falha anterior à criação de uma NF no provedor'
      USING ERRCODE = 'PZ230';
  END IF;
  UPDATE public.nfe_devolucoes
     SET status = 'rejeitada', provider_status = 'rejeitada',
         provider_submission_state = 'rejected',
         motivo_rejeicao = left(btrim(p_reason), 1000), updated_at = now()
   WHERE id = v_return.id;
  UPDATE public.nfe_devolucao_item_claims
     SET status = 'released', released_at = now(), updated_at = now()
   WHERE nfe_devolucao_id = v_return.id AND status = 'claimed';
  RETURN jsonb_build_object(
    'ok', false, 'rejected', true, 'terminal_rejected', true,
    'devolucao_id', v_return.id,
    'error', left(btrim(p_reason), 1000)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) Commit local único depois da autorização externa
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.complete_nfe_devolucao_command(
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_return public.nfe_devolucoes%ROWTYPE;
  v_nfe public.nfe_emitidas%ROWTYPE;
  v_sale_order public.sale_orders%ROWTYPE;
  v_claim record;
  v_item public.sale_order_items%ROWTYPE;
  v_item_effective_grade jsonb;
  v_size record;
  v_product_ids uuid[];
  v_product public.products%ROWTYPE;
  v_new_grade jsonb;
  v_ready_id uuid;
  v_ready_new integer;
  v_ready_previous integer;
  v_ar record;
  v_total_outstanding numeric := 0;
  v_credit_total numeric := 0;
  v_credit_remaining numeric := 0;
  v_reduction numeric;
  v_outstanding numeric;
  v_ar_remaining integer := 0;
  v_new_amount numeric;
  v_new_status text;
  v_error text;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Função interna: service_role obrigatório'
      USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id é obrigatório' USING ERRCODE = '22004';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'nfe-devolucao-request:' || p_request_id::text, 0
  ));
  -- Primeiro lock de negócio: todos os comandos que cruzam PV/estoque usam a
  -- mesma época antes de NF, PV, item e produto.
  PERFORM public.lock_sale_order_purchase_allocation();

  SELECT * INTO v_return FROM public.nfe_devolucoes d
   WHERE d.idempotency_key = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Devolução não encontrada' USING ERRCODE = 'P0002'; END IF;
  IF v_return.effects_applied_at IS NOT NULL
     AND v_return.provider_submission_state = 'completed' THEN
    RETURN jsonb_build_object(
      'ok', true, 'idempotent_replay', true, 'completed', true,
      'devolucao_id', v_return.id, 'status', v_return.status,
      'provider_nfe_id', v_return.provider_nfe_id,
      'chave_acesso', v_return.chave_acesso,
      'numero', v_return.numero
    );
  END IF;
  IF v_return.provider_submission_state = 'reconciliation_required'
     AND v_return.provider_status IS DISTINCT FROM 'autorizada' THEN
    RETURN jsonb_build_object(
      'ok', false, 'reconciliation_required', true,
      'devolucao_id', v_return.id,
      'reconciliation_reason', v_return.reconciliation_reason
    );
  END IF;
  IF v_return.provider_status <> 'autorizada'
     OR v_return.provider_submission_state NOT IN ('recorded', 'reconciliation_required') THEN
    RAISE EXCEPTION 'Provedor ainda não confirmou autorização da devolução'
      USING ERRCODE = 'PZ230';
  END IF;

  BEGIN
    IF length(COALESCE(v_return.chave_acesso, '')) <> 44 THEN
      RAISE EXCEPTION 'Provedor autorizou sem chave de acesso válida';
    END IF;

    SELECT * INTO v_nfe FROM public.nfe_emitidas ne
     WHERE ne.id = v_return.nfe_original_id;
    IF NOT FOUND OR v_nfe.sale_order_id IS NULL THEN
      RAISE EXCEPTION 'NF-e original/PV deixou de existir';
    END IF;
    PERFORM ne.id FROM public.nfe_emitidas ne
     WHERE ne.sale_order_id = v_nfe.sale_order_id
     ORDER BY ne.id FOR UPDATE;
    SELECT * INTO v_nfe FROM public.nfe_emitidas ne
     WHERE ne.id = v_return.nfe_original_id FOR UPDATE;
    IF lower(btrim(COALESCE(v_nfe.status, ''))) <> 'autorizada' THEN
      RAISE EXCEPTION 'NF-e original não está mais autorizada';
    END IF;

    SELECT * INTO v_sale_order FROM public.sale_orders so
     WHERE so.id = v_return.sale_order_id
       AND so.deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND OR v_sale_order.status <> 'Faturado' THEN
      RAISE EXCEPTION 'PV deixou de estar Faturado';
    END IF;

    PERFORM c.id
      FROM public.nfe_devolucao_item_claims c
     WHERE c.nfe_devolucao_id = v_return.id
       AND c.status IN ('claimed', 'reconciliation_required')
     ORDER BY c.sale_order_item_id
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Devolução não possui claims ativos para concluir'; END IF;

    SELECT COALESCE(array_agg(DISTINCT c.product_id ORDER BY c.product_id), ARRAY[]::uuid[])
      INTO v_product_ids
      FROM public.nfe_devolucao_item_claims c
     WHERE c.nfe_devolucao_id = v_return.id
       AND c.product_id IS NOT NULL;
    PERFORM public.lock_sale_order_purchase_products(v_product_ids);

    -- Valida todo o snapshot antes do primeiro efeito.
    FOR v_claim IN
      SELECT c.* FROM public.nfe_devolucao_item_claims c
       WHERE c.nfe_devolucao_id = v_return.id
         AND c.status IN ('claimed', 'reconciliation_required')
       ORDER BY c.sale_order_item_id
    LOOP
      SELECT * INTO v_item FROM public.sale_order_items soi
       WHERE soi.id = v_claim.sale_order_item_id FOR UPDATE;
      IF NOT FOUND
         OR v_item.sale_order_id <> v_return.sale_order_id
         OR v_item.reference_id IS DISTINCT FROM v_claim.reference_id
         OR v_item.product_id IS DISTINCT FROM v_claim.product_id
         OR v_item.material_variant_id IS DISTINCT FROM v_claim.material_variant_id
         OR COALESCE(v_item.color, '') IS DISTINCT FROM v_claim.color
         OR v_item.unit_price IS DISTINCT FROM v_claim.unit_price
         OR COALESCE(v_item.qty_devolvida, 0) + v_claim.quantity > v_item.quantity THEN
        RAISE EXCEPTION 'Snapshot/saldo mudou no item %', v_claim.sale_order_item_id;
      END IF;
      v_item_effective_grade := public.resolve_effective_op_grade(
        v_item.grade, v_item.quantity
      );
      IF public.nfe_devolucao_grade_total(v_item_effective_grade)
           IS DISTINCT FROM v_item.quantity::numeric THEN
        RAISE EXCEPTION 'Grade efetiva deixou de fechar o item %', v_item.id;
      END IF;
      FOR v_size IN
        SELECT e.key AS size_key, (e.value #>> '{}')::numeric AS qty
          FROM jsonb_each(v_claim.grade) e
         WHERE left(e.key, 1) <> '_' AND (e.value #>> '{}')::numeric > 0
      LOOP
        IF v_size.qty > COALESCE((v_item_effective_grade ->> v_size.size_key)::numeric, 0) THEN
          RAISE EXCEPTION 'Numeração % excede a grade original do item %',
            v_size.size_key, v_item.id;
        END IF;
      END LOOP;
    END LOOP;

    -- Produto direto pertence à NF avulsa; pronta-entrega pertence ao PV
    -- normal. Ambos preservam a grade exata informada pelo operador.
    FOR v_claim IN
      SELECT c.* FROM public.nfe_devolucao_item_claims c
       WHERE c.nfe_devolucao_id = v_return.id
         AND c.status IN ('claimed', 'reconciliation_required')
         AND c.product_id IS NOT NULL
       ORDER BY c.product_id, c.sale_order_item_id
    LOOP
      SELECT * INTO v_product FROM public.products p
       WHERE p.id = v_claim.product_id FOR UPDATE;
      IF NOT FOUND OR NOT COALESCE(v_product.active, false) THEN
        RAISE EXCEPTION 'Produto direto % ausente/inativo', v_claim.product_id;
      END IF;
      v_new_grade := public.standalone_nfe_apply_grade_delta(
        COALESCE(v_product.stock_grade, '{}'::jsonb), v_claim.grade, 1
      );
      UPDATE public.products
         SET quantity = COALESCE(v_product.quantity, 0) + v_claim.quantity,
             stock_grade = v_new_grade,
             updated_at = now()
       WHERE id = v_product.id;
      INSERT INTO public.stock_movements(
        product_id, movement_type, quantity, previous_stock, new_stock,
        previous_grade, new_grade, description, movement_reason,
        correlation_id, user_id, nfe_devolucao_item_claim_id
      ) VALUES (
        v_product.id, 'in', v_claim.quantity,
        COALESCE(v_product.quantity, 0), COALESCE(v_product.quantity, 0) + v_claim.quantity,
        COALESCE(v_product.stock_grade, '{}'::jsonb), v_new_grade,
        format('Entrada por NF-e de devolução %s', v_return.id), 'devolucao',
        md5('nfe-devolucao:' || v_claim.id::text)::uuid,
        v_return.created_by, v_claim.id
      ) ON CONFLICT DO NOTHING;
    END LOOP;

    FOR v_size IN
      SELECT c.id AS claim_id, c.reference_id, c.material_variant_id,
             c.color, e.key AS size_key, (e.value #>> '{}')::integer AS qty
        FROM public.nfe_devolucao_item_claims c
        CROSS JOIN LATERAL jsonb_each(c.grade) e
       WHERE c.nfe_devolucao_id = v_return.id
         AND c.status IN ('claimed', 'reconciliation_required')
         AND c.product_id IS NULL
         AND c.reference_id IS NOT NULL
         AND left(e.key, 1) <> '_'
         AND (e.value #>> '{}')::numeric > 0
       ORDER BY c.reference_id, c.material_variant_id NULLS FIRST,
                c.color, e.key, c.id
    LOOP
      INSERT INTO public.ready_stock(
        reference_id, material_variant_id, color, size, quantity,
        location, notes
      ) VALUES (
        v_size.reference_id, v_size.material_variant_id, v_size.color,
        v_size.size_key, v_size.qty, 'Devoluções',
        format('Entrada por NF-e de devolução %s', v_return.id)
      )
      ON CONFLICT (reference_id, material_variant_id, color, size) DO UPDATE
        SET quantity = public.ready_stock.quantity + EXCLUDED.quantity,
            updated_at = now(),
            notes = EXCLUDED.notes
      RETURNING id, quantity INTO v_ready_id, v_ready_new;
      v_ready_previous := v_ready_new - v_size.qty;
      INSERT INTO public.nfe_devolucao_ready_stock_effects(
        claim_id, ready_stock_id, size, quantity,
        previous_quantity, new_quantity
      ) VALUES (
        v_size.claim_id, v_ready_id, v_size.size_key, v_size.qty,
        v_ready_previous, v_ready_new
      );
    END LOOP;

    FOR v_claim IN
      SELECT c.* FROM public.nfe_devolucao_item_claims c
       WHERE c.nfe_devolucao_id = v_return.id
         AND c.status IN ('claimed', 'reconciliation_required')
       ORDER BY c.sale_order_item_id
    LOOP
      UPDATE public.sale_order_items
         SET qty_devolvida = COALESCE(qty_devolvida, 0) + v_claim.quantity
       WHERE id = v_claim.sale_order_item_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Item desapareceu durante o commit'; END IF;
    END LOOP;

    -- Contas a receber: reduz somente o saldo ainda não recebido e nunca viola
    -- amount_received <= amount. O estorno contábil abaixo cobre o valor total.
    PERFORM ar.id FROM public.accounts_receivable ar
     WHERE ar.sale_order_id = v_return.sale_order_id
     ORDER BY ar.due_date, ar.id FOR UPDATE;
    SELECT COALESCE(sum(GREATEST(ar.amount - COALESCE(ar.amount_received, 0), 0)), 0),
           count(*) FILTER (
             WHERE GREATEST(ar.amount - COALESCE(ar.amount_received, 0), 0) > 0
           )::integer
      INTO v_total_outstanding, v_ar_remaining
      FROM public.accounts_receivable ar
     WHERE ar.sale_order_id = v_return.sale_order_id
       AND ar.status NOT IN ('received', 'cancelled', 'cancelado');
    v_credit_total := LEAST(COALESCE(v_return.valor_total, 0), v_total_outstanding);
    v_credit_remaining := v_credit_total;

    FOR v_ar IN
      SELECT ar.* FROM public.accounts_receivable ar
       WHERE ar.sale_order_id = v_return.sale_order_id
         AND ar.status NOT IN ('received', 'cancelled', 'cancelado')
         AND GREATEST(ar.amount - COALESCE(ar.amount_received, 0), 0) > 0
       ORDER BY ar.due_date, ar.id
    LOOP
      v_outstanding := GREATEST(v_ar.amount - COALESCE(v_ar.amount_received, 0), 0);
      v_ar_remaining := v_ar_remaining - 1;
      IF v_ar_remaining = 0 THEN
        v_reduction := LEAST(v_outstanding, v_credit_remaining);
      ELSE
        v_reduction := LEAST(
          v_outstanding,
          round(v_credit_total * v_outstanding / NULLIF(v_total_outstanding, 0), 2),
          v_credit_remaining
        );
      END IF;
      CONTINUE WHEN v_reduction <= 0;
      v_new_amount := v_ar.amount - v_reduction;
      v_new_status := CASE
        WHEN v_new_amount <= COALESCE(v_ar.amount_received, 0) + 0.01
          THEN CASE WHEN COALESCE(v_ar.amount_received, 0) > 0
            THEN 'received' ELSE 'cancelled' END
        ELSE v_ar.status
      END;
      INSERT INTO public.nfe_devolucao_ar_effects(
        nfe_devolucao_id, accounts_receivable_id, reduction,
        previous_amount, new_amount, previous_status, new_status
      ) VALUES (
        v_return.id, v_ar.id, v_reduction,
        v_ar.amount, v_new_amount, v_ar.status, v_new_status
      );
      UPDATE public.accounts_receivable
         SET amount = v_new_amount,
             status = v_new_status,
             notes = concat_ws(E'\n', NULLIF(notes, ''),
               format('Redução de R$ %s pela NF-e de devolução %s',
                      to_char(v_reduction, 'FM999999990.00'), v_return.id)),
             updated_at = now()
       WHERE id = v_ar.id;
      v_credit_remaining := v_credit_remaining - v_reduction;
    END LOOP;

    IF EXISTS (
      SELECT 1 FROM public.financial_entries fe
       WHERE fe.reference_type = 'sale_order'
         AND fe.reference_id = v_return.sale_order_id::text
         AND fe.status IN ('confirmed', 'posted', 'reconciled', 'paid')
    ) THEN
      INSERT INTO public.financial_entries(
        type, category, amount, status, description,
        reference_id, reference_type, entry_date, created_by
      ) VALUES (
        'receita', 'venda', -COALESCE(v_return.valor_total, 0), 'confirmed',
        format('Estorno por NF-e de devolução %s do PV %s',
               v_return.id, v_return.sale_order_id),
        v_return.id::text, 'sale_order_devolucao', CURRENT_DATE,
        v_return.created_by
      ) ON CONFLICT DO NOTHING;
    END IF;

    UPDATE public.nfe_devolucao_item_claims
       SET status = 'applied', applied_at = now(), updated_at = now()
     WHERE nfe_devolucao_id = v_return.id
       AND status IN ('claimed', 'reconciliation_required');
    UPDATE public.nfe_devolucoes
       SET status = 'autorizada',
           provider_submission_state = 'completed',
           effects_applied_at = now(), completed_at = now(),
           reconciliation_reason = NULL, motivo_rejeicao = NULL,
           updated_at = now()
     WHERE id = v_return.id;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    UPDATE public.nfe_devolucoes
       SET provider_submission_state = 'reconciliation_required',
           reconciliation_reason = left(
             'Provedor autorizou, mas o commit local foi revertido: ' || v_error,
             1000
           ),
           updated_at = now()
     WHERE id = v_return.id;
    UPDATE public.nfe_devolucao_item_claims
       SET status = 'reconciliation_required', updated_at = now()
     WHERE nfe_devolucao_id = v_return.id
       AND status = 'claimed';
    RETURN jsonb_build_object(
      'ok', false, 'reconciliation_required', true,
      'devolucao_id', v_return.id,
      'reconciliation_reason',
        left('Provedor autorizou, mas o commit local foi revertido: ' || v_error, 1000)
    );
  END;

  RETURN jsonb_build_object(
    'ok', true, 'idempotent_replay', false, 'completed', true,
    'devolucao_id', v_return.id, 'status', 'autorizada',
    'provider_nfe_id', v_return.provider_nfe_id,
    'chave_acesso', v_return.chave_acesso,
    'numero', v_return.numero
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 6) Leitura canônica para a UI, ACL e diagnósticos
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_nfe_devolucao_available_items(
  p_nfe_original_id uuid,
  p_request_id uuid DEFAULT NULL
)
RETURNS TABLE(
  item_id uuid,
  reference_id uuid,
  product_id uuid,
  material_variant_id uuid,
  color text,
  quantity integer,
  unit_price numeric,
  qty_devolvida numeric,
  original_grade jsonb,
  available_grade jsonb,
  available_quantity numeric,
  technical_code text,
  technical_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_sale_order_id uuid;
BEGIN
  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'nfe_operator']) THEN
    RAISE EXCEPTION 'Sem permissão para consultar devolução de NF-e'
      USING ERRCODE = '42501';
  END IF;
  SELECT ne.sale_order_id INTO v_sale_order_id
    FROM public.nfe_emitidas ne
   WHERE ne.id = p_nfe_original_id
     AND lower(btrim(COALESCE(ne.status, ''))) = 'autorizada';
  IF NOT FOUND OR v_sale_order_id IS NULL THEN
    RAISE EXCEPTION 'NF-e original autorizada não encontrada'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  WITH used AS (
    SELECT c.sale_order_item_id, e.key AS size_key,
           sum((e.value #>> '{}')::numeric) AS qty
      FROM public.nfe_devolucao_item_claims c
      CROSS JOIN LATERAL jsonb_each(c.grade) e
     WHERE c.status <> 'released'
       AND NOT EXISTS (
         SELECT 1 FROM public.nfe_devolucoes own_return
          WHERE own_return.id = c.nfe_devolucao_id
            AND own_return.idempotency_key = p_request_id
       )
       AND left(e.key, 1) <> '_'
     GROUP BY c.sale_order_item_id, e.key
  ), canonical AS (
    SELECT soi.id, soi.reference_id, soi.product_id, soi.material_variant_id,
           COALESCE(soi.color, '') AS color, soi.quantity, soi.unit_price,
           COALESCE(soi.qty_devolvida, 0) AS qty_devolvida,
           COALESCE(
             public.resolve_effective_op_grade(soi.grade, soi.quantity),
             '{}'::jsonb
           ) AS original_grade,
           ts.code, ts.name
      FROM public.sale_order_items soi
      LEFT JOIN public.technical_sheets ts ON ts.id = soi.reference_id
     WHERE soi.sale_order_id = v_sale_order_id
  ), remaining AS (
    SELECT c.*,
           COALESCE(jsonb_object_agg(
             g.key,
             to_jsonb(GREATEST((g.value #>> '{}')::numeric - COALESCE(u.qty, 0), 0))
             ORDER BY g.key
           ) FILTER (WHERE left(g.key, 1) <> '_'), '{}'::jsonb) AS remaining_grade
      FROM canonical c
      LEFT JOIN LATERAL jsonb_each(c.original_grade) g ON true
      LEFT JOIN used u ON u.sale_order_item_id = c.id AND u.size_key = g.key
     GROUP BY c.id, c.reference_id, c.product_id, c.material_variant_id,
              c.color, c.quantity, c.unit_price, c.qty_devolvida,
              c.original_grade, c.code, c.name
  )
  SELECT r.id, r.reference_id, r.product_id, r.material_variant_id,
         r.color, r.quantity, r.unit_price, r.qty_devolvida,
         r.original_grade, r.remaining_grade,
         COALESCE(public.nfe_devolucao_grade_total(r.remaining_grade), 0),
         r.code, r.name
    FROM remaining r
   ORDER BY r.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.nfe_devolucao_command_diagnostics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'nfe_operator']) THEN
    RAISE EXCEPTION 'Sem permissão para diagnóstico de devolução'
      USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'ok', count(*) FILTER (
      WHERE d.provider_submission_state = 'reconciliation_required'
         OR (d.provider_submission_state = 'inflight'
             AND d.provider_submission_started_at < now() - interval '10 minutes')
         OR (d.provider_submission_state = 'not_started'
             AND d.created_at < now() - interval '10 minutes')
         OR (d.provider_status = 'autorizada' AND d.effects_applied_at IS NULL)
    ) = 0,
    'reconciliation_required', count(*) FILTER (
      WHERE d.provider_submission_state = 'reconciliation_required'
    ),
    'stale_inflight', count(*) FILTER (
      WHERE d.provider_submission_state = 'inflight'
        AND d.provider_submission_started_at < now() - interval '10 minutes'
    ),
    'stale_not_started', count(*) FILTER (
      WHERE d.provider_submission_state = 'not_started'
        AND d.created_at < now() - interval '10 minutes'
    ),
    'authorized_without_effects', count(*) FILTER (
      WHERE d.provider_status = 'autorizada' AND d.effects_applied_at IS NULL
    ),
    'completed', count(*) FILTER (
      WHERE d.provider_submission_state = 'completed'
    ),
    'checked_at', now()
  ) INTO v_result
  FROM public.nfe_devolucoes d;
  RETURN v_result;
END;
$$;

-- Incremento legado e writes diretos deixam de ser canais operacionais.
REVOKE ALL ON FUNCTION public.increment_qty_devolvida(uuid, numeric)
  FROM PUBLIC, anon, authenticated, service_role;

DO $acl$
DECLARE
  v_signature text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'begin_nfe_devolucao_command(uuid,uuid,jsonb,text,uuid)',
    'claim_nfe_devolucao_provider_submission(uuid,jsonb)',
    'record_nfe_devolucao_provider_creation(uuid,text,jsonb)',
    'mark_nfe_devolucao_reconciliation_required(uuid,text)',
    'record_nfe_devolucao_provider_result(uuid,text,text,text,text,text,text,timestamptz,text,jsonb)',
    'abort_nfe_devolucao_before_provider(uuid,text)',
    'complete_nfe_devolucao_command(uuid)'
  ]
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role',
      v_signature
    );
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', v_signature);
  END LOOP;
END;
$acl$;

REVOKE ALL ON FUNCTION public.get_nfe_devolucao_available_items(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_nfe_devolucao_available_items(uuid, uuid)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.nfe_devolucao_command_diagnostics()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nfe_devolucao_command_diagnostics()
  TO authenticated, service_role;

COMMENT ON FUNCTION public.begin_nfe_devolucao_command(uuid, uuid, jsonb, text, uuid) IS
  'Reclama saldo/grade e congela o intent da devolução antes de qualquer POST fiscal.';
COMMENT ON FUNCTION public.complete_nfe_devolucao_command(uuid) IS
  'Commit atômico e idempotente de estoque por grade, qty_devolvida, AR e financeiro após autorização do provedor.';

-- ---------------------------------------------------------------------------
-- 7) Contratos executáveis de segurança/ordem
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.run_nfe_devolucao_command_contract_tests()
RETURNS TABLE(case_name text, ok boolean, message text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_begin text;
  v_claim text;
  v_complete text;
BEGIN
  SELECT pg_get_functiondef(
    'public.begin_nfe_devolucao_command(uuid,uuid,jsonb,text,uuid)'::regprocedure
  ) INTO v_begin;
  SELECT pg_get_functiondef(
    'public.claim_nfe_devolucao_provider_submission(uuid,jsonb)'::regprocedure
  ) INTO v_claim;
  SELECT pg_get_functiondef(
    'public.complete_nfe_devolucao_command(uuid)'::regprocedure
  ) INTO v_complete;

  case_name := 'grade_is_exact_and_integer';
  ok := public.nfe_devolucao_grade_total('{"34":2,"35":3}'::jsonb) = 5
    AND public.nfe_devolucao_grade_total('{"34":1.5}'::jsonb) IS NULL
    AND public.nfe_devolucao_grade_total('{"34":-1}'::jsonb) IS NULL;
  message := 'Grade devolvida é inteira, positiva e soma exatamente a quantidade.';
  RETURN NEXT;

  case_name := 'base_grade_is_scaled_to_sale_order_quantity';
  ok := public.nfe_devolucao_grade_total(
    public.resolve_effective_op_grade('{"34":1,"35":2}'::jsonb, 30)
  ) = 30
    AND public.resolve_effective_op_grade(
      '{"34":1,"35":2}'::jsonb, 30
    ) = '{"34":10,"35":20}'::jsonb;
  message := 'Curva-base do PV é expandida para a grade física antes de saldo/devolução.';
  RETURN NEXT;

  case_name := 'provider_post_claim_is_durable';
  ok := position('provider_submission_state = ''inflight''' IN v_claim) > 0
    AND position('POST de criação ficou sem resposta persistida' IN v_claim) > 0
    AND position('provider_call_required'', true' IN v_claim) > 0;
  message := 'Somente not_started autoriza POST; resposta ambígua falha fechada.';
  RETURN NEXT;

  case_name := 'completion_lock_order';
  ok := position('lock_sale_order_purchase_allocation()' IN v_complete) > 0
    AND position('lock_sale_order_purchase_allocation()' IN v_complete)
      < position('FROM public.nfe_emitidas ne' IN v_complete)
    AND position('FROM public.nfe_emitidas ne' IN v_complete)
      < position('FROM public.sale_orders so' IN v_complete)
    AND position('FROM public.sale_orders so' IN v_complete)
      < position('lock_sale_order_purchase_products' IN v_complete);
  message := 'Commit segue época -> NF -> PV/itens -> produtos.';
  RETURN NEXT;

  case_name := 'all_effects_in_single_completion';
  ok := position('public.ready_stock' IN v_complete) > 0
    AND position('public.stock_movements' IN v_complete) > 0
    AND position('qty_devolvida' IN v_complete) > 0
    AND position('public.accounts_receivable' IN v_complete) > 0
    AND position('public.financial_entries' IN v_complete) > 0
    AND position('effects_applied_at = now()' IN v_complete) > 0;
  message := 'Estoque, ledger, item, AR, financeiro e conclusão pertencem ao mesmo commit.';
  RETURN NEXT;

  case_name := 'no_authenticated_mutation_bypass';
  ok := NOT has_table_privilege('authenticated', 'public.nfe_devolucoes', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.nfe_devolucoes', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.nfe_devolucoes', 'DELETE')
    AND NOT has_function_privilege(
      'authenticated', 'public.increment_qty_devolvida(uuid,numeric)', 'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated',
      'public.complete_nfe_devolucao_command(uuid)', 'EXECUTE'
    )
    AND EXISTS (
      SELECT 1
        FROM pg_catalog.pg_policy policy
       WHERE policy.polrelid = 'public.nfe_devolucoes'::regclass
         AND policy.polname = 'nfe_devolucoes_select_roles'
         AND pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
           LIKE '%is_approved_user%'
    );
  message := 'App lê devoluções, mas só a Edge service-role executa seus efeitos.';
  RETURN NEXT;

  case_name := 'approved_actor_and_fiscal_role_required';
  ok := position('JOIN public.profiles profile ON profile.id = ur.user_id' IN v_begin) > 0
    AND position('profile.approved IS TRUE' IN v_begin) > 0
    AND position('nfe_operator' IN v_begin) > 0;
  message := 'A Edge não pode usar um papel antigo para operar após o perfil ser reprovado.';
  RETURN NEXT;

  case_name := 'snapshot_claim_precedes_provider';
  ok := position('nfe_devolucao_item_claims' IN v_begin) > 0
    AND position('record_nfe_devolucao_provider_creation' IN v_begin) = 0
    AND position('complete_nfe_devolucao_command' IN v_begin) = 0;
  message := 'Begin reclama saldo/grade sem qualquer chamada ou mutação do provedor.';
  RETURN NEXT;

  case_name := 'applied_return_keeps_fiscal_history_immutable';
  ok := position(
    '''claimed'', ''reconciliation_required'', ''applied'''
    IN pg_get_functiondef(
      'public.tg_block_original_nfe_with_active_return()'::regprocedure
    )
  ) > 0
    AND position(
      '''claimed'', ''reconciliation_required'', ''applied'''
      IN pg_get_functiondef(
        'public.tg_block_sale_order_item_with_active_return()'::regprocedure
      )
    ) > 0;
  message := 'NF original e snapshot comercial continuam imutáveis depois da devolução aplicada.';
  RETURN NEXT;

  case_name := 'pre_provider_failure_can_release_claim';
  ok := position(
    'NOT IN (''not_started'', ''inflight'')'
    IN pg_get_functiondef(
      'public.abort_nfe_devolucao_before_provider(uuid,text)'::regprocedure
    )
  ) > 0;
  message := 'Falha local anterior ao POST fiscal libera grade/quantidade sem deixar claim órfã.';
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.run_nfe_devolucao_command_contract_tests()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_nfe_devolucao_command_contract_tests()
  TO service_role;

COMMIT;
