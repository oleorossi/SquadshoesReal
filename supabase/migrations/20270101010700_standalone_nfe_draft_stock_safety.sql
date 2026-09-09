-- =============================================================================
-- NF-e avulsa: readiness comercial + hold transacional de estoque
-- =============================================================================
-- Uma NF-e avulsa nasce como PV Rascunho e aponta diretamente para products.
-- A emissão fiscal só pode atravessar a fronteira depois de:
--   * validar cliente/política/crédito e a identidade comercial dos itens;
--   * reservar estoque com lock determinístico;
--   * converter a reserva em baixa somente após autorização da SEFAZ.
-- Falha/rejeição libera a reserva. Cancelamento autorizado gera estorno
-- idempotente e devolve o PV avulso para Rascunho, sem criar OP.

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Ledger privado do hold
-- -----------------------------------------------------------------------------

CREATE TABLE public.standalone_nfe_stock_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_order_id uuid NOT NULL
    REFERENCES public.sale_orders(id) ON DELETE RESTRICT,
  attempt_id uuid NOT NULL,
  nfe_id uuid
    REFERENCES public.nfe_emitidas(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'prepared'
    CHECK (status IN (
      'prepared', 'committed', 'released', 'reversed',
      'reconciliation_required'
    )),
  preflight_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  prepared_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  prepared_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  committed_at timestamptz,
  released_at timestamptz,
  reversed_at timestamptz,
  release_reason text,
  reconciliation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sale_order_id, attempt_id),
  UNIQUE (nfe_id)
);

CREATE UNIQUE INDEX standalone_nfe_stock_holds_one_active_order_uq
  ON public.standalone_nfe_stock_holds(sale_order_id)
  WHERE status IN ('prepared', 'reconciliation_required');

CREATE INDEX standalone_nfe_stock_holds_stale_idx
  ON public.standalone_nfe_stock_holds(expires_at)
  WHERE status IN ('prepared', 'reconciliation_required');

CREATE TABLE public.standalone_nfe_stock_hold_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hold_id uuid NOT NULL
    REFERENCES public.standalone_nfe_stock_holds(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  source_item_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  quantity numeric NOT NULL CHECK (quantity > 0),
  grade jsonb NOT NULL DEFAULT '{}'::jsonb,
  committed_previous_quantity numeric,
  committed_new_quantity numeric,
  committed_previous_grade jsonb,
  committed_new_grade jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hold_id, product_id)
);

CREATE INDEX standalone_nfe_stock_hold_items_product_idx
  ON public.standalone_nfe_stock_hold_items(product_id, hold_id);

ALTER TABLE public.standalone_nfe_stock_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.standalone_nfe_stock_hold_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.standalone_nfe_stock_holds
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.standalone_nfe_stock_hold_items
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.standalone_nfe_stock_holds TO service_role;
GRANT ALL ON TABLE public.standalone_nfe_stock_hold_items TO service_role;

COMMENT ON TABLE public.standalone_nfe_stock_holds IS
  'Ledger privado e idempotente do estoque segurado durante a emissão de NF-e avulsa.';
COMMENT ON COLUMN public.standalone_nfe_stock_holds.attempt_id IS
  'Chave de idempotência da tentativa. Replay recebe o mesmo hold; tentativa concorrente diferente é recusada.';
COMMENT ON COLUMN public.standalone_nfe_stock_holds.expires_at IS
  'Sinal diagnóstico. Expiração não libera automaticamente um hold que pode ter alcançado o provedor.';

-- Enquanto há reserva fiscal ativa, cabeçalho e itens ficam congelados. Sem
-- isso, o payload poderia divergir do estoque reservado entre o prepare e a
-- resposta da SEFAZ. A operação interna muda primeiro o status do hold e só
-- então atualiza o PV, portanto não precisa de bypass inseguro por role.
CREATE OR REPLACE FUNCTION public.tg_guard_standalone_nfe_active_hold_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_order_id uuid;
  v_new_sale_order_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'sale_orders' THEN
    v_sale_order_id := OLD.id;

    IF TG_OP = 'UPDATE'
       AND NEW.is_standalone_nfe IS DISTINCT FROM OLD.is_standalone_nfe THEN
      RAISE EXCEPTION 'Identidade standalone da NF-e avulsa é imutável (%)', OLD.id
        USING ERRCODE = '23514';
    END IF;

    -- `tg_sync_nfe_numero_to_sale_order` é alfabeticamente anterior ao trigger
    -- de settlement em nfe_emitidas: ao receber autorização ele grava somente
    -- nfe/updated_at enquanto o hold ainda está prepared. O trigger de versão
    -- (alfabeticamente anterior a este) também incrementa order_version. Essa
    -- escrita fiscal service-role é segura e precisa passar; qualquer outro
    -- campo continua congelado até commit/release/reverse mudar o hold.
    IF TG_OP = 'UPDATE'
       AND COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
       AND (to_jsonb(NEW) - 'nfe' - 'updated_at' - 'order_version')
           = (to_jsonb(OLD) - 'nfe' - 'updated_at' - 'order_version') THEN
      RETURN NEW;
    END IF;
  ELSE
    IF TG_OP = 'INSERT' THEN
      v_sale_order_id := NEW.sale_order_id;
    ELSE
      v_sale_order_id := OLD.sale_order_id;
    END IF;
    IF TG_OP = 'UPDATE' THEN
      v_new_sale_order_id := NEW.sale_order_id;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.standalone_nfe_stock_holds h
     WHERE h.sale_order_id IN (v_sale_order_id, v_new_sale_order_id)
       AND h.status IN ('prepared', 'reconciliation_required')
  ) THEN
    RAISE EXCEPTION
      'PV de NF-e avulsa está congelado por reserva fiscal ativa (%)',
      v_sale_order_id
      USING ERRCODE = '55006';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_standalone_nfe_hold_order
  ON public.sale_orders;
CREATE TRIGGER trg_guard_standalone_nfe_hold_order
  BEFORE UPDATE OR DELETE ON public.sale_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_guard_standalone_nfe_active_hold_mutation();

DROP TRIGGER IF EXISTS trg_guard_standalone_nfe_hold_items
  ON public.sale_order_items;
CREATE TRIGGER trg_guard_standalone_nfe_hold_items
  BEFORE INSERT OR UPDATE OR DELETE ON public.sale_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_guard_standalone_nfe_active_hold_mutation();

REVOKE ALL ON FUNCTION public.tg_guard_standalone_nfe_active_hold_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

-- Vínculo explícito evita sobrecarregar origin_type, cujo contrato existente é
-- restrito às três origens do motor de tiras. Um movimento por item/fase do
-- hold não interfere nos correlation_id históricos, que não eram únicos.
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS standalone_nfe_stock_hold_item_id uuid
  REFERENCES public.standalone_nfe_stock_hold_items(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.stock_movements.standalone_nfe_stock_hold_item_id IS
  'Item do hold fiscal que originou a baixa/estorno idempotente da NF-e avulsa.';

CREATE UNIQUE INDEX standalone_nfe_stock_movement_correlation_uq
  ON public.stock_movements(correlation_id)
  WHERE standalone_nfe_stock_hold_item_id IS NOT NULL
    AND correlation_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. Helpers privados de grade e autorização
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.standalone_nfe_grade_total(p_grade jsonb)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
DECLARE
  v_entry record;
  v_total numeric := 0;
BEGIN
  IF p_grade IS NULL OR p_grade = '{}'::jsonb THEN
    RETURN 0;
  END IF;
  IF jsonb_typeof(p_grade) <> 'object' THEN
    RETURN NULL;
  END IF;

  FOR v_entry IN
    SELECT e.key, e.value
      FROM jsonb_each(p_grade) e
     WHERE left(e.key, 1) <> '_'
  LOOP
    IF jsonb_typeof(v_entry.value) <> 'number' THEN
      RETURN NULL;
    END IF;
    IF (v_entry.value #>> '{}')::numeric < 0
       OR (v_entry.value #>> '{}')::numeric
          <> trunc((v_entry.value #>> '{}')::numeric) THEN
      RETURN NULL;
    END IF;
    v_total := v_total + (v_entry.value #>> '{}')::numeric;
  END LOOP;
  RETURN v_total;
END;
$$;

CREATE OR REPLACE FUNCTION public.standalone_nfe_apply_grade_delta(
  p_grade jsonb,
  p_delta jsonb,
  p_direction integer
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
DECLARE
  v_result jsonb := COALESCE(p_grade, '{}'::jsonb);
  v_entry record;
  v_current numeric;
  v_next numeric;
BEGIN
  IF jsonb_typeof(v_result) <> 'object'
     OR jsonb_typeof(COALESCE(p_delta, '{}'::jsonb)) <> 'object'
     OR p_direction NOT IN (-1, 1) THEN
    RAISE EXCEPTION 'Grade/direção inválida para movimento de NF-e avulsa'
      USING ERRCODE = '22023';
  END IF;

  FOR v_entry IN
    SELECT e.key, e.value
      FROM jsonb_each(COALESCE(p_delta, '{}'::jsonb)) e
     WHERE left(e.key, 1) <> '_'
  LOOP
    IF jsonb_typeof(v_entry.value) <> 'number' THEN
      RAISE EXCEPTION 'Quantidade não numérica na grade %', v_entry.key
        USING ERRCODE = '23514';
    END IF;
    v_current := COALESCE((v_result ->> v_entry.key)::numeric, 0);
    v_next := v_current + p_direction * (v_entry.value #>> '{}')::numeric;
    IF v_next < 0 THEN
      RAISE EXCEPTION 'Estoque por grade ficaria negativo na numeração %', v_entry.key
        USING ERRCODE = '23514';
    END IF;
    v_result := jsonb_set(v_result, ARRAY[v_entry.key], to_jsonb(v_next), true);
  END LOOP;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_execute_standalone_nfe_action(p_action text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_action text := lower(btrim(COALESCE(p_action, '')));
  v_has_granular boolean;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role' THEN
    RETURN true;
  END IF;
  IF v_user_id IS NULL
     OR NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'nfe_operator']) THEN
    RETURN false;
  END IF;
  IF v_action NOT IN ('preflight', 'prepare', 'cancel') THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.user_permissions up
     WHERE up.user_id = v_user_id
       AND up.can_view
  ) INTO v_has_granular;

  -- Sem allow-list granular, preserva o RBAC legado. Quando existe ao menos
  -- um grant de tela, /nfe passa a ser obrigatório e a mutação exige ação.
  IF NOT v_has_granular THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
      FROM public.user_permissions up
     WHERE up.user_id = v_user_id
       AND up.can_view
       AND (
         up.module = 'nfe'
         OR (
           up.module = '/nfe'
           AND CASE
             WHEN v_action = 'preflight' THEN true
             WHEN v_action = 'prepare' THEN up.can_create
             ELSE up.can_edit
           END
         )
       )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.standalone_nfe_grade_total(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.standalone_nfe_apply_grade_delta(jsonb, jsonb, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.can_execute_standalone_nfe_action(text)
  FROM PUBLIC, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Preflight público fail-closed
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.preflight_standalone_nfe_emission(
  p_sale_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_so record;
  v_client record;
  v_commercial record;
  v_item record;
  v_size record;
  v_blockers jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_item_count integer := 0;
  v_calculated_total numeric := 0;
  v_available_credit numeric := 0;
  v_policy_effective boolean := false;
  v_grade_total numeric;
  v_product_grade_total numeric;
  v_has_grade boolean;
  v_product_has_grade boolean;
  v_product_grade_valid boolean;
  v_size_available numeric;
  v_size_held numeric;
  v_client_loaded boolean := false;
  v_commercial_loaded boolean := false;
BEGIN
  IF NOT public.can_execute_standalone_nfe_action('preflight') THEN
    RAISE EXCEPTION
      'Permission denied: NF-e avulsa exige admin/gerente/nfe_operator e acesso a /nfe'
      USING ERRCODE = '42501';
  END IF;

  SELECT so.id, so.status, so.is_standalone_nfe, so.client_id,
         so.payment_condition, so.total, so.deleted_at, so.nfe_required,
         so.order_number
    INTO v_so
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id;

  IF NOT FOUND OR v_so.deleted_at IS NOT NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'standalone_sale_order_not_found',
      'scope', 'sale_order',
      'message', 'PV avulso não encontrado ou removido.'
    ));
    RETURN jsonb_build_object('ready', false, 'blockers', v_blockers, 'warnings', v_warnings);
  END IF;

  IF NOT COALESCE(v_so.is_standalone_nfe, false) THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'not_standalone_nfe',
      'scope', 'sale_order',
      'message', 'Este PV não é uma NF-e avulsa.'
    ));
  END IF;
  IF v_so.status <> 'Rascunho' THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'standalone_must_be_draft',
      'scope', 'sale_order',
      'message', 'NF-e avulsa só pode ser preparada a partir de Rascunho.',
      'details', jsonb_build_object('status', v_so.status)
    ));
  END IF;
  IF NOT COALESCE(v_so.nfe_required, true) THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'nfe_not_required',
      'scope', 'fiscal',
      'message', 'PV marcado como informal não pode emitir NF-e avulsa.'
    ));
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.nfe_emitidas n
     WHERE n.sale_order_id = p_sale_order_id
       AND n.status IN ('processando', 'autorizada', 'cancelando')
  ) THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'active_nfe_exists',
      'scope', 'fiscal',
      'message', 'Já existe NF-e ativa ou pendente de reconciliação para este PV.'
    ));
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.standalone_nfe_stock_holds h
     WHERE h.sale_order_id = p_sale_order_id
       AND h.status IN ('prepared', 'reconciliation_required')
  ) THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'standalone_stock_hold_active',
      'scope', 'stock',
      'message', 'Já existe uma reserva fiscal ativa para este PV.'
    ));
  END IF;

  IF v_so.client_id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'client_required',
      'scope', 'commercial',
      'message', 'Cliente é obrigatório.'
    ));
  ELSE
    SELECT c.id, c.active, c.economic_group_id
      INTO v_client
      FROM public.clients c
     WHERE c.id = v_so.client_id;
    v_client_loaded := FOUND;

    IF NOT v_client_loaded THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'client_not_found', 'scope', 'commercial',
        'message', 'Cliente não existe.'
      ));
    ELSIF NOT COALESCE(v_client.active, false) THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'client_inactive', 'scope', 'commercial',
        'message', 'Cliente inativo não pode receber NF-e avulsa.'
      ));
    ELSE
      SELECT * INTO v_commercial
        FROM public.get_client_commercial_defaults(v_so.client_id);
      v_commercial_loaded := FOUND;

      IF NOT v_commercial_loaded THEN
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code', 'commercial_policy_required', 'scope', 'commercial',
          'message', 'Não foi possível resolver a política comercial do cliente.'
        ));
      ELSIF v_commercial.price_list_id IS NULL THEN
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code', 'commercial_policy_required', 'scope', 'commercial',
          'message', 'Cliente/grupo não possui política comercial efetiva.'
        ));
      ELSE
        SELECT pl.active
               AND pl.valid_from <= CURRENT_DATE
               AND (pl.valid_to IS NULL OR pl.valid_to >= CURRENT_DATE)
          INTO v_policy_effective
          FROM public.price_lists pl
         WHERE pl.id = v_commercial.price_list_id;
        IF NOT COALESCE(v_policy_effective, false) THEN
          v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
            'code', 'commercial_policy_not_effective', 'scope', 'commercial',
            'message', 'A política/lista comercial está inativa ou fora da vigência.',
            'details', jsonb_build_object('price_list_id', v_commercial.price_list_id)
          ));
        END IF;
      END IF;

      IF COALESCE(v_commercial.block_new_orders, false) THEN
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code', 'commercial_orders_blocked', 'scope', 'commercial',
          'message', COALESCE(NULLIF(btrim(v_commercial.block_reason), ''),
            'Cliente/grupo está bloqueado comercialmente.')
        ));
      END IF;
      IF NULLIF(btrim(COALESCE(v_so.payment_condition, '')), '') IS NULL THEN
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code', 'payment_condition_required', 'scope', 'commercial',
          'message', 'Condição de pagamento é obrigatória.'
        ));
      END IF;
    END IF;
  END IF;

  FOR v_item IN
    SELECT i.id, i.product_id, i.reference_id, i.quantity, i.unit_price, i.grade,
           p.name AS product_name, p.sku, p.active AS product_active,
           p.ncm, p.unit, p.unit_price AS canonical_unit_price,
           p.quantity AS stock_quantity, COALESCE(p.reserved_stock, 0) AS reserved_stock,
           COALESCE(p.stock_grade, '{}'::jsonb) AS stock_grade
      FROM public.sale_order_items i
      LEFT JOIN public.products p ON p.id = i.product_id
     WHERE i.sale_order_id = p_sale_order_id
     ORDER BY i.id
  LOOP
    v_item_count := v_item_count + 1;

    IF v_item.product_id IS NULL OR v_item.reference_id IS NOT NULL THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'standalone_item_identity_invalid', 'scope', 'item',
        'item_id', v_item.id,
        'message', 'Item avulso deve ter product_id e reference_id nulo.'
      ));
      CONTINUE;
    END IF;
    IF v_item.product_name IS NULL THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'product_not_found', 'scope', 'item', 'item_id', v_item.id,
        'message', 'Produto do item não existe.'
      ));
      CONTINUE;
    END IF;
    IF NOT COALESCE(v_item.product_active, false) THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'product_inactive', 'scope', 'item', 'item_id', v_item.id,
        'product_id', v_item.product_id,
        'message', 'Produto inativo não pode ser faturado.'
      ));
    END IF;
    IF btrim(COALESCE(v_item.ncm, '')) !~ '^[0-9]{8}$' THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'product_ncm_invalid', 'scope', 'fiscal', 'item_id', v_item.id,
        'product_id', v_item.product_id,
        'message', 'Produto sem NCM válido de 8 dígitos.'
      ));
    END IF;
    IF COALESCE(v_item.unit, '') <> ALL (ARRAY[
      'm', 'cm', 'mm', 'm²', 'dm²', 'cm²',
      'un', 'par', 'placa', 'kg', 'g', 'L', 'ml'
    ]::text[]) THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'product_unit_invalid', 'scope', 'stock', 'item_id', v_item.id,
        'product_id', v_item.product_id,
        'message', 'Produto sem unidade canônica de estoque.',
        'details', jsonb_build_object('unit', v_item.unit)
      ));
    END IF;
    IF v_item.quantity::text IN ('NaN', 'Infinity', '-Infinity')
       OR COALESCE(v_item.quantity, 0) <= 0
       OR v_item.quantity <> trunc(v_item.quantity) THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'item_quantity_invalid', 'scope', 'item', 'item_id', v_item.id,
        'message', 'Quantidade do item deve ser inteira e positiva.'
      ));
    END IF;
    IF v_item.canonical_unit_price::text IN ('NaN', 'Infinity', '-Infinity')
       OR v_item.unit_price::text IN ('NaN', 'Infinity', '-Infinity')
       OR COALESCE(v_item.canonical_unit_price, 0) <= 0
       OR COALESCE(v_item.unit_price, 0) <= 0
       OR v_item.unit_price IS DISTINCT FROM v_item.canonical_unit_price THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'standalone_item_price_mismatch', 'scope', 'commercial',
        'item_id', v_item.id, 'product_id', v_item.product_id,
        'message', 'Preço do item diverge de products.unit_price.',
        'details', jsonb_build_object(
          'item_unit_price', v_item.unit_price,
          'canonical_unit_price', v_item.canonical_unit_price
        )
      ));
    END IF;

    v_calculated_total := v_calculated_total
      + round(COALESCE(v_item.quantity, 0) * COALESCE(v_item.unit_price, 0), 2);
    v_grade_total := public.standalone_nfe_grade_total(v_item.grade);
    v_has_grade := COALESCE(v_grade_total, 0) > 0;
    v_product_has_grade := false;
    v_product_grade_total := public.standalone_nfe_grade_total(v_item.stock_grade);
    v_product_grade_valid := v_product_grade_total IS NOT NULL;
    IF v_product_grade_valid THEN
      SELECT EXISTS (
        SELECT 1 FROM jsonb_each(v_item.stock_grade) g
         WHERE left(g.key, 1) <> '_'
      ) INTO v_product_has_grade;
    END IF;

    IF NOT v_product_grade_valid THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'product_stock_grade_invalid', 'scope', 'stock',
        'item_id', v_item.id, 'product_id', v_item.product_id,
        'message', 'Estoque por numeração do produto está malformado.'
      ));
    END IF;
    IF v_item.stock_quantity::text IN ('NaN', 'Infinity', '-Infinity')
       OR v_item.reserved_stock::text IN ('NaN', 'Infinity', '-Infinity')
       OR COALESCE(v_item.stock_quantity, 0) < 0
       OR v_item.reserved_stock < 0
       OR v_item.reserved_stock > COALESCE(v_item.stock_quantity, 0) THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'product_stock_invalid', 'scope', 'stock',
        'item_id', v_item.id, 'product_id', v_item.product_id,
        'message', 'Saldo total/reservado do produto está inconsistente.'
      ));
    END IF;
    IF v_product_grade_valid
       AND v_product_has_grade
       AND v_product_grade_total IS DISTINCT FROM v_item.stock_quantity THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'product_stock_total_grade_mismatch', 'scope', 'stock',
        'item_id', v_item.id, 'product_id', v_item.product_id,
        'message', 'Saldo total do produto diverge da soma do estoque por numeração.',
        'details', jsonb_build_object(
          'stock_quantity', v_item.stock_quantity,
          'grade_total', v_product_grade_total
        )
      ));
    END IF;

    IF v_grade_total IS NULL
       OR (v_has_grade AND v_grade_total <> v_item.quantity) THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'item_grade_invalid', 'scope', 'stock', 'item_id', v_item.id,
        'message', 'Grade deve conter inteiros positivos e somar a quantidade do item.'
      ));
    ELSIF v_product_has_grade AND NOT v_has_grade THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'item_grade_required', 'scope', 'stock', 'item_id', v_item.id,
        'message', 'Produto controlado por numeração exige grade detalhada.'
      ));
    ELSIF v_has_grade AND NOT v_product_has_grade THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'product_grade_not_configured', 'scope', 'stock', 'item_id', v_item.id,
        'message', 'Item informa grade, mas o produto não possui estoque por numeração.'
      ));
    END IF;

    IF COALESCE(v_item.stock_quantity, 0) - v_item.reserved_stock
       < COALESCE(v_item.quantity, 0) THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'insufficient_stock', 'scope', 'stock', 'item_id', v_item.id,
        'product_id', v_item.product_id,
        'message', 'Estoque líquido insuficiente para a NF-e avulsa.',
        'details', jsonb_build_object(
          'requested', v_item.quantity,
          'available', GREATEST(COALESCE(v_item.stock_quantity, 0) - v_item.reserved_stock, 0)
        )
      ));
    END IF;

    IF v_has_grade AND v_product_has_grade AND v_product_grade_valid THEN
      FOR v_size IN
        SELECT g.key AS size_key, (g.value #>> '{}')::numeric AS requested
          FROM jsonb_each(v_item.grade) g
         WHERE left(g.key, 1) <> '_'
           AND jsonb_typeof(g.value) = 'number'
      LOOP
        v_size_available := COALESCE((v_item.stock_grade ->> v_size.size_key)::numeric, 0);
        SELECT COALESCE(sum((hi.grade ->> v_size.size_key)::numeric), 0)
          INTO v_size_held
          FROM public.standalone_nfe_stock_hold_items hi
          JOIN public.standalone_nfe_stock_holds h ON h.id = hi.hold_id
         WHERE hi.product_id = v_item.product_id
           AND hi.grade ? v_size.size_key
           AND h.status IN ('prepared', 'reconciliation_required');
        IF v_size_available - v_size_held < v_size.requested THEN
          v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
            'code', 'insufficient_grade_stock', 'scope', 'stock',
            'item_id', v_item.id, 'product_id', v_item.product_id,
            'message', format('Estoque insuficiente na numeração %s.', v_size.size_key),
            'details', jsonb_build_object(
              'size', v_size.size_key,
              'requested', v_size.requested,
              'available', GREATEST(v_size_available - v_size_held, 0)
            )
          ));
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  -- Revalida de forma agregada: duas linhas do mesmo produto não podem passar
  -- isoladamente e, juntas, consumir mais que o saldo total ou a numeração.
  FOR v_item IN
    SELECT i.product_id,
           sum(i.quantity)::numeric AS requested,
           p.quantity AS stock_quantity,
           COALESCE(p.reserved_stock, 0) AS reserved_stock
      FROM public.sale_order_items i
      JOIN public.products p ON p.id = i.product_id
     WHERE i.sale_order_id = p_sale_order_id
       AND i.product_id IS NOT NULL
     GROUP BY i.product_id, p.quantity, p.reserved_stock
  LOOP
    IF v_item.stock_quantity - v_item.reserved_stock < v_item.requested THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'insufficient_aggregate_stock', 'scope', 'stock',
        'product_id', v_item.product_id,
        'message', 'Soma das linhas do produto excede o estoque líquido.',
        'details', jsonb_build_object(
          'requested', v_item.requested,
          'available', GREATEST(v_item.stock_quantity - v_item.reserved_stock, 0)
        )
      ));
    END IF;
  END LOOP;

  FOR v_size IN
    SELECT i.product_id, e.key AS size_key,
           sum((e.value #>> '{}')::numeric) AS requested,
           max(CASE
             WHEN jsonb_typeof(p.stock_grade -> e.key) = 'number'
               THEN (p.stock_grade ->> e.key)::numeric
             ELSE 0
           END) AS stock_quantity
      FROM public.sale_order_items i
      JOIN public.products p ON p.id = i.product_id
      CROSS JOIN LATERAL jsonb_each(
        CASE
          WHEN jsonb_typeof(COALESCE(i.grade, '{}'::jsonb)) = 'object'
            THEN COALESCE(i.grade, '{}'::jsonb)
          ELSE '{}'::jsonb
        END
      ) e
     WHERE i.sale_order_id = p_sale_order_id
       AND i.product_id IS NOT NULL
       AND left(e.key, 1) <> '_'
       AND jsonb_typeof(e.value) = 'number'
     GROUP BY i.product_id, e.key
  LOOP
    SELECT COALESCE(sum((hi.grade ->> v_size.size_key)::numeric), 0)
      INTO v_size_held
      FROM public.standalone_nfe_stock_hold_items hi
      JOIN public.standalone_nfe_stock_holds h ON h.id = hi.hold_id
     WHERE hi.product_id = v_size.product_id
       AND hi.grade ? v_size.size_key
       AND h.status IN ('prepared', 'reconciliation_required');
    IF v_size.stock_quantity - v_size_held < v_size.requested THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'insufficient_aggregate_grade_stock', 'scope', 'stock',
        'product_id', v_size.product_id,
        'message', format('Soma das linhas excede o estoque da numeração %s.', v_size.size_key),
        'details', jsonb_build_object(
          'size', v_size.size_key,
          'requested', v_size.requested,
          'available', GREATEST(v_size.stock_quantity - v_size_held, 0)
        )
      ));
    END IF;
  END LOOP;

  IF v_item_count = 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'items_required', 'scope', 'item',
      'message', 'NF-e avulsa precisa de ao menos um item.'
    ));
  END IF;
  IF v_so.total::text IN ('NaN', 'Infinity', '-Infinity')
     OR v_calculated_total::text IN ('NaN', 'Infinity', '-Infinity')
     OR abs(COALESCE(v_so.total, 0) - v_calculated_total) > 0.01 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'sale_order_total_mismatch', 'scope', 'commercial',
      'message', 'Total do PV diverge da soma canônica dos itens.',
      'details', jsonb_build_object(
        'stored_total', COALESCE(v_so.total, 0),
        'calculated_total', v_calculated_total
      )
    ));
  END IF;

  IF v_so.client_id IS NOT NULL
     AND v_client_loaded
     AND v_commercial_loaded
     AND COALESCE(v_commercial.credit_limit, 0) > 0 THEN
    IF v_client.economic_group_id IS NOT NULL THEN
      SELECT COALESCE(c.credit_available, 0)
        INTO v_available_credit
        FROM public.v_economic_group_credit c
       WHERE c.economic_group_id = v_client.economic_group_id;
    ELSE
      SELECT COALESCE(c.available_credit, 0)
        INTO v_available_credit
        FROM public.v_client_credit_exposure c
       WHERE c.client_id = v_so.client_id;
    END IF;
    IF v_calculated_total > COALESCE(v_available_credit, 0) THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'credit_limit_exceeded', 'scope', 'commercial',
        'message', 'Valor da NF-e avulsa excede o crédito disponível.',
        'details', jsonb_build_object(
          'sale_order_total', v_calculated_total,
          'available_credit', COALESCE(v_available_credit, 0)
        )
      ));
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ready', jsonb_array_length(v_blockers) = 0,
    'sale_order_id', p_sale_order_id,
    'order_number', v_so.order_number,
    'calculated_total', v_calculated_total,
    'item_count', v_item_count,
    'blockers', v_blockers,
    'warnings', v_warnings
  );
END;
$$;

REVOKE ALL ON FUNCTION public.preflight_standalone_nfe_emission(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.preflight_standalone_nfe_emission(uuid)
  TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. Prepare público: lock + reserva atômica e idempotente
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prepare_standalone_nfe_stock_hold(
  p_sale_order_id uuid,
  p_attempt_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_existing public.standalone_nfe_stock_holds%ROWTYPE;
  v_preflight jsonb;
  v_hold_id uuid;
  v_product record;
  v_grade jsonb;
BEGIN
  IF NOT public.can_execute_standalone_nfe_action('prepare') THEN
    RAISE EXCEPTION
      'Permission denied: preparar NF-e avulsa exige ação de criação em /nfe'
      USING ERRCODE = '42501';
  END IF;
  IF p_sale_order_id IS NULL OR p_attempt_id IS NULL THEN
    RAISE EXCEPTION 'sale_order_id e attempt_id são obrigatórios'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('standalone-nfe:' || p_sale_order_id::text, 0)
  );
  PERFORM 1 FROM public.sale_orders so
   WHERE so.id = p_sale_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV avulso % não encontrado', p_sale_order_id;
  END IF;

  -- Congela o conjunto e o conteúdo das linhas antes de derivar os locks de
  -- produto e o hold agregado. O lock do cabeçalho, sozinho, não bloqueia
  -- INSERT/UPDATE/DELETE nas linhas filhas.
  PERFORM i.id
    FROM public.sale_order_items i
   WHERE i.sale_order_id = p_sale_order_id
   ORDER BY i.id
   FOR UPDATE;

  SELECT * INTO v_existing
    FROM public.standalone_nfe_stock_holds h
   WHERE h.sale_order_id = p_sale_order_id
     AND h.attempt_id = p_attempt_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', v_existing.status = 'prepared',
      'idempotent_replay', true,
      'hold_id', v_existing.id,
      'status', v_existing.status,
      'code', CASE
        WHEN v_existing.status = 'prepared' THEN NULL
        ELSE 'attempt_not_preparable'
      END,
      'expires_at', v_existing.expires_at
    );
  END IF;

  -- Ordem UUID fixa: duas emissões que compartilham produtos nunca entram em
  -- deadlock por adquirir os mesmos locks em sequência diferente.
  PERFORM p.id
    FROM public.products p
    JOIN (
      SELECT DISTINCT i.product_id
        FROM public.sale_order_items i
       WHERE i.sale_order_id = p_sale_order_id
         AND i.product_id IS NOT NULL
    ) wanted ON wanted.product_id = p.id
   ORDER BY p.id
   FOR UPDATE OF p;

  -- Recalcula depois dos locks: o SELECT de preview é informativo; somente este
  -- segundo preflight decide a reserva contra o estoque atual.
  v_preflight := public.preflight_standalone_nfe_emission(p_sale_order_id);
  IF NOT COALESCE((v_preflight ->> 'ready')::boolean, false) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'idempotent_replay', false,
      'blockers', COALESCE(v_preflight -> 'blockers', '[]'::jsonb),
      'preflight', v_preflight
    );
  END IF;

  INSERT INTO public.standalone_nfe_stock_holds(
    sale_order_id, attempt_id, status, preflight_snapshot, prepared_by
  ) VALUES (
    p_sale_order_id, p_attempt_id, 'prepared', v_preflight, auth.uid()
  ) RETURNING id INTO v_hold_id;

  FOR v_product IN
    SELECT i.product_id,
           sum(i.quantity)::numeric AS quantity,
           array_agg(i.id ORDER BY i.id) AS item_ids
      FROM public.sale_order_items i
     WHERE i.sale_order_id = p_sale_order_id
       AND i.product_id IS NOT NULL
     GROUP BY i.product_id
     ORDER BY i.product_id
  LOOP
    SELECT COALESCE(jsonb_object_agg(g.size_key, to_jsonb(g.qty)), '{}'::jsonb)
      INTO v_grade
      FROM (
        SELECT e.key AS size_key,
               sum((e.value #>> '{}')::numeric) AS qty
          FROM public.sale_order_items i
          CROSS JOIN LATERAL jsonb_each(
            CASE
              WHEN jsonb_typeof(COALESCE(i.grade, '{}'::jsonb)) = 'object'
                THEN COALESCE(i.grade, '{}'::jsonb)
              ELSE '{}'::jsonb
            END
          ) e
         WHERE i.sale_order_id = p_sale_order_id
           AND i.product_id = v_product.product_id
           AND left(e.key, 1) <> '_'
           AND jsonb_typeof(e.value) = 'number'
         GROUP BY e.key
      ) g;

    INSERT INTO public.standalone_nfe_stock_hold_items(
      hold_id, product_id, source_item_ids, quantity, grade
    ) VALUES (
      v_hold_id, v_product.product_id, v_product.item_ids,
      v_product.quantity, COALESCE(v_grade, '{}'::jsonb)
    );

    UPDATE public.products p
       SET reserved_stock = COALESCE(p.reserved_stock, 0) + v_product.quantity,
           updated_at = now()
     WHERE p.id = v_product.product_id
       AND p.quantity - COALESCE(p.reserved_stock, 0) >= v_product.quantity;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Estoque mudou durante a reserva do produto %', v_product.product_id
        USING ERRCODE = '40001';
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent_replay', false,
    'hold_id', v_hold_id,
    'status', 'prepared',
    'expires_at', now() + interval '30 minutes',
    'preflight', v_preflight
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_standalone_nfe_stock_hold(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prepare_standalone_nfe_stock_hold(uuid, uuid)
  TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. Operações internas service_role-only
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bind_standalone_nfe_stock_hold(
  p_hold_id uuid,
  p_nfe_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_hold public.standalone_nfe_stock_holds%ROWTYPE;
  v_nfe record;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Função interna: service_role obrigatório'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_hold FROM public.standalone_nfe_stock_holds
   WHERE id = p_hold_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Hold % não encontrado', p_hold_id; END IF;
  SELECT id, sale_order_id, status
    INTO v_nfe FROM public.nfe_emitidas WHERE id = p_nfe_id;
  IF NOT FOUND OR v_nfe.sale_order_id IS DISTINCT FROM v_hold.sale_order_id THEN
    RAISE EXCEPTION 'NF-e não pertence ao PV do hold' USING ERRCODE = '23514';
  END IF;
  IF v_nfe.status <> 'processando' THEN
    RAISE EXCEPTION 'Vínculo do hold exige claim fiscal processando'
      USING ERRCODE = '23514';
  END IF;
  IF v_hold.status NOT IN ('prepared', 'reconciliation_required') THEN
    RAISE EXCEPTION 'Hold % não pode ser vinculado no status %', p_hold_id, v_hold.status
      USING ERRCODE = '23514';
  END IF;
  IF v_hold.nfe_id IS NOT NULL AND v_hold.nfe_id <> p_nfe_id THEN
    RAISE EXCEPTION 'Hold já vinculado a outra NF-e' USING ERRCODE = '23505';
  END IF;
  UPDATE public.standalone_nfe_stock_holds
     SET nfe_id = p_nfe_id, updated_at = now()
   WHERE id = p_hold_id;
  RETURN jsonb_build_object('ok', true, 'hold_id', p_hold_id, 'nfe_id', p_nfe_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_standalone_nfe_stock_hold_reconciliation(
  p_hold_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE v_status text;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Função interna: service_role obrigatório'
      USING ERRCODE = '42501';
  END IF;
  UPDATE public.standalone_nfe_stock_holds
     SET status = CASE WHEN status = 'prepared' THEN 'reconciliation_required' ELSE status END,
         reconciliation_reason = CASE
           WHEN status NOT IN ('released', 'reversed')
             THEN left(COALESCE(NULLIF(btrim(p_reason), ''), 'Reconciliação fiscal necessária'), 2000)
           ELSE reconciliation_reason
         END,
         updated_at = now()
   WHERE id = p_hold_id
   RETURNING status INTO v_status;
  RETURN jsonb_build_object('ok', FOUND, 'hold_id', p_hold_id, 'status', v_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_standalone_nfe_stock_hold(
  p_hold_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_hold public.standalone_nfe_stock_holds%ROWTYPE;
  v_item record;
  v_reserved numeric;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Função interna: service_role obrigatório'
      USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Motivo de liberação é obrigatório' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_hold FROM public.standalone_nfe_stock_holds
   WHERE id = p_hold_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'hold_not_found');
  END IF;
  IF v_hold.status = 'released' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent_replay', true,
      'hold_id', p_hold_id, 'status', v_hold.status);
  END IF;
  IF v_hold.status IN ('committed', 'reversed') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'hold_has_physical_fact',
      'hold_id', p_hold_id, 'status', v_hold.status);
  END IF;

  PERFORM p.id FROM public.products p
    JOIN public.standalone_nfe_stock_hold_items hi ON hi.product_id = p.id
   WHERE hi.hold_id = p_hold_id
   ORDER BY p.id FOR UPDATE OF p;

  FOR v_item IN
    SELECT hi.product_id, hi.quantity
      FROM public.standalone_nfe_stock_hold_items hi
     WHERE hi.hold_id = p_hold_id
     ORDER BY hi.product_id
  LOOP
    SELECT COALESCE(p.reserved_stock, 0) INTO v_reserved
      FROM public.products p WHERE p.id = v_item.product_id;
    IF v_reserved < v_item.quantity THEN
      UPDATE public.standalone_nfe_stock_holds
         SET status = 'reconciliation_required',
             reconciliation_reason = format(
               'reserved_stock %s menor que hold %s no produto %s durante release',
               v_reserved, v_item.quantity, v_item.product_id
             ),
             updated_at = now()
       WHERE id = p_hold_id;
      RETURN jsonb_build_object('ok', false, 'code', 'reserved_stock_drift',
        'hold_id', p_hold_id, 'product_id', v_item.product_id);
    END IF;
  END LOOP;

  UPDATE public.products p
     SET reserved_stock = COALESCE(p.reserved_stock, 0) - hi.quantity,
         updated_at = now()
    FROM public.standalone_nfe_stock_hold_items hi
   WHERE hi.hold_id = p_hold_id
     AND p.id = hi.product_id
     AND COALESCE(p.reserved_stock, 0) >= hi.quantity;

  UPDATE public.standalone_nfe_stock_holds
     SET status = 'released', released_at = now(),
         release_reason = left(btrim(p_reason), 2000),
         reconciliation_reason = NULL, updated_at = now()
   WHERE id = p_hold_id;
  RETURN jsonb_build_object('ok', true, 'idempotent_replay', false,
    'hold_id', p_hold_id, 'status', 'released');
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_standalone_nfe_stock_hold(
  p_hold_id uuid,
  p_nfe_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_hold public.standalone_nfe_stock_holds%ROWTYPE;
  v_nfe record;
  v_item record;
  v_size record;
  v_product record;
  v_new_grade jsonb;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Função interna: service_role obrigatório'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_hold FROM public.standalone_nfe_stock_holds
   WHERE id = p_hold_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Hold % não encontrado', p_hold_id; END IF;
  IF v_hold.status = 'committed' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent_replay', true,
      'hold_id', p_hold_id, 'status', v_hold.status);
  END IF;
  IF v_hold.status = 'reversed' THEN
    RAISE EXCEPTION 'Hold % já foi estornado e não pode ser baixado novamente', p_hold_id
      USING ERRCODE = '23514';
  END IF;
  IF v_hold.status NOT IN ('prepared', 'reconciliation_required') THEN
    RAISE EXCEPTION 'Hold % não está disponível para commit (status %)', p_hold_id, v_hold.status
      USING ERRCODE = '23514';
  END IF;

  SELECT n.id, n.sale_order_id, n.status, n.numero
    INTO v_nfe FROM public.nfe_emitidas n WHERE n.id = p_nfe_id;
  IF NOT FOUND OR v_nfe.sale_order_id IS DISTINCT FROM v_hold.sale_order_id
     OR v_nfe.status <> 'autorizada' THEN
    RAISE EXCEPTION 'Commit exige NF-e autorizada do mesmo PV'
      USING ERRCODE = '23514';
  END IF;
  IF v_hold.nfe_id IS NOT NULL AND v_hold.nfe_id <> p_nfe_id THEN
    RAISE EXCEPTION 'Hold vinculado a outra NF-e' USING ERRCODE = '23505';
  END IF;

  PERFORM p.id FROM public.products p
    JOIN public.standalone_nfe_stock_hold_items hi ON hi.product_id = p.id
   WHERE hi.hold_id = p_hold_id
   ORDER BY p.id FOR UPDATE OF p;

  -- Valida tudo antes da primeira escrita: nenhuma linha pode produzir saldo
  -- negativo, nem no total nem na grade.
  FOR v_item IN
    SELECT * FROM public.standalone_nfe_stock_hold_items hi
     WHERE hi.hold_id = p_hold_id ORDER BY hi.product_id
  LOOP
    SELECT p.quantity, COALESCE(p.reserved_stock, 0) AS reserved_stock,
           COALESCE(p.stock_grade, '{}'::jsonb) AS stock_grade
      INTO v_product FROM public.products p WHERE p.id = v_item.product_id;
    IF v_product.quantity < v_item.quantity
       OR v_product.reserved_stock < v_item.quantity THEN
      RAISE EXCEPTION
        'Estoque/reserva insuficiente no commit do produto % (qtd %, reservado %, hold %)',
        v_item.product_id, v_product.quantity, v_product.reserved_stock, v_item.quantity
        USING ERRCODE = '23514';
    END IF;
    FOR v_size IN
      SELECT e.key AS size_key, (e.value #>> '{}')::numeric AS quantity
        FROM jsonb_each(v_item.grade) e
       WHERE left(e.key, 1) <> '_'
    LOOP
      IF COALESCE((v_product.stock_grade ->> v_size.size_key)::numeric, 0)
         < v_size.quantity THEN
        RAISE EXCEPTION 'Grade % insuficiente no commit do produto %',
          v_size.size_key, v_item.product_id USING ERRCODE = '23514';
      END IF;
    END LOOP;
  END LOOP;

  FOR v_item IN
    SELECT * FROM public.standalone_nfe_stock_hold_items hi
     WHERE hi.hold_id = p_hold_id ORDER BY hi.product_id
  LOOP
    SELECT p.quantity, COALESCE(p.reserved_stock, 0) AS reserved_stock,
           COALESCE(p.stock_grade, '{}'::jsonb) AS stock_grade
      INTO v_product FROM public.products p WHERE p.id = v_item.product_id;
    v_new_grade := public.standalone_nfe_apply_grade_delta(
      v_product.stock_grade, v_item.grade, -1
    );

    UPDATE public.products
       SET quantity = v_product.quantity - v_item.quantity,
           reserved_stock = v_product.reserved_stock - v_item.quantity,
           stock_grade = CASE
             WHEN v_item.grade = '{}'::jsonb THEN stock_grade
             ELSE v_new_grade
           END,
           updated_at = now()
     WHERE id = v_item.product_id
       AND quantity >= v_item.quantity
       AND COALESCE(reserved_stock, 0) >= v_item.quantity;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Concorrência detectada no commit do produto %', v_item.product_id
        USING ERRCODE = '40001';
    END IF;

    UPDATE public.standalone_nfe_stock_hold_items
       SET committed_previous_quantity = v_product.quantity,
           committed_new_quantity = v_product.quantity - v_item.quantity,
           committed_previous_grade = v_product.stock_grade,
           committed_new_grade = v_new_grade
     WHERE id = v_item.id;

    INSERT INTO public.stock_movements(
      product_id, movement_type, quantity, previous_stock, new_stock,
      previous_grade, new_grade, description, movement_reason,
      origin_type, correlation_id, user_id, standalone_nfe_stock_hold_item_id
    ) VALUES (
      v_item.product_id, 'out', v_item.quantity,
      v_product.quantity, v_product.quantity - v_item.quantity,
      CASE WHEN v_item.grade = '{}'::jsonb THEN NULL ELSE v_product.stock_grade END,
      CASE WHEN v_item.grade = '{}'::jsonb THEN NULL ELSE v_new_grade END,
      format('Baixa NF-e avulsa autorizada — hold %s / NF %s', p_hold_id, p_nfe_id),
      'ajuste', NULL,
      md5(format('standalone-nfe:%s:%s:out', p_hold_id, v_item.product_id))::uuid,
      v_hold.prepared_by, v_item.id
    ) ON CONFLICT (correlation_id)
      WHERE standalone_nfe_stock_hold_item_id IS NOT NULL AND correlation_id IS NOT NULL
      DO NOTHING;
  END LOOP;

  UPDATE public.standalone_nfe_stock_holds
     SET nfe_id = p_nfe_id, status = 'committed', committed_at = now(),
         reconciliation_reason = NULL, updated_at = now()
   WHERE id = p_hold_id;

  UPDATE public.sale_orders
     SET status = 'Faturado', nfe = COALESCE(v_nfe.numero, nfe), updated_at = now()
   WHERE id = v_hold.sale_order_id
     AND is_standalone_nfe
     AND status <> 'Cancelado';

  RETURN jsonb_build_object('ok', true, 'idempotent_replay', false,
    'hold_id', p_hold_id, 'status', 'committed', 'nfe_id', p_nfe_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_standalone_nfe_stock_for_cancel(
  p_nfe_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_hold public.standalone_nfe_stock_holds%ROWTYPE;
  v_nfe record;
  v_item record;
  v_product record;
  v_new_grade jsonb;
  v_release jsonb;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Função interna: service_role obrigatório'
      USING ERRCODE = '42501';
  END IF;
  SELECT n.id, n.sale_order_id, n.status
    INTO v_nfe FROM public.nfe_emitidas n WHERE n.id = p_nfe_id;
  IF NOT FOUND OR v_nfe.status <> 'cancelada' THEN
    RAISE EXCEPTION 'Estorno exige NF-e cancelada' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_hold FROM public.standalone_nfe_stock_holds h
   WHERE h.nfe_id = p_nfe_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'hold_not_found', 'nfe_id', p_nfe_id);
  END IF;
  IF v_hold.status = 'reversed' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent_replay', true,
      'hold_id', v_hold.id, 'status', 'reversed');
  END IF;
  IF v_hold.status = 'released' THEN
    UPDATE public.sale_orders
       SET status = 'Rascunho', nfe = NULL, nfe_first_due_date = NULL,
           updated_at = now()
     WHERE id = v_hold.sale_order_id
       AND is_standalone_nfe;
    RETURN jsonb_build_object('ok', true, 'idempotent_replay', true,
      'hold_id', v_hold.id, 'status', 'released',
      'stock_action', 'already_released');
  END IF;
  IF v_hold.status IN ('prepared', 'reconciliation_required') THEN
    -- A autorização pode ter sido confirmada no provedor enquanto a baixa
    -- local falhou atomicamente. Se a NF depois foi cancelada e o hold nunca
    -- chegou a committed, não existe saída a estornar: libera-se somente a
    -- reserva, também de modo idempotente.
    v_release := public.release_standalone_nfe_stock_hold(
      v_hold.id, 'NF-e cancelada antes de o hold produzir baixa local'
    );
    IF NOT COALESCE((v_release ->> 'ok')::boolean, false) THEN
      RETURN v_release || jsonb_build_object('nfe_id', p_nfe_id);
    END IF;
    UPDATE public.sale_orders
       SET status = 'Rascunho', nfe = NULL, nfe_first_due_date = NULL,
           updated_at = now()
     WHERE id = v_hold.sale_order_id
       AND is_standalone_nfe;
    RETURN jsonb_build_object('ok', true, 'idempotent_replay', false,
      'hold_id', v_hold.id, 'status', 'released',
      'stock_action', 'reservation_released', 'nfe_id', p_nfe_id);
  END IF;
  IF v_hold.status <> 'committed' THEN
    RAISE EXCEPTION 'Hold da NF-e cancelada não está committed (status %)', v_hold.status
      USING ERRCODE = '23514';
  END IF;

  PERFORM p.id FROM public.products p
    JOIN public.standalone_nfe_stock_hold_items hi ON hi.product_id = p.id
   WHERE hi.hold_id = v_hold.id
   ORDER BY p.id FOR UPDATE OF p;

  FOR v_item IN
    SELECT * FROM public.standalone_nfe_stock_hold_items hi
     WHERE hi.hold_id = v_hold.id ORDER BY hi.product_id
  LOOP
    SELECT p.quantity, COALESCE(p.stock_grade, '{}'::jsonb) AS stock_grade
      INTO v_product FROM public.products p WHERE p.id = v_item.product_id;
    v_new_grade := public.standalone_nfe_apply_grade_delta(
      v_product.stock_grade, v_item.grade, 1
    );
    UPDATE public.products
       SET quantity = v_product.quantity + v_item.quantity,
           stock_grade = CASE
             WHEN v_item.grade = '{}'::jsonb THEN stock_grade
             ELSE v_new_grade
           END,
           updated_at = now()
     WHERE id = v_item.product_id;

    INSERT INTO public.stock_movements(
      product_id, movement_type, quantity, previous_stock, new_stock,
      previous_grade, new_grade, description, movement_reason,
      origin_type, correlation_id, user_id, standalone_nfe_stock_hold_item_id
    ) VALUES (
      v_item.product_id, 'in', v_item.quantity,
      v_product.quantity, v_product.quantity + v_item.quantity,
      CASE WHEN v_item.grade = '{}'::jsonb THEN NULL ELSE v_product.stock_grade END,
      CASE WHEN v_item.grade = '{}'::jsonb THEN NULL ELSE v_new_grade END,
      format('Estorno de NF-e avulsa cancelada — hold %s / NF %s', v_hold.id, p_nfe_id),
      'estorno', NULL,
      md5(format('standalone-nfe:%s:%s:reverse', v_hold.id, v_item.product_id))::uuid,
      v_hold.prepared_by, v_item.id
    ) ON CONFLICT (correlation_id)
      WHERE standalone_nfe_stock_hold_item_id IS NOT NULL AND correlation_id IS NOT NULL
      DO NOTHING;
  END LOOP;

  UPDATE public.standalone_nfe_stock_holds
     SET status = 'reversed', reversed_at = now(),
         reconciliation_reason = NULL, updated_at = now()
   WHERE id = v_hold.id;
  UPDATE public.sale_orders
     SET status = 'Rascunho', nfe = NULL, nfe_first_due_date = NULL,
         updated_at = now()
   WHERE id = v_hold.sale_order_id
     AND is_standalone_nfe;

  RETURN jsonb_build_object('ok', true, 'idempotent_replay', false,
    'hold_id', v_hold.id, 'status', 'reversed', 'nfe_id', p_nfe_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_stale_standalone_nfe_stock_holds(
  p_before timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_hold record;
  v_result jsonb;
  v_released integer := 0;
  v_failed integer := 0;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Função interna: service_role obrigatório'
      USING ERRCODE = '42501';
  END IF;
  FOR v_hold IN
    SELECT h.id
      FROM public.standalone_nfe_stock_holds h
      LEFT JOIN public.nfe_emitidas n ON n.id = h.nfe_id
     WHERE h.status = 'prepared'
       AND h.expires_at <= COALESCE(p_before, now())
       AND (
         h.nfe_id IS NULL
         OR n.status IN ('rejeitada', 'cancelada')
       )
     ORDER BY h.expires_at, h.id
     FOR UPDATE OF h SKIP LOCKED
  LOOP
    v_result := public.release_standalone_nfe_stock_hold(
      v_hold.id, 'Liberação automática de hold expirado sem fato fiscal ativo'
    );
    IF COALESCE((v_result ->> 'ok')::boolean, false) THEN
      v_released := v_released + 1;
    ELSE
      v_failed := v_failed + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', v_failed = 0, 'released', v_released, 'failed', v_failed);
END;
$$;

-- Somente as duas entradas públicas (preflight/prepare) são executáveis por
-- authenticated. Bind/mark/commit/release/reverse e varredura são service-only.
DO $$
DECLARE v_signature text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'bind_standalone_nfe_stock_hold(uuid,uuid)',
    'mark_standalone_nfe_stock_hold_reconciliation(uuid,text)',
    'release_standalone_nfe_stock_hold(uuid,text)',
    'commit_standalone_nfe_stock_hold(uuid,uuid)',
    'reverse_standalone_nfe_stock_for_cancel(uuid)',
    'release_stale_standalone_nfe_stock_holds(timestamptz)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', v_signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', v_signature);
  END LOOP;
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. Sincronização defensiva para autorizações assíncronas
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_settle_standalone_nfe_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_hold_id uuid;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.sale_orders so
     WHERE so.id = NEW.sale_order_id AND so.is_standalone_nfe
  ) THEN
    RETURN NEW;
  END IF;

  -- Browser não pode fabricar nenhuma transição fiscal e deixar o estoque
  -- fora do ledger. Edge Functions fiscais usam service_role.
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Status fiscal de NF-e avulsa exige service_role'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role' THEN
    SELECT h.id INTO v_hold_id
      FROM public.standalone_nfe_stock_holds h
     WHERE h.nfe_id = NEW.id
     LIMIT 1;
    IF v_hold_id IS NOT NULL THEN
      BEGIN
        IF NEW.status = 'autorizada' THEN
          PERFORM public.commit_standalone_nfe_stock_hold(v_hold_id, NEW.id);
        ELSIF NEW.status = 'rejeitada' THEN
          PERFORM public.release_standalone_nfe_stock_hold(
            v_hold_id, 'NF-e rejeitada antes da autorização'
          );
        ELSIF NEW.status = 'cancelada' THEN
          PERFORM public.reverse_standalone_nfe_stock_for_cancel(NEW.id);
        END IF;
      EXCEPTION WHEN OTHERS THEN
        PERFORM public.mark_standalone_nfe_stock_hold_reconciliation(
          v_hold_id,
          format('Falha no settlement automático do status %s: %s', NEW.status, SQLERRM)
        );
      END;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_settle_standalone_nfe_stock ON public.nfe_emitidas;
CREATE TRIGGER trg_settle_standalone_nfe_stock
  AFTER UPDATE OF status ON public.nfe_emitidas
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_settle_standalone_nfe_stock();

REVOKE ALL ON FUNCTION public.tg_settle_standalone_nfe_stock()
  FROM PUBLIC, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 7. Diagnóstico privado e contrato executável read-only
-- -----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.standalone_nfe_stock_hold_diagnostics
WITH (security_invoker = true)
AS
SELECT h.id AS hold_id,
       h.sale_order_id,
       so.order_number,
       h.nfe_id,
       n.status AS nfe_status,
       h.status AS hold_status,
       h.prepared_at,
       h.expires_at,
       now() - h.prepared_at AS hold_age,
       h.expires_at <= now() AS is_stale,
       (
         h.status = 'prepared'
         AND h.expires_at <= now()
         AND (h.nfe_id IS NULL OR n.status IN ('rejeitada', 'cancelada'))
       ) AS auto_release_safe,
       (
         h.reconciliation_reason IS NOT NULL
         OR h.status = 'reconciliation_required'
         OR (
           h.expires_at <= now()
           AND n.status IN ('processando', 'autorizada', 'cancelando', 'erro')
         )
       ) AS requires_manual_reconciliation,
       h.reconciliation_reason,
       count(hi.id)::bigint AS product_count,
       COALESCE(sum(hi.quantity), 0)::numeric AS held_quantity
  FROM public.standalone_nfe_stock_holds h
  JOIN public.sale_orders so ON so.id = h.sale_order_id
  LEFT JOIN public.nfe_emitidas n ON n.id = h.nfe_id
  LEFT JOIN public.standalone_nfe_stock_hold_items hi ON hi.hold_id = h.id
 GROUP BY h.id, h.sale_order_id, so.order_number, h.nfe_id, n.status,
          h.status, h.prepared_at, h.expires_at, h.reconciliation_reason;

REVOKE ALL ON public.standalone_nfe_stock_hold_diagnostics
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.standalone_nfe_stock_hold_diagnostics TO service_role;

CREATE OR REPLACE FUNCTION public.run_standalone_nfe_stock_contract_tests()
RETURNS TABLE(case_name text, passed boolean, details text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Função de diagnóstico exige service_role'
      USING ERRCODE = '42501';
  END IF;

  case_name := 'active_hold_unique';
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'standalone_nfe_stock_holds_one_active_order_uq'
       AND indexdef ILIKE '%UNIQUE%'
  ) INTO passed;
  details := 'Apenas um hold ativo por PV.';
  RETURN NEXT;

  case_name := 'public_surface';
  passed := has_function_privilege('authenticated',
      'public.preflight_standalone_nfe_emission(uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated',
      'public.prepare_standalone_nfe_stock_hold(uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated',
      'public.commit_standalone_nfe_stock_hold(uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated',
      'public.release_standalone_nfe_stock_hold(uuid,text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated',
      'public.reverse_standalone_nfe_stock_for_cancel(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated',
      'public.release_stale_standalone_nfe_stock_holds(timestamptz)', 'EXECUTE');
  details := 'Authenticated só recebe preflight/prepare; fatos físicos são service-only.';
  RETURN NEXT;

  case_name := 'movement_idempotency';
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'standalone_nfe_stock_movement_correlation_uq'
       AND indexdef ILIKE '%UNIQUE%'
  ) INTO passed;
  details := 'Baixa e estorno não podem duplicar correlation_id.';
  RETURN NEXT;

  case_name := 'private_ledger_rls';
  SELECT bool_and(c.relrowsecurity)
    INTO passed
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('standalone_nfe_stock_holds', 'standalone_nfe_stock_hold_items');
  details := 'Ledger exposto está com RLS e sem grants a authenticated.';
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.run_standalone_nfe_stock_contract_tests()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.run_standalone_nfe_stock_contract_tests()
  TO service_role;

COMMIT;
