-- Fronteira transacional unica para OCs genericas.
--
-- Invariantes:
--   * request_id duravel + hash do payload: replay nao repete efeitos;
--   * ordem de lock: produtos UUID -> embalagens UUID -> cabecalho da OC -> itens UUID;
--   * criacao/edicao/cancelamento/recebimento sao atomicos;
--   * recebimento credita quantidade/grade, grava movimento, atualiza item/OC
--     e persiste o recibo na mesma transacao;
--   * o canal artesanal strap_demand permanece exclusivamente nas RPCs dele.
--
-- Esta migration nao altera valores de negocio existentes. Ela torna explicita
-- a identidade de estoque de cada linha: exatamente produto OU embalagem.

BEGIN;

ALTER TABLE public.purchase_order_items
  ALTER COLUMN product_id DROP NOT NULL;

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint constraint_row
     WHERE constraint_row.conrelid = 'public.purchase_order_items'::regclass
       AND constraint_row.conname = 'purchase_order_items_exactly_one_stock_identity_ck'
  ) THEN
    ALTER TABLE public.purchase_order_items
      ADD CONSTRAINT purchase_order_items_exactly_one_stock_identity_ck
      CHECK ((product_id IS NULL) <> (box_type_id IS NULL)) NOT VALID;
  END IF;
END;
$constraint$;

ALTER TABLE public.purchase_order_items
  VALIDATE CONSTRAINT purchase_order_items_exactly_one_stock_identity_ck;

CREATE UNIQUE INDEX IF NOT EXISTS ux_purchase_order_items_po_box_type
  ON public.purchase_order_items (purchase_order_id, box_type_id)
  WHERE box_type_id IS NOT NULL;

COMMENT ON CONSTRAINT purchase_order_items_exactly_one_stock_identity_ck
  ON public.purchase_order_items IS
  'Cada linha de OC aponta para exatamente uma identidade canonica de estoque: products ou box_types.';

-- Ledger proprio: stock_movements.product_id nao vira ponte polimorfica para
-- box_types. Cada recebimento congela before/after e o item exato da OC.
CREATE TABLE IF NOT EXISTS public.box_type_stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  box_type_id uuid NOT NULL REFERENCES public.box_types(id),
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id),
  purchase_order_item_id uuid NOT NULL REFERENCES public.purchase_order_items(id),
  movement_type text NOT NULL CHECK (movement_type IN ('in', 'out', 'adjustment')),
  quantity numeric NOT NULL CHECK (quantity > 0),
  previous_stock numeric NOT NULL,
  new_stock numeric NOT NULL,
  unit_price_at_movement numeric,
  movement_reason text NOT NULL CHECK (
    movement_reason IN ('compra', 'consumo_op', 'ajuste', 'devolucao', 'estorno')
  ),
  client_request_id uuid NOT NULL,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_request_id, purchase_order_item_id)
);
ALTER TABLE public.box_type_stock_movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.box_type_stock_movements
  FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.box_type_stock_movements TO service_role;

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS freight_value numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS freight_type text,
  ADD COLUMN IF NOT EXISTS payment_terms text,
  ADD COLUMN IF NOT EXISTS quotation_award_snapshot_id uuid;

-- Espelho da fronteira de produtos criada na 111. A ordenacao UUID e parte do
-- contrato de deadlock: epoch -> products -> box_types -> OC -> itens.
CREATE OR REPLACE FUNCTION public.lock_purchase_order_box_types_121(
  p_box_type_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_box_type_ids uuid[];
  v_box_type_id uuid;
  v_expected integer;
  v_found integer;
BEGIN
  IF pg_catalog.array_position(p_box_type_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Embalagem nula na fronteira de compra'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(
           pg_catalog.array_agg(scope.box_type_id ORDER BY scope.box_type_id),
           ARRAY[]::uuid[]
         )
    INTO v_box_type_ids
    FROM (
      SELECT DISTINCT input.box_type_id
        FROM pg_catalog.unnest(
          COALESCE(p_box_type_ids, ARRAY[]::uuid[])
        ) input(box_type_id)
    ) scope;
  v_expected := pg_catalog.cardinality(v_box_type_ids);

  FOREACH v_box_type_id IN ARRAY v_box_type_ids
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'purchase-order-box-type:' || v_box_type_id::text,
      0
    ));
  END LOOP;

  SELECT pg_catalog.count(*)::integer
    INTO v_found
    FROM (
      SELECT box_type.id
        FROM public.box_types box_type
       WHERE box_type.id = ANY(v_box_type_ids)
       ORDER BY box_type.id
       FOR UPDATE
    ) locked_box_types;
  IF v_found <> v_expected THEN
    RAISE EXCEPTION 'Uma ou mais embalagens da compra deixaram de existir'
      USING ERRCODE = '40001';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.lock_purchase_order_box_types_121(uuid[])
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.purchase_order_command_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_request_id uuid NOT NULL UNIQUE,
  command_name text NOT NULL CHECK (command_name IN (
    'create', 'append', 'edit', 'update', 'cancel', 'receive', 'mrp',
    'force_delete_product', 'quotation_winner'
  )),
  purchase_order_id uuid REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  request_hash text NOT NULL CHECK (length(request_hash) = 32),
  actor_id uuid,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.purchase_order_command_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.purchase_order_command_receipts
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.purchase_order_command_receipts TO service_role;

COMMENT ON TABLE public.purchase_order_command_receipts IS
  'Recibos imutaveis dos comandos de OC generica. O UUID do cliente e o hash '
  'impedem replay divergente; a linha nasce na mesma transacao dos efeitos.';

CREATE UNIQUE INDEX IF NOT EXISTS ux_purchase_quotation_one_winner_121
  ON public.purchase_quotation_responses (quotation_id)
  WHERE is_winner IS TRUE;

CREATE TABLE IF NOT EXISTS public.purchase_quotation_award_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL UNIQUE REFERENCES public.purchase_quotations(id),
  response_id uuid NOT NULL REFERENCES public.purchase_quotation_responses(id),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id),
  snapshot_digest text NOT NULL CHECK (length(snapshot_digest) = 32),
  snapshot jsonb NOT NULL,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.purchase_quotation_award_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.purchase_quotation_award_snapshots
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.purchase_quotation_award_snapshots TO service_role;

CREATE OR REPLACE FUNCTION public.tg_preserve_purchase_quotation_award_snapshot_121()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION
    'Snapshot comercial vencedor e imutavel; gere uma nova cotacao'
    USING ERRCODE = '55000';
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_preserve_purchase_quotation_award_snapshot_121()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_preserve_purchase_quotation_award_snapshot_121
  ON public.purchase_quotation_award_snapshots;
CREATE TRIGGER trg_preserve_purchase_quotation_award_snapshot_121
  BEFORE UPDATE OR DELETE ON public.purchase_quotation_award_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_preserve_purchase_quotation_award_snapshot_121();

-- Espelha a leitura de condicao usada pela tela: a vista = hoje; numeros na
-- ordem digitada viram parcelas; texto sem prazo explicito preserva o rotulo no
-- cabecalho e usa o fallback operacional de 30 dias para o AP.
CREATE OR REPLACE FUNCTION public.purchase_order_payment_days_121(p_terms text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_match text[];
  v_day integer;
  v_days jsonb := '[]'::jsonb;
BEGIN
  IF pg_catalog.lower(COALESCE(p_terms, '')) LIKE '%vista%' THEN
    RETURN '[0]'::jsonb;
  END IF;
  FOR v_match IN
    SELECT match_row.matches
      FROM pg_catalog.regexp_matches(
        COALESCE(p_terms, ''), '([0-9]+)', 'g'
      ) AS match_row(matches)
  LOOP
    v_day := v_match[1]::integer;
    IF v_day < 0 OR v_day > 3650 THEN
      RAISE EXCEPTION 'Prazo financeiro da cotacao fora do limite: % dias', v_day
        USING ERRCODE = '22023';
    END IF;
    v_days := v_days || pg_catalog.jsonb_build_array(v_day);
  END LOOP;
  RETURN CASE WHEN pg_catalog.jsonb_array_length(v_days) > 0
    THEN v_days ELSE '[30]'::jsonb END;
END;
$function$;

REVOKE ALL ON FUNCTION public.purchase_order_payment_days_121(text)
  FROM PUBLIC, anon, authenticated, service_role;

DO $award_snapshot_fk_121$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint constraint_row
     WHERE constraint_row.conrelid = 'public.purchase_orders'::regclass
       AND constraint_row.conname = 'purchase_orders_quotation_award_snapshot_fk'
  ) THEN
    ALTER TABLE public.purchase_orders
      ADD CONSTRAINT purchase_orders_quotation_award_snapshot_fk
      FOREIGN KEY (quotation_award_snapshot_id)
      REFERENCES public.purchase_quotation_award_snapshots(id);
  END IF;
END;
$award_snapshot_fk_121$;

CREATE OR REPLACE FUNCTION public.tg_lock_purchase_quotation_after_award_121()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_quotation_id uuid;
  v_status text;
  v_marker text := pg_catalog.current_setting(
    'app.purchase_quotation_award_internal', true
  );
BEGIN
  IF TG_TABLE_NAME = 'purchase_quotations' THEN
    v_quotation_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
    IF TG_OP = 'UPDATE' THEN
      IF v_marker = OLD.id::text
         AND (
           pg_catalog.to_jsonb(NEW) - ARRAY[
             'selected_supplier_id', 'status', 'decision_at', 'decided_by'
           ]::text[]
         ) IS NOT DISTINCT FROM (
           pg_catalog.to_jsonb(OLD) - ARRAY[
             'selected_supplier_id', 'status', 'decision_at', 'decided_by'
           ]::text[]
         ) THEN
        RETURN NEW;
      END IF;
    END IF;
    IF pg_catalog.lower(COALESCE(OLD.status, '')) IN ('aprovada', 'approved') THEN
      RAISE EXCEPTION 'Cotacao aprovada e imutavel; crie nova cotacao para revisar'
        USING ERRCODE = '55000';
    END IF;
    IF TG_OP = 'UPDATE' THEN
      IF pg_catalog.lower(COALESCE(NEW.status, '')) IN ('aprovada', 'approved') THEN
        RAISE EXCEPTION 'Cotacao aprovada e imutavel; crie nova cotacao para revisar'
          USING ERRCODE = '55000';
      END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME = 'purchase_quotation_responses' THEN
    v_quotation_id := CASE WHEN TG_OP = 'DELETE'
      THEN OLD.quotation_id ELSE NEW.quotation_id END;
    IF TG_OP = 'UPDATE' THEN
      IF v_marker = v_quotation_id::text
         AND NEW.id IS NOT DISTINCT FROM OLD.id
         AND (
           pg_catalog.to_jsonb(NEW) - 'is_winner'
         ) IS NOT DISTINCT FROM (
           pg_catalog.to_jsonb(OLD) - 'is_winner'
         ) THEN
        RETURN NEW;
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'purchase_quotation_items' THEN
    v_quotation_id := CASE WHEN TG_OP = 'DELETE'
      THEN OLD.quotation_id ELSE NEW.quotation_id END;
  ELSE
    SELECT item.quotation_id
      INTO v_quotation_id
      FROM public.purchase_quotation_items item
     WHERE item.id = CASE WHEN TG_OP = 'DELETE'
       THEN OLD.quotation_item_id ELSE NEW.quotation_item_id END;
  END IF;

  SELECT quotation.status
    INTO v_status
    FROM public.purchase_quotations quotation
   WHERE quotation.id = v_quotation_id;
  IF pg_catalog.lower(COALESCE(v_status, '')) IN ('aprovada', 'approved') THEN
    RAISE EXCEPTION 'Cotacao aprovada e imutavel; crie nova cotacao para revisar'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_lock_purchase_quotation_after_award_121()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_lock_purchase_quotation_after_award_121
  ON public.purchase_quotations;
CREATE TRIGGER trg_lock_purchase_quotation_after_award_121
  BEFORE UPDATE OR DELETE ON public.purchase_quotations
  FOR EACH ROW EXECUTE FUNCTION public.tg_lock_purchase_quotation_after_award_121();
DROP TRIGGER IF EXISTS trg_lock_purchase_quotation_response_after_award_121
  ON public.purchase_quotation_responses;
CREATE TRIGGER trg_lock_purchase_quotation_response_after_award_121
  BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_quotation_responses
  FOR EACH ROW EXECUTE FUNCTION public.tg_lock_purchase_quotation_after_award_121();
DROP TRIGGER IF EXISTS trg_lock_purchase_quotation_item_after_award_121
  ON public.purchase_quotation_items;
CREATE TRIGGER trg_lock_purchase_quotation_item_after_award_121
  BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_quotation_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_lock_purchase_quotation_after_award_121();
DROP TRIGGER IF EXISTS trg_lock_purchase_quotation_price_after_award_121
  ON public.purchase_quotation_prices;
CREATE TRIGGER trg_lock_purchase_quotation_price_after_award_121
  BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_quotation_prices
  FOR EACH ROW EXECUTE FUNCTION public.tg_lock_purchase_quotation_after_award_121();

CREATE OR REPLACE FUNCTION public.purchase_order_receipt_factor_121(
  p_item_unit text,
  p_stock_unit text,
  p_purchase_unit text,
  p_conversion_rate numeric,
  p_dimensions_width numeric,
  p_dimensions_unit text,
  p_product_name text
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_item_unit text := public.po_norm_unit(p_item_unit);
  v_stock_unit text := public.po_norm_unit(p_stock_unit);
  v_purchase_unit text := public.po_norm_unit(
    COALESCE(NULLIF(pg_catalog.btrim(p_purchase_unit), ''), p_stock_unit)
  );
  v_rate numeric := p_conversion_rate;
  v_width_dm numeric;
BEGIN
  IF v_item_unit = v_stock_unit THEN
    RETURN 1;
  END IF;
  IF v_item_unit IS DISTINCT FROM v_purchase_unit THEN
    RAISE EXCEPTION
      '%: unidade da linha "%" nao casa com compra "%" nem estoque "%"',
      COALESCE(NULLIF(p_product_name, ''), 'Produto'),
      p_item_unit, p_purchase_unit, p_stock_unit
      USING ERRCODE = '22023';
  END IF;
  IF v_purchase_unit = v_stock_unit THEN
    RETURN 1;
  END IF;
  IF v_rate IS NULL OR v_rate <= 0 THEN
    RAISE EXCEPTION
      '%: conversao de compra invalida; configure taxa positiva',
      COALESCE(NULLIF(p_product_name, ''), 'Produto')
      USING ERRCODE = '22023';
  END IF;

  v_width_dm := CASE pg_catalog.lower(pg_catalog.btrim(COALESCE(p_dimensions_unit, '')))
    WHEN 'mm' THEN p_dimensions_width / 100
    WHEN 'cm' THEN p_dimensions_width / 10
    WHEN 'dm' THEN p_dimensions_width
    WHEN 'm'  THEN p_dimensions_width * 10
    ELSE NULL
  END;

  IF v_purchase_unit = 'm' AND v_stock_unit = 'dm²' THEN
    IF v_width_dm IS NULL OR v_width_dm <= 0 THEN
      RAISE EXCEPTION
        '%: largura com unidade e obrigatoria para converter m em dm2',
        COALESCE(NULLIF(p_product_name, ''), 'Produto')
        USING ERRCODE = '22023';
    END IF;
    RETURN 10 * v_width_dm;
  END IF;
  IF v_purchase_unit = 'm' AND v_stock_unit = 'm²' THEN
    IF v_width_dm IS NULL OR v_width_dm <= 0 THEN
      RAISE EXCEPTION
        '%: largura com unidade e obrigatoria para converter m em m2',
        COALESCE(NULLIF(p_product_name, ''), 'Produto')
        USING ERRCODE = '22023';
    END IF;
    RETURN v_width_dm / 10;
  END IF;
  RETURN v_rate;
END;
$function$;

REVOKE ALL ON FUNCTION public.purchase_order_receipt_factor_121(
  text,text,text,numeric,numeric,text,text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_purchase_order_payables_121(
  p_purchase_order_id uuid,
  p_payload jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_po public.purchase_orders%ROWTYPE;
  v_days jsonb;
  v_day jsonb;
  v_count integer;
  v_index integer := 0;
  v_offset integer;
  v_base numeric;
  v_amount numeric;
  v_due_date date;
  v_description text;
  v_created integer := 0;
BEGIN
  SELECT purchase_order.*
    INTO v_po
    FROM public.purchase_orders purchase_order
   WHERE purchase_order.id = p_purchase_order_id;
  IF NOT FOUND OR COALESCE(v_po.total_value, 0) <= 0 THEN
    RETURN 0;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.accounts_payable payable
     WHERE payable.purchase_order_id = v_po.id
        OR COALESCE(payable.notes, '') LIKE '%[OC#' || v_po.id::text || ']%'
  ) THEN
    RETURN 0;
  END IF;

  IF NULLIF(p_payload ->> 'payable_due_date', '') IS NOT NULL THEN
    v_days := pg_catalog.jsonb_build_array(
      ((p_payload ->> 'payable_due_date')::date - v_po.created_at::date)
    );
  ELSE
    v_days := CASE
      WHEN pg_catalog.jsonb_typeof(p_payload -> 'payment_days') = 'array'
       AND pg_catalog.jsonb_array_length(p_payload -> 'payment_days') > 0
      THEN p_payload -> 'payment_days'
      ELSE '[30]'::jsonb
    END;
  END IF;

  v_count := pg_catalog.jsonb_array_length(v_days);
  v_base := pg_catalog.trunc(v_po.total_value / v_count, 2);
  FOR v_day IN SELECT value FROM pg_catalog.jsonb_array_elements(v_days)
  LOOP
    v_index := v_index + 1;
    v_offset := (v_day #>> '{}')::integer;
    IF v_offset < 0 OR v_offset > 3650 THEN
      RAISE EXCEPTION 'Prazo financeiro da OC fora do limite: % dias', v_offset
        USING ERRCODE = '22023';
    END IF;
    v_due_date := v_po.created_at::date + v_offset;
    v_amount := CASE
      WHEN v_index = 1 THEN v_po.total_value - v_base * (v_count - 1)
      ELSE v_base
    END;
    IF v_amount <= 0 THEN
      CONTINUE;
    END IF;
    v_description := COALESCE(
      NULLIF(p_payload ->> 'payable_description', ''),
      'OC ' || v_po.order_number
    );
    IF v_count > 1 THEN
      v_description := v_description || ' - Parcela ' || v_index || '/' || v_count;
    END IF;

    INSERT INTO public.accounts_payable (
      description, amount, due_date, category, supplier_id, status, notes,
      purchase_order_id, installment_number, total_installments
    ) VALUES (
      pg_catalog.left(v_description, 200),
      v_amount,
      v_due_date,
      'material',
      v_po.supplier_id,
      'pending',
      'OC: ' || v_po.order_number || ' - ' || v_po.supplier_name
        || ' [OC#' || v_po.id::text || ']',
      v_po.id,
      v_index,
      v_count
    );
    v_created := v_created + 1;
  END LOOP;
  RETURN v_created;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_purchase_order_payables_121(uuid,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.execute_purchase_order_command(
  p_command text,
  p_payload jsonb,
  p_client_request_id uuid,
  p_purchase_order_id uuid DEFAULT NULL,
  p_expected_updated_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_is_service boolean := COALESCE(
    pg_catalog.current_setting('request.jwt.claim.role', true), ''
  ) = 'service_role' OR session_user IN ('postgres', 'supabase_admin', 'service_role');
  v_command text := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_command, '')));
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_request_hash text;
  v_existing_receipt public.purchase_order_command_receipts%ROWTYPE;
  v_receipt_id uuid := pg_catalog.gen_random_uuid();
  v_po public.purchase_orders%ROWTYPE;
  v_award_snapshot public.purchase_quotation_award_snapshots%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_box_type public.box_types%ROWTYPE;
  v_item_row public.purchase_order_items%ROWTYPE;
  v_header jsonb;
  v_patch jsonb;
  v_item jsonb;
  v_receive_line jsonb;
  v_product_ids uuid[] := ARRAY[]::uuid[];
  v_box_type_ids uuid[] := ARRAY[]::uuid[];
  v_revalidated_ids uuid[] := ARRAY[]::uuid[];
  v_revalidated_box_type_ids uuid[] := ARRAY[]::uuid[];
  v_product_id uuid;
  v_box_type_id uuid;
  v_item_id uuid;
  v_preexisting_id uuid;
  v_locked_id uuid;
  v_source_type text;
  v_freight_value numeric;
  v_snapshot_items jsonb;
  v_idempotency_key text;
  v_return_existing boolean := false;
  v_normalized_qty numeric;
  v_normalized_unit text;
  v_normalized_price numeric;
  v_input_price numeric;
  v_input_qty numeric;
  v_grade jsonb;
  v_grade_key text;
  v_grade_value numeric;
  v_grade_sum numeric;
  v_new_grade jsonb;
  v_factor numeric;
  v_expected_received numeric;
  v_receive_qty numeric;
  v_remaining numeric;
  v_received_stock numeric;
  v_previous_stock numeric;
  v_new_stock numeric;
  v_effective_unit_price numeric;
  v_new_unit_price numeric;
  v_movement_id uuid;
  v_movement_ids uuid[] := ARRAY[]::uuid[];
  v_received_items jsonb := '[]'::jsonb;
  v_item_results jsonb := '[]'::jsonb;
  v_payables_created integer := 0;
  v_response jsonb;
  v_is_complete boolean;
  v_receive_all boolean := COALESCE((v_payload ->> 'receive_all')::boolean, false);
  v_should_receive boolean := false;
  v_deduplicate_sale_order_id uuid;
  v_skip_append boolean := false;
BEGIN
  IF NOT v_is_service AND (
    NOT public.is_approved_user()
    OR NOT public.user_has_any_role(ARRAY['admin', 'gerente'])
  ) THEN
    RAISE EXCEPTION
      'Permission denied: comando de OC exige Administracao ou Gerencia'
      USING ERRCODE = '42501';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id e obrigatorio'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.jsonb_typeof(v_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'payload de comando de OC deve ser objeto JSON'
      USING ERRCODE = '22023';
  END IF;
  IF v_command NOT IN ('create', 'append', 'edit', 'update', 'cancel', 'receive') THEN
    RAISE EXCEPTION 'Comando de OC invalido: %', p_command
      USING ERRCODE = '22023';
  END IF;

  v_request_hash := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'command', v_command,
    'purchase_order_id', p_purchase_order_id,
    'expected_updated_at', p_expected_updated_at,
    'payload', v_payload
  )::text);

  -- Primeiro lock de negocio comum aos writers de PV/produto/OC (111).
  PERFORM public.lock_sale_order_purchase_allocation();
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'purchase-order-command:' || p_client_request_id::text, 0
  ));
  SELECT receipt.*
    INTO v_existing_receipt
    FROM public.purchase_order_command_receipts receipt
   WHERE receipt.client_request_id = p_client_request_id
   FOR UPDATE;
  IF FOUND THEN
    IF v_existing_receipt.command_name IS DISTINCT FROM v_command
       OR v_existing_receipt.request_hash IS DISTINCT FROM v_request_hash
       OR (
         NOT v_is_service
         AND v_existing_receipt.actor_id IS DISTINCT FROM v_actor_id
       ) THEN
      RAISE EXCEPTION 'Replay divergente para client_request_id %', p_client_request_id
        USING ERRCODE = '22000';
    END IF;
    RETURN v_existing_receipt.response || pg_catalog.jsonb_build_object(
      'replayed', true,
      'receipt_id', v_existing_receipt.id
    );
  END IF;

  IF v_command = 'create' THEN
    IF pg_catalog.jsonb_typeof(v_payload -> 'header') IS DISTINCT FROM 'object'
       OR pg_catalog.jsonb_typeof(v_payload -> 'items') IS DISTINCT FROM 'array'
       OR pg_catalog.jsonb_array_length(v_payload -> 'items') = 0 THEN
      RAISE EXCEPTION 'Criacao de OC exige header e items nao vazio'
        USING ERRCODE = '22023';
    END IF;
    v_header := v_payload -> 'header';
    v_idempotency_key := NULLIF(v_header ->> 'idempotency_key', '');
    v_return_existing := COALESCE(
      (v_payload ->> 'return_existing_on_idempotency')::boolean,
      false
    );
    IF v_return_existing AND v_idempotency_key IS NOT NULL THEN
      SELECT purchase_order.id
        INTO v_preexisting_id
        FROM public.purchase_orders purchase_order
       WHERE purchase_order.idempotency_key = v_idempotency_key
         AND purchase_order.status NOT IN ('cancelled')
       ORDER BY purchase_order.created_at DESC, purchase_order.id
       LIMIT 1;
    END IF;

    SELECT COALESCE(pg_catalog.array_agg(scope.product_id ORDER BY scope.product_id), ARRAY[]::uuid[])
      INTO v_product_ids
      FROM (
        SELECT DISTINCT NULLIF(element.value ->> 'product_id', '')::uuid AS product_id
          FROM pg_catalog.jsonb_array_elements(v_payload -> 'items') element(value)
         WHERE NULLIF(element.value ->> 'product_id', '') IS NOT NULL
        UNION
        SELECT DISTINCT existing_item.product_id
          FROM public.purchase_order_items existing_item
         WHERE existing_item.purchase_order_id = v_preexisting_id
      ) scope
     WHERE scope.product_id IS NOT NULL;
    SELECT COALESCE(pg_catalog.array_agg(scope.box_type_id ORDER BY scope.box_type_id), ARRAY[]::uuid[])
      INTO v_box_type_ids
      FROM (
        SELECT DISTINCT NULLIF(element.value ->> 'box_type_id', '')::uuid AS box_type_id
          FROM pg_catalog.jsonb_array_elements(v_payload -> 'items') element(value)
         WHERE NULLIF(element.value ->> 'box_type_id', '') IS NOT NULL
        UNION
        SELECT DISTINCT existing_item.box_type_id
          FROM public.purchase_order_items existing_item
         WHERE existing_item.purchase_order_id = v_preexisting_id
      ) scope
     WHERE scope.box_type_id IS NOT NULL;
  ELSE
    IF p_purchase_order_id IS NULL THEN
      RAISE EXCEPTION 'purchase_order_id e obrigatorio para %', v_command
        USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(pg_catalog.array_agg(scope.product_id ORDER BY scope.product_id), ARRAY[]::uuid[])
      INTO v_product_ids
      FROM (
        SELECT DISTINCT existing_item.product_id
          FROM public.purchase_order_items existing_item
         WHERE existing_item.purchase_order_id = p_purchase_order_id
        UNION
        SELECT DISTINCT NULLIF(element.value ->> 'product_id', '')::uuid
          FROM pg_catalog.jsonb_array_elements(
            CASE WHEN pg_catalog.jsonb_typeof(v_payload -> 'items') = 'array'
                 THEN v_payload -> 'items' ELSE '[]'::jsonb END
          ) element(value)
         WHERE NULLIF(element.value ->> 'product_id', '') IS NOT NULL
      ) scope
     WHERE scope.product_id IS NOT NULL;
    SELECT COALESCE(pg_catalog.array_agg(scope.box_type_id ORDER BY scope.box_type_id), ARRAY[]::uuid[])
      INTO v_box_type_ids
      FROM (
        SELECT DISTINCT existing_item.box_type_id
          FROM public.purchase_order_items existing_item
         WHERE existing_item.purchase_order_id = p_purchase_order_id
        UNION
        SELECT DISTINCT NULLIF(element.value ->> 'box_type_id', '')::uuid
          FROM pg_catalog.jsonb_array_elements(
            CASE WHEN pg_catalog.jsonb_typeof(v_payload -> 'items') = 'array'
                 THEN v_payload -> 'items' ELSE '[]'::jsonb END
          ) element(value)
         WHERE NULLIF(element.value ->> 'box_type_id', '') IS NOT NULL
      ) scope
     WHERE scope.box_type_id IS NOT NULL;
  END IF;

  -- Ordem global comum: epoch -> produtos crescentes -> embalagens crescentes
  -- -> OC -> itens. Nenhum efeito ocorre antes de todas as identidades travarem.
  PERFORM public.lock_sale_order_purchase_products(v_product_ids);
  PERFORM public.lock_purchase_order_box_types_121(v_box_type_ids);

  IF v_command = 'create' THEN
    IF v_idempotency_key IS NOT NULL THEN
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'purchase-order-idempotency:' || v_idempotency_key, 0
      ));
    END IF;
    IF v_return_existing AND v_idempotency_key IS NOT NULL THEN
      SELECT purchase_order.*
        INTO v_po
        FROM public.purchase_orders purchase_order
       WHERE purchase_order.idempotency_key = v_idempotency_key
         AND purchase_order.status NOT IN ('cancelled')
       ORDER BY purchase_order.created_at DESC, purchase_order.id
       LIMIT 1
       FOR UPDATE;
      IF FOUND THEN
        IF v_preexisting_id IS DISTINCT FROM v_po.id THEN
          RAISE EXCEPTION 'OC idempotente mudou durante a aquisicao de locks'
            USING ERRCODE = '40001';
        END IF;
        PERFORM 1
          FROM public.purchase_order_items existing_item
         WHERE existing_item.purchase_order_id = v_po.id
         ORDER BY existing_item.id
         FOR UPDATE;
        IF NULLIF(v_header ->> 'quotation_award_snapshot_id', '') IS NOT NULL
           AND (
             v_po.quotation_award_snapshot_id IS DISTINCT FROM
               (v_header ->> 'quotation_award_snapshot_id')::uuid
             OR v_po.freight_value IS DISTINCT FROM COALESCE(
               NULLIF(v_header ->> 'freight_value', '')::numeric,
               0
             )
             OR v_po.freight_type IS DISTINCT FROM
               NULLIF(v_header ->> 'freight_type', '')
             OR v_po.payment_terms IS DISTINCT FROM
               NULLIF(v_header ->> 'payment_terms', '')
           ) THEN
          RAISE EXCEPTION
            'OC idempotente diverge do snapshot comercial vencedor'
            USING ERRCODE = 'PZ220';
        END IF;
        v_response := pg_catalog.jsonb_build_object(
          'purchase_order_id', v_po.id,
          'purchase_order', pg_catalog.to_jsonb(v_po),
          'deduplicated', true,
          'replayed', false
        );
      END IF;
    END IF;

    IF v_response IS NULL THEN
      v_source_type := COALESCE(NULLIF(v_header ->> 'source_type', ''), 'manual');
      IF v_source_type = 'strap_demand' OR v_source_type NOT IN (
        'manual', 'mrp', 'per_pv', 'manual_avulsa', 'auto_pv', 'auto_op', 'rop'
      ) THEN
        RAISE EXCEPTION 'Canal de OC generica invalido: %', v_source_type
          USING ERRCODE = '22023';
      END IF;
      IF COALESCE(NULLIF(v_header ->> 'supplier_name', ''), '') = '' THEN
        RAISE EXCEPTION 'supplier_name e obrigatorio na OC'
          USING ERRCODE = '22023';
      END IF;
      IF COALESCE(NULLIF(v_header ->> 'status', ''), 'pending') NOT IN (
        'pending', 'approved', 'sent'
      ) THEN
        RAISE EXCEPTION 'Status inicial invalido para OC generica'
          USING ERRCODE = '22023';
      END IF;
      v_freight_value := COALESCE(
        NULLIF(v_header ->> 'freight_value', '')::numeric,
        0
      );
      IF v_freight_value < 0 THEN
        RAISE EXCEPTION 'Frete da OC nao pode ser negativo'
          USING ERRCODE = '22023';
      END IF;
      IF NULLIF(v_header ->> 'quotation_award_snapshot_id', '') IS NOT NULL THEN
        SELECT snapshot.*
          INTO v_award_snapshot
          FROM public.purchase_quotation_award_snapshots snapshot
         WHERE snapshot.id = (v_header ->> 'quotation_award_snapshot_id')::uuid
         FOR SHARE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Snapshot vencedor da cotacao nao encontrado'
            USING ERRCODE = 'P0002';
        END IF;
        SELECT pg_catalog.jsonb_agg(
                 pg_catalog.jsonb_build_object(
                   'product_id', snapshot_item.value ->> 'product_id',
                   'quantity', (snapshot_item.value ->> 'quantity')::numeric,
                   'unit', snapshot_item.value ->> 'unit',
                   'unit_price',
                     (snapshot_item.value ->> 'effective_unit_price')::numeric
                 ) ORDER BY snapshot_item.ordinality
               )
          INTO v_snapshot_items
          FROM pg_catalog.jsonb_array_elements(
            v_award_snapshot.snapshot -> 'items'
          ) WITH ORDINALITY snapshot_item(value, ordinality);
        IF v_award_snapshot.supplier_id IS DISTINCT FROM
             NULLIF(v_header ->> 'supplier_id', '')::uuid
           OR v_award_snapshot.snapshot_digest IS DISTINCT FROM
             NULLIF(v_header ->> 'quotation_award_snapshot_digest', '')
           OR COALESCE(
                (v_award_snapshot.snapshot ->> 'freight_value')::numeric,
                0
              ) IS DISTINCT FROM v_freight_value
           OR (v_award_snapshot.snapshot ->> 'freight_type') IS DISTINCT FROM
                NULLIF(v_header ->> 'freight_type', '')
           OR (v_award_snapshot.snapshot ->> 'payment_terms') IS DISTINCT FROM
                NULLIF(v_header ->> 'payment_terms', '')
           OR COALESCE(v_snapshot_items, '[]'::jsonb) IS DISTINCT FROM
                COALESCE(v_payload -> 'items', '[]'::jsonb) THEN
          RAISE EXCEPTION
            'Payload da OC diverge do snapshot comercial vencedor'
            USING ERRCODE = 'PZ220';
        END IF;
      END IF;

      INSERT INTO public.purchase_orders (
        supplier_id, supplier_name, status, total_value, notes, auto_generated,
        reference_order_id, eta_days, promised_date, linked_sale_order_ids,
        idempotency_key, source_type, source_pv_ids, purchase_by_date,
        freight_value, freight_type, payment_terms,
        quotation_award_snapshot_id
      ) VALUES (
        NULLIF(v_header ->> 'supplier_id', '')::uuid,
        v_header ->> 'supplier_name',
        COALESCE(NULLIF(v_header ->> 'status', ''), 'pending'),
        0,
        COALESCE(v_header ->> 'notes', ''),
        COALESCE((v_header ->> 'auto_generated')::boolean, false),
        NULLIF(v_header ->> 'reference_order_id', '')::uuid,
        NULLIF(v_header ->> 'eta_days', '')::integer,
        NULLIF(v_header ->> 'promised_date', '')::date,
        CASE WHEN pg_catalog.jsonb_typeof(v_header -> 'linked_sale_order_ids') = 'array'
          THEN ARRAY(
            SELECT value::uuid
              FROM pg_catalog.jsonb_array_elements_text(v_header -> 'linked_sale_order_ids') value
            ORDER BY value::uuid
          ) ELSE NULL END,
        v_idempotency_key,
        v_source_type,
        CASE WHEN pg_catalog.jsonb_typeof(v_header -> 'source_pv_ids') = 'array'
          THEN ARRAY(
            SELECT value::uuid
              FROM pg_catalog.jsonb_array_elements_text(v_header -> 'source_pv_ids') value
            ORDER BY value::uuid
          ) ELSE NULL END,
        NULLIF(v_header ->> 'purchase_by_date', '')::date,
        v_freight_value,
        NULLIF(v_header ->> 'freight_type', ''),
        NULLIF(v_header ->> 'payment_terms', ''),
        NULLIF(v_header ->> 'quotation_award_snapshot_id', '')::uuid
      ) RETURNING * INTO v_po;

      FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(v_payload -> 'items')
      LOOP
        v_product_id := NULLIF(v_item ->> 'product_id', '')::uuid;
        v_box_type_id := NULLIF(v_item ->> 'box_type_id', '')::uuid;
        IF (v_product_id IS NULL) = (v_box_type_id IS NULL) THEN
          RAISE EXCEPTION 'Item de OC exige exatamente product_id OU box_type_id'
            USING ERRCODE = '22023';
        END IF;
        v_input_qty := NULLIF(v_item ->> 'quantity', '')::numeric;
        v_input_price := NULLIF(v_item ->> 'unit_price', '')::numeric;
        IF v_product_id IS NOT NULL THEN
          SELECT product.* INTO v_product
            FROM public.products product WHERE product.id = v_product_id;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'Produto % do item nao existe', v_product_id
              USING ERRCODE = 'P0002';
          END IF;
          IF COALESCE(v_input_price, 0) <= 0 THEN
            v_input_price := NULLIF(v_product.unit_price, 0);
          END IF;
          SELECT normalized.out_qty, normalized.out_unit, normalized.out_unit_price
            INTO v_normalized_qty, v_normalized_unit, v_normalized_price
            FROM public.po_normalize_line(
              v_product_id,
              v_input_qty,
              COALESCE(NULLIF(v_item ->> 'unit', ''), v_product.unit),
              v_input_price
            ) normalized;
          IF COALESCE(v_normalized_qty, 0) <= 0
             OR COALESCE(v_normalized_price, 0) <= 0 THEN
            RAISE EXCEPTION 'Quantidade/preco invalido no produto %', v_product_id
              USING ERRCODE = '22023';
          END IF;
          v_grade := CASE WHEN pg_catalog.jsonb_typeof(v_item -> 'grade') = 'object'
            THEN v_item -> 'grade' ELSE NULL END;
          INSERT INTO public.purchase_order_items (
            purchase_order_id, product_id, box_type_id,
            current_stock, min_stock, max_stock,
            suggested_quantity, quantity, unit_price, unit, grade, color
          ) VALUES (
            v_po.id, v_product_id, NULL,
            COALESCE(NULLIF(v_item ->> 'current_stock', '')::numeric, v_product.quantity, 0),
            COALESCE(NULLIF(v_item ->> 'min_stock', '')::numeric, v_product.min_stock, 0),
            COALESCE(NULLIF(v_item ->> 'max_stock', '')::numeric, v_product.max_stock, 0),
            v_normalized_qty, v_normalized_qty, v_normalized_price,
            v_normalized_unit, v_grade, NULLIF(v_item ->> 'color', '')
          ) RETURNING id INTO v_item_id;
        ELSE
          SELECT box_type.* INTO v_box_type
            FROM public.box_types box_type WHERE box_type.id = v_box_type_id;
          IF NOT FOUND OR NOT COALESCE(v_box_type.active, false) THEN
            RAISE EXCEPTION 'Embalagem % nao existe ou esta inativa', v_box_type_id
              USING ERRCODE = '22023';
          END IF;
          IF v_box_type.supplier_id IS NULL
             OR v_po.supplier_id IS DISTINCT FROM v_box_type.supplier_id THEN
            RAISE EXCEPTION 'Fornecedor da OC nao corresponde ao fornecedor da embalagem %',
              v_box_type.nome USING ERRCODE = '22023';
          END IF;
          IF COALESCE(
               NULLIF(v_item ->> 'unit', ''),
               CASE WHEN v_box_type.tipo::text = 'fitilho' THEN 'm' ELSE 'un' END
             ) <> (CASE WHEN v_box_type.tipo::text = 'fitilho' THEN 'm' ELSE 'un' END)
             OR v_item ? 'grade' OR NULLIF(v_item ->> 'color', '') IS NOT NULL THEN
            RAISE EXCEPTION 'Unidade da embalagem nao e canonica ou grade/cor foi informada'
              USING ERRCODE = '22023';
          END IF;
          IF COALESCE(v_input_price, 0) <= 0 THEN
            v_input_price := NULLIF(v_box_type.unit_price, 0);
          END IF;
          IF COALESCE(v_input_qty, 0) <= 0 OR COALESCE(v_input_price, 0) <= 0 THEN
            RAISE EXCEPTION 'Quantidade/preco invalido na embalagem %', v_box_type.nome
              USING ERRCODE = '22023';
          END IF;
          v_normalized_qty := v_input_qty;
          v_normalized_unit := CASE WHEN v_box_type.tipo::text = 'fitilho' THEN 'm' ELSE 'un' END;
          v_normalized_price := v_input_price;
          INSERT INTO public.purchase_order_items (
            purchase_order_id, product_id, box_type_id,
            current_stock, min_stock, max_stock,
            suggested_quantity, quantity, unit_price, unit, grade, color
          ) VALUES (
            v_po.id, NULL, v_box_type_id,
            COALESCE(v_box_type.quantity, 0), COALESCE(v_box_type.min_stock, 0), 0,
            v_normalized_qty, v_normalized_qty, v_normalized_price,
            v_normalized_unit, NULL, NULL
          ) RETURNING id INTO v_item_id;
        END IF;
        v_item_results := v_item_results || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'item_id', v_item_id,
            'product_id', v_product_id,
            'box_type_id', v_box_type_id,
            'quantity', v_normalized_qty,
            'unit', v_normalized_unit,
            'unit_price', v_normalized_price
          )
        );
      END LOOP;
      UPDATE public.purchase_orders purchase_order
         SET total_value = purchase_order.freight_value + (
           SELECT COALESCE(pg_catalog.sum(item.quantity * item.unit_price), 0)
             FROM public.purchase_order_items item
            WHERE item.purchase_order_id = v_po.id
         ), updated_at = pg_catalog.now()
       WHERE purchase_order.id = v_po.id
       RETURNING * INTO v_po;
      v_response := pg_catalog.jsonb_build_object(
        'purchase_order_id', v_po.id,
        'purchase_order', pg_catalog.to_jsonb(v_po),
        'items', v_item_results,
        'deduplicated', false,
        'replayed', false
      );
      v_should_receive := v_receive_all;
    END IF;
  ELSE
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'purchase-order:' || p_purchase_order_id::text, 0
    ));
    SELECT purchase_order.*
      INTO v_po
      FROM public.purchase_orders purchase_order
     WHERE purchase_order.id = p_purchase_order_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'OC % nao encontrada', p_purchase_order_id
        USING ERRCODE = 'P0002';
    END IF;
    IF v_po.source_type = 'strap_demand' THEN
      RAISE EXCEPTION 'OC artesanal usa fronteira operacional propria'
        USING ERRCODE = '42501';
    END IF;
    IF p_expected_updated_at IS NOT NULL
       AND v_po.updated_at IS DISTINCT FROM p_expected_updated_at THEN
      RAISE EXCEPTION 'OC mudou desde a leitura; recarregue antes de confirmar'
        USING ERRCODE = '40001';
    END IF;
    PERFORM 1
      FROM public.purchase_order_items locked_item
     WHERE locked_item.purchase_order_id = v_po.id
     ORDER BY locked_item.id
     FOR UPDATE;

    SELECT COALESCE(pg_catalog.array_agg(scope.product_id ORDER BY scope.product_id), ARRAY[]::uuid[])
      INTO v_revalidated_ids
      FROM (
        SELECT DISTINCT existing_item.product_id
          FROM public.purchase_order_items existing_item
         WHERE existing_item.purchase_order_id = v_po.id
        UNION
        SELECT DISTINCT NULLIF(element.value ->> 'product_id', '')::uuid
          FROM pg_catalog.jsonb_array_elements(
            CASE WHEN pg_catalog.jsonb_typeof(v_payload -> 'items') = 'array'
                 THEN v_payload -> 'items' ELSE '[]'::jsonb END
          ) element(value)
         WHERE NULLIF(element.value ->> 'product_id', '') IS NOT NULL
      ) scope
     WHERE scope.product_id IS NOT NULL;
    IF v_revalidated_ids IS DISTINCT FROM v_product_ids THEN
      RAISE EXCEPTION 'Escopo de produtos da OC mudou durante os locks'
        USING ERRCODE = '40001';
    END IF;
    SELECT COALESCE(pg_catalog.array_agg(scope.box_type_id ORDER BY scope.box_type_id), ARRAY[]::uuid[])
      INTO v_revalidated_box_type_ids
      FROM (
        SELECT DISTINCT existing_item.box_type_id
          FROM public.purchase_order_items existing_item
         WHERE existing_item.purchase_order_id = v_po.id
        UNION
        SELECT DISTINCT NULLIF(element.value ->> 'box_type_id', '')::uuid
          FROM pg_catalog.jsonb_array_elements(
            CASE WHEN pg_catalog.jsonb_typeof(v_payload -> 'items') = 'array'
                 THEN v_payload -> 'items' ELSE '[]'::jsonb END
          ) element(value)
         WHERE NULLIF(element.value ->> 'box_type_id', '') IS NOT NULL
      ) scope
     WHERE scope.box_type_id IS NOT NULL;
    IF v_revalidated_box_type_ids IS DISTINCT FROM v_box_type_ids THEN
      RAISE EXCEPTION 'Escopo de embalagens da OC mudou durante os locks'
        USING ERRCODE = '40001';
    END IF;

    IF v_command IN ('append', 'edit', 'update')
       AND v_po.status IN ('received', 'receiving', 'cancelled', 'suspended') THEN
      RAISE EXCEPTION 'OC em estado terminal nao pode ser alterada'
        USING ERRCODE = '55000';
    END IF;
    IF v_command = 'append' THEN
      v_deduplicate_sale_order_id := NULLIF(
        v_payload ->> 'deduplicate_sale_order_id', ''
      )::uuid;
      v_skip_append := v_deduplicate_sale_order_id IS NOT NULL
        AND v_deduplicate_sale_order_id = ANY(
          COALESCE(v_po.linked_sale_order_ids, ARRAY[]::uuid[])
        );
    END IF;

    IF v_command IN ('edit', 'update')
       OR (v_command = 'append' AND NOT v_skip_append) THEN
      v_patch := CASE WHEN pg_catalog.jsonb_typeof(v_payload -> 'header_patch') = 'object'
        THEN v_payload -> 'header_patch' ELSE '{}'::jsonb END;
      IF EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_object_keys(v_patch) key
         WHERE key NOT IN (
           'supplier_id', 'supplier_name', 'notes', 'notes_append', 'status',
           'promised_date', 'received_date', 'purchase_by_date',
           'purchase_by_date_min', 'eta_days', 'expedite',
           'linked_sale_order_ids_add', 'source_pv_ids_add'
         )
      ) THEN
        RAISE EXCEPTION 'header_patch contem campo nao permitido'
          USING ERRCODE = '22023';
      END IF;
      IF v_patch ? 'status'
         AND COALESCE(v_patch ->> 'status', '') NOT IN ('pending', 'approved', 'sent', 'cancelled') THEN
        RAISE EXCEPTION 'Transicao de status invalida pela edicao generica'
          USING ERRCODE = '22023';
      END IF;
      UPDATE public.purchase_orders purchase_order SET
        supplier_id = CASE WHEN v_patch ? 'supplier_id'
          THEN NULLIF(v_patch ->> 'supplier_id', '')::uuid ELSE purchase_order.supplier_id END,
        supplier_name = CASE WHEN v_patch ? 'supplier_name'
          THEN v_patch ->> 'supplier_name' ELSE purchase_order.supplier_name END,
        notes = CASE
          WHEN v_patch ? 'notes' THEN v_patch ->> 'notes'
          WHEN v_patch ? 'notes_append'
            AND NULLIF(pg_catalog.btrim(COALESCE(v_patch ->> 'notes_append', '')), '') IS NULL
            THEN purchase_order.notes
          WHEN v_patch ? 'notes_append'
            AND NULLIF(pg_catalog.btrim(COALESCE(purchase_order.notes, '')), '') IS NULL
            THEN v_patch ->> 'notes_append'
          WHEN v_patch ? 'notes_append'
            THEN purchase_order.notes || E'\n' || (v_patch ->> 'notes_append')
          ELSE purchase_order.notes END,
        status = CASE WHEN v_patch ? 'status'
          THEN v_patch ->> 'status' ELSE purchase_order.status END,
        promised_date = CASE WHEN v_patch ? 'promised_date'
          THEN NULLIF(v_patch ->> 'promised_date', '')::date ELSE purchase_order.promised_date END,
        received_date = CASE WHEN v_patch ? 'received_date'
          THEN NULLIF(v_patch ->> 'received_date', '')::date ELSE purchase_order.received_date END,
        purchase_by_date = CASE
          WHEN v_patch ? 'purchase_by_date_min' THEN LEAST(
            purchase_order.purchase_by_date,
            NULLIF(v_patch ->> 'purchase_by_date_min', '')::date
          )
          WHEN v_patch ? 'purchase_by_date' THEN NULLIF(v_patch ->> 'purchase_by_date', '')::date
          ELSE purchase_order.purchase_by_date END,
        eta_days = CASE WHEN v_patch ? 'eta_days'
          THEN NULLIF(v_patch ->> 'eta_days', '')::integer ELSE purchase_order.eta_days END,
        expedite = CASE WHEN v_patch ? 'expedite'
          THEN (v_patch ->> 'expedite')::boolean ELSE purchase_order.expedite END,
        linked_sale_order_ids = CASE WHEN pg_catalog.jsonb_typeof(v_patch -> 'linked_sale_order_ids_add') = 'array'
          THEN ARRAY(
            SELECT DISTINCT id_value FROM (
              SELECT pg_catalog.unnest(COALESCE(purchase_order.linked_sale_order_ids, ARRAY[]::uuid[])) id_value
              UNION ALL
              SELECT value::uuid FROM pg_catalog.jsonb_array_elements_text(v_patch -> 'linked_sale_order_ids_add') value
            ) ids ORDER BY id_value
          ) ELSE purchase_order.linked_sale_order_ids END,
        source_pv_ids = CASE WHEN pg_catalog.jsonb_typeof(v_patch -> 'source_pv_ids_add') = 'array'
          THEN ARRAY(
            SELECT DISTINCT id_value FROM (
              SELECT pg_catalog.unnest(COALESCE(purchase_order.source_pv_ids, ARRAY[]::uuid[])) id_value
              UNION ALL
              SELECT value::uuid FROM pg_catalog.jsonb_array_elements_text(v_patch -> 'source_pv_ids_add') value
            ) ids ORDER BY id_value
          ) ELSE purchase_order.source_pv_ids END,
        cancelled_at = CASE WHEN v_patch ->> 'status' = 'cancelled'
          THEN pg_catalog.now() ELSE purchase_order.cancelled_at END,
        updated_at = pg_catalog.now()
      WHERE purchase_order.id = v_po.id
      RETURNING * INTO v_po;
    END IF;

    IF v_command <> 'cancel' AND v_po.status <> 'cancelled' AND EXISTS (
      SELECT 1
        FROM public.purchase_order_items existing_item
        JOIN public.box_types box_type ON box_type.id = existing_item.box_type_id
       WHERE existing_item.purchase_order_id = v_po.id
         AND (
           NOT COALESCE(box_type.active, false)
           OR box_type.supplier_id IS NULL
           OR v_po.supplier_id IS DISTINCT FROM box_type.supplier_id
         )
    ) THEN
      RAISE EXCEPTION 'OC contem embalagem inativa ou de fornecedor divergente'
        USING ERRCODE = '22023';
    END IF;

    IF v_command = 'append' AND NOT v_skip_append THEN
      IF pg_catalog.jsonb_typeof(v_payload -> 'items') IS DISTINCT FROM 'array'
         OR pg_catalog.jsonb_array_length(v_payload -> 'items') = 0 THEN
        RAISE EXCEPTION 'append exige items nao vazio' USING ERRCODE = '22023';
      END IF;
      FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(v_payload -> 'items')
      LOOP
        v_product_id := NULLIF(v_item ->> 'product_id', '')::uuid;
        v_box_type_id := NULLIF(v_item ->> 'box_type_id', '')::uuid;
        IF (v_product_id IS NULL) = (v_box_type_id IS NULL) THEN
          RAISE EXCEPTION 'Item de OC exige exatamente product_id OU box_type_id'
            USING ERRCODE = '22023';
        END IF;
        v_input_price := NULLIF(v_item ->> 'unit_price', '')::numeric;
        IF v_product_id IS NOT NULL THEN
          SELECT product.* INTO v_product
            FROM public.products product WHERE product.id = v_product_id;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'Produto % do item nao existe', v_product_id
              USING ERRCODE = 'P0002';
          END IF;
          IF COALESCE(v_input_price, 0) <= 0 THEN
            v_input_price := NULLIF(v_product.unit_price, 0);
          END IF;
          IF COALESCE(v_input_price, 0) <= 0 THEN
            RAISE EXCEPTION 'Produto % sem preco valido para compra', v_product_id
              USING ERRCODE = '22023';
          END IF;
          v_item_results := v_item_results || pg_catalog.jsonb_build_array(
            public.upsert_po_item_atomic_impl_115(
              v_po.id,
              v_product_id,
              NULLIF(v_item ->> 'quantity', '')::numeric,
              v_input_price,
              COALESCE(NULLIF(v_item ->> 'unit', ''), v_product.unit),
              COALESCE(NULLIF(v_item ->> 'current_stock', '')::numeric, v_product.quantity, 0),
              COALESCE(NULLIF(v_item ->> 'min_stock', '')::numeric, v_product.min_stock, 0),
              COALESCE(NULLIF(v_item ->> 'max_stock', '')::numeric, v_product.max_stock, 0),
              CASE WHEN pg_catalog.jsonb_typeof(v_item -> 'grade') = 'object'
                THEN v_item -> 'grade' ELSE NULL END,
              NULLIF(v_item ->> 'color', '')
            )
          );
        ELSE
          SELECT box_type.* INTO v_box_type
            FROM public.box_types box_type WHERE box_type.id = v_box_type_id;
          IF NOT FOUND OR NOT COALESCE(v_box_type.active, false) THEN
            RAISE EXCEPTION 'Embalagem % nao existe ou esta inativa', v_box_type_id
              USING ERRCODE = '22023';
          END IF;
          IF v_box_type.supplier_id IS NULL
             OR v_po.supplier_id IS DISTINCT FROM v_box_type.supplier_id THEN
            RAISE EXCEPTION 'Fornecedor da OC nao corresponde ao fornecedor da embalagem %',
              v_box_type.nome USING ERRCODE = '22023';
          END IF;
          IF COALESCE(
               NULLIF(v_item ->> 'unit', ''),
               CASE WHEN v_box_type.tipo::text = 'fitilho' THEN 'm' ELSE 'un' END
             ) <> (CASE WHEN v_box_type.tipo::text = 'fitilho' THEN 'm' ELSE 'un' END)
             OR v_item ? 'grade' OR NULLIF(v_item ->> 'color', '') IS NOT NULL THEN
            RAISE EXCEPTION 'Unidade da embalagem nao e canonica ou grade/cor foi informada'
              USING ERRCODE = '22023';
          END IF;
          v_input_qty := NULLIF(v_item ->> 'quantity', '')::numeric;
          IF COALESCE(v_input_price, 0) <= 0 THEN
            v_input_price := NULLIF(v_box_type.unit_price, 0);
          END IF;
          IF COALESCE(v_input_qty, 0) <= 0 OR COALESCE(v_input_price, 0) <= 0 THEN
            RAISE EXCEPTION 'Quantidade/preco invalido na embalagem %', v_box_type.nome
              USING ERRCODE = '22023';
          END IF;
          SELECT item.* INTO v_item_row
            FROM public.purchase_order_items item
           WHERE item.purchase_order_id = v_po.id
             AND item.box_type_id = v_box_type_id
           FOR UPDATE;
          IF FOUND THEN
            UPDATE public.purchase_order_items item SET
              quantity = item.quantity + v_input_qty,
              suggested_quantity = item.quantity + v_input_qty,
              unit_price = v_input_price,
              unit = CASE WHEN v_box_type.tipo::text = 'fitilho' THEN 'm' ELSE 'un' END
            WHERE item.id = v_item_row.id
            RETURNING * INTO v_item_row;
          ELSE
            INSERT INTO public.purchase_order_items (
              purchase_order_id, product_id, box_type_id,
              current_stock, min_stock, max_stock,
              suggested_quantity, quantity, unit_price, unit, grade, color
            ) VALUES (
              v_po.id, NULL, v_box_type_id,
              COALESCE(v_box_type.quantity, 0), COALESCE(v_box_type.min_stock, 0), 0,
              v_input_qty, v_input_qty, v_input_price,
              CASE WHEN v_box_type.tipo::text = 'fitilho' THEN 'm' ELSE 'un' END,
              NULL, NULL
            ) RETURNING * INTO v_item_row;
          END IF;
          v_item_results := v_item_results || pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
              'item_id', v_item_row.id,
              'product_id', NULL,
              'box_type_id', v_box_type_id,
              'new_qty', v_item_row.quantity,
              'unit', CASE WHEN v_box_type.tipo::text = 'fitilho' THEN 'm' ELSE 'un' END
            )
          );
        END IF;
      END LOOP;
    END IF;

    IF v_command = 'edit' THEN
      IF pg_catalog.jsonb_typeof(v_payload -> 'items') IS DISTINCT FROM 'array'
         OR pg_catalog.jsonb_array_length(v_payload -> 'items') = 0 THEN
        RAISE EXCEPTION 'edit exige items nao vazio' USING ERRCODE = '22023';
      END IF;
      FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(v_payload -> 'items')
      LOOP
        v_item_id := NULLIF(v_item ->> 'item_id', '')::uuid;
        SELECT item.* INTO v_item_row
          FROM public.purchase_order_items item
         WHERE item.id = v_item_id AND item.purchase_order_id = v_po.id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Item % nao pertence a OC', v_item_id USING ERRCODE = 'P0002';
        END IF;
        IF COALESCE(v_item_row.received_quantity, 0) > 0 THEN
          RAISE EXCEPTION 'Item parcialmente recebido nao pode ser editado'
            USING ERRCODE = '55000';
        END IF;
        IF v_item ? 'quantity' AND COALESCE((v_item ->> 'quantity')::numeric, 0) <= 0 THEN
          RAISE EXCEPTION 'Quantidade do item deve ser positiva' USING ERRCODE = '22023';
        END IF;
        IF v_item ? 'unit_price' AND COALESCE((v_item ->> 'unit_price')::numeric, 0) <= 0 THEN
          RAISE EXCEPTION 'Preco do item deve ser positivo' USING ERRCODE = '22023';
        END IF;
        IF v_item_row.box_type_id IS NOT NULL AND v_item ? 'grade' THEN
          RAISE EXCEPTION 'Embalagem nao aceita grade'
            USING ERRCODE = '22023';
        END IF;
        UPDATE public.purchase_order_items item SET
          quantity = CASE WHEN v_item ? 'quantity'
            THEN (v_item ->> 'quantity')::numeric ELSE item.quantity END,
          suggested_quantity = CASE WHEN v_item ? 'quantity'
            THEN (v_item ->> 'quantity')::numeric ELSE item.suggested_quantity END,
          unit_price = CASE WHEN v_item ? 'unit_price'
            THEN (v_item ->> 'unit_price')::numeric ELSE item.unit_price END,
          grade = CASE WHEN v_item ? 'grade'
            THEN CASE WHEN pg_catalog.jsonb_typeof(v_item -> 'grade') = 'object'
              THEN v_item -> 'grade' ELSE NULL END ELSE item.grade END
        WHERE item.id = v_item_id;
        v_item_results := v_item_results || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'item_id', v_item_id,
            'product_id', v_item_row.product_id,
            'box_type_id', v_item_row.box_type_id,
            'updated', true
          )
        );
      END LOOP;
    END IF;

    IF v_command IN ('append', 'edit') AND NOT v_skip_append THEN
      UPDATE public.purchase_orders purchase_order
         SET total_value = purchase_order.freight_value + (
           SELECT COALESCE(pg_catalog.sum(item.quantity * item.unit_price), 0)
             FROM public.purchase_order_items item
            WHERE item.purchase_order_id = v_po.id
         ), updated_at = pg_catalog.now()
       WHERE purchase_order.id = v_po.id
       RETURNING * INTO v_po;
    END IF;

    IF v_command = 'cancel' OR v_po.status = 'cancelled' THEN
      IF v_po.status IN ('received', 'receiving', 'cancelled') AND v_command = 'cancel' THEN
        RAISE EXCEPTION 'OC recebida/em recebimento/cancelada nao pode ser cancelada'
          USING ERRCODE = '55000';
      END IF;
      UPDATE public.purchase_orders purchase_order
         SET status = 'cancelled', cancelled_at = pg_catalog.now(), updated_at = pg_catalog.now()
       WHERE purchase_order.id = v_po.id
       RETURNING * INTO v_po;
      UPDATE public.accounts_payable payable
         SET status = 'cancelled', updated_at = pg_catalog.now()
       WHERE (
         payable.purchase_order_id = v_po.id
         OR COALESCE(payable.notes, '') LIKE '%[OC#' || v_po.id::text || ']%'
       ) AND payable.status IN ('pending', 'partial', 'approved');
    END IF;
    v_should_receive := v_command = 'receive';
    v_response := pg_catalog.jsonb_build_object(
      'purchase_order_id', v_po.id,
      'purchase_order', pg_catalog.to_jsonb(v_po),
      'items', v_item_results,
      'deduplicated', v_skip_append,
      'replayed', false
    );
  END IF;

  IF v_should_receive THEN
    IF v_po.source_type = 'strap_demand' THEN
      RAISE EXCEPTION 'Recebimento artesanal usa register_strap_purchase_receipt'
        USING ERRCODE = '42501';
    END IF;
    IF v_po.status IN ('received', 'receiving', 'cancelled', 'suspended') THEN
      RAISE EXCEPTION 'OC em estado % nao pode ser recebida', v_po.status
        USING ERRCODE = '55000';
    END IF;
    IF NOT v_receive_all
       AND (
         pg_catalog.jsonb_typeof(v_payload -> 'receipts') IS DISTINCT FROM 'array'
         OR pg_catalog.jsonb_array_length(v_payload -> 'receipts') = 0
       ) THEN
      RAISE EXCEPTION 'Recebimento parcial exige receipts nao vazio'
        USING ERRCODE = '22023';
    END IF;

    FOR v_item_row IN
      SELECT item.*
        FROM public.purchase_order_items item
       WHERE item.purchase_order_id = v_po.id
         AND COALESCE(item.received_quantity, 0) < item.quantity - 0.0001
         AND (
           v_receive_all
           OR EXISTS (
             SELECT 1 FROM pg_catalog.jsonb_array_elements(v_payload -> 'receipts') line(value)
              WHERE NULLIF(line.value ->> 'item_id', '')::uuid = item.id
           )
         )
       ORDER BY item.id
    LOOP
      IF v_receive_all THEN
        v_receive_line := pg_catalog.jsonb_build_object(
          'item_id', v_item_row.id,
          'quantity', v_item_row.quantity - COALESCE(v_item_row.received_quantity, 0),
          'expected_received_quantity', COALESCE(v_item_row.received_quantity, 0)
        );
      ELSE
        SELECT line.value INTO v_receive_line
          FROM pg_catalog.jsonb_array_elements(v_payload -> 'receipts') line(value)
         WHERE NULLIF(line.value ->> 'item_id', '')::uuid = v_item_row.id
         LIMIT 1;
      END IF;
      v_expected_received := NULLIF(v_receive_line ->> 'expected_received_quantity', '')::numeric;
      IF v_expected_received IS NULL
         OR v_expected_received IS DISTINCT FROM COALESCE(v_item_row.received_quantity, 0) THEN
        RAISE EXCEPTION 'Quantidade recebida do item % mudou; recarregue a OC', v_item_row.id
          USING ERRCODE = '40001';
      END IF;
      v_receive_qty := NULLIF(v_receive_line ->> 'quantity', '')::numeric;
      v_remaining := v_item_row.quantity - COALESCE(v_item_row.received_quantity, 0);
      IF COALESCE(v_receive_qty, 0) <= 0 OR v_receive_qty > v_remaining + 0.0001 THEN
        RAISE EXCEPTION 'Quantidade de recebimento invalida no item %', v_item_row.id
          USING ERRCODE = '22023';
      END IF;

      IF v_item_row.box_type_id IS NOT NULL THEN
        IF v_item_row.product_id IS NOT NULL OR v_item_row.grade IS NOT NULL THEN
          RAISE EXCEPTION 'Linha de embalagem com identidade/grade invalida'
            USING ERRCODE = '22023';
        END IF;
        SELECT box_type.* INTO v_box_type
          FROM public.box_types box_type WHERE box_type.id = v_item_row.box_type_id;
        IF NOT FOUND OR NOT COALESCE(v_box_type.active, false) THEN
          RAISE EXCEPTION 'Embalagem % nao existe ou esta inativa', v_item_row.box_type_id
            USING ERRCODE = '22023';
        END IF;
        IF v_box_type.supplier_id IS NULL
           OR v_po.supplier_id IS DISTINCT FROM v_box_type.supplier_id THEN
          RAISE EXCEPTION 'Fornecedor da OC nao corresponde ao fornecedor da embalagem %',
            v_box_type.nome USING ERRCODE = '22023';
        END IF;
        IF v_item_row.unit IS DISTINCT FROM
           (CASE WHEN v_box_type.tipo::text = 'fitilho' THEN 'm' ELSE 'un' END) THEN
          RAISE EXCEPTION 'Unidade da embalagem % nao e canonica', v_box_type.nome
            USING ERRCODE = '22023';
        END IF;
        v_factor := 1;
        v_grade := NULL;
        v_new_grade := NULL;
        v_received_stock := v_receive_qty;
        v_previous_stock := COALESCE(v_box_type.quantity, 0);
        v_new_stock := v_previous_stock + v_received_stock;
        v_effective_unit_price := v_item_row.unit_price;
        v_new_unit_price := CASE WHEN v_new_stock <= 0 THEN v_effective_unit_price
          ELSE (
            v_previous_stock * COALESCE(v_box_type.unit_price, 0)
            + v_received_stock * v_effective_unit_price
          ) / v_new_stock END;

        UPDATE public.box_types box_type SET
          quantity = v_new_stock,
          unit_price = v_new_unit_price,
          updated_at = pg_catalog.now()
        WHERE box_type.id = v_box_type.id;

        INSERT INTO public.box_type_stock_movements (
          box_type_id, purchase_order_id, purchase_order_item_id,
          movement_type, quantity, previous_stock, new_stock,
          unit_price_at_movement, movement_reason, client_request_id, actor_id
        ) VALUES (
          v_box_type.id, v_po.id, v_item_row.id,
          'in', v_received_stock, v_previous_stock, v_new_stock,
          v_new_unit_price, 'compra', p_client_request_id, v_actor_id
        ) RETURNING id INTO v_movement_id;
      ELSE
        SELECT product.* INTO v_product
          FROM public.products product WHERE product.id = v_item_row.product_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Produto % do item nao existe', v_item_row.product_id
            USING ERRCODE = 'P0002';
        END IF;
        v_factor := public.purchase_order_receipt_factor_121(
          v_item_row.unit,
          v_product.unit,
          v_product.purchase_unit,
          v_product.conversion_rate,
          v_product.dimensions_width,
          v_product.dimensions_unit,
          v_product.name
        );
        v_grade := CASE WHEN pg_catalog.jsonb_typeof(v_item_row.grade) = 'object'
          THEN v_item_row.grade ELSE NULL END;
        v_new_grade := COALESCE(v_product.stock_grade, '{}'::jsonb);
        IF v_grade IS NOT NULL AND EXISTS (
          SELECT 1
            FROM pg_catalog.jsonb_each(v_grade) grade_entry(key, value)
           WHERE grade_entry.key !~ '^_'
             AND CASE WHEN pg_catalog.jsonb_typeof(grade_entry.value) = 'number'
               THEN (grade_entry.value #>> '{}')::numeric < 0
                 OR (grade_entry.value #>> '{}')::numeric
                    <> pg_catalog.trunc((grade_entry.value #>> '{}')::numeric)
               ELSE true END
        ) THEN
          RAISE EXCEPTION 'Grade do item % exige quantidades inteiras e nao negativas',
            v_item_row.id USING ERRCODE = '22023';
        END IF;
        IF v_grade IS NOT NULL AND EXISTS (
          SELECT 1 FROM pg_catalog.jsonb_each(v_grade) grade_entry(key, value)
           WHERE grade_entry.key !~ '^_'
        ) THEN
          IF COALESCE(v_item_row.received_quantity, 0) <> 0
             OR v_receive_qty IS DISTINCT FROM v_item_row.quantity
             OR v_factor IS DISTINCT FROM 1::numeric THEN
            RAISE EXCEPTION 'Item com grade so pode ser recebido integralmente e sem conversao'
              USING ERRCODE = '22023';
          END IF;
          SELECT COALESCE(pg_catalog.sum((grade_entry.value #>> '{}')::numeric), 0)
            INTO v_grade_sum
            FROM pg_catalog.jsonb_each(v_grade) grade_entry(key, value)
           WHERE grade_entry.key !~ '^_';
          IF v_grade_sum IS DISTINCT FROM v_item_row.quantity THEN
            RAISE EXCEPTION 'Grade do item % soma %, quantidade %',
              v_item_row.id, v_grade_sum, v_item_row.quantity
              USING ERRCODE = '22023';
          END IF;
          FOR v_grade_key, v_grade_value IN
            SELECT grade_entry.key, (grade_entry.value #>> '{}')::numeric
              FROM pg_catalog.jsonb_each(v_grade) grade_entry(key, value)
             WHERE grade_entry.key !~ '^_'
          LOOP
            v_new_grade := pg_catalog.jsonb_set(
              v_new_grade,
              ARRAY[v_grade_key],
              pg_catalog.to_jsonb(
                COALESCE((v_new_grade ->> v_grade_key)::numeric, 0) + v_grade_value
              ),
              true
            );
          END LOOP;
        END IF;

        v_received_stock := v_receive_qty * v_factor;
        v_previous_stock := COALESCE(v_product.quantity, 0);
        v_new_stock := v_previous_stock + v_received_stock;
        v_effective_unit_price := v_item_row.unit_price / v_factor;
        v_new_unit_price := CASE WHEN v_new_stock <= 0 THEN v_effective_unit_price
          ELSE (
            v_previous_stock * COALESCE(v_product.unit_price, 0)
            + v_received_stock * v_effective_unit_price
          ) / v_new_stock END;

        UPDATE public.products product SET
          quantity = v_new_stock,
          current_stock = v_new_stock,
          stock_grade = CASE WHEN v_grade IS NOT NULL THEN v_new_grade ELSE product.stock_grade END,
          unit_price = v_new_unit_price,
          supplier_id = COALESCE(product.supplier_id, v_po.supplier_id),
          updated_at = pg_catalog.now()
        WHERE product.id = v_product.id;

        INSERT INTO public.stock_movements (
          product_id, movement_type, quantity, previous_stock, new_stock,
          description, user_id, unit_price_at_movement, movement_reason,
          previous_grade, new_grade, origin_type, effective_unit_cost, correlation_id
        ) VALUES (
          v_product.id, 'in', v_received_stock, v_previous_stock, v_new_stock,
          COALESCE(NULLIF(v_payload ->> 'reason', ''), 'Recebimento OC ' || v_po.order_number),
          v_actor_id, v_new_unit_price, 'compra',
          v_product.stock_grade,
          CASE WHEN v_grade IS NOT NULL THEN v_new_grade ELSE v_product.stock_grade END,
          NULL, v_effective_unit_price, p_client_request_id
        ) RETURNING id INTO v_movement_id;
      END IF;
      v_movement_ids := pg_catalog.array_append(v_movement_ids, v_movement_id);

      UPDATE public.purchase_order_items item SET
        received_quantity = COALESCE(item.received_quantity, 0) + v_receive_qty,
        received_at = CASE
          WHEN COALESCE(item.received_quantity, 0) + v_receive_qty >= item.quantity - 0.0001
          THEN pg_catalog.now() ELSE item.received_at END
      WHERE item.id = v_item_row.id;

      v_received_items := v_received_items || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'item_id', v_item_row.id,
          'product_id', v_item_row.product_id,
          'box_type_id', v_item_row.box_type_id,
          'purchase_quantity', v_receive_qty,
          'stock_quantity', v_received_stock,
          'movement_id', v_movement_id
        )
      );
    END LOOP;

    IF NOT v_receive_all AND pg_catalog.jsonb_array_length(v_received_items)
       <> pg_catalog.jsonb_array_length(v_payload -> 'receipts') THEN
      RAISE EXCEPTION 'Um ou mais itens do recebimento nao pertencem/nao estao abertos na OC'
        USING ERRCODE = '22023';
    END IF;
    IF pg_catalog.jsonb_array_length(v_received_items) = 0 THEN
      RAISE EXCEPTION 'OC nao possui quantidade aberta para receber'
        USING ERRCODE = '55000';
    END IF;

    SELECT NOT EXISTS (
      SELECT 1 FROM public.purchase_order_items item
       WHERE item.purchase_order_id = v_po.id
         AND COALESCE(item.received_quantity, 0) < item.quantity - 0.0001
    ) INTO v_is_complete;
    UPDATE public.purchase_orders purchase_order SET
      status = CASE WHEN v_is_complete THEN 'received' ELSE 'parcial' END,
      received_date = CASE WHEN v_is_complete
        THEN COALESCE(NULLIF(v_payload ->> 'received_date', '')::date, CURRENT_DATE)
        ELSE purchase_order.received_date END,
      received_at = CASE WHEN v_is_complete THEN pg_catalog.now() ELSE purchase_order.received_at END,
      updated_at = pg_catalog.now()
    WHERE purchase_order.id = v_po.id
    RETURNING * INTO v_po;
    v_response := v_response || pg_catalog.jsonb_build_object(
      'purchase_order', pg_catalog.to_jsonb(v_po),
      'received_items', v_received_items,
      'movement_ids', pg_catalog.to_jsonb(v_movement_ids),
      'complete', v_is_complete
    );
  END IF;

  IF NOT v_skip_append AND (
    COALESCE((v_payload ->> 'create_payables')::boolean, false)
    OR NULLIF(v_payload ->> 'payable_due_date', '') IS NOT NULL
  ) THEN
    IF v_po.status = 'cancelled' THEN
      RAISE EXCEPTION 'OC cancelada nao pode gerar contas a pagar'
        USING ERRCODE = '55000';
    END IF;
    v_payables_created := public.create_purchase_order_payables_121(v_po.id, v_payload);
    v_response := v_response || pg_catalog.jsonb_build_object(
      'payables_created', v_payables_created
    );
  END IF;

  v_response := v_response || pg_catalog.jsonb_build_object(
    'receipt_id', v_receipt_id,
    'client_request_id', p_client_request_id,
    'request_hash', v_request_hash,
    'replayed', false
  );
  INSERT INTO public.purchase_order_command_receipts (
    id, client_request_id, command_name, purchase_order_id,
    request_hash, actor_id, response
  ) VALUES (
    v_receipt_id, p_client_request_id, v_command, v_po.id,
    v_request_hash, v_actor_id, v_response
  );
  RETURN v_response;
END;
$function$;

REVOKE ALL ON FUNCTION public.execute_purchase_order_command(
  text,jsonb,uuid,uuid,timestamptz
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_purchase_order_command(
  text,jsonb,uuid,uuid,timestamptz
) TO authenticated, service_role;

COMMENT ON FUNCTION public.execute_purchase_order_command(
  text,jsonb,uuid,uuid,timestamptz
) IS
  'Fronteira transacional de OC generica: receipt/hash, locks '
  'epoch->produto->embalagem->OC->item, CAS e recebimento atomico. '
  'strap_demand permanece em fronteira propria.';

-- ---------------------------------------------------------------------------
-- Cotacao vencedora: traduz para o mesmo command/receipt, sem DML paralelo
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.select_purchase_quotation_winner_command(
  p_quotation_id uuid,
  p_response_id uuid,
  p_client_request_id uuid,
  p_expected_status text,
  p_expected_supplier_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_request_hash text;
  v_receipt_id uuid := pg_catalog.gen_random_uuid();
  v_existing public.purchase_order_command_receipts%ROWTYPE;
  v_quotation public.purchase_quotations%ROWTYPE;
  v_response public.purchase_quotation_responses%ROWTYPE;
  v_items jsonb;
  v_snapshot jsonb;
  v_snapshot_digest text;
  v_snapshot_id uuid := pg_catalog.gen_random_uuid();
  v_supplier_name text;
  v_subtotal_value numeric;
  v_total_value numeric;
  v_item_count integer;
  v_price_count integer;
  v_previous_marker text;
  v_result jsonb;
BEGIN
  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin', 'gerente']) THEN
    RAISE EXCEPTION
      'Permission denied: escolher vencedor exige Administracao ou Gerencia'
      USING ERRCODE = '42501';
  END IF;
  IF p_client_request_id IS NULL OR NULLIF(p_expected_status, '') IS NULL THEN
    RAISE EXCEPTION 'client_request_id e expected_status sao obrigatorios'
      USING ERRCODE = '22023';
  END IF;
  v_request_hash := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'quotation_id', p_quotation_id,
    'response_id', p_response_id,
    'expected_status', p_expected_status,
    'expected_supplier_id', p_expected_supplier_id
  )::text);

  PERFORM public.lock_sale_order_purchase_allocation();
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'purchase-order-command:' || p_client_request_id::text,
    0
  ));
  SELECT receipt.*
    INTO v_existing
    FROM public.purchase_order_command_receipts receipt
   WHERE receipt.client_request_id = p_client_request_id
   FOR UPDATE;
  IF FOUND THEN
    IF v_existing.command_name IS DISTINCT FROM 'quotation_winner'
       OR v_existing.request_hash IS DISTINCT FROM v_request_hash
       OR v_existing.actor_id IS DISTINCT FROM v_actor_id THEN
      RAISE EXCEPTION 'Replay divergente para client_request_id %', p_client_request_id
        USING ERRCODE = '22000';
    END IF;
    RETURN v_existing.response || pg_catalog.jsonb_build_object(
      'replayed', true,
      'receipt_id', v_existing.id
    );
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'purchase-quotation:' || p_quotation_id::text,
    0
  ));
  SELECT quotation.*
    INTO v_quotation
    FROM public.purchase_quotations quotation
   WHERE quotation.id = p_quotation_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cotacao % nao encontrada', p_quotation_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_quotation.status IS DISTINCT FROM p_expected_status
     OR v_quotation.selected_supplier_id IS DISTINCT FROM p_expected_supplier_id THEN
    RAISE EXCEPTION 'Cotacao mudou desde a leitura; recarregue antes de escolher'
      USING ERRCODE = '40001';
  END IF;
  PERFORM response.id
    FROM public.purchase_quotation_responses response
   WHERE response.quotation_id = p_quotation_id
   ORDER BY response.id
   FOR UPDATE;
  SELECT response.*
    INTO v_response
    FROM public.purchase_quotation_responses response
   WHERE response.id = p_response_id
     AND response.quotation_id = p_quotation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Resposta vencedora nao pertence a cotacao'
      USING ERRCODE = '22023';
  END IF;
  SELECT supplier.name
    INTO v_supplier_name
    FROM public.suppliers supplier
   WHERE supplier.id = v_response.supplier_id
   FOR SHARE;
  IF NULLIF(pg_catalog.btrim(COALESCE(v_supplier_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Fornecedor da resposta vencedora nao existe'
      USING ERRCODE = 'P0002';
  END IF;
  IF COALESCE(v_response.freight_value, 0) < 0
     OR COALESCE(v_response.freight_value, 0) = 'NaN'::numeric THEN
    RAISE EXCEPTION 'Frete da resposta vencedora nao pode ser negativo/invalido'
      USING ERRCODE = '22023';
  END IF;

  PERFORM quotation_item.id
    FROM public.purchase_quotation_items quotation_item
   WHERE quotation_item.quotation_id = p_quotation_id
   ORDER BY quotation_item.id
   FOR UPDATE;
  PERFORM price.id
    FROM public.purchase_quotation_prices price
    JOIN public.purchase_quotation_items quotation_item
      ON quotation_item.id = price.quotation_item_id
   WHERE quotation_item.quotation_id = p_quotation_id
     AND price.response_id = p_response_id
   ORDER BY price.id
   FOR UPDATE OF price;
  SELECT pg_catalog.count(*)::integer
    INTO v_item_count
    FROM public.purchase_quotation_items quotation_item
   WHERE quotation_item.quotation_id = p_quotation_id;
  IF EXISTS (
    SELECT 1
      FROM public.purchase_quotation_items quotation_item
     WHERE quotation_item.quotation_id = p_quotation_id
       AND (
         quotation_item.product_id IS NULL
         OR COALESCE(quotation_item.quantity, 0) <= 0
         OR NULLIF(pg_catalog.btrim(COALESCE(quotation_item.unit, '')), '') IS NULL
       )
  ) THEN
    RAISE EXCEPTION 'Cotacao vencedora contem item sem produto, quantidade ou unidade valida'
      USING ERRCODE = '22023';
  END IF;
  SELECT pg_catalog.count(*)::integer
    INTO v_price_count
    FROM public.purchase_quotation_prices price
    JOIN public.purchase_quotation_items quotation_item
      ON quotation_item.id = price.quotation_item_id
   WHERE quotation_item.quotation_id = p_quotation_id
     AND price.response_id = p_response_id
     AND COALESCE(price.unit_price, 0) > 0
     AND COALESCE(price.discount_pct, 0) BETWEEN 0 AND 100
     AND price.unit_price * (1 - COALESCE(price.discount_pct, 0) / 100.0) > 0;
  IF v_item_count = 0 OR v_price_count <> v_item_count THEN
    RAISE EXCEPTION
      'Vencedor precisa ter exatamente um preco efetivo positivo para cada item (%)',
      v_item_count
      USING ERRCODE = '22023';
  END IF;
  SELECT pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'quotation_item_id', quotation_item.id,
             'product_id', quotation_item.product_id,
             'quantity', quotation_item.quantity,
             'unit', quotation_item.unit,
             'unit_price', price.unit_price,
             'discount_pct', COALESCE(price.discount_pct, 0),
             'effective_unit_price', pg_catalog.round(
               price.unit_price * (1 - COALESCE(price.discount_pct, 0) / 100.0),
               6
             ),
             'price_notes', price.notes
           ) ORDER BY quotation_item.id
         )
    INTO v_items
    FROM public.purchase_quotation_items quotation_item
    JOIN public.purchase_quotation_prices price
      ON price.quotation_item_id = quotation_item.id
     AND price.response_id = p_response_id
   WHERE quotation_item.quotation_id = p_quotation_id;
  IF pg_catalog.jsonb_array_length(COALESCE(v_items, '[]'::jsonb)) <> v_item_count THEN
    RAISE EXCEPTION 'Cobertura de precos mudou durante o award'
      USING ERRCODE = '40001';
  END IF;
  SELECT COALESCE(
           pg_catalog.sum(
             (snapshot_item.value ->> 'quantity')::numeric
             * (snapshot_item.value ->> 'effective_unit_price')::numeric
           ),
           0
         )
    INTO v_subtotal_value
    FROM pg_catalog.jsonb_array_elements(v_items) snapshot_item(value);
  v_total_value := v_subtotal_value + COALESCE(v_response.freight_value, 0);
  v_snapshot := pg_catalog.jsonb_build_object(
    'quotation_id', p_quotation_id,
    'quotation_number', v_quotation.quotation_number,
    'response_id', p_response_id,
    'supplier_id', v_response.supplier_id,
    'supplier_name', v_supplier_name,
    'delivery_days', v_response.delivery_days,
    'payment_terms', v_response.payment_terms,
    'freight_type', v_response.freight_type,
    'freight_value', COALESCE(v_response.freight_value, 0),
    'validity_days', v_response.validity_days,
    'response_notes', v_response.notes,
    'subtotal_value', v_subtotal_value,
    'total_value', v_total_value,
    'items', v_items
  );
  v_snapshot_digest := pg_catalog.md5(v_snapshot::text);

  v_previous_marker := pg_catalog.current_setting(
    'app.purchase_quotation_award_internal', true
  );
  PERFORM pg_catalog.set_config(
    'app.purchase_quotation_award_internal', p_quotation_id::text, true
  );
  BEGIN
    UPDATE public.purchase_quotation_responses response
       SET is_winner = false
     WHERE response.quotation_id = p_quotation_id
       AND response.id <> p_response_id
       AND response.is_winner IS TRUE;
    UPDATE public.purchase_quotation_responses response
       SET is_winner = true
     WHERE response.id = p_response_id
       AND response.quotation_id = p_quotation_id;
    UPDATE public.purchase_quotations quotation
       SET selected_supplier_id = v_response.supplier_id,
           status = 'aprovada',
           decision_at = pg_catalog.now(),
           decided_by = v_actor_id
     WHERE quotation.id = p_quotation_id
     RETURNING * INTO v_quotation;
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_catalog.set_config(
      'app.purchase_quotation_award_internal', COALESCE(v_previous_marker, ''), true
    );
    RAISE;
  END;
  PERFORM pg_catalog.set_config(
    'app.purchase_quotation_award_internal', COALESCE(v_previous_marker, ''), true
  );

  IF (SELECT pg_catalog.count(*)
        FROM public.purchase_quotation_responses response
       WHERE response.quotation_id = p_quotation_id
         AND response.is_winner IS TRUE) <> 1 THEN
    RAISE EXCEPTION 'Cotacao precisa terminar com exatamente um vencedor'
      USING ERRCODE = 'PZ220';
  END IF;

  INSERT INTO public.purchase_quotation_award_snapshots (
    id, quotation_id, response_id, supplier_id,
    snapshot_digest, snapshot, actor_id
  ) VALUES (
    v_snapshot_id, p_quotation_id, p_response_id, v_response.supplier_id,
    v_snapshot_digest, v_snapshot, v_actor_id
  );

  v_result := pg_catalog.jsonb_build_object(
    'quotation_id', p_quotation_id,
    'response_id', p_response_id,
    'supplier_id', v_response.supplier_id,
    'status', v_quotation.status,
    'award_snapshot_id', v_snapshot_id,
    'snapshot_digest', v_snapshot_digest,
    'receipt_id', v_receipt_id,
    'client_request_id', p_client_request_id,
    'request_hash', v_request_hash,
    'replayed', false
  );
  INSERT INTO public.purchase_order_command_receipts (
    id, client_request_id, command_name, purchase_order_id,
    request_hash, actor_id, response
  ) VALUES (
    v_receipt_id, p_client_request_id, 'quotation_winner', NULL,
    v_request_hash, v_actor_id, v_result
  );
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.select_purchase_quotation_winner_command(
  uuid,uuid,uuid,text,uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.select_purchase_quotation_winner_command(
  uuid,uuid,uuid,text,uuid
) TO authenticated;

DO $retire_quotation_writer_121$
BEGIN
  IF pg_catalog.to_regprocedure('public.create_po_from_quotation(uuid)') IS NOT NULL
     AND pg_catalog.to_regprocedure(
       'public.create_po_from_quotation_impl_121(uuid)'
     ) IS NULL THEN
    ALTER FUNCTION public.create_po_from_quotation(uuid)
      RENAME TO create_po_from_quotation_impl_121;
  END IF;
END;
$retire_quotation_writer_121$;

REVOKE ALL ON FUNCTION public.create_po_from_quotation_impl_121(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_po_from_quotation_command(
  p_quotation_id uuid,
  p_client_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_quotation public.purchase_quotations%ROWTYPE;
  v_award public.purchase_quotation_award_snapshots%ROWTYPE;
  v_supplier_name text;
  v_product_ids uuid[];
  v_items jsonb;
  v_winner_count integer;
  v_winner_response_id uuid;
  v_winner_supplier_id uuid;
  v_payment_days jsonb;
BEGIN
  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin', 'gerente']) THEN
    RAISE EXCEPTION
      'Permission denied: gerar OC da cotacao exige Administracao ou Gerencia'
      USING ERRCODE = '42501';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id e obrigatorio'
      USING ERRCODE = '22023';
  END IF;

  PERFORM public.lock_sale_order_purchase_allocation();
  SELECT quotation.*
    INTO v_quotation
    FROM public.purchase_quotations quotation
   WHERE quotation.id = p_quotation_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cotacao % nao encontrada', p_quotation_id
      USING ERRCODE = 'P0002';
  END IF;
  IF pg_catalog.lower(COALESCE(v_quotation.status, '')) NOT IN ('aprovada', 'approved') THEN
    RAISE EXCEPTION 'Cotacao precisa estar aprovada antes de gerar OC'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO v_winner_count
    FROM public.purchase_quotation_responses response
   WHERE response.quotation_id = p_quotation_id
     AND response.is_winner IS TRUE;
  IF v_winner_count <> 1 THEN
    RAISE EXCEPTION 'Cotacao precisa ter exatamente um fornecedor vencedor'
      USING ERRCODE = '55000';
  END IF;
  SELECT response.id, response.supplier_id
    INTO v_winner_response_id, v_winner_supplier_id
    FROM public.purchase_quotation_responses response
   WHERE response.quotation_id = p_quotation_id
     AND response.is_winner IS TRUE;
  IF v_quotation.selected_supplier_id IS NULL
     OR v_winner_supplier_id IS DISTINCT FROM v_quotation.selected_supplier_id THEN
    RAISE EXCEPTION 'Vencedor da resposta diverge do fornecedor selecionado na cotacao'
      USING ERRCODE = 'PZ220';
  END IF;

  SELECT snapshot.*
    INTO v_award
    FROM public.purchase_quotation_award_snapshots snapshot
   WHERE snapshot.quotation_id = p_quotation_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cotacao aprovada sem snapshot comercial vencedor'
      USING ERRCODE = 'PZ220';
  END IF;
  IF v_award.response_id IS DISTINCT FROM v_winner_response_id
     OR v_award.supplier_id IS DISTINCT FROM v_winner_supplier_id
     OR v_award.snapshot_digest IS DISTINCT FROM
          pg_catalog.md5(v_award.snapshot::text)
     OR (v_award.snapshot ->> 'quotation_id')::uuid IS DISTINCT FROM p_quotation_id
     OR (v_award.snapshot ->> 'response_id')::uuid IS DISTINCT FROM v_winner_response_id
     OR (v_award.snapshot ->> 'supplier_id')::uuid IS DISTINCT FROM v_winner_supplier_id THEN
    RAISE EXCEPTION 'Snapshot comercial diverge do award da cotacao'
      USING ERRCODE = 'PZ220';
  END IF;

  v_supplier_name := v_award.snapshot ->> 'supplier_name';
  IF NULLIF(pg_catalog.btrim(COALESCE(v_supplier_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Snapshot comercial nao congelou o nome do fornecedor'
      USING ERRCODE = 'PZ220';
  END IF;

  SELECT COALESCE(
           pg_catalog.array_agg(scope.product_id ORDER BY scope.product_id),
           ARRAY[]::uuid[]
         )
    INTO v_product_ids
    FROM (
      SELECT DISTINCT (snapshot_item.value ->> 'product_id')::uuid AS product_id
        FROM pg_catalog.jsonb_array_elements(
          v_award.snapshot -> 'items'
        ) snapshot_item(value)
    ) scope
   WHERE scope.product_id IS NOT NULL;
  IF pg_catalog.cardinality(v_product_ids) = 0 THEN
    RAISE EXCEPTION 'Snapshot comercial nao possui itens de produto'
      USING ERRCODE = '22023';
  END IF;
  PERFORM public.lock_sale_order_purchase_products(v_product_ids);
  SELECT pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'product_id', snapshot_item.value ->> 'product_id',
             'quantity', (snapshot_item.value ->> 'quantity')::numeric,
             'unit', snapshot_item.value ->> 'unit',
             'unit_price',
               (snapshot_item.value ->> 'effective_unit_price')::numeric
           ) ORDER BY snapshot_item.ordinality
         )
    INTO v_items
    FROM pg_catalog.jsonb_array_elements(
      v_award.snapshot -> 'items'
    ) WITH ORDINALITY snapshot_item(value, ordinality);
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(
        v_award.snapshot -> 'items'
      ) snapshot_item(value)
     WHERE NULLIF(snapshot_item.value ->> 'product_id', '') IS NULL
        OR COALESCE((snapshot_item.value ->> 'quantity')::numeric, 0) <= 0
        OR NULLIF(pg_catalog.btrim(COALESCE(snapshot_item.value ->> 'unit', '')), '') IS NULL
        OR COALESCE((snapshot_item.value ->> 'unit_price')::numeric, 0) <= 0
        OR COALESCE((snapshot_item.value ->> 'discount_pct')::numeric, 0)
             NOT BETWEEN 0 AND 100
        OR COALESCE(
             (snapshot_item.value ->> 'effective_unit_price')::numeric,
             0
           ) <= 0
  ) THEN
    RAISE EXCEPTION 'Snapshot comercial contem item/preco invalido'
      USING ERRCODE = 'PZ220';
  END IF;
  v_payment_days := public.purchase_order_payment_days_121(
    v_award.snapshot ->> 'payment_terms'
  );

  RETURN public.execute_purchase_order_command(
    'create',
    pg_catalog.jsonb_build_object(
      'header', pg_catalog.jsonb_build_object(
        'supplier_id', v_award.supplier_id,
        'supplier_name', v_supplier_name,
        'status', 'pending',
        'notes', 'Gerada da cotacao ' || COALESCE(
          v_quotation.quotation_number,
          p_quotation_id::text
        ),
        'auto_generated', false,
        'source_type', 'manual',
        'idempotency_key', 'quotation:' || p_quotation_id::text,
        'freight_value', COALESCE(
          (v_award.snapshot ->> 'freight_value')::numeric,
          0
        ),
        'freight_type', v_award.snapshot ->> 'freight_type',
        'payment_terms', v_award.snapshot ->> 'payment_terms',
        'quotation_award_snapshot_id', v_award.id,
        'quotation_award_snapshot_digest', v_award.snapshot_digest
      ),
      'items', v_items,
      'return_existing_on_idempotency', true,
      'create_payables', true,
      'payment_days', v_payment_days,
      'payable_description', 'OC da cotacao ' || COALESCE(
        v_award.snapshot ->> 'quotation_number',
        p_quotation_id::text
      )
    ),
    p_client_request_id,
    NULL,
    NULL
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_po_from_quotation_command(uuid,uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_po_from_quotation_command(uuid,uuid)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- MRP: lote atomico, request duravel e filhos no command generico
-- ---------------------------------------------------------------------------

DO $retire_mrp_writer_121$
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.generate_purchase_orders_from_mrp(uuid[])'
     ) IS NOT NULL
     AND pg_catalog.to_regprocedure(
       'public.generate_purchase_orders_from_mrp_impl_121(uuid[])'
     ) IS NULL THEN
    ALTER FUNCTION public.generate_purchase_orders_from_mrp(uuid[])
      RENAME TO generate_purchase_orders_from_mrp_impl_121;
  END IF;
END;
$retire_mrp_writer_121$;

REVOKE ALL ON FUNCTION public.generate_purchase_orders_from_mrp_impl_121(uuid[])
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.generate_purchase_orders_from_mrp(
  p_product_ids uuid[],
  p_client_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_requested_ids uuid[];
  v_scope_ids uuid[];
  v_revalidated_ids uuid[];
  v_request_hash text;
  v_existing public.purchase_order_command_receipts%ROWTYPE;
  v_receipt_id uuid := pg_catalog.gen_random_uuid();
  v_supplier_id uuid;
  v_supplier_name text;
  v_group_product_ids uuid[];
  v_items jsonb;
  v_linked_ids uuid[];
  v_child_request_id uuid;
  v_child_hash text;
  v_child_result jsonb;
  v_po_ids uuid[] := ARRAY[]::uuid[];
  v_result jsonb;
BEGIN
  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin', 'gerente']) THEN
    RAISE EXCEPTION
      'Permission denied: gerar OCs do MRP exige Administracao ou Gerencia'
      USING ERRCODE = '42501';
  END IF;
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'client_request_id e obrigatorio'
      USING ERRCODE = '22023';
  END IF;

  PERFORM public.lock_sale_order_purchase_allocation();
  SELECT COALESCE(
           pg_catalog.array_agg(scope.product_id ORDER BY scope.product_id),
           ARRAY[]::uuid[]
         )
    INTO v_requested_ids
    FROM (
      SELECT DISTINCT input.product_id
        FROM pg_catalog.unnest(COALESCE(p_product_ids, ARRAY[]::uuid[]))
          input(product_id)
       WHERE input.product_id IS NOT NULL
    ) scope;
  v_request_hash := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'command', 'mrp',
    'all_products', p_product_ids IS NULL,
    'product_ids', v_requested_ids
  )::text);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'purchase-order-command:' || p_client_request_id::text,
    0
  ));
  SELECT receipt.*
    INTO v_existing
    FROM public.purchase_order_command_receipts receipt
   WHERE receipt.client_request_id = p_client_request_id
   FOR UPDATE;
  IF FOUND THEN
    IF v_existing.command_name IS DISTINCT FROM 'mrp'
       OR v_existing.request_hash IS DISTINCT FROM v_request_hash
       OR v_existing.actor_id IS DISTINCT FROM v_actor_id THEN
      RAISE EXCEPTION 'Replay divergente para client_request_id %', p_client_request_id
        USING ERRCODE = '22000';
    END IF;
    RETURN v_existing.response || pg_catalog.jsonb_build_object(
      'replayed', true,
      'receipt_id', v_existing.id
    );
  END IF;

  SELECT COALESCE(
           pg_catalog.array_agg(scope.product_id ORDER BY scope.product_id),
           ARRAY[]::uuid[]
         )
    INTO v_scope_ids
    FROM (
      SELECT DISTINCT need.product_id
        FROM public.v_mrp_needs need
       WHERE need.suggested_qty > 0
         AND NOT COALESCE(need.is_packaging, false)
         AND NOT COALESCE(need.is_artisanal, false)
         AND (p_product_ids IS NULL OR need.product_id = ANY(p_product_ids))
    ) scope;
  PERFORM public.lock_sale_order_purchase_products(v_scope_ids);
  SELECT COALESCE(
           pg_catalog.array_agg(scope.product_id ORDER BY scope.product_id),
           ARRAY[]::uuid[]
         )
    INTO v_revalidated_ids
    FROM (
      SELECT DISTINCT need.product_id
        FROM public.v_mrp_needs need
       WHERE need.suggested_qty > 0
         AND NOT COALESCE(need.is_packaging, false)
         AND NOT COALESCE(need.is_artisanal, false)
         AND (p_product_ids IS NULL OR need.product_id = ANY(p_product_ids))
    ) scope;
  IF v_revalidated_ids IS DISTINCT FROM v_scope_ids THEN
    RAISE EXCEPTION 'Necessidades do MRP mudaram durante os locks; tente novamente'
      USING ERRCODE = '40001';
  END IF;

  FOR v_supplier_id, v_supplier_name, v_group_product_ids, v_items IN
    SELECT need.preferred_supplier_id,
           COALESCE(NULLIF(need.supplier_name, ''), 'Sem Fornecedor'),
           pg_catalog.array_agg(need.product_id ORDER BY need.product_id),
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'product_id', need.product_id,
               'quantity', need.suggested_qty,
               'unit', need.unit,
               'unit_price', need.unit_price,
               'current_stock', need.on_hand,
               'min_stock', need.min_stock,
               'max_stock', 0
             ) ORDER BY need.product_id
           )
      FROM public.v_mrp_needs need
     WHERE need.product_id = ANY(v_scope_ids)
       AND need.suggested_qty > 0
       AND NOT COALESCE(need.is_packaging, false)
       AND NOT COALESCE(need.is_artisanal, false)
     GROUP BY need.preferred_supplier_id,
              COALESCE(NULLIF(need.supplier_name, ''), 'Sem Fornecedor')
     ORDER BY need.preferred_supplier_id NULLS LAST,
              COALESCE(NULLIF(need.supplier_name, ''), 'Sem Fornecedor')
  LOOP
    SELECT COALESCE(
             pg_catalog.array_agg(DISTINCT sale_order.id ORDER BY sale_order.id),
             ARRAY[]::uuid[]
           )
      INTO v_linked_ids
      FROM public.sale_orders sale_order
      JOIN public.sale_order_items sale_item
        ON sale_item.sale_order_id = sale_order.id
      JOIN public.sheet_materials material
        ON material.sheet_id = sale_item.reference_id
       AND material.product_id = ANY(v_group_product_ids)
     WHERE sale_order.deleted_at IS NULL
       AND sale_order.status IN ('Aprovado', 'Em Produção');

    v_child_hash := pg_catalog.md5(
      p_client_request_id::text || ':' || COALESCE(v_supplier_id::text, v_supplier_name)
    );
    v_child_request_id := (
      pg_catalog.substr(v_child_hash, 1, 8) || '-' ||
      pg_catalog.substr(v_child_hash, 9, 4) || '-' ||
      pg_catalog.substr(v_child_hash, 13, 4) || '-' ||
      pg_catalog.substr(v_child_hash, 17, 4) || '-' ||
      pg_catalog.substr(v_child_hash, 21, 12)
    )::uuid;
    v_child_result := public.execute_purchase_order_command(
      'create',
      pg_catalog.jsonb_build_object(
        'header', pg_catalog.jsonb_build_object(
          'supplier_id', v_supplier_id,
          'supplier_name', v_supplier_name,
          'status', 'pending',
          'notes', 'Gerada automaticamente pelo MRP',
          'auto_generated', true,
          'source_type', 'mrp',
          'linked_sale_order_ids', pg_catalog.to_jsonb(v_linked_ids),
          'source_pv_ids', pg_catalog.to_jsonb(v_linked_ids),
          'idempotency_key', 'mrp:' || p_client_request_id::text || ':'
            || COALESCE(v_supplier_id::text, v_supplier_name)
        ),
        'items', v_items,
        'return_existing_on_idempotency', true
      ),
      v_child_request_id,
      NULL,
      NULL
    );
    v_po_ids := pg_catalog.array_append(
      v_po_ids,
      (v_child_result ->> 'purchase_order_id')::uuid
    );
  END LOOP;

  v_result := pg_catalog.jsonb_build_object(
    'purchase_order_ids', pg_catalog.to_jsonb(v_po_ids),
    'receipt_id', v_receipt_id,
    'client_request_id', p_client_request_id,
    'request_hash', v_request_hash,
    'replayed', false
  );
  INSERT INTO public.purchase_order_command_receipts (
    id, client_request_id, command_name, purchase_order_id,
    request_hash, actor_id, response
  ) VALUES (
    v_receipt_id, p_client_request_id, 'mrp', NULL,
    v_request_hash, v_actor_id, v_result
  );
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.generate_purchase_orders_from_mrp(uuid[],uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.generate_purchase_orders_from_mrp(uuid[],uuid)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- Override destrutivo de produto: admin, CAS, receipt e locks completos
-- ---------------------------------------------------------------------------

DO $retire_force_delete_product_121$
BEGIN
  IF pg_catalog.to_regprocedure('public.force_delete_product(uuid)') IS NOT NULL
     AND pg_catalog.to_regprocedure(
       'public.force_delete_product_impl_121(uuid)'
     ) IS NULL THEN
    ALTER FUNCTION public.force_delete_product(uuid)
      RENAME TO force_delete_product_impl_121;
  END IF;
END;
$retire_force_delete_product_121$;

REVOKE ALL ON FUNCTION public.force_delete_product_impl_121(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.force_delete_product_command(
  p_product_id uuid,
  p_client_request_id uuid,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_request_hash text;
  v_receipt_id uuid := pg_catalog.gen_random_uuid();
  v_existing public.purchase_order_command_receipts%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_po_ids uuid[];
  v_po_id uuid;
  v_summary jsonb;
  v_result jsonb;
BEGIN
  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Permission denied: exclusao forcada exige Administracao'
      USING ERRCODE = '42501';
  END IF;
  IF p_product_id IS NULL OR p_client_request_id IS NULL
     OR p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'produto, client_request_id e expected_updated_at sao obrigatorios'
      USING ERRCODE = '22023';
  END IF;
  v_request_hash := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'product_id', p_product_id,
    'expected_updated_at', p_expected_updated_at
  )::text);

  PERFORM public.lock_sale_order_purchase_allocation();
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'purchase-order-command:' || p_client_request_id::text,
    0
  ));
  SELECT receipt.*
    INTO v_existing
    FROM public.purchase_order_command_receipts receipt
   WHERE receipt.client_request_id = p_client_request_id
   FOR UPDATE;
  IF FOUND THEN
    IF v_existing.command_name IS DISTINCT FROM 'force_delete_product'
       OR v_existing.request_hash IS DISTINCT FROM v_request_hash
       OR v_existing.actor_id IS DISTINCT FROM v_actor_id THEN
      RAISE EXCEPTION 'Replay divergente para client_request_id %', p_client_request_id
        USING ERRCODE = '22000';
    END IF;
    RETURN v_existing.response || pg_catalog.jsonb_build_object(
      'replayed', true,
      'receipt_id', v_existing.id
    );
  END IF;

  PERFORM public.lock_sale_order_purchase_products(ARRAY[p_product_id]);
  SELECT product.*
    INTO v_product
    FROM public.products product
   WHERE product.id = p_product_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto % nao encontrado', p_product_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_product.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Produto mudou desde a confirmacao; revise os vinculos'
      USING ERRCODE = '40001';
  END IF;

  SELECT COALESCE(
           pg_catalog.array_agg(scope.purchase_order_id ORDER BY scope.purchase_order_id),
           ARRAY[]::uuid[]
         )
    INTO v_po_ids
    FROM (
      SELECT DISTINCT item.purchase_order_id
        FROM public.purchase_order_items item
       WHERE item.product_id = p_product_id
    ) scope;
  FOREACH v_po_id IN ARRAY v_po_ids
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'purchase-order:' || v_po_id::text,
      0
    ));
  END LOOP;
  PERFORM purchase_order.id
    FROM public.purchase_orders purchase_order
   WHERE purchase_order.id = ANY(v_po_ids)
   ORDER BY purchase_order.id
   FOR UPDATE;
  PERFORM item.id
    FROM public.purchase_order_items item
   WHERE item.purchase_order_id = ANY(v_po_ids)
   ORDER BY item.id
   FOR UPDATE;

  v_summary := public.force_delete_product_impl_121(p_product_id);
  UPDATE public.purchase_orders purchase_order
     SET total_value = purchase_order.freight_value + (
           SELECT COALESCE(pg_catalog.sum(item.quantity * item.unit_price), 0)
             FROM public.purchase_order_items item
            WHERE item.purchase_order_id = purchase_order.id
         ),
         updated_at = pg_catalog.now()
   WHERE purchase_order.id = ANY(v_po_ids);

  v_result := v_summary || pg_catalog.jsonb_build_object(
    'receipt_id', v_receipt_id,
    'client_request_id', p_client_request_id,
    'request_hash', v_request_hash,
    'replayed', false
  );
  INSERT INTO public.purchase_order_command_receipts (
    id, client_request_id, command_name, purchase_order_id,
    request_hash, actor_id, response
  ) VALUES (
    v_receipt_id, p_client_request_id, 'force_delete_product', NULL,
    v_request_hash, v_actor_id, v_result
  );
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.force_delete_product_command(uuid,uuid,timestamptz)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.force_delete_product_command(uuid,uuid,timestamptz)
  TO authenticated;

-- Todos os callers web vivos (manual, avulso, onda, solado, material, PV, MRP
-- e cotacao) usam os commands acima. Os atalhos antigos e o DML REST deixam de
-- ser superficies de negocio; funcoes owner/trigger continuam operando.
REVOKE EXECUTE ON FUNCTION public.create_purchase_order_normalized(
  text,uuid,text,text,jsonb
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.upsert_po_item_atomic(
  uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,jsonb,text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.upsert_open_purchase_order(
  uuid,text,uuid,text,jsonb
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.purchase_orders
  FROM anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.purchase_order_items
  FROM anon, authenticated, service_role;

-- Grants de coluna sobrevivem a REVOKE da tabela; fecha-os de forma derivada
-- para cobrir colunas historicas e futuras ja presentes no momento do deploy.
DO $revoke_purchase_column_dml_121$
DECLARE
  v_table text;
  v_columns text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['purchase_orders', 'purchase_order_items']
  LOOP
    SELECT pg_catalog.string_agg(pg_catalog.quote_ident(column_name), ', ' ORDER BY ordinal_position)
      INTO v_columns
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = v_table;
    IF NULLIF(v_columns, '') IS NOT NULL THEN
      EXECUTE pg_catalog.format(
        'REVOKE INSERT (%1$s), UPDATE (%1$s) ON TABLE public.%2$I '
          || 'FROM anon, authenticated, service_role',
        v_columns,
        v_table
      );
    END IF;
  END LOOP;
END;
$revoke_purchase_column_dml_121$;

CREATE OR REPLACE FUNCTION public.run_purchase_order_command_boundary_contract_tests()
RETURNS TABLE(case_name text, ok boolean, detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_definition text;
  v_quotation text;
  v_winner text;
  v_mrp text;
  v_force_delete text;
  v_quote_guard text;
  v_stock_constraints text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.execute_purchase_order_command(text,jsonb,uuid,uuid,timestamptz)'::regprocedure
  ) INTO v_definition;
  v_quotation := pg_catalog.pg_get_functiondef(
    'public.create_po_from_quotation_command(uuid,uuid)'::regprocedure
  );
  v_winner := pg_catalog.pg_get_functiondef(
    'public.select_purchase_quotation_winner_command(uuid,uuid,uuid,text,uuid)'::regprocedure
  );
  v_mrp := pg_catalog.pg_get_functiondef(
    'public.generate_purchase_orders_from_mrp(uuid[],uuid)'::regprocedure
  );
  v_force_delete := pg_catalog.pg_get_functiondef(
    'public.force_delete_product_command(uuid,uuid,timestamptz)'::regprocedure
  );
  v_quote_guard := pg_catalog.pg_get_functiondef(
    'public.tg_lock_purchase_quotation_after_award_121()'::regprocedure
  );
  SELECT pg_catalog.string_agg(
           pg_catalog.pg_get_constraintdef(constraint_row.oid),
           ' ' ORDER BY constraint_row.conname
         )
    INTO v_stock_constraints
    FROM pg_catalog.pg_constraint constraint_row
   WHERE constraint_row.conrelid = 'public.stock_movements'::regclass
     AND constraint_row.contype = 'c';

  case_name := 'command_receipt_replay';
  ok := position('purchase_order_command_receipts' IN v_definition) > 0
    AND position('Replay divergente' IN v_definition) > 0
    AND position('replayed' IN v_definition) > 0;
  detail := 'request_id, hash e replay retornam o recibo sem repetir efeitos';
  RETURN NEXT;

  case_name := 'lock_order_epoch_product_box_po_item';
  ok := position('lock_sale_order_purchase_allocation' IN v_definition) > 0
    AND position('lock_sale_order_purchase_products' IN v_definition) > 0
    AND position('lock_purchase_order_box_types_121' IN v_definition) > 0
    AND position(
      '''purchase-order:'' || p_purchase_order_id::text' IN v_definition
    ) > 0
    AND position('ORDER BY locked_item.id' IN v_definition) > 0
    AND position('lock_sale_order_purchase_allocation' IN v_definition)
      < position('lock_sale_order_purchase_products' IN v_definition)
    AND position('lock_sale_order_purchase_products' IN v_definition)
      < position('lock_purchase_order_box_types_121' IN v_definition)
    AND position('lock_purchase_order_box_types_121' IN v_definition)
      < position(
        '''purchase-order:'' || p_purchase_order_id::text' IN v_definition
      );
  detail := 'epoch, produtos e embalagens ordenados precedem cabecalho e itens';
  RETURN NEXT;

  case_name := 'receipt_is_single_transaction';
  ok := position('UPDATE public.products' IN v_definition) > 0
    AND position('UPDATE public.box_types' IN v_definition) > 0
    AND position('INSERT INTO public.stock_movements' IN v_definition) > 0
    AND position('INSERT INTO public.box_type_stock_movements' IN v_definition) > 0
    AND position('UPDATE public.purchase_order_items' IN v_definition) > 0
    AND position('INSERT INTO public.purchase_order_command_receipts' IN v_definition) > 0
    AND position('v_new_unit_price, ''compra''' IN v_definition) > 0
    AND position('''purchase_order_receipt'', v_effective_unit_price' IN v_definition) = 0;
  detail := 'produto/grade ou embalagem, ledger, item/OC e receipt compartilham a transacao';
  RETURN NEXT;

  case_name := 'box_type_is_canonical_stock_identity';
  ok := position('v_item_row.box_type_id IS NOT NULL' IN v_definition) > 0
    AND position('UPDATE public.box_types' IN v_definition) > 0
    AND position('INSERT INTO public.box_type_stock_movements' IN v_definition) > 0
    AND position('''box_type_id'', v_item_row.box_type_id' IN v_definition) > 0
    AND position('lock_purchase_order_box_types_121' IN v_definition) > 0
    AND pg_catalog.to_regclass('public.box_type_stock_movements') IS NOT NULL
    AND EXISTS (
      SELECT 1
        FROM pg_catalog.pg_constraint constraint_row
       WHERE constraint_row.conrelid = 'public.purchase_order_items'::regclass
         AND constraint_row.conname =
           'purchase_order_items_exactly_one_stock_identity_ck'
         AND constraint_row.convalidated
    );
  detail := 'embalagem usa identidade/estoque/ledger proprios, sem ponte por nome';
  RETURN NEXT;

  case_name := 'receipt_matches_live_stock_movement_schema';
  ok := position('v_new_unit_price, ''compra''' IN v_definition) > 0
    AND position('NULL, v_effective_unit_price' IN v_definition) > 0
    AND position('compra' IN COALESCE(v_stock_constraints, '')) > 0
    AND EXISTS (
      SELECT 1
        FROM information_schema.columns column_row
       WHERE column_row.table_schema = 'public'
         AND column_row.table_name = 'stock_movements'
         AND column_row.column_name = 'origin_type'
         AND column_row.is_nullable = 'YES'
    );
  detail := 'produto recebido usa reason compra e origin NULL aceitos pelo schema vivo';
  RETURN NEXT;

  case_name := 'grade_is_fail_closed';
  ok := position('jsonb_typeof(grade_entry.value) = ''number''' IN v_definition) > 0
    AND position('pg_catalog.trunc((grade_entry.value #>> ''{}'')::numeric)' IN v_definition) > 0
    AND position('v_grade_sum IS DISTINCT FROM v_item_row.quantity' IN v_definition) > 0
    AND position('quantidades inteiras e nao negativas' IN v_definition) > 0;
  detail := 'grade recusa valor textual/negativo/fracionario e exige soma exata';
  RETURN NEXT;

  case_name := 'append_is_idempotent_per_sale_order';
  ok := position('deduplicate_sale_order_id' IN v_definition) > 0
    AND position('v_skip_append' IN v_definition) > 0
    AND position('linked_sale_order_ids' IN v_definition) > 0
    AND position('''deduplicated'', v_skip_append' IN v_definition) > 0
    AND position('notes_append' IN v_definition) > 0
    AND position('E''\n''' IN v_definition) > 0;
  detail := 'retry concluido do mesmo PV nao soma item/nota/financeiro novamente';
  RETURN NEXT;

  case_name := 'generic_rejects_artisanal';
  ok := position('source_type = ''strap_demand''' IN v_definition) > 0
    AND position('fronteira operacional propria' IN v_definition) > 0;
  detail := 'canal artesanal continua separado';
  RETURN NEXT;

  case_name := 'command_acl_is_explicit';
  ok := pg_catalog.has_function_privilege(
      'authenticated', 'public.execute_purchase_order_command(text,jsonb,uuid,uuid,timestamptz)', 'EXECUTE'
    ) AND pg_catalog.has_function_privilege(
      'service_role', 'public.execute_purchase_order_command(text,jsonb,uuid,uuid,timestamptz)', 'EXECUTE'
    ) AND NOT pg_catalog.has_function_privilege(
      'anon', 'public.execute_purchase_order_command(text,jsonb,uuid,uuid,timestamptz)', 'EXECUTE'
    ) AND pg_catalog.has_function_privilege(
      'authenticated', 'public.create_po_from_quotation_command(uuid,uuid)', 'EXECUTE'
    ) AND pg_catalog.has_function_privilege(
      'authenticated', 'public.generate_purchase_orders_from_mrp(uuid[],uuid)', 'EXECUTE'
    ) AND NOT pg_catalog.has_table_privilege(
      'authenticated', 'public.purchase_order_command_receipts', 'SELECT'
    );
  detail := 'command so autenticado/service; recibos internos nao sao expostos';
  RETURN NEXT;

  case_name := 'legacy_and_table_dml_are_closed';
  ok := NOT pg_catalog.has_function_privilege(
      'authenticated', 'public.create_purchase_order_normalized(text,uuid,text,text,jsonb)', 'EXECUTE'
    ) AND NOT pg_catalog.has_function_privilege(
      'authenticated',
      'public.upsert_po_item_atomic(uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,jsonb,text)',
      'EXECUTE'
    ) AND NOT pg_catalog.has_function_privilege(
      'authenticated', 'public.upsert_open_purchase_order(uuid,text,uuid,text,jsonb)', 'EXECUTE'
    ) AND NOT pg_catalog.has_table_privilege('authenticated', 'public.purchase_orders', 'INSERT')
    AND NOT pg_catalog.has_table_privilege('authenticated', 'public.purchase_orders', 'UPDATE')
    AND NOT pg_catalog.has_table_privilege('authenticated', 'public.purchase_orders', 'DELETE')
    AND NOT pg_catalog.has_table_privilege('authenticated', 'public.purchase_order_items', 'INSERT')
    AND NOT pg_catalog.has_table_privilege('authenticated', 'public.purchase_order_items', 'UPDATE')
    AND NOT pg_catalog.has_table_privilege('authenticated', 'public.purchase_order_items', 'DELETE')
    AND NOT pg_catalog.has_table_privilege('service_role', 'public.purchase_orders', 'INSERT')
    AND NOT pg_catalog.has_table_privilege('service_role', 'public.purchase_orders', 'UPDATE')
    AND NOT pg_catalog.has_table_privilege('service_role', 'public.purchase_orders', 'DELETE')
    AND NOT pg_catalog.has_table_privilege('service_role', 'public.purchase_order_items', 'INSERT')
    AND NOT pg_catalog.has_table_privilege('service_role', 'public.purchase_order_items', 'UPDATE')
    AND NOT pg_catalog.has_table_privilege('service_role', 'public.purchase_order_items', 'DELETE');
  detail := 'RPCs legadas e REST I/U/D nao contornam a command';
  RETURN NEXT;

  case_name := 'quotation_is_atomic_and_complete';
  ok := position('exatamente um fornecedor vencedor' IN v_quotation) > 0
    AND position('purchase_quotation_award_snapshots' IN v_quotation) > 0
    AND position('snapshot_digest' IN v_quotation) > 0
    AND position('purchase_quotation_prices' IN v_quotation) = 0
    AND position('response.is_winner IS TRUE' IN v_quotation) > 0
    AND position('OR response.supplier_id' IN v_quotation) = 0
    AND position('ux_purchase_quotation_one_winner_121' IN pg_catalog.pg_get_indexdef(
      'public.ux_purchase_quotation_one_winner_121'::regclass
    )) > 0
    AND position('v_price_count <> v_item_count' IN v_winner) > 0
    AND position('effective_unit_price' IN v_winner) > 0
    AND position('freight_value' IN v_winner) > 0
    AND position('subtotal_value' IN v_winner) > 0
    AND position('purchase_quotation_award_snapshots' IN v_winner) > 0
    AND position('UPDATE public.purchase_quotation_responses' IN v_winner) > 0
    AND position('UPDATE public.purchase_quotations' IN v_winner) > 0
    AND position('create_payables' IN v_quotation) > 0
    AND position('payment_days' IN v_quotation) > 0
    AND position('quotation_award_snapshot_id' IN v_quotation) > 0
    AND position('Cotacao aprovada e imutavel' IN v_quote_guard) > 0;
  detail := 'award congela preco/frete/termos; OC e AP usam somente o snapshot';
  RETURN NEXT;

  case_name := 'mrp_replay_uses_input_hash';
  ok := position('''all_products'', p_product_ids IS NULL' IN v_mrp) > 0
    AND position('''product_ids'', v_requested_ids' IN v_mrp) > 0
    AND position('WHERE receipt.client_request_id' IN v_mrp)
      < position('FROM public.v_mrp_needs need' IN v_mrp)
    AND position('lock_sale_order_purchase_products' IN v_mrp) > 0;
  detail := 'replay do lote MRP independe das necessidades alteradas pela primeira execucao';
  RETURN NEXT;

  case_name := 'force_delete_is_admin_cas_receipt';
  ok := position('ARRAY[''admin'']' IN v_force_delete) > 0
    AND position('p_expected_updated_at' IN v_force_delete) > 0
    AND position('lock_sale_order_purchase_allocation' IN v_force_delete)
      < position('lock_sale_order_purchase_products' IN v_force_delete)
    AND position('purchase_order_command_receipts' IN v_force_delete) > 0
    AND NOT pg_catalog.has_function_privilege(
      'service_role', 'public.force_delete_product_command(uuid,uuid,timestamptz)', 'EXECUTE'
    );
  detail := 'override destrutivo exige admin, CAS, receipt e ordem epoch/produto/OC';
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.run_purchase_order_command_boundary_contract_tests()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_purchase_order_command_boundary_contract_tests()
  TO service_role;

DO $contract$
DECLARE
  v_failed text;
BEGIN
  SELECT pg_catalog.string_agg(test.case_name || ': ' || test.detail, '; ')
    INTO v_failed
    FROM public.run_purchase_order_command_boundary_contract_tests() test
   WHERE NOT test.ok;
  IF v_failed IS NOT NULL THEN
    RAISE EXCEPTION 'Contrato da fronteira de OC falhou: %', v_failed;
  END IF;
END;
$contract$;

COMMIT;
