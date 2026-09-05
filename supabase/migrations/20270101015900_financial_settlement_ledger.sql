-- =============================================================================
-- Ledger imutavel de liquidacoes financeiras (AP / AR)
-- =============================================================================
-- Decisoes preservadas:
--   * esta migration NAO decide quando AP/AR nasce;
--   * esta migration NAO altera bank_accounts.current_balance;
--   * esta migration NAO cria pagamento, recebimento ou backfill historico;
--   * acumulados legados sao capturados somente na primeira liquidacao explicita,
--     como saldo de abertura (nao como evento de caixa inventado);
--   * baixa e estorno passam por um unico command boundary atomico e idempotente.

DO $preflight_159$
BEGIN
  IF pg_catalog.to_regnamespace('private') IS NULL THEN
    RAISE EXCEPTION 'Preflight 15900: schema private ausente';
  END IF;
  IF pg_catalog.to_regclass('public.accounts_payable') IS NULL
     OR pg_catalog.to_regclass('public.accounts_receivable') IS NULL
     OR pg_catalog.to_regclass('public.bank_accounts') IS NULL THEN
    RAISE EXCEPTION 'Preflight 15900: AP, AR ou contas bancarias ausentes';
  END IF;
  IF pg_catalog.to_regprocedure('public.user_has_any_role(text[])') IS NULL
     OR pg_catalog.to_regprocedure('public.strap_payload_hash(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Preflight 15900: helpers canonicos de ACL/hash ausentes';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.mark_contractor_payment_cycle_paid(uuid,date,text,uuid)'
     ) IS NULL THEN
    RAISE EXCEPTION 'Preflight 15900: writer de ciclo terceirizado ausente';
  END IF;
END;
$preflight_159$;

CREATE TABLE public.financial_settlement_command_receipts (
  command_id uuid PRIMARY KEY,
  command text NOT NULL,
  payload_hash text NOT NULL,
  actor_id uuid,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT financial_settlement_receipts_command_ck
    CHECK (command IN ('register', 'reverse')),
  CONSTRAINT financial_settlement_receipts_hash_ck
    CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT financial_settlement_receipts_result_ck
    CHECK (pg_catalog.jsonb_typeof(result) = 'object')
);

CREATE TABLE public.financial_settlement_account_heads (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  account_kind text NOT NULL,
  payable_id uuid REFERENCES public.accounts_payable(id) ON DELETE RESTRICT,
  receivable_id uuid REFERENCES public.accounts_receivable(id) ON DELETE RESTRICT,
  opening_amount numeric NOT NULL,
  opening_payment_date date,
  opening_payment_method text,
  opening_category text NOT NULL,
  opening_status text NOT NULL,
  opening_cmv_sale_order_id uuid
    REFERENCES public.sale_orders(id) ON DELETE RESTRICT,
  opening_cmv_amount numeric,
  opening_cmv_date date,
  opening_cmv_total_snapshot numeric,
  opening_receivable_gross_snapshot numeric,
  captured_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  captured_by uuid,
  CONSTRAINT financial_settlement_heads_kind_ck
    CHECK (account_kind IN ('payable', 'receivable')),
  CONSTRAINT financial_settlement_heads_target_ck CHECK (
    (account_kind = 'payable' AND payable_id IS NOT NULL AND receivable_id IS NULL)
    OR
    (account_kind = 'receivable' AND receivable_id IS NOT NULL AND payable_id IS NULL)
  ),
  CONSTRAINT financial_settlement_heads_opening_ck CHECK (
    opening_amount >= 0
    AND opening_amount::text NOT IN ('NaN', 'Infinity', '-Infinity')
  ),
  CONSTRAINT financial_settlement_heads_cmv_ck CHECK (
    (
      account_kind = 'payable'
      AND opening_cmv_sale_order_id IS NULL
      AND opening_cmv_amount IS NULL
      AND opening_cmv_date IS NULL
      AND opening_cmv_total_snapshot IS NULL
      AND opening_receivable_gross_snapshot IS NULL
    )
    OR
    (
      account_kind = 'receivable'
      AND (
        opening_cmv_amount IS NULL
        OR (
          opening_cmv_sale_order_id IS NOT NULL
          AND opening_cmv_amount >= 0
          AND opening_cmv_amount::text NOT IN ('NaN', 'Infinity', '-Infinity')
        )
      )
      AND (opening_cmv_total_snapshot IS NULL OR (
        opening_cmv_total_snapshot > 0
        AND opening_cmv_total_snapshot::text
          NOT IN ('NaN', 'Infinity', '-Infinity')
      ))
      AND (opening_receivable_gross_snapshot IS NULL OR (
        opening_receivable_gross_snapshot > 0
        AND opening_receivable_gross_snapshot::text
          NOT IN ('NaN', 'Infinity', '-Infinity')
      ))
    )
  ),
  CONSTRAINT financial_settlement_heads_payable_uq UNIQUE (payable_id),
  CONSTRAINT financial_settlement_heads_receivable_uq UNIQUE (receivable_id)
);

CREATE TABLE public.financial_settlement_events (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  command_id uuid NOT NULL,
  batch_position integer NOT NULL,
  event_type text NOT NULL,
  account_kind text NOT NULL,
  payable_id uuid REFERENCES public.accounts_payable(id) ON DELETE RESTRICT,
  receivable_id uuid REFERENCES public.accounts_receivable(id) ON DELETE RESTRICT,
  amount numeric NOT NULL,
  effective_on date NOT NULL,
  method text NOT NULL,
  bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  category text NOT NULL,
  reference text,
  notes text,
  source_type text NOT NULL,
  source_reference text,
  source_line_key text,
  reverses_event_id uuid REFERENCES public.financial_settlement_events(id) ON DELETE RESTRICT,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT financial_settlement_events_receipt_fk
    FOREIGN KEY (command_id)
    REFERENCES public.financial_settlement_command_receipts(command_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT financial_settlement_events_command_position_uq
    UNIQUE (command_id, batch_position),
  CONSTRAINT financial_settlement_events_kind_ck
    CHECK (account_kind IN ('payable', 'receivable')),
  CONSTRAINT financial_settlement_events_target_ck CHECK (
    (account_kind = 'payable' AND payable_id IS NOT NULL AND receivable_id IS NULL)
    OR
    (account_kind = 'receivable' AND receivable_id IS NOT NULL AND payable_id IS NULL)
  ),
  CONSTRAINT financial_settlement_events_type_ck
    CHECK (event_type IN ('settlement', 'reversal')),
  CONSTRAINT financial_settlement_events_reversal_ck CHECK (
    (event_type = 'settlement' AND reverses_event_id IS NULL)
    OR
    (event_type = 'reversal' AND reverses_event_id IS NOT NULL)
  ),
  CONSTRAINT financial_settlement_events_amount_ck CHECK (
    amount > 0
    AND amount::text NOT IN ('NaN', 'Infinity', '-Infinity')
    AND amount = pg_catalog.round(amount, 2)
  ),
  CONSTRAINT financial_settlement_events_date_ck CHECK (
    effective_on::text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  ),
  CONSTRAINT financial_settlement_events_method_ck CHECK (
    method IN ('pix', 'transferencia', 'boleto', 'dinheiro', 'cheque', 'cartao', 'outro')
  ),
  CONSTRAINT financial_settlement_events_reference_ck
    CHECK (reference IS NULL OR pg_catalog.length(reference) <= 500),
  CONSTRAINT financial_settlement_events_notes_ck
    CHECK (notes IS NULL OR pg_catalog.length(notes) <= 4000),
  CONSTRAINT financial_settlement_events_source_ck CHECK (
    source_type IN ('manual', 'ofx', 'factoring', 'contractor_cycle', 'system')
  )
);

CREATE UNIQUE INDEX financial_settlement_events_one_reversal_uq
  ON public.financial_settlement_events (reverses_event_id)
  WHERE reverses_event_id IS NOT NULL;

CREATE UNIQUE INDEX financial_settlement_events_external_source_uq
  ON public.financial_settlement_events (
    source_type, source_reference, source_line_key
  )
  WHERE event_type = 'settlement'
    AND source_type <> 'manual'
    AND source_reference IS NOT NULL
    AND source_line_key IS NOT NULL;

CREATE INDEX financial_settlement_events_payable_idx
  ON public.financial_settlement_events (payable_id, effective_on, created_at)
  WHERE payable_id IS NOT NULL;

CREATE INDEX financial_settlement_events_receivable_idx
  ON public.financial_settlement_events (receivable_id, effective_on, created_at)
  WHERE receivable_id IS NOT NULL;

CREATE INDEX financial_settlement_events_bank_idx
  ON public.financial_settlement_events (bank_account_id, effective_on)
  WHERE bank_account_id IS NOT NULL;

-- CMV em caixa ganha granularidade por evento. O legado continua na tabela
-- sale_order_cmv_recognized; nunca fabricamos data para saldo de abertura.
ALTER TABLE public.sale_order_cmv_recognized
  ALTER COLUMN recognized_date DROP NOT NULL;

CREATE TABLE public.financial_settlement_cmv_events (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  settlement_event_id uuid NOT NULL
    REFERENCES public.financial_settlement_events(id) ON DELETE RESTRICT,
  receivable_id uuid NOT NULL
    REFERENCES public.accounts_receivable(id) ON DELETE RESTRICT,
  sale_order_id uuid NOT NULL
    REFERENCES public.sale_orders(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  recognized_amount numeric NOT NULL,
  recognized_on date NOT NULL,
  cmv_total_snapshot numeric NOT NULL,
  receivable_gross_snapshot numeric NOT NULL,
  reverses_cmv_event_id uuid
    REFERENCES public.financial_settlement_cmv_events(id) ON DELETE RESTRICT,
  quality_issue text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT financial_settlement_cmv_events_type_ck
    CHECK (event_type IN ('settlement', 'reversal', 'rounding_adjustment')),
  CONSTRAINT financial_settlement_cmv_events_amount_ck CHECK (
    recognized_amount::text NOT IN ('NaN', 'Infinity', '-Infinity')
    AND recognized_amount = pg_catalog.round(recognized_amount, 2)
  ),
  CONSTRAINT financial_settlement_cmv_events_direction_ck CHECK (
    (event_type = 'settlement' AND recognized_amount >= 0 AND reverses_cmv_event_id IS NULL)
    OR
    (event_type = 'reversal' AND recognized_amount <= 0 AND reverses_cmv_event_id IS NOT NULL)
    OR
    (event_type = 'rounding_adjustment' AND reverses_cmv_event_id IS NULL)
  ),
  CONSTRAINT financial_settlement_cmv_events_snapshots_ck CHECK (
    cmv_total_snapshot > 0
    AND receivable_gross_snapshot > 0
    AND cmv_total_snapshot::text NOT IN ('NaN', 'Infinity', '-Infinity')
    AND receivable_gross_snapshot::text NOT IN ('NaN', 'Infinity', '-Infinity')
  ),
  CONSTRAINT financial_settlement_cmv_events_quality_ck
    CHECK (quality_issue IS NULL OR pg_catalog.length(quality_issue) <= 500),
  CONSTRAINT financial_settlement_cmv_events_date_ck CHECK (
    recognized_on::text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  )
);

CREATE UNIQUE INDEX financial_settlement_cmv_events_one_reversal_uq
  ON public.financial_settlement_cmv_events (reverses_cmv_event_id)
  WHERE reverses_cmv_event_id IS NOT NULL;

CREATE UNIQUE INDEX financial_settlement_cmv_events_event_type_uq
  ON public.financial_settlement_cmv_events (settlement_event_id, event_type);

CREATE INDEX financial_settlement_cmv_events_timeline_idx
  ON public.financial_settlement_cmv_events (recognized_on, sale_order_id);

COMMENT ON TABLE public.financial_settlement_account_heads IS
  'Snapshot do acumulado legado capturado somente na primeira liquidacao explicita. Nao e evento de caixa nem backfill.';
COMMENT ON TABLE public.financial_settlement_events IS
  'Ledger imutavel de baixas e estornos de AP/AR. amount e positivo; reversal referencia exatamente o settlement original.';
COMMENT ON COLUMN public.financial_settlement_events.source_type IS
  'Origem confiavel derivada pelo servidor. A RPC publica aceita somente manual; OFX/factoring/ciclos chamam o core privado.';
COMMENT ON TABLE public.financial_settlement_cmv_events IS
  'Reconhecimento de CMV por evento de recebimento/estorno, preservando a data de cada efeito de caixa.';

CREATE OR REPLACE FUNCTION private.tg_financial_settlement_immutable_159()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION '% e imutavel; use execute_financial_settlement', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$function$;

CREATE TRIGGER trg_financial_settlement_receipts_immutable
  BEFORE UPDATE OR DELETE ON public.financial_settlement_command_receipts
  FOR EACH ROW EXECUTE FUNCTION private.tg_financial_settlement_immutable_159();
CREATE TRIGGER trg_financial_settlement_heads_immutable
  BEFORE UPDATE OR DELETE ON public.financial_settlement_account_heads
  FOR EACH ROW EXECUTE FUNCTION private.tg_financial_settlement_immutable_159();
CREATE TRIGGER trg_financial_settlement_events_immutable
  BEFORE UPDATE OR DELETE ON public.financial_settlement_events
  FOR EACH ROW EXECUTE FUNCTION private.tg_financial_settlement_immutable_159();
CREATE TRIGGER trg_financial_settlement_cmv_immutable
  BEFORE UPDATE OR DELETE ON public.financial_settlement_cmv_events
  FOR EACH ROW EXECUTE FUNCTION private.tg_financial_settlement_immutable_159();

CREATE OR REPLACE FUNCTION private.normalize_financial_settlement_method_159(
  p_method text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE pg_catalog.lower(pg_catalog.btrim(COALESCE(p_method, '')))
    WHEN 'pix' THEN 'pix'
    WHEN 'transferencia' THEN 'transferencia'
    WHEN 'transferência' THEN 'transferencia'
    WHEN 'transfer' THEN 'transferencia'
    WHEN 'boleto' THEN 'boleto'
    WHEN 'dinheiro' THEN 'dinheiro'
    WHEN 'cash' THEN 'dinheiro'
    WHEN 'cheque' THEN 'cheque'
    WHEN 'cartao' THEN 'cartao'
    WHEN 'cartão' THEN 'cartao'
    WHEN 'card' THEN 'cartao'
    WHEN 'outro' THEN 'outro'
    WHEN 'other' THEN 'outro'
    ELSE NULL
  END
$function$;

CREATE OR REPLACE FUNCTION private.financial_cash_status_159(
  p_kind text,
  p_status text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN p_kind = 'payable' THEN
      pg_catalog.lower(COALESCE(p_status, '')) IN
        ('paid', 'pago', 'partial', 'parcial')
    WHEN p_kind = 'receivable' THEN
      pg_catalog.lower(COALESCE(p_status, '')) IN
        ('received', 'recebido', 'partial', 'parcial')
    ELSE false
  END
$function$;

CREATE OR REPLACE FUNCTION private.ensure_financial_settlement_head_159(
  p_kind text,
  p_account_id uuid,
  p_actor_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_head_id uuid;
BEGIN
  IF p_kind = 'payable' THEN
    SELECT head.id
      INTO v_head_id
      FROM public.financial_settlement_account_heads head
     WHERE head.payable_id = p_account_id;
    IF v_head_id IS NULL THEN
      INSERT INTO public.financial_settlement_account_heads (
        account_kind, payable_id, opening_amount, opening_payment_date,
        opening_payment_method, opening_category, opening_status,
        opening_cmv_sale_order_id, opening_cmv_amount, opening_cmv_date,
        opening_cmv_total_snapshot, opening_receivable_gross_snapshot,
        captured_by
      )
      SELECT
        'payable', payable.id, COALESCE(payable.amount_paid, 0),
        payable.payment_date, payable.payment_method, payable.category,
        payable.status, NULL, NULL, NULL, NULL, NULL, p_actor_id
      FROM public.accounts_payable payable
      WHERE payable.id = p_account_id
      RETURNING id INTO v_head_id;
    END IF;
  ELSIF p_kind = 'receivable' THEN
    SELECT head.id
      INTO v_head_id
      FROM public.financial_settlement_account_heads head
     WHERE head.receivable_id = p_account_id;
    IF v_head_id IS NULL THEN
      INSERT INTO public.financial_settlement_account_heads (
        account_kind, receivable_id, opening_amount, opening_payment_date,
        opening_payment_method, opening_category, opening_status,
        opening_cmv_sale_order_id, opening_cmv_amount, opening_cmv_date,
        opening_cmv_total_snapshot, opening_receivable_gross_snapshot,
        captured_by
      )
      SELECT
        'receivable', receivable.id, COALESCE(receivable.amount_received, 0),
        receivable.payment_date, receivable.payment_method, receivable.category,
        receivable.status, receivable.sale_order_id,
        legacy.recognized_amount, legacy.recognized_date,
        CASE WHEN legacy.id IS NOT NULL THEN NULLIF((
          SELECT COALESCE(pg_catalog.sum(entry.amount), 0)
            FROM public.financial_entries entry
           WHERE entry.reference_type = 'sale_order_cmv'
             AND entry.reference_id = receivable.sale_order_id::text
             AND entry.status NOT IN ('cancelado', 'cancelled', 'estornado')
        ), 0) END,
        CASE WHEN legacy.id IS NOT NULL THEN NULLIF((
          SELECT COALESCE(pg_catalog.sum(gross.amount), 0)
            FROM public.accounts_receivable gross
           WHERE gross.sale_order_id = receivable.sale_order_id
             AND gross.status NOT IN ('cancelled', 'cancelado')
        ), 0) END,
        p_actor_id
      FROM public.accounts_receivable receivable
      LEFT JOIN public.sale_order_cmv_recognized legacy
        ON legacy.receivable_id = receivable.id
       AND legacy.sale_order_id = receivable.sale_order_id
      WHERE receivable.id = p_account_id
      RETURNING id INTO v_head_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'Tipo de titulo invalido: %', p_kind
      USING ERRCODE = '22023';
  END IF;
  IF v_head_id IS NULL THEN
    RAISE EXCEPTION 'Titulo % % nao encontrado', p_kind, p_account_id
      USING ERRCODE = 'P0002';
  END IF;
  RETURN v_head_id;
END;
$function$;

CREATE OR REPLACE FUNCTION private.financial_settled_amount_159(
  p_kind text,
  p_account_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    COALESCE((
      SELECT head.opening_amount
        FROM public.financial_settlement_account_heads head
       WHERE (p_kind = 'payable' AND head.payable_id = p_account_id)
          OR (p_kind = 'receivable' AND head.receivable_id = p_account_id)
    ), 0)
    + COALESCE((
      SELECT pg_catalog.sum(
        CASE event.event_type
          WHEN 'settlement' THEN event.amount
          ELSE -event.amount
        END
      )
      FROM public.financial_settlement_events event
      WHERE (p_kind = 'payable' AND event.payable_id = p_account_id)
         OR (p_kind = 'receivable' AND event.receivable_id = p_account_id)
    ), 0)
$function$;

CREATE OR REPLACE FUNCTION private.financial_account_projection_159(
  p_kind text,
  p_account_id uuid
)
RETURNS TABLE (
  settled_amount numeric,
  projected_status text,
  projected_payment_date date,
  projected_payment_method text,
  opening_amount numeric,
  opening_payment_date date,
  opening_status text,
  has_head boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_total numeric;
  v_current_status text;
  v_head public.financial_settlement_account_heads%ROWTYPE;
  v_latest public.financial_settlement_events%ROWTYPE;
BEGIN
  IF p_kind = 'payable' THEN
    SELECT payable.amount, payable.status
      INTO v_total, v_current_status
      FROM public.accounts_payable payable
     WHERE payable.id = p_account_id;
    SELECT head.* INTO v_head
      FROM public.financial_settlement_account_heads head
     WHERE head.payable_id = p_account_id;
  ELSIF p_kind = 'receivable' THEN
    SELECT receivable.amount, receivable.status
      INTO v_total, v_current_status
      FROM public.accounts_receivable receivable
     WHERE receivable.id = p_account_id;
    SELECT head.* INTO v_head
      FROM public.financial_settlement_account_heads head
     WHERE head.receivable_id = p_account_id;
  ELSE
    RAISE EXCEPTION 'Tipo de titulo invalido: %', p_kind
      USING ERRCODE = '22023';
  END IF;
  IF v_total IS NULL THEN
    RAISE EXCEPTION 'Titulo % % nao encontrado', p_kind, p_account_id
      USING ERRCODE = 'P0002';
  END IF;

  has_head := v_head.id IS NOT NULL;
  opening_amount := COALESCE(v_head.opening_amount, 0);
  opening_payment_date := v_head.opening_payment_date;
  opening_status := COALESCE(v_head.opening_status, v_current_status);
  settled_amount := private.financial_settled_amount_159(p_kind, p_account_id);

  SELECT settlement.*
    INTO v_latest
    FROM public.financial_settlement_events settlement
   WHERE settlement.event_type = 'settlement'
     AND ((p_kind = 'payable' AND settlement.payable_id = p_account_id)
       OR (p_kind = 'receivable' AND settlement.receivable_id = p_account_id))
     AND NOT EXISTS (
       SELECT 1
         FROM public.financial_settlement_events reversal
        WHERE reversal.reverses_event_id = settlement.id
     )
   ORDER BY settlement.effective_on DESC, settlement.created_at DESC,
            settlement.id DESC
   LIMIT 1;

  IF v_latest.id IS NOT NULL
     AND (v_head.opening_payment_date IS NULL
       OR v_latest.effective_on >= v_head.opening_payment_date) THEN
    projected_payment_date := v_latest.effective_on;
    projected_payment_method := v_latest.method;
  ELSE
    projected_payment_date := v_head.opening_payment_date;
    projected_payment_method := v_head.opening_payment_method;
  END IF;

  IF settled_amount > 0 AND settled_amount >= v_total THEN
    projected_status := CASE p_kind
      WHEN 'payable' THEN 'paid'
      ELSE 'received'
    END;
  ELSIF settled_amount > 0 THEN
    projected_status := 'parcial';
  ELSE
    projected_status := COALESCE(v_head.opening_status, v_current_status);
    IF private.financial_cash_status_159(p_kind, projected_status) THEN
      projected_status := 'pending';
    END IF;
    projected_payment_date := NULL;
    projected_payment_method := COALESCE(v_head.opening_payment_method, '');
  END IF;
  RETURN NEXT;
END;
$function$;

-- A protecao compara a projecao solicitada ao ledger. Nao usa GUC (que seria
-- forjavel pelo cliente) nem session_user. Mesmo um writer legado SECURITY
-- DEFINER nao consegue inventar caixa sem antes criar um evento valido.
CREATE OR REPLACE FUNCTION private.tg_assert_financial_account_projection_159()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_kind text := CASE TG_TABLE_NAME
    WHEN 'accounts_payable' THEN 'payable'
    ELSE 'receivable'
  END;
  v_account_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  v_projection record;
  v_has_events boolean;
  v_new_settled numeric;
  v_new_status text;
  v_new_date date;
  v_new_method text;
  v_new_total numeric;
  v_old_settled numeric;
  v_old_status text;
  v_old_date date;
  v_old_method text;
  v_expected_status text;
  v_old_row jsonb;
  v_new_row jsonb;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old_row := pg_catalog.to_jsonb(OLD);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_row := pg_catalog.to_jsonb(NEW);
  END IF;
  SELECT EXISTS (
    SELECT 1
      FROM public.financial_settlement_events event
     WHERE (v_kind = 'payable' AND event.payable_id = v_account_id)
        OR (v_kind = 'receivable' AND event.receivable_id = v_account_id)
  ) INTO v_has_events;

  IF TG_OP = 'DELETE' THEN
    v_old_settled := COALESCE((v_old_row ->> CASE v_kind
      WHEN 'payable' THEN 'amount_paid' ELSE 'amount_received' END)::numeric, 0);
    IF v_old_settled > 0 OR OLD.payment_date IS NOT NULL
       OR v_has_events OR EXISTS (
      SELECT 1
        FROM public.financial_settlement_account_heads head
       WHERE (v_kind = 'payable' AND head.payable_id = v_account_id)
          OR (v_kind = 'receivable' AND head.receivable_id = v_account_id)
    ) THEN
      RAISE EXCEPTION
        'Titulo com historico de liquidacao nao pode ser excluido; preserve a auditoria'
        USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  v_new_settled := COALESCE((v_new_row ->> CASE v_kind
    WHEN 'payable' THEN 'amount_paid' ELSE 'amount_received' END)::numeric, 0);
  v_new_status := NEW.status;
  v_new_date := NEW.payment_date;
  v_new_method := NEW.payment_method;
  v_new_total := NEW.amount;

  IF TG_OP = 'INSERT' THEN
    IF v_new_settled <> 0
       OR v_new_date IS NOT NULL
       OR private.financial_cash_status_159(v_kind, v_new_status) THEN
      RAISE EXCEPTION
        'Baixa financeira exige execute_financial_settlement'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO v_projection
    FROM private.financial_account_projection_159(v_kind, v_account_id);

  IF v_kind = 'receivable' THEN
    IF (v_new_row ->> 'sale_order_id')
         IS DISTINCT FROM (v_old_row ->> 'sale_order_id')
       AND (v_projection.has_head OR v_has_events) THEN
      RAISE EXCEPTION
        'Vinculo do recebivel com PV e imutavel apos iniciar o historico de liquidacao'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF NOT v_projection.has_head THEN
    v_old_settled := COALESCE((v_old_row ->> CASE v_kind
      WHEN 'payable' THEN 'amount_paid' ELSE 'amount_received' END)::numeric, 0);
    v_old_status := OLD.status;
    v_old_date := OLD.payment_date;
    v_old_method := OLD.payment_method;
    IF v_new_total IS NULL
       OR v_new_total::text IN ('NaN', 'Infinity', '-Infinity')
       OR v_new_total < v_old_settled THEN
      RAISE EXCEPTION
        'Valor do titulo legado nao pode ser menor que o total liquidado (%)',
        v_old_settled USING ERRCODE = '23514';
    END IF;
    IF v_old_settled > 0 THEN
      v_expected_status := CASE
        WHEN v_old_settled >= v_new_total THEN CASE v_kind
          WHEN 'payable' THEN 'paid' ELSE 'received' END
        ELSE 'parcial'
      END;
      IF NEW.amount IS DISTINCT FROM OLD.amount THEN
        NEW.status := v_expected_status;
        v_new_status := v_expected_status;
      END IF;
    END IF;
    IF v_new_settled IS DISTINCT FROM v_old_settled
       OR v_new_date IS DISTINCT FROM v_old_date
       OR (
         v_old_settled > 0
         AND (v_new_status IS DISTINCT FROM CASE
               WHEN NEW.amount IS DISTINCT FROM OLD.amount
                 THEN v_expected_status ELSE v_old_status END
           OR v_new_method IS DISTINCT FROM v_old_method)
       )
       OR (
         v_old_settled = 0
         AND (v_new_date IS NOT NULL
           OR private.financial_cash_status_159(v_kind, v_new_status))
       ) THEN
      RAISE EXCEPTION
        'Campos de caixa legados sao imutaveis; use execute_financial_settlement'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF v_new_total IS NULL
     OR v_new_total::text IN ('NaN', 'Infinity', '-Infinity')
     OR v_new_total < v_projection.settled_amount THEN
    RAISE EXCEPTION
      'Valor do titulo nao pode ser menor que o total liquidado (%)',
      v_projection.settled_amount
      USING ERRCODE = '23514';
  END IF;
  v_expected_status := CASE
    WHEN v_projection.settled_amount > 0
      AND v_projection.settled_amount >= v_new_total
      THEN CASE v_kind WHEN 'payable' THEN 'paid' ELSE 'received' END
    WHEN v_projection.settled_amount > 0 THEN 'parcial'
    ELSE v_projection.projected_status
  END;
  IF NEW.amount IS DISTINCT FROM OLD.amount THEN
    NEW.status := v_expected_status;
    v_new_status := v_expected_status;
  END IF;
  IF v_new_settled IS DISTINCT FROM v_projection.settled_amount
     OR v_new_date IS DISTINCT FROM v_projection.projected_payment_date
     OR (
       v_projection.settled_amount > 0
       AND COALESCE(v_new_method, '')
         IS DISTINCT FROM COALESCE(v_projection.projected_payment_method, '')
     )
     OR (
       v_projection.settled_amount > 0
       AND v_new_status IS DISTINCT FROM v_expected_status
     )
     OR (
       v_projection.settled_amount = 0
       AND private.financial_cash_status_159(v_kind, v_new_status)
     ) THEN
    RAISE EXCEPTION
      'Projecao financeira diverge do ledger; use execute_financial_settlement'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_zz_financial_projection_ap
  ON public.accounts_payable;
CREATE TRIGGER trg_zz_financial_projection_ap
  BEFORE INSERT OR DELETE OR UPDATE OF
    amount, amount_paid, status, payment_date, payment_method
  ON public.accounts_payable
  FOR EACH ROW EXECUTE FUNCTION private.tg_assert_financial_account_projection_159();

DROP TRIGGER IF EXISTS trg_zz_financial_projection_ar
  ON public.accounts_receivable;
CREATE TRIGGER trg_zz_financial_projection_ar
  BEFORE INSERT OR DELETE OR UPDATE OF
    amount, amount_received, status, payment_date, payment_method, sale_order_id
  ON public.accounts_receivable
  FOR EACH ROW EXECUTE FUNCTION private.tg_assert_financial_account_projection_159();

CREATE OR REPLACE FUNCTION private.apply_financial_account_projection_159(
  p_kind text,
  p_account_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_projection record;
BEGIN
  SELECT * INTO v_projection
    FROM private.financial_account_projection_159(p_kind, p_account_id);
  IF p_kind = 'payable' THEN
    UPDATE public.accounts_payable payable
       SET amount_paid = v_projection.settled_amount,
           status = v_projection.projected_status,
           payment_date = v_projection.projected_payment_date,
           payment_method = COALESCE(v_projection.projected_payment_method, ''),
           updated_at = pg_catalog.now()
     WHERE payable.id = p_account_id;
  ELSIF p_kind = 'receivable' THEN
    UPDATE public.accounts_receivable receivable
       SET amount_received = v_projection.settled_amount,
           status = v_projection.projected_status,
           payment_date = v_projection.projected_payment_date,
           payment_method = COALESCE(v_projection.projected_payment_method, ''),
           updated_at = pg_catalog.now()
     WHERE receivable.id = p_account_id;
  ELSE
    RAISE EXCEPTION 'Tipo de titulo invalido: %', p_kind
      USING ERRCODE = '22023';
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'settled_amount', v_projection.settled_amount,
    'status', v_projection.projected_status,
    'payment_date', v_projection.projected_payment_date,
    'payment_method', v_projection.projected_payment_method
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.record_financial_cmv_event_159(
  p_settlement_event_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_event public.financial_settlement_events%ROWTYPE;
  v_original_cmv public.financial_settlement_cmv_events%ROWTYPE;
  v_sale_order_id uuid;
  v_cmv_total numeric;
  v_receivable_gross numeric;
  v_cash_total numeric;
  v_recognized_before numeric;
  v_recognized_target numeric;
  v_recognized_delta numeric;
  v_after_exact_reversal numeric;
  v_quality_issue text;
BEGIN
  SELECT event.* INTO v_event
    FROM public.financial_settlement_events event
   WHERE event.id = p_settlement_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evento financeiro % nao encontrado', p_settlement_event_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_event.account_kind <> 'receivable' THEN
    RETURN;
  END IF;

  IF v_event.event_type = 'reversal' THEN
    SELECT cmv.* INTO v_original_cmv
      FROM public.financial_settlement_cmv_events cmv
     WHERE cmv.settlement_event_id = v_event.reverses_event_id
       AND cmv.event_type = 'settlement';
    IF NOT FOUND THEN
      RETURN;
    END IF;
    v_sale_order_id := v_original_cmv.sale_order_id;
    PERFORM 1 FROM public.sale_orders sale_order
     WHERE sale_order.id = v_sale_order_id FOR UPDATE;
  ELSE
    SELECT receivable.sale_order_id
      INTO v_sale_order_id
      FROM public.accounts_receivable receivable
     WHERE receivable.id = v_event.receivable_id;
    IF v_sale_order_id IS NULL THEN
      RETURN;
    END IF;
    -- Diferentes parcelas do mesmo PV precisam compartilhar a mesma ordem de
    -- rateio; sem este lock dois recebimentos concorrentes perderiam residual.
    PERFORM 1 FROM public.sale_orders sale_order
     WHERE sale_order.id = v_sale_order_id FOR UPDATE;
  END IF;

  SELECT COALESCE(pg_catalog.sum(entry.amount), 0)
    INTO v_cmv_total
    FROM public.financial_entries entry
   WHERE entry.reference_type = 'sale_order_cmv'
     AND entry.reference_id = v_sale_order_id::text
     AND entry.status NOT IN ('cancelado', 'cancelled', 'estornado');
  SELECT COALESCE(pg_catalog.sum(receivable.amount), 0)
    INTO v_receivable_gross
    FROM public.accounts_receivable receivable
   WHERE receivable.sale_order_id = v_sale_order_id
     AND receivable.status NOT IN ('cancelled', 'cancelado');
  -- O snapshot de abertura e as linhas antigas sem head sao fatos distintos.
  -- O recompute nunca pode recalcular o primeiro usando a base corrente.
  PERFORM public.recompute_sale_order_cmv_recognition(v_sale_order_id);

  SELECT COALESCE(pg_catalog.sum(
           LEAST(
             CASE WHEN head.id IS NULL
               THEN COALESCE(receivable.amount_received, 0)
               ELSE private.financial_settled_amount_159(
                 'receivable', receivable.id
               )
             END,
             receivable.amount
           )
         ), 0)
    INTO v_cash_total
    FROM public.accounts_receivable receivable
    LEFT JOIN public.financial_settlement_account_heads head
      ON head.receivable_id = receivable.id
   WHERE receivable.sale_order_id = v_sale_order_id
     AND receivable.status NOT IN ('cancelled', 'cancelado');
  IF v_cmv_total > 0 AND v_receivable_gross > 0 THEN
    v_recognized_target := pg_catalog.round(
      v_cmv_total * (v_cash_total / v_receivable_gross), 2
    );
  ELSE
    v_recognized_target := NULL;
  END IF;
  SELECT COALESCE(pg_catalog.sum(recognition.amount), 0)
    INTO v_recognized_before
    FROM (
      SELECT head.opening_cmv_amount AS amount
        FROM public.financial_settlement_account_heads head
       WHERE head.account_kind = 'receivable'
         AND head.opening_cmv_sale_order_id = v_sale_order_id
         AND head.opening_cmv_amount IS NOT NULL
      UNION ALL
      SELECT legacy.recognized_amount
        FROM public.sale_order_cmv_recognized legacy
       WHERE legacy.sale_order_id = v_sale_order_id
         AND NOT EXISTS (
           SELECT 1
             FROM public.financial_settlement_account_heads head
            WHERE head.receivable_id = legacy.receivable_id
         )
      UNION ALL
      SELECT cmv.recognized_amount
        FROM public.financial_settlement_cmv_events cmv
       WHERE cmv.sale_order_id = v_sale_order_id
    ) recognition;
  IF v_event.event_type = 'settlement' THEN
    IF v_cmv_total <= 0 OR v_receivable_gross <= 0 THEN
      RETURN;
    END IF;
    -- Uma abertura sem evidencia de CMV ou uma base fisica alterada tornam o
    -- rateio cumulativo indeterminavel. Caixa permanece valido e a view de
    -- qualidade o sinaliza; nao fabricamos nem reprecificamos custo.
    IF EXISTS (
      SELECT 1
        FROM public.financial_settlement_account_heads head
       WHERE head.account_kind = 'receivable'
         AND head.opening_cmv_sale_order_id = v_sale_order_id
         AND head.opening_amount > 0
         AND (
           head.opening_cmv_amount IS NULL
           OR head.opening_cmv_total_snapshot IS NULL
           OR head.opening_receivable_gross_snapshot IS NULL
           OR head.opening_cmv_total_snapshot IS DISTINCT FROM v_cmv_total
           OR head.opening_receivable_gross_snapshot
             IS DISTINCT FROM v_receivable_gross
         )
    ) OR EXISTS (
      SELECT 1
        FROM public.financial_settlement_events prior
        JOIN public.accounts_receivable prior_receivable
          ON prior_receivable.id = prior.receivable_id
       WHERE prior.event_type = 'settlement'
         AND prior.account_kind = 'receivable'
         AND prior_receivable.sale_order_id = v_sale_order_id
         AND prior.id <> v_event.id
         AND NOT EXISTS (
           SELECT 1 FROM public.financial_settlement_events prior_reversal
            WHERE prior_reversal.reverses_event_id = prior.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM public.financial_settlement_cmv_events prior_cmv
            WHERE prior_cmv.settlement_event_id = prior.id
              AND prior_cmv.event_type = 'settlement'
         )
    ) OR EXISTS (
      SELECT 1
        FROM public.financial_settlement_cmv_events prior_cmv
        JOIN public.financial_settlement_events prior
          ON prior.id = prior_cmv.settlement_event_id
       WHERE prior_cmv.sale_order_id = v_sale_order_id
         AND prior_cmv.event_type = 'settlement'
         AND NOT EXISTS (
           SELECT 1 FROM public.financial_settlement_events prior_reversal
            WHERE prior_reversal.reverses_event_id = prior.id
         )
         AND (
           prior_cmv.cmv_total_snapshot IS DISTINCT FROM v_cmv_total
           OR prior_cmv.receivable_gross_snapshot
             IS DISTINCT FROM v_receivable_gross
         )
    ) THEN
      RETURN;
    END IF;
    v_recognized_delta := pg_catalog.round(
      v_recognized_target - v_recognized_before, 2
    );
    IF v_recognized_delta < 0 THEN
      RETURN;
    END IF;
    INSERT INTO public.financial_settlement_cmv_events (
      settlement_event_id, receivable_id, sale_order_id, event_type,
      recognized_amount, recognized_on, cmv_total_snapshot,
      receivable_gross_snapshot
    ) VALUES (
      v_event.id, v_event.receivable_id, v_sale_order_id, 'settlement',
      v_recognized_delta, v_event.effective_on, v_cmv_total,
      v_receivable_gross
    );
  ELSE
    -- Estorno sempre e o oposto exato do fato original. Base atual diferente
    -- vira pendencia explicita e jamais um "ajuste de arredondamento" material.
    IF v_cmv_total <= 0 OR v_receivable_gross <= 0 THEN
      v_quality_issue := 'current_cmv_basis_missing_on_reversal';
    ELSIF v_cmv_total IS DISTINCT FROM v_original_cmv.cmv_total_snapshot
       OR v_receivable_gross
         IS DISTINCT FROM v_original_cmv.receivable_gross_snapshot THEN
      v_quality_issue := 'cmv_basis_changed_since_original';
    ELSIF EXISTS (
      SELECT 1
        FROM public.financial_settlement_cmv_events active_cmv
        JOIN public.financial_settlement_events active_settlement
          ON active_settlement.id = active_cmv.settlement_event_id
       WHERE active_cmv.sale_order_id = v_sale_order_id
         AND active_cmv.event_type = 'settlement'
         AND active_settlement.id <> v_event.reverses_event_id
         AND NOT EXISTS (
           SELECT 1 FROM public.financial_settlement_events active_reversal
            WHERE active_reversal.reverses_event_id = active_settlement.id
         )
         AND (
           active_cmv.cmv_total_snapshot IS DISTINCT FROM v_cmv_total
           OR active_cmv.receivable_gross_snapshot
             IS DISTINCT FROM v_receivable_gross
         )
    ) THEN
      v_quality_issue := 'mixed_cmv_basis_on_reversal';
    END IF;

    v_after_exact_reversal := pg_catalog.round(
      v_recognized_before - v_original_cmv.recognized_amount, 2
    );
    IF v_quality_issue IS NULL THEN
      v_recognized_delta := pg_catalog.round(
        v_recognized_target - v_after_exact_reversal, 2
      );
      IF pg_catalog.abs(v_recognized_delta) > 0.01 THEN
        v_quality_issue := 'cmv_residual_exceeds_one_cent';
      END IF;
    END IF;

    INSERT INTO public.financial_settlement_cmv_events (
      settlement_event_id, receivable_id, sale_order_id, event_type,
      recognized_amount, recognized_on, cmv_total_snapshot,
      receivable_gross_snapshot, reverses_cmv_event_id, quality_issue
    ) VALUES (
      v_event.id, v_original_cmv.receivable_id, v_original_cmv.sale_order_id,
      'reversal', -v_original_cmv.recognized_amount, v_event.effective_on,
      v_original_cmv.cmv_total_snapshot,
      v_original_cmv.receivable_gross_snapshot, v_original_cmv.id,
      v_quality_issue
    );
    IF v_quality_issue IS NULL AND v_recognized_delta <> 0 THEN
      INSERT INTO public.financial_settlement_cmv_events (
        settlement_event_id, receivable_id, sale_order_id, event_type,
        recognized_amount, recognized_on, cmv_total_snapshot,
        receivable_gross_snapshot
      ) VALUES (
        v_event.id, v_original_cmv.receivable_id, v_sale_order_id,
        'rounding_adjustment', v_recognized_delta, v_event.effective_on,
        v_cmv_total, v_receivable_gross
      );
    END IF;
  END IF;
  PERFORM public.recompute_sale_order_cmv_recognition(v_sale_order_id);
END;
$function$;

-- Mantem o comportamento legado para titulos ainda sem head. Depois da
-- primeira liquidacao explicita, a linha antiga representa somente o saldo de
-- abertura; eventos novos e estornos vivem na tabela granular acima.
CREATE OR REPLACE FUNCTION public.recompute_sale_order_cmv_recognition(
  p_sale_order_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_ref text := p_sale_order_id::text;
  v_cmv_total numeric;
  v_gross numeric;
  v_rec_total numeric := 0;
  v_rec_date date;
BEGIN
  IF p_sale_order_id IS NULL THEN
    RETURN;
  END IF;
  SELECT COALESCE(pg_catalog.sum(entry.amount), 0)
    INTO v_cmv_total
    FROM public.financial_entries entry
   WHERE entry.reference_type = 'sale_order_cmv'
     AND entry.reference_id = v_ref
     AND entry.status NOT IN ('cancelado', 'cancelled', 'estornado');
  SELECT COALESCE(pg_catalog.sum(receivable.amount), 0)
    INTO v_gross
    FROM public.accounts_receivable receivable
   WHERE receivable.sale_order_id = p_sale_order_id
     AND receivable.status NOT IN ('cancelled', 'cancelado');

  IF v_cmv_total > 0 AND v_gross > 0 THEN
    INSERT INTO public.sale_order_cmv_recognized AS target (
      sale_order_id, receivable_id, recognized_amount, recognized_date
    )
    SELECT
      p_sale_order_id,
      receivable.id,
      pg_catalog.round(
        v_cmv_total * (
          LEAST(
            CASE WHEN head.id IS NULL
              THEN COALESCE(receivable.amount_received, 0)
              ELSE head.opening_amount
            END,
            receivable.amount
          ) / v_gross
        ),
        2
      ),
      CASE WHEN head.id IS NULL
        THEN receivable.payment_date
        ELSE head.opening_payment_date
      END
    FROM public.accounts_receivable receivable
    LEFT JOIN public.financial_settlement_account_heads head
      ON head.receivable_id = receivable.id
    WHERE receivable.sale_order_id = p_sale_order_id
      AND receivable.status NOT IN ('cancelled', 'cancelado')
      AND head.id IS NULL
      AND CASE WHEN head.id IS NULL
        THEN COALESCE(receivable.amount_received, 0)
        ELSE head.opening_amount
      END > 0
    ON CONFLICT (sale_order_id, receivable_id) DO UPDATE
      SET recognized_amount = EXCLUDED.recognized_amount,
          recognized_date = EXCLUDED.recognized_date,
          updated_at = pg_catalog.now();
  END IF;

  DELETE FROM public.sale_order_cmv_recognized recognized
   WHERE recognized.sale_order_id = p_sale_order_id
     AND NOT EXISTS (
       SELECT 1
         FROM public.financial_settlement_account_heads frozen_head
        WHERE frozen_head.receivable_id = recognized.receivable_id
     )
     AND (
       v_cmv_total <= 0
       OR v_gross <= 0
       OR NOT EXISTS (
         SELECT 1
           FROM public.accounts_receivable receivable
           LEFT JOIN public.financial_settlement_account_heads head
             ON head.receivable_id = receivable.id
          WHERE receivable.id = recognized.receivable_id
            AND receivable.status NOT IN ('cancelled', 'cancelado')
            AND CASE WHEN head.id IS NULL
              THEN COALESCE(receivable.amount_received, 0)
              ELSE head.opening_amount
            END > 0
       )
     );

  SELECT COALESCE(pg_catalog.sum(recognized_amount), 0),
         pg_catalog.max(recognized_date)
    INTO v_rec_total, v_rec_date
    FROM (
      SELECT head.opening_cmv_amount AS recognized_amount,
             head.opening_cmv_date AS recognized_date
        FROM public.financial_settlement_account_heads head
       WHERE head.account_kind = 'receivable'
         AND head.opening_cmv_sale_order_id = p_sale_order_id
         AND head.opening_cmv_amount IS NOT NULL
      UNION ALL
      SELECT legacy.recognized_amount, legacy.recognized_date
        FROM public.sale_order_cmv_recognized legacy
       WHERE legacy.sale_order_id = p_sale_order_id
         AND NOT EXISTS (
           SELECT 1
             FROM public.financial_settlement_account_heads head
            WHERE head.receivable_id = legacy.receivable_id
         )
      UNION ALL
      SELECT event.recognized_amount, event.recognized_on
        FROM public.financial_settlement_cmv_events event
       WHERE event.sale_order_id = p_sale_order_id
    ) recognition;

  UPDATE public.financial_entries entry
     SET recognized_amount = v_rec_total,
         recognized_date = v_rec_date
   WHERE entry.reference_type = 'sale_order_cmv'
     AND entry.reference_id = v_ref
     AND entry.status NOT IN ('cancelado', 'cancelled', 'estornado')
     AND (
       entry.recognized_amount IS DISTINCT FROM v_rec_total
       OR entry.recognized_date IS DISTINCT FROM v_rec_date
     );
END;
$function$;

CREATE OR REPLACE FUNCTION private.execute_financial_settlement_core_159(
  p_command_id uuid,
  p_command text,
  p_payload jsonb,
  p_source_type text,
  p_source_reference text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_payload_hash text;
  v_receipt public.financial_settlement_command_receipts%ROWTYPE;
  v_entry jsonb;
  v_position integer;
  v_entry_count integer;
  v_kind text;
  v_account_id uuid;
  v_bank_account_id uuid;
  v_amount numeric;
  v_effective_on date;
  v_method text;
  v_event_id uuid;
  v_original_event_id uuid;
  v_original_event public.financial_settlement_events%ROWTYPE;
  v_payable public.accounts_payable%ROWTYPE;
  v_receivable public.accounts_receivable%ROWTYPE;
  v_projection record;
  v_requested numeric;
  v_event_ids uuid[] := ARRAY[]::uuid[];
  v_items jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_result jsonb;
  v_reason text;
  v_reference text;
  v_notes text;
  v_source_line_key text;
  v_category text;
  v_today date := (pg_catalog.clock_timestamp()
    AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF p_command_id IS NULL THEN
    RAISE EXCEPTION 'command_id obrigatorio' USING ERRCODE = '22023';
  END IF;
  IF p_command IS NULL OR p_command NOT IN ('register', 'reverse') THEN
    RAISE EXCEPTION 'Comando financeiro invalido: %', p_command
      USING ERRCODE = '22023';
  END IF;
  IF p_source_type IS NULL OR p_source_type NOT IN
       ('manual', 'ofx', 'factoring', 'contractor_cycle', 'system') THEN
    RAISE EXCEPTION 'Origem financeira invalida: %', p_source_type
      USING ERRCODE = '22023';
  END IF;
  IF p_source_type = 'manual' THEN
    IF NULLIF(pg_catalog.btrim(COALESCE(p_source_reference, '')), '')
       IS NOT NULL THEN
      RAISE EXCEPTION 'Origem manual nao aceita source_reference do cliente'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NULLIF(pg_catalog.btrim(COALESCE(p_source_reference, '')), '')
       IS NULL OR pg_catalog.length(p_source_reference) > 500 THEN
    RAISE EXCEPTION 'Origem confiavel exige source_reference valido'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
     OR pg_catalog.jsonb_typeof(p_payload -> 'entries') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Payload exige entries em array'
      USING ERRCODE = '22023';
  END IF;
  v_entry_count := pg_catalog.jsonb_array_length(p_payload -> 'entries');
  IF v_entry_count < 1 OR v_entry_count > 200 THEN
    RAISE EXCEPTION 'Lote financeiro exige entre 1 e 200 entradas'
      USING ERRCODE = '22023';
  END IF;

  v_payload_hash := public.strap_payload_hash(pg_catalog.jsonb_build_object(
    'command', p_command,
    'payload', p_payload,
    'source_type', p_source_type,
    'source_reference', p_source_reference
  ));
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_command_id::text, 159)
  );
  SELECT receipt.* INTO v_receipt
    FROM public.financial_settlement_command_receipts receipt
   WHERE receipt.command_id = p_command_id;
  IF FOUND THEN
    IF v_receipt.command IS DISTINCT FROM p_command
       OR v_receipt.payload_hash IS DISTINCT FROM v_payload_hash
       OR v_receipt.actor_id IS DISTINCT FROM v_actor_id THEN
      RAISE EXCEPTION 'Replay divergente para command_id %', p_command_id
        USING ERRCODE = '23505';
    END IF;
    RETURN v_receipt.result || pg_catalog.jsonb_build_object('replayed', true);
  END IF;

  -- Primeira passagem: nenhuma linha e tocada antes de validar o lote inteiro.
  FOR v_entry, v_position IN
    SELECT input.value, input.ordinality::integer
      FROM pg_catalog.jsonb_array_elements(p_payload -> 'entries')
        WITH ORDINALITY AS input(value, ordinality)
  LOOP
    IF pg_catalog.jsonb_typeof(v_entry) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Entrada % precisa ser objeto', v_position
        USING ERRCODE = '22023';
    END IF;
    IF p_command = 'register' THEN
      v_kind := v_entry ->> 'kind';
      IF v_kind NOT IN ('payable', 'receivable') THEN
        RAISE EXCEPTION 'Entrada %: kind invalido', v_position
          USING ERRCODE = '22023';
      END IF;
      IF COALESCE(v_entry ->> 'settled_on', '')
           !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        RAISE EXCEPTION 'Entrada % exige data ISO YYYY-MM-DD', v_position
          USING ERRCODE = '22023';
      END IF;
      BEGIN
        v_account_id := (v_entry ->> 'account_id')::uuid;
        v_amount := (v_entry ->> 'amount')::numeric;
        v_effective_on := (v_entry ->> 'settled_on')::date;
        v_bank_account_id := CASE
          WHEN NULLIF(v_entry ->> 'bank_account_id', '') IS NULL THEN NULL
          ELSE (v_entry ->> 'bank_account_id')::uuid
        END;
      EXCEPTION
        WHEN invalid_text_representation OR numeric_value_out_of_range
          OR datetime_field_overflow THEN
          RAISE EXCEPTION 'Entrada % possui UUID, valor ou data invalido', v_position
            USING ERRCODE = '22023';
      END;
      IF v_account_id IS NULL
         OR v_amount IS NULL
         OR v_amount <= 0
         OR v_amount::text IN ('NaN', 'Infinity', '-Infinity')
         OR v_amount IS DISTINCT FROM pg_catalog.round(v_amount, 2) THEN
        RAISE EXCEPTION 'Entrada % exige valor positivo exato em centavos', v_position
          USING ERRCODE = '22023';
      END IF;
      IF v_effective_on IS NULL OR v_effective_on > v_today THEN
        RAISE EXCEPTION 'Entrada % possui data futura ou ausente', v_position
          USING ERRCODE = '22023';
      END IF;
      v_method := private.normalize_financial_settlement_method_159(
        v_entry ->> 'method'
      );
      IF v_method IS NULL THEN
        RAISE EXCEPTION
          'Entrada %: metodo deve ser pix, transferencia, boleto, dinheiro, cheque, cartao ou outro',
          v_position USING ERRCODE = '22023';
      END IF;
      v_reference := NULLIF(pg_catalog.btrim(COALESCE(v_entry ->> 'reference', '')), '');
      v_notes := NULLIF(pg_catalog.btrim(COALESCE(v_entry ->> 'notes', '')), '');
      IF pg_catalog.length(COALESCE(v_reference, '')) > 500
         OR pg_catalog.length(COALESCE(v_notes, '')) > 4000 THEN
        RAISE EXCEPTION 'Entrada % excede limites de referencia/notas', v_position
          USING ERRCODE = '22023';
      END IF;
      v_source_line_key := NULLIF(
        pg_catalog.btrim(COALESCE(v_entry ->> 'source_line_key', '')), ''
      );
      IF p_source_type = 'manual' AND v_source_line_key IS NOT NULL THEN
        RAISE EXCEPTION 'Cliente manual nao pode declarar source_line_key'
          USING ERRCODE = '42501';
      ELSIF p_source_type <> 'manual'
        AND (v_source_line_key IS NULL
          OR pg_catalog.length(v_source_line_key) > 500) THEN
        RAISE EXCEPTION 'Entrada confiavel exige source_line_key valido'
          USING ERRCODE = '22023';
      END IF;
    ELSE
      IF COALESCE(v_entry ->> 'reversed_on', '')
           !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        RAISE EXCEPTION 'Entrada % exige data ISO YYYY-MM-DD', v_position
          USING ERRCODE = '22023';
      END IF;
      BEGIN
        v_original_event_id := (v_entry ->> 'event_id')::uuid;
        v_effective_on := (v_entry ->> 'reversed_on')::date;
      EXCEPTION
        WHEN invalid_text_representation OR datetime_field_overflow THEN
          RAISE EXCEPTION 'Entrada % possui evento ou data invalido', v_position
            USING ERRCODE = '22023';
      END;
      v_reason := NULLIF(pg_catalog.btrim(COALESCE(v_entry ->> 'reason', '')), '');
      IF v_original_event_id IS NULL OR v_effective_on IS NULL
         OR v_effective_on > v_today THEN
        RAISE EXCEPTION 'Entrada % possui evento/data ausente ou futura', v_position
          USING ERRCODE = '22023';
      END IF;
      IF v_reason IS NULL OR pg_catalog.length(v_reason) > 4000 THEN
        RAISE EXCEPTION 'Entrada % exige motivo de estorno (ate 4000 caracteres)',
          v_position USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;

  IF p_command = 'reverse' AND (
    SELECT pg_catalog.count(DISTINCT (input.value ->> 'event_id'))
      FROM pg_catalog.jsonb_array_elements(p_payload -> 'entries') input(value)
  ) <> v_entry_count THEN
    RAISE EXCEPTION 'Um mesmo evento nao pode ser estornado duas vezes no lote'
      USING ERRCODE = '22023';
  END IF;
  IF p_command = 'register' AND p_source_type <> 'manual' AND (
    SELECT pg_catalog.count(DISTINCT (input.value ->> 'source_line_key'))
      FROM pg_catalog.jsonb_array_elements(p_payload -> 'entries') input(value)
  ) <> v_entry_count THEN
    RAISE EXCEPTION 'source_line_key duplicada no lote confiavel'
      USING ERRCODE = '22023';
  END IF;

  -- Ordem global de locks: eventos originais -> bancos -> AP -> AR.
  IF p_command = 'reverse' THEN
    FOR v_original_event_id IN
      SELECT DISTINCT (input.value ->> 'event_id')::uuid
        FROM pg_catalog.jsonb_array_elements(p_payload -> 'entries') input(value)
       ORDER BY 1
    LOOP
      SELECT event.* INTO v_original_event
        FROM public.financial_settlement_events event
       WHERE event.id = v_original_event_id
       FOR UPDATE;
      IF NOT FOUND OR v_original_event.event_type <> 'settlement' THEN
        RAISE EXCEPTION 'Evento % nao e uma liquidacao valida', v_original_event_id
          USING ERRCODE = 'P0002';
      END IF;
      IF v_original_event.source_type IS DISTINCT FROM p_source_type
         AND p_source_type <> 'system' THEN
        RAISE EXCEPTION
          'Evento % pertence a origem % e nao pode ser estornado por %',
          v_original_event_id, v_original_event.source_type, p_source_type
          USING ERRCODE = '42501';
      END IF;
      IF p_source_type <> 'manual'
         AND p_source_type <> 'system'
         AND v_original_event.source_reference IS DISTINCT FROM p_source_reference THEN
        RAISE EXCEPTION
          'Evento % nao pertence ao contexto confiavel informado',
          v_original_event_id USING ERRCODE = '42501';
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.financial_settlement_events reversal
         WHERE reversal.reverses_event_id = v_original_event_id
      ) THEN
        RAISE EXCEPTION 'Evento % ja foi estornado', v_original_event_id
          USING ERRCODE = '55000';
      END IF;
    END LOOP;
  END IF;

  FOR v_bank_account_id IN
    SELECT DISTINCT bank_id
      FROM (
        SELECT CASE WHEN p_command = 'register'
          THEN NULLIF(input.value ->> 'bank_account_id', '')::uuid
          ELSE original.bank_account_id
        END AS bank_id
        FROM pg_catalog.jsonb_array_elements(p_payload -> 'entries') input(value)
        LEFT JOIN public.financial_settlement_events original
          ON p_command = 'reverse'
         AND original.id = NULLIF(input.value ->> 'event_id', '')::uuid
      ) banks
     WHERE bank_id IS NOT NULL
     ORDER BY bank_id
  LOOP
    PERFORM bank.id
     FROM public.bank_accounts bank
     WHERE bank.id = v_bank_account_id
       AND (p_command = 'reverse' OR bank.active IS TRUE)
     FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Conta bancaria % inexistente ou inativa', v_bank_account_id
        USING ERRCODE = '23503';
    END IF;
  END LOOP;

  FOR v_account_id IN
    SELECT DISTINCT account_id
      FROM (
        SELECT CASE WHEN p_command = 'register'
          THEN CASE WHEN input.value ->> 'kind' = 'payable'
            THEN (input.value ->> 'account_id')::uuid END
          ELSE original.payable_id
        END AS account_id
        FROM pg_catalog.jsonb_array_elements(p_payload -> 'entries') input(value)
        LEFT JOIN public.financial_settlement_events original
          ON p_command = 'reverse'
         AND original.id = NULLIF(input.value ->> 'event_id', '')::uuid
      ) targets
     WHERE account_id IS NOT NULL
     ORDER BY account_id
  LOOP
    SELECT payable.* INTO v_payable
      FROM public.accounts_payable payable
     WHERE payable.id = v_account_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Conta a pagar % nao encontrada', v_account_id
        USING ERRCODE = 'P0002';
    END IF;
    IF p_command = 'register'
       AND pg_catalog.lower(v_payable.status) IN ('cancelled', 'cancelado') THEN
      RAISE EXCEPTION 'Conta a pagar % esta cancelada', v_account_id
        USING ERRCODE = '55000';
    END IF;
    PERFORM private.ensure_financial_settlement_head_159(
      'payable', v_account_id, v_actor_id
    );
    IF p_command = 'register' THEN
      SELECT COALESCE(pg_catalog.sum((input.value ->> 'amount')::numeric), 0)
        INTO v_requested
        FROM pg_catalog.jsonb_array_elements(p_payload -> 'entries') input(value)
       WHERE input.value ->> 'kind' = 'payable'
         AND (input.value ->> 'account_id')::uuid = v_account_id;
      SELECT * INTO v_projection
        FROM private.financial_account_projection_159('payable', v_account_id);
      IF v_payable.amount <= 0
         OR v_payable.amount::text IN ('NaN', 'Infinity', '-Infinity')
         OR v_projection.settled_amount + v_requested > v_payable.amount THEN
        RAISE EXCEPTION
          'Liquidacao excede saldo da conta a pagar % (liquidado %, lote %, titulo %)',
          v_account_id, v_projection.settled_amount, v_requested, v_payable.amount
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;

  FOR v_account_id IN
    SELECT DISTINCT account_id
      FROM (
        SELECT CASE WHEN p_command = 'register'
          THEN CASE WHEN input.value ->> 'kind' = 'receivable'
            THEN (input.value ->> 'account_id')::uuid END
          ELSE original.receivable_id
        END AS account_id
        FROM pg_catalog.jsonb_array_elements(p_payload -> 'entries') input(value)
        LEFT JOIN public.financial_settlement_events original
          ON p_command = 'reverse'
         AND original.id = NULLIF(input.value ->> 'event_id', '')::uuid
      ) targets
     WHERE account_id IS NOT NULL
     ORDER BY account_id
  LOOP
    SELECT receivable.* INTO v_receivable
      FROM public.accounts_receivable receivable
     WHERE receivable.id = v_account_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Conta a receber % nao encontrada', v_account_id
        USING ERRCODE = 'P0002';
    END IF;
    IF p_command = 'register'
       AND pg_catalog.lower(v_receivable.status) IN ('cancelled', 'cancelado') THEN
      RAISE EXCEPTION 'Conta a receber % esta cancelada', v_account_id
        USING ERRCODE = '55000';
    END IF;
    PERFORM private.ensure_financial_settlement_head_159(
      'receivable', v_account_id, v_actor_id
    );
    IF p_command = 'register' THEN
      SELECT COALESCE(pg_catalog.sum((input.value ->> 'amount')::numeric), 0)
        INTO v_requested
        FROM pg_catalog.jsonb_array_elements(p_payload -> 'entries') input(value)
       WHERE input.value ->> 'kind' = 'receivable'
         AND (input.value ->> 'account_id')::uuid = v_account_id;
      SELECT * INTO v_projection
        FROM private.financial_account_projection_159('receivable', v_account_id);
      IF v_receivable.amount <= 0
         OR v_receivable.amount::text IN ('NaN', 'Infinity', '-Infinity')
         OR v_projection.settled_amount + v_requested > v_receivable.amount THEN
        RAISE EXCEPTION
          'Liquidacao excede saldo da conta a receber % (liquidado %, lote %, titulo %)',
          v_account_id, v_projection.settled_amount, v_requested, v_receivable.amount
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;

  -- Efeitos somente depois de validacao e locks de todo o lote.
  FOR v_entry, v_position IN
    SELECT input.value, input.ordinality::integer
      FROM pg_catalog.jsonb_array_elements(p_payload -> 'entries')
        WITH ORDINALITY AS input(value, ordinality)
  LOOP
    v_event_id := pg_catalog.gen_random_uuid();
    IF p_command = 'register' THEN
      v_kind := v_entry ->> 'kind';
      v_account_id := (v_entry ->> 'account_id')::uuid;
      v_amount := (v_entry ->> 'amount')::numeric;
      v_effective_on := (v_entry ->> 'settled_on')::date;
      v_method := private.normalize_financial_settlement_method_159(
        v_entry ->> 'method'
      );
      v_bank_account_id := CASE
        WHEN NULLIF(v_entry ->> 'bank_account_id', '') IS NULL THEN NULL
        ELSE (v_entry ->> 'bank_account_id')::uuid
      END;
      v_reference := NULLIF(pg_catalog.btrim(COALESCE(v_entry ->> 'reference', '')), '');
      v_notes := NULLIF(pg_catalog.btrim(COALESCE(v_entry ->> 'notes', '')), '');
      v_source_line_key := CASE WHEN p_source_type = 'manual'
        THEN p_command_id::text || ':' || v_position::text
        ELSE NULLIF(pg_catalog.btrim(v_entry ->> 'source_line_key'), '')
      END;
      IF v_kind = 'payable' THEN
        SELECT payable.category INTO v_category
          FROM public.accounts_payable payable WHERE payable.id = v_account_id;
      ELSE
        SELECT receivable.category INTO v_category
          FROM public.accounts_receivable receivable WHERE receivable.id = v_account_id;
      END IF;
      INSERT INTO public.financial_settlement_events (
        id, command_id, batch_position, event_type, account_kind,
        payable_id, receivable_id, amount, effective_on, method,
        bank_account_id, category, reference, notes, source_type,
        source_reference, source_line_key, actor_id
      ) VALUES (
        v_event_id, p_command_id, v_position, 'settlement', v_kind,
        CASE WHEN v_kind = 'payable' THEN v_account_id END,
        CASE WHEN v_kind = 'receivable' THEN v_account_id END,
        v_amount, v_effective_on, v_method, v_bank_account_id, v_category,
        v_reference, v_notes, p_source_type, p_source_reference,
        v_source_line_key, v_actor_id
      );
    ELSE
      v_original_event_id := (v_entry ->> 'event_id')::uuid;
      SELECT event.* INTO STRICT v_original_event
        FROM public.financial_settlement_events event
       WHERE event.id = v_original_event_id;
      v_effective_on := (v_entry ->> 'reversed_on')::date;
      v_reason := pg_catalog.btrim(v_entry ->> 'reason');
      IF v_effective_on < v_original_event.effective_on THEN
        RAISE EXCEPTION 'Estorno nao pode anteceder a liquidacao %',
          v_original_event.id USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.financial_settlement_events (
        id, command_id, batch_position, event_type, account_kind,
        payable_id, receivable_id, amount, effective_on, method,
        bank_account_id, category, reference, notes, source_type,
        source_reference, source_line_key, reverses_event_id, actor_id
      ) VALUES (
        v_event_id, p_command_id, v_position, 'reversal',
        v_original_event.account_kind, v_original_event.payable_id,
        v_original_event.receivable_id, v_original_event.amount,
        v_effective_on, v_original_event.method,
        v_original_event.bank_account_id, v_original_event.category,
        v_original_event.reference, v_reason, p_source_type,
        p_source_reference,
        p_command_id::text || ':' || v_position::text,
        v_original_event.id, v_actor_id
      );
    END IF;
    PERFORM private.record_financial_cmv_event_159(v_event_id);
    v_event_ids := pg_catalog.array_append(v_event_ids, v_event_id);
  END LOOP;

  FOR v_kind, v_account_id IN
    SELECT event.account_kind,
           CASE event.account_kind
             WHEN 'payable' THEN event.payable_id
             ELSE event.receivable_id
           END AS account_id
      FROM public.financial_settlement_events event
     WHERE event.command_id = p_command_id
     GROUP BY event.account_kind,
       CASE event.account_kind
         WHEN 'payable' THEN event.payable_id
         ELSE event.receivable_id
       END
     ORDER BY event.account_kind, account_id
  LOOP
    PERFORM private.apply_financial_account_projection_159(v_kind, v_account_id);
  END LOOP;

  FOR v_original_event IN
    SELECT event.*
      FROM public.financial_settlement_events event
     WHERE event.command_id = p_command_id
     ORDER BY event.batch_position
  LOOP
    v_account_id := CASE v_original_event.account_kind
      WHEN 'payable' THEN v_original_event.payable_id
      ELSE v_original_event.receivable_id
    END;
    SELECT * INTO v_projection
      FROM private.financial_account_projection_159(
        v_original_event.account_kind, v_account_id
      );
    v_items := v_items || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'position', v_original_event.batch_position,
        'event_id', v_original_event.id,
        'kind', v_original_event.account_kind,
        'account_id', v_account_id,
        'event_type', v_original_event.event_type,
        'amount', v_original_event.amount,
        'effective_on', v_original_event.effective_on,
        'projected_settled_amount', v_projection.settled_amount,
        'projected_status', v_projection.projected_status,
        'projected_payment_date', v_projection.projected_payment_date
      )
    );
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM public.financial_settlement_account_heads head
      JOIN public.financial_settlement_events event
        ON event.command_id = p_command_id
       AND ((event.account_kind = 'payable' AND event.payable_id = head.payable_id)
         OR (event.account_kind = 'receivable' AND event.receivable_id = head.receivable_id))
     WHERE head.opening_amount > 0
  ) THEN
    v_warnings := v_warnings || pg_catalog.jsonb_build_array(
      'legacy_opening_balance_excluded_from_new_cash_events'
    );
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.financial_settlement_account_heads head
      JOIN public.financial_settlement_events event
        ON event.command_id = p_command_id
       AND ((event.account_kind = 'payable' AND event.payable_id = head.payable_id)
         OR (event.account_kind = 'receivable' AND event.receivable_id = head.receivable_id))
     WHERE head.opening_amount > 0 AND head.opening_payment_date IS NULL
  ) THEN
    v_warnings := v_warnings || pg_catalog.jsonb_build_array(
      'legacy_opening_balance_without_date'
    );
  END IF;

  v_result := pg_catalog.jsonb_build_object(
    'ok', true,
    'command_id', p_command_id,
    'command', p_command,
    'event_ids', pg_catalog.to_jsonb(v_event_ids),
    'items', v_items,
    'warnings', v_warnings,
    'replayed', false
  );
  INSERT INTO public.financial_settlement_command_receipts (
    command_id, command, payload_hash, actor_id, result
  ) VALUES (
    p_command_id, p_command, v_payload_hash, v_actor_id, v_result
  );
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION private.execute_financial_settlement_core_159(
  uuid,text,jsonb,text,text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.execute_financial_settlement(
  p_command_id uuid,
  p_command text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_payload jsonb;
BEGIN
  IF NOT public.user_has_any_role(ARRAY['admin', 'gerente']) THEN
    RAISE EXCEPTION 'Permissao negada para liquidacao financeira'
      USING ERRCODE = '42501';
  END IF;
  IF (p_payload ? 'source_type'
       AND p_payload ->> 'source_type' IS DISTINCT FROM 'manual')
     OR p_payload ? 'source_reference' THEN
    RAISE EXCEPTION 'Origem da liquidacao e derivada pelo servidor'
      USING ERRCODE = '42501';
  END IF;
  v_payload := p_payload - 'source_type';
  RETURN private.execute_financial_settlement_core_159(
    p_command_id, p_command, v_payload, 'manual', NULL
  );
END;
$function$;

CREATE OR REPLACE VIEW public.financial_cash_movements
WITH (security_invoker = true)
AS
  SELECT
    event.id::text AS id,
    event.account_kind AS kind,
    CASE event.account_kind
      WHEN 'payable' THEN event.payable_id
      ELSE event.receivable_id
    END AS account_id,
    event.effective_on,
    CASE
      WHEN event.account_kind = 'payable' AND event.event_type = 'settlement'
        THEN -event.amount
      WHEN event.account_kind = 'payable' AND event.event_type = 'reversal'
        THEN event.amount
      WHEN event.account_kind = 'receivable' AND event.event_type = 'settlement'
        THEN event.amount
      ELSE -event.amount
    END AS amount_signed,
    event.category,
    false AS legacy
  FROM public.financial_settlement_events event
UNION ALL
  SELECT
    'opening:' || head.account_kind || ':' ||
      COALESCE(head.payable_id, head.receivable_id)::text AS id,
    head.account_kind AS kind,
    COALESCE(head.payable_id, head.receivable_id) AS account_id,
    head.opening_payment_date AS effective_on,
    CASE head.account_kind
      WHEN 'payable' THEN -head.opening_amount
      ELSE head.opening_amount
    END AS amount_signed,
    head.opening_category AS category,
    true AS legacy
  FROM public.financial_settlement_account_heads head
  WHERE head.opening_amount > 0
UNION ALL
  SELECT
    'opening:payable:' || payable.id::text,
    'payable', payable.id, payable.payment_date,
    -payable.amount_paid, payable.category, true
  FROM public.accounts_payable payable
  WHERE payable.amount_paid > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.financial_settlement_account_heads head
       WHERE head.payable_id = payable.id
    )
UNION ALL
  SELECT
    'opening:receivable:' || receivable.id::text,
    'receivable', receivable.id, receivable.payment_date,
    receivable.amount_received, receivable.category, true
  FROM public.accounts_receivable receivable
  WHERE receivable.amount_received > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.financial_settlement_account_heads head
       WHERE head.receivable_id = receivable.id
    );

COMMENT ON VIEW public.financial_cash_movements IS
  'Movimentos de caixa: AP negativo, AR positivo e estorno com sinal inverso. legacy=true e saldo de abertura; data pode ser NULL e nunca e inventada.';

CREATE OR REPLACE VIEW public.financial_cash_cmv_movements
WITH (security_invoker = true)
AS
  SELECT
    event.id::text AS id,
    event.sale_order_id,
    event.receivable_id,
    event.recognized_on AS effective_on,
    event.recognized_amount AS amount_signed,
    false AS legacy
  FROM public.financial_settlement_cmv_events event
UNION ALL
  SELECT
    'opening:cmv:head:' || head.id::text,
    head.opening_cmv_sale_order_id,
    head.receivable_id,
    head.opening_cmv_date,
    head.opening_cmv_amount,
    true
  FROM public.financial_settlement_account_heads head
  WHERE head.account_kind = 'receivable'
    AND head.opening_cmv_amount IS NOT NULL
    AND head.opening_cmv_amount <> 0
    AND head.opening_cmv_sale_order_id IS NOT NULL
UNION ALL
  SELECT
    'opening:cmv:' || legacy.id::text,
    legacy.sale_order_id,
    legacy.receivable_id,
    legacy.recognized_date,
    legacy.recognized_amount,
    true
  FROM public.sale_order_cmv_recognized legacy
  WHERE legacy.recognized_amount <> 0
    AND NOT EXISTS (
      SELECT 1
        FROM public.financial_settlement_account_heads head
       WHERE head.receivable_id = legacy.receivable_id
    );

CREATE OR REPLACE VIEW public.financial_settlement_cmv_pending
WITH (security_invoker = true)
AS
  SELECT
    event.id AS settlement_event_id,
    event.receivable_id,
    receivable.sale_order_id,
    event.effective_on,
    event.amount AS received_amount
  FROM public.financial_settlement_events event
  JOIN public.accounts_receivable receivable
    ON receivable.id = event.receivable_id
  WHERE event.event_type = 'settlement'
    AND event.account_kind = 'receivable'
    AND receivable.sale_order_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.financial_settlement_cmv_events cmv
       WHERE cmv.settlement_event_id = event.id
         AND cmv.event_type = 'settlement'
    )
UNION ALL
  SELECT
    reversal.id,
    original.receivable_id,
    receivable.sale_order_id,
    reversal.effective_on,
    -reversal.amount
  FROM public.financial_settlement_events reversal
  JOIN public.financial_settlement_events original
    ON original.id = reversal.reverses_event_id
  JOIN public.accounts_receivable receivable
    ON receivable.id = original.receivable_id
  WHERE reversal.event_type = 'reversal'
    AND original.event_type = 'settlement'
    AND original.account_kind = 'receivable'
    AND receivable.sale_order_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.financial_settlement_cmv_events original_cmv
       WHERE original_cmv.settlement_event_id = original.id
         AND original_cmv.event_type = 'settlement'
    )
UNION ALL
  SELECT
    cmv.settlement_event_id,
    cmv.receivable_id,
    cmv.sale_order_id,
    cmv.recognized_on,
    -financial_reversal.amount
  FROM public.financial_settlement_cmv_events cmv
  JOIN public.financial_settlement_events financial_reversal
    ON financial_reversal.id = cmv.settlement_event_id
  WHERE cmv.event_type = 'reversal'
    AND cmv.quality_issue IS NOT NULL
UNION ALL
  SELECT
    head.id,
    head.receivable_id,
    head.opening_cmv_sale_order_id,
    head.opening_payment_date,
    head.opening_amount
  FROM public.financial_settlement_account_heads head
  WHERE head.account_kind = 'receivable'
    AND head.opening_amount > 0
    AND head.opening_cmv_sale_order_id IS NOT NULL
    AND head.opening_cmv_amount IS NULL
UNION ALL
  SELECT
    receivable.id,
    receivable.id,
    receivable.sale_order_id,
    receivable.payment_date,
    receivable.amount_received
  FROM public.accounts_receivable receivable
  WHERE receivable.sale_order_id IS NOT NULL
    AND receivable.amount_received > 0
    AND receivable.status NOT IN ('cancelled', 'cancelado')
    AND NOT EXISTS (
      SELECT 1
        FROM public.financial_settlement_account_heads head
       WHERE head.receivable_id = receivable.id
    )
    AND NOT EXISTS (
      SELECT 1
        FROM public.sale_order_cmv_recognized legacy_cmv
       WHERE legacy_cmv.receivable_id = receivable.id
         AND legacy_cmv.sale_order_id = receivable.sale_order_id
    );

COMMENT ON VIEW public.financial_settlement_cmv_pending IS
  'Efeitos de caixa sem CMV comprovado na propria data: recebimento, estorno ou opening legado. Pendencias permanecem na competencia original mesmo apos estorno posterior; nao retrodata custo.';

COMMENT ON VIEW public.financial_cash_cmv_movements IS
  'CMV por recebimento/estorno. Eventos novos preservam cada data; legacy=true identifica reconhecimento anterior ou saldo de abertura, inclusive sem data.';

CREATE OR REPLACE FUNCTION public.get_financial_settlement_history(
  p_kind text,
  p_account_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_head jsonb;
  v_events jsonb;
  v_projection record;
  v_opening_amount numeric;
  v_opening_date date;
  v_opening_method text;
  v_opening_status text;
  v_opening_category text;
  v_opening_cmv_sale_order_id uuid;
  v_opening_cmv_amount numeric;
  v_opening_cmv_date date;
  v_opening_cmv_total numeric;
  v_opening_cmv_gross numeric;
  v_captured boolean := false;
BEGIN
  IF NOT public.user_has_any_role(ARRAY['admin', 'gerente']) THEN
    RAISE EXCEPTION 'Permissao negada para historico financeiro'
      USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('payable', 'receivable') OR p_account_id IS NULL THEN
    RAISE EXCEPTION 'kind/account_id invalidos' USING ERRCODE = '22023';
  END IF;

  IF p_kind = 'payable' THEN
    SELECT head.opening_amount, head.opening_payment_date,
           head.opening_payment_method, head.opening_status,
           head.opening_category, head.opening_cmv_sale_order_id,
           head.opening_cmv_amount, head.opening_cmv_date,
           head.opening_cmv_total_snapshot,
           head.opening_receivable_gross_snapshot, true
      INTO v_opening_amount, v_opening_date, v_opening_method,
           v_opening_status, v_opening_category,
           v_opening_cmv_sale_order_id, v_opening_cmv_amount,
           v_opening_cmv_date, v_opening_cmv_total, v_opening_cmv_gross,
           v_captured
      FROM public.financial_settlement_account_heads head
     WHERE head.payable_id = p_account_id;
    IF NOT FOUND THEN
      SELECT COALESCE(payable.amount_paid, 0), payable.payment_date,
             payable.payment_method, payable.status, payable.category
        INTO v_opening_amount, v_opening_date, v_opening_method,
             v_opening_status, v_opening_category
        FROM public.accounts_payable payable
       WHERE payable.id = p_account_id;
    END IF;
  ELSE
    SELECT head.opening_amount, head.opening_payment_date,
           head.opening_payment_method, head.opening_status,
           head.opening_category, head.opening_cmv_sale_order_id,
           head.opening_cmv_amount, head.opening_cmv_date,
           head.opening_cmv_total_snapshot,
           head.opening_receivable_gross_snapshot, true
      INTO v_opening_amount, v_opening_date, v_opening_method,
           v_opening_status, v_opening_category,
           v_opening_cmv_sale_order_id, v_opening_cmv_amount,
           v_opening_cmv_date, v_opening_cmv_total, v_opening_cmv_gross,
           v_captured
      FROM public.financial_settlement_account_heads head
     WHERE head.receivable_id = p_account_id;
    IF NOT FOUND THEN
      SELECT COALESCE(receivable.amount_received, 0), receivable.payment_date,
             receivable.payment_method, receivable.status, receivable.category
        INTO v_opening_amount, v_opening_date, v_opening_method,
             v_opening_status, v_opening_category
        FROM public.accounts_receivable receivable
       WHERE receivable.id = p_account_id;
    END IF;
  END IF;
  IF v_opening_amount IS NULL THEN
    RAISE EXCEPTION 'Titulo % % nao encontrado', p_kind, p_account_id
      USING ERRCODE = 'P0002';
  END IF;

  v_head := pg_catalog.jsonb_build_object(
    'captured', v_captured,
    'opening_amount', v_opening_amount,
    'opening_payment_date', v_opening_date,
    'opening_payment_method', v_opening_method,
    'opening_status', v_opening_status,
    'opening_category', v_opening_category,
    'opening_cmv_sale_order_id', v_opening_cmv_sale_order_id,
    'opening_cmv_amount', v_opening_cmv_amount,
    'opening_cmv_date', v_opening_cmv_date,
    'opening_cmv_total_snapshot', v_opening_cmv_total,
    'opening_receivable_gross_snapshot', v_opening_cmv_gross,
    'opening_history_warning', CASE WHEN v_opening_amount > 0 THEN
      'Saldo acumulado anterior sem discriminação individual; não representa um movimento novo.'
      ELSE NULL END,
    'opening_date_missing', v_opening_amount > 0 AND v_opening_date IS NULL
  );
  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', event.id,
      'command_id', event.command_id,
      'batch_position', event.batch_position,
      'event_type', event.event_type,
      'amount', event.amount,
      'signed_amount', CASE event.event_type
        WHEN 'settlement' THEN event.amount ELSE -event.amount END,
      'effective_on', event.effective_on,
      'method', event.method,
      'bank_account_id', event.bank_account_id,
      'category', event.category,
      'reference', event.reference,
      'notes', event.notes,
      'source_type', event.source_type,
      'source_reference', event.source_reference,
      'source_line_key', event.source_line_key,
      'reverses_event_id', event.reverses_event_id,
      'reversed', event.event_type = 'settlement' AND EXISTS (
        SELECT 1 FROM public.financial_settlement_events reversal
         WHERE reversal.reverses_event_id = event.id
      ),
      'actor_id', event.actor_id,
      'created_at', event.created_at
    ) ORDER BY event.effective_on, event.created_at, event.id
  ), '[]'::jsonb)
    INTO v_events
    FROM public.financial_settlement_events event
   WHERE (p_kind = 'payable' AND event.payable_id = p_account_id)
      OR (p_kind = 'receivable' AND event.receivable_id = p_account_id);

  IF v_captured THEN
    SELECT * INTO v_projection
      FROM private.financial_account_projection_159(p_kind, p_account_id);
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'kind', p_kind,
    'account_id', p_account_id,
    'head', v_head,
    'events', v_events,
    'projection', CASE WHEN v_captured THEN pg_catalog.jsonb_build_object(
      'settled_amount', v_projection.settled_amount,
      'status', v_projection.projected_status,
      'payment_date', v_projection.projected_payment_date,
      'payment_method', v_projection.projected_payment_method
    ) ELSE NULL END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_financial_settlement_cash_period(
  p_start_date date,
  p_end_date date,
  p_kind text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_events jsonb;
  v_legacy jsonb;
  v_cmv_events jsonb;
  v_cmv_legacy jsonb;
  v_cmv_pending jsonb;
BEGIN
  IF NOT public.user_has_any_role(ARRAY['admin', 'gerente']) THEN
    RAISE EXCEPTION 'Permissao negada para movimentos financeiros'
      USING ERRCODE = '42501';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date
     OR p_start_date::text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     OR p_end_date::text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     OR (p_kind IS NOT NULL AND p_kind NOT IN ('payable', 'receivable')) THEN
    RAISE EXCEPTION 'Periodo/kind invalido' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(movement)
    ORDER BY movement.effective_on, movement.id), '[]'::jsonb)
    INTO v_events
    FROM public.financial_cash_movements movement
   WHERE movement.legacy IS FALSE
     AND movement.effective_on BETWEEN p_start_date AND p_end_date
     AND (p_kind IS NULL OR movement.kind = p_kind);
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(movement)
    ORDER BY movement.effective_on NULLS LAST, movement.id), '[]'::jsonb)
    INTO v_legacy
    FROM public.financial_cash_movements movement
   WHERE movement.legacy IS TRUE
     AND (p_kind IS NULL OR movement.kind = p_kind);
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(movement)
    ORDER BY movement.effective_on, movement.id), '[]'::jsonb)
    INTO v_cmv_events
    FROM public.financial_cash_cmv_movements movement
   WHERE movement.legacy IS FALSE
     AND movement.effective_on BETWEEN p_start_date AND p_end_date;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(movement)
    ORDER BY movement.effective_on NULLS LAST, movement.id), '[]'::jsonb)
    INTO v_cmv_legacy
    FROM public.financial_cash_cmv_movements movement
   WHERE movement.legacy IS TRUE;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(pending)
    ORDER BY pending.effective_on, pending.settlement_event_id), '[]'::jsonb)
    INTO v_cmv_pending
    FROM public.financial_settlement_cmv_pending pending
   WHERE pending.effective_on BETWEEN p_start_date AND p_end_date;
  RETURN pg_catalog.jsonb_build_object(
    'start_date', p_start_date,
    'end_date', p_end_date,
    'kind', p_kind,
    'events', v_events,
    'legacy_openings', v_legacy,
    'cmv_events', v_cmv_events,
    'cmv_legacy_openings', v_cmv_legacy,
    'cmv_pending', v_cmv_pending,
    'cmv_complete', pg_catalog.jsonb_array_length(v_cmv_pending) = 0,
    'legacy_excluded_from_event_totals', true,
    'totals', pg_catalog.jsonb_build_object(
      'payable', COALESCE((
        SELECT pg_catalog.sum(movement.amount_signed)
          FROM public.financial_cash_movements movement
         WHERE movement.legacy IS FALSE
           AND movement.kind = 'payable'
           AND movement.effective_on BETWEEN p_start_date AND p_end_date
      ), 0),
      'receivable', COALESCE((
        SELECT pg_catalog.sum(movement.amount_signed)
          FROM public.financial_cash_movements movement
         WHERE movement.legacy IS FALSE
           AND movement.kind = 'receivable'
           AND movement.effective_on BETWEEN p_start_date AND p_end_date
      ), 0),
      'cmv', COALESCE((
        SELECT pg_catalog.sum(movement.amount_signed)
          FROM public.financial_cash_cmv_movements movement
         WHERE movement.legacy IS FALSE
           AND movement.effective_on BETWEEN p_start_date AND p_end_date
      ), 0)
    )
  );
END;
$function$;

-- Writer legado sensivel: a baixa do ciclo agora usa o mesmo ledger. O ciclo
-- continua com sua idempotencia/status, mas nao pode mais projetar AP por UPDATE.
CREATE OR REPLACE FUNCTION public.mark_contractor_payment_cycle_paid(
  p_cycle_id uuid,
  p_payment_date date,
  p_payment_method text DEFAULT NULL,
  p_correlation_id uuid DEFAULT pg_catalog.gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_cycle public.contractor_payment_cycles%ROWTYPE;
  v_payable public.accounts_payable%ROWTYPE;
  v_before jsonb;
  v_after jsonb;
  v_effective_method text;
  v_hash text;
  v_key text;
  v_command_id uuid := COALESCE(p_correlation_id, pg_catalog.gen_random_uuid());
  v_settled numeric := 0;
  v_outstanding numeric := 0;
  v_settlement_result jsonb := NULL;
BEGIN
  IF NOT public.user_has_any_role(ARRAY['admin'])
     OR NOT public.can_see_strap_financial_values() THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  SELECT cycle.* INTO v_cycle
    FROM public.contractor_payment_cycles cycle
   WHERE cycle.id = p_cycle_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ciclo nao encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF p_payment_date IS NULL THEN
    RAISE EXCEPTION 'Data de pagamento obrigatoria' USING ERRCODE = '22023';
  END IF;
  IF p_payment_date > (
    pg_catalog.clock_timestamp() AT TIME ZONE 'America/Sao_Paulo'
  )::date THEN
    RAISE EXCEPTION 'Data de pagamento futura nao permitida'
      USING ERRCODE = '22023';
  END IF;
  IF v_cycle.accounts_payable_id IS NOT NULL THEN
    SELECT payable.* INTO v_payable
      FROM public.accounts_payable payable
     WHERE payable.id = v_cycle.accounts_payable_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Conta a pagar do ciclo nao encontrada'
        USING ERRCODE = 'P0002';
    END IF;
  END IF;
  v_effective_method := COALESCE(
    private.normalize_financial_settlement_method_159(p_payment_method),
    private.normalize_financial_settlement_method_159(v_payable.payment_method),
    'outro'
  );
  v_key := 'contractor-cycle-paid:' || v_cycle.id::text;
  v_hash := public.strap_payload_hash(pg_catalog.jsonb_build_object(
    'cycle_id', v_cycle.id,
    'accounts_payable_id', v_cycle.accounts_payable_id,
    'payment_date', p_payment_date,
    'payment_method', v_effective_method
  ));
  IF v_cycle.status = 'paid' THEN
    IF v_cycle.payment_idempotency_key = v_key
       AND v_cycle.payment_payload_hash = v_hash THEN
      RETURN pg_catalog.jsonb_build_object(
        'cycle_id', v_cycle.id,
        'replayed', true,
        'accounts_payable_id', v_cycle.accounts_payable_id
      );
    END IF;
    RAISE EXCEPTION 'Replay de pagamento divergente para ciclo ja pago'
      USING ERRCODE = '23505';
  END IF;
  IF v_cycle.status <> 'closed' THEN
    RAISE EXCEPTION 'Ciclo precisa estar fechado' USING ERRCODE = '55000';
  END IF;
  v_before := pg_catalog.to_jsonb(v_cycle);

  IF v_cycle.accounts_payable_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.financial_settlement_account_heads head
       WHERE head.payable_id = v_payable.id
    ) THEN
      v_settled := private.financial_settled_amount_159('payable', v_payable.id);
    ELSE
      v_settled := COALESCE(v_payable.amount_paid, 0);
    END IF;
    v_outstanding := v_payable.amount - v_settled;
    IF v_outstanding < 0
       OR v_outstanding::text IN ('NaN', 'Infinity', '-Infinity') THEN
      RAISE EXCEPTION 'Conta a pagar do ciclo possui saldo invalido'
        USING ERRCODE = '23514';
    END IF;
    IF v_outstanding > 0 THEN
      IF v_outstanding IS DISTINCT FROM pg_catalog.round(v_outstanding, 2) THEN
        RAISE EXCEPTION
          'Saldo do ciclo precisa estar expresso em centavos antes da baixa'
          USING ERRCODE = '23514';
      END IF;
      v_settlement_result := private.execute_financial_settlement_core_159(
        v_command_id,
        'register',
        pg_catalog.jsonb_build_object(
          'entries', pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
              'kind', 'payable',
              'account_id', v_payable.id,
              'amount', v_outstanding,
              'settled_on', p_payment_date,
              'method', v_effective_method,
              'bank_account_id', NULL,
              'reference', 'Ciclo terceirizado ' || v_cycle.id::text,
              'notes', 'Baixa administrativa do ciclo de pagamento',
              'source_line_key', v_cycle.id::text
            )
          )
        ),
        'contractor_cycle',
        v_cycle.id::text
      );
    ELSE
      PERFORM private.ensure_financial_settlement_head_159(
        'payable', v_payable.id, auth.uid()
      );
      PERFORM private.apply_financial_account_projection_159(
        'payable', v_payable.id
      );
    END IF;
  END IF;

  PERFORM pg_catalog.set_config('app.strap_cycle_payment', '1', true);
  UPDATE public.contractor_payment_cycles cycle
     SET status = 'paid',
         paid_by = auth.uid(),
         paid_at = pg_catalog.now(),
         payment_date_snapshot = p_payment_date,
         payment_method_snapshot = v_effective_method,
         payment_idempotency_key = v_key,
         payment_payload_hash = v_hash
   WHERE cycle.id = v_cycle.id
   RETURNING cycle.* INTO v_cycle;
  v_after := pg_catalog.to_jsonb(v_cycle) || pg_catalog.jsonb_build_object(
    'accounts_payable', (
      SELECT pg_catalog.to_jsonb(payable)
        FROM public.accounts_payable payable
       WHERE payable.id = v_cycle.accounts_payable_id
    )
  );
  INSERT INTO public.artisanal_strap_operational_audit_log (
    entity_type, entity_id, action, before_data, after_data, reason,
    correlation_id, actor_id
  ) VALUES (
    'contractor_payment_cycle', v_cycle.id, 'update', v_before, v_after,
    'Baixa administrativa do ciclo de pagamento', v_command_id, auth.uid()
  );
  RETURN pg_catalog.jsonb_build_object(
    'cycle_id', v_cycle.id,
    'status', 'paid',
    'accounts_payable_id', v_cycle.accounts_payable_id,
    'settlement', v_settlement_result,
    'replayed', false
  );
END;
$function$;

ALTER TABLE public.financial_settlement_command_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_settlement_account_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_settlement_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_settlement_cmv_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY financial_settlement_receipts_read
  ON public.financial_settlement_command_receipts
  FOR SELECT TO authenticated
  USING (public.user_has_any_role(ARRAY['admin', 'gerente']));
CREATE POLICY financial_settlement_heads_read
  ON public.financial_settlement_account_heads
  FOR SELECT TO authenticated
  USING (public.user_has_any_role(ARRAY['admin', 'gerente']));
CREATE POLICY financial_settlement_events_read
  ON public.financial_settlement_events
  FOR SELECT TO authenticated
  USING (public.user_has_any_role(ARRAY['admin', 'gerente']));
CREATE POLICY financial_settlement_cmv_events_read
  ON public.financial_settlement_cmv_events
  FOR SELECT TO authenticated
  USING (public.user_has_any_role(ARRAY['admin', 'gerente']));

-- A view de CMV e SECURITY INVOKER e inclui o reconhecimento legado. A policy
-- historica aceitava qualquer aprovado e vazaria custo para papeis nao
-- financeiros atraves desse ramo do UNION.
DROP POLICY IF EXISTS socr_select ON public.sale_order_cmv_recognized;
CREATE POLICY socr_select
  ON public.sale_order_cmv_recognized
  FOR SELECT TO authenticated
  USING (public.user_has_any_role(ARRAY['admin', 'gerente']));

REVOKE ALL ON TABLE public.financial_settlement_command_receipts
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.financial_settlement_account_heads
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.financial_settlement_events
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.financial_settlement_cmv_events
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.financial_settlement_command_receipts
  TO authenticated, service_role;
GRANT SELECT ON TABLE public.financial_settlement_account_heads
  TO authenticated, service_role;
GRANT SELECT ON TABLE public.financial_settlement_events
  TO authenticated, service_role;
GRANT SELECT ON TABLE public.financial_settlement_cmv_events
  TO authenticated, service_role;

REVOKE ALL ON TABLE public.financial_cash_movements
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.financial_cash_cmv_movements
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.financial_settlement_cmv_pending
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.financial_cash_movements
  TO authenticated, service_role;
GRANT SELECT ON TABLE public.financial_cash_cmv_movements
  TO authenticated, service_role;
GRANT SELECT ON TABLE public.financial_settlement_cmv_pending
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.execute_financial_settlement(uuid,text,jsonb)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_financial_settlement_history(text,uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_financial_settlement_cash_period(date,date,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_financial_settlement(uuid,text,jsonb)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_financial_settlement_history(text,uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_financial_settlement_cash_period(date,date,text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION private.tg_financial_settlement_immutable_159()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.normalize_financial_settlement_method_159(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.financial_cash_status_159(text,text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.ensure_financial_settlement_head_159(text,uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.financial_settled_amount_159(text,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.financial_account_projection_159(text,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.tg_assert_financial_account_projection_159()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.apply_financial_account_projection_159(text,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.record_financial_cmv_event_159(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.execute_financial_settlement(uuid,text,jsonb) IS
  'Command boundary atomico/idempotente de baixa e estorno AP/AR. A origem publica e sempre manual; integracoes usam o core privado server-side.';
COMMENT ON FUNCTION public.get_financial_settlement_history(text,uuid) IS
  'Historico de um titulo: head legado separado, eventos imutaveis e projecao atual.';
COMMENT ON FUNCTION public.get_financial_settlement_cash_period(date,date,text) IS
  'Read model de caixa por periodo. Eventos novos ficam separados de openings legados e inclui qualidade/pending de CMV.';

DO $contracts_159$
DECLARE
  v_core record;
  v_public record;
  v_history record;
  v_cash record;
  v_mark_definition text;
  v_core_definition text;
BEGIN
  IF pg_catalog.to_regclass('public.financial_settlement_command_receipts') IS NULL
     OR pg_catalog.to_regclass('public.financial_settlement_account_heads') IS NULL
     OR pg_catalog.to_regclass('public.financial_settlement_events') IS NULL
     OR pg_catalog.to_regclass('public.financial_settlement_cmv_events') IS NULL THEN
    RAISE EXCEPTION 'Contrato 15900: tabelas do ledger ausentes';
  END IF;
  IF EXISTS (SELECT 1 FROM public.financial_settlement_command_receipts)
     OR EXISTS (SELECT 1 FROM public.financial_settlement_account_heads)
     OR EXISTS (SELECT 1 FROM public.financial_settlement_events)
     OR EXISTS (SELECT 1 FROM public.financial_settlement_cmv_events) THEN
    RAISE EXCEPTION 'Contrato 15900: migration nao pode criar fatos financeiros/backfill';
  END IF;

  SELECT procedure.prosecdef, procedure.proconfig,
         pg_catalog.pg_get_functiondef(procedure.oid) AS definition
    INTO v_core
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'private'
     AND procedure.proname = 'execute_financial_settlement_core_159'
     AND pg_catalog.pg_get_function_identity_arguments(procedure.oid) =
       'p_command_id uuid, p_command text, p_payload jsonb, p_source_type text, p_source_reference text';
  IF NOT FOUND OR NOT v_core.prosecdef
     OR NOT (v_core.proconfig @> ARRAY['search_path=""']::text[]) THEN
    RAISE EXCEPTION 'Contrato 15900: core privado/search_path invalido';
  END IF;
  v_core_definition := v_core.definition;
  IF position('pg_advisory_xact_lock' IN v_core_definition) = 0
     OR position('FOR UPDATE' IN v_core_definition) = 0
     OR position('Replay divergente' IN v_core_definition) = 0
     OR position('source_type' IN v_core_definition) = 0 THEN
    RAISE EXCEPTION 'Contrato 15900: locks/hash/origem ausentes no core';
  END IF;

  SELECT procedure.prosecdef, procedure.proconfig,
         pg_catalog.pg_get_functiondef(procedure.oid) AS definition
    INTO v_public
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname = 'execute_financial_settlement'
     AND pg_catalog.pg_get_function_identity_arguments(procedure.oid) =
       'p_command_id uuid, p_command text, p_payload jsonb';
  IF NOT FOUND OR NOT v_public.prosecdef
     OR NOT (v_public.proconfig @> ARRAY['search_path=""']::text[])
     OR position('user_has_any_role' IN v_public.definition) = 0
     OR position('''manual''' IN v_public.definition) = 0 THEN
    RAISE EXCEPTION 'Contrato 15900: wrapper publico/ACL/origem invalido';
  END IF;

  SELECT procedure.prosecdef, procedure.proconfig INTO v_history
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname = 'get_financial_settlement_history';
  SELECT procedure.prosecdef, procedure.proconfig INTO v_cash
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname = 'get_financial_settlement_cash_period';
  IF NOT v_history.prosecdef OR NOT v_cash.prosecdef
     OR NOT (v_history.proconfig @> ARRAY['search_path=""']::text[])
     OR NOT (v_cash.proconfig @> ARRAY['search_path=""']::text[]) THEN
    RAISE EXCEPTION 'Contrato 15900: read models sem hardening';
  END IF;

  IF pg_catalog.has_function_privilege(
       'anon', 'public.execute_financial_settlement(uuid,text,jsonb)', 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'authenticated', 'public.execute_financial_settlement(uuid,text,jsonb)', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated',
       'private.execute_financial_settlement_core_159(uuid,text,jsonb,text,text)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role',
       'private.execute_financial_settlement_core_159(uuid,text,jsonb,text,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Contrato 15900: ACL das funcoes invalida';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM (VALUES
        ('public.financial_settlement_command_receipts'),
        ('public.financial_settlement_account_heads'),
        ('public.financial_settlement_events'),
        ('public.financial_settlement_cmv_events')
      ) AS relation_name(name)
      CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'))
        AS privilege_name(name)
     WHERE pg_catalog.has_table_privilege(
       'service_role', relation_name.name, privilege_name.name
     ) OR pg_catalog.has_table_privilege(
       'authenticated', relation_name.name, privilege_name.name
     )
  ) THEN
    RAISE EXCEPTION 'Contrato 15900: ledger permite DML direto fora do core';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy policy
      JOIN pg_catalog.pg_class relation ON relation.oid = policy.polrelid
      JOIN pg_catalog.pg_namespace namespace
        ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relname = 'sale_order_cmv_recognized'
       AND policy.polname = 'socr_select'
       AND position(
         'user_has_any_role' IN pg_catalog.pg_get_expr(
           policy.polqual, policy.polrelid
         )
       ) > 0
  ) THEN
    RAISE EXCEPTION 'Contrato 15900: CMV legado vaza para papel nao financeiro';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN (
        'financial_cash_movements',
        'financial_cash_cmv_movements',
        'financial_settlement_cmv_pending'
      )
      AND relation.relkind = 'v'
      AND relation.reloptions @> ARRAY['security_invoker=true']::text[]
    GROUP BY namespace.nspname
    HAVING pg_catalog.count(*) = 3
  ) THEN
    RAISE EXCEPTION 'Contrato 15900: views devem ser security_invoker';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(procedure.oid)
    INTO v_mark_definition
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname = 'mark_contractor_payment_cycle_paid'
     AND pg_catalog.pg_get_function_identity_arguments(procedure.oid) =
       'p_cycle_id uuid, p_payment_date date, p_payment_method text, p_correlation_id uuid';
  IF position(
       'execute_financial_settlement_core_159' IN COALESCE(v_mark_definition, '')
     ) = 0
     OR position(
       'UPDATE public.accounts_payable SET status=''paid'',amount_paid=amount'
       IN COALESCE(v_mark_definition, '')
     ) > 0 THEN
    RAISE EXCEPTION 'Contrato 15900: ciclo terceirizado ainda contorna ledger';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger trigger_info
    JOIN pg_catalog.pg_class relation ON relation.oid = trigger_info.tgrelid
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN ('accounts_payable', 'accounts_receivable')
      AND trigger_info.tgname IN (
        'trg_zz_financial_projection_ap',
        'trg_zz_financial_projection_ar'
      )
      AND NOT trigger_info.tgisinternal
    GROUP BY namespace.nspname
    HAVING pg_catalog.count(*) = 2
  ) THEN
    RAISE EXCEPTION 'Contrato 15900: guards AP/AR ausentes';
  END IF;
END;
$contracts_159$;
