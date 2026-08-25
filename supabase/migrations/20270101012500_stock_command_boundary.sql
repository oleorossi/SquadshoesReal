-- Fronteira transacional unica para estoque manual, cadastro com saldo,
-- configuracao de grade e pronta-entrega.
--
-- Invariantes:
--   * request_id + hash do comando/payload/snapshot tornam replay idempotente;
--   * locks de produto/SKU/pronta-entrega sao adquiridos em ordem canonica;
--   * quantity, current_stock e stock_grade mudam juntos sob CAS;
--   * saida manual nunca consome saldo reservado quando enforce_reserved=true;
--   * todo efeito fisico gera ledger na mesma transacao;
--   * o browser conserva DML de metadados, mas perde os campos fisicos.
--
-- Nenhum saldo historico e alterado por esta migration.

BEGIN;

-- Dependencia explicita da 122: sem identidade variante-aware, um delta de
-- pronta-entrega poderia colidir com outra variante da mesma referencia.
DO $ready_stock_dependency$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute attribute
     WHERE attribute.attrelid = 'public.ready_stock'::regclass
       AND attribute.attname = 'material_variant_id'
       AND NOT attribute.attisdropped
  ) OR to_regclass('public.ready_stock_ref_variant_color_size_uq') IS NULL THEN
    RAISE EXCEPTION
      'Migration 125 exige a identidade variante-aware ready_stock_ref_variant_color_size_uq da migration 122';
  END IF;
END;
$ready_stock_dependency$;

CREATE TABLE public.stock_command_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_request_id uuid NOT NULL UNIQUE,
  command_name text NOT NULL CHECK (command_name IN (
    'adjust_products', 'create_product',
    'configure_product_grades', 'ready_stock'
  )),
  request_hash text NOT NULL CHECK (length(request_hash) = 32),
  expected_snapshot jsonb NOT NULL,
  actor_id uuid NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stock_command_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.stock_command_receipts
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.stock_command_receipts TO service_role;

COMMENT ON TABLE public.stock_command_receipts IS
  'Recibo imutavel do comando canonico de estoque. Mesmo request_id, ator e hash retorna replay; payload divergente falha fechado.';

-- O writer legado move_stock_delta ja tenta persistir estes dois campos. Em
-- bases nas quais eles nunca foram criados, o endpoint quebrava depois do
-- UPDATE do produto (a transacao revertia, mas a operacao ficava indisponivel).
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS lot_number text,
  ADD COLUMN IF NOT EXISTS responsible text,
  ADD COLUMN IF NOT EXISTS stock_command_receipt_id uuid
    REFERENCES public.stock_command_receipts(id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  ADD COLUMN IF NOT EXISTS stock_command_item_index integer;

CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_stock_command_item_uq
  ON public.stock_movements(stock_command_receipt_id, stock_command_item_index)
  WHERE stock_command_receipt_id IS NOT NULL;

CREATE TABLE public.ready_stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ready_stock_id uuid REFERENCES public.ready_stock(id) ON DELETE SET NULL,
  reference_id uuid NOT NULL REFERENCES public.technical_sheets(id) ON DELETE RESTRICT,
  material_variant_id uuid
    REFERENCES public.reference_material_variants(id) ON DELETE RESTRICT,
  color text NOT NULL,
  size text NOT NULL,
  action text NOT NULL CHECK (action IN ('delta', 'set', 'delete')),
  delta integer NOT NULL,
  previous_quantity integer NOT NULL CHECK (previous_quantity >= 0),
  new_quantity integer NOT NULL CHECK (new_quantity >= 0),
  reason text NOT NULL,
  stock_command_receipt_id uuid NOT NULL
    REFERENCES public.stock_command_receipts(id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  stock_command_item_index integer NOT NULL,
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stock_command_receipt_id, stock_command_item_index)
);

ALTER TABLE public.ready_stock_movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ready_stock_movements
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ready_stock_movements TO service_role;

COMMENT ON TABLE public.ready_stock_movements IS
  'Ledger dedicado de pronta-entrega; preserva identidade comercial e before/after inclusive quando a linha e excluida.';

CREATE OR REPLACE FUNCTION public.stock_grade_validation_error_125(
  p_grade jsonb,
  p_unit text,
  p_quantity numeric
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_total numeric;
  v_bucket_count integer;
BEGIN
  IF p_grade IS NULL OR jsonb_typeof(p_grade) IS DISTINCT FROM 'object' THEN
    RETURN 'INVALID_GRADE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_each(p_grade) entry
     WHERE left(entry.key, 1) <> '_'
       AND jsonb_typeof(entry.value) IS DISTINCT FROM 'number'
  ) THEN
    RETURN 'INVALID_GRADE_BUCKET';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_each(p_grade) entry
     WHERE left(entry.key, 1) <> '_'
       AND ((entry.value #>> '{}')::numeric)::text IN ('NaN', 'Infinity', '-Infinity')
  ) THEN
    RETURN 'INVALID_GRADE_BUCKET';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_each(p_grade) entry
     WHERE left(entry.key, 1) <> '_'
       AND (entry.value #>> '{}')::numeric < 0
  ) THEN
    RETURN 'NEGATIVE_GRADE_BUCKET';
  END IF;

  IF public.is_discrete_stock_unit(p_unit) AND EXISTS (
    SELECT 1 FROM jsonb_each(p_grade) entry
     WHERE left(entry.key, 1) <> '_'
       AND (entry.value #>> '{}')::numeric
           <> trunc((entry.value #>> '{}')::numeric)
  ) THEN
    RETURN 'FRACTIONAL_GRADE_BUCKET';
  END IF;

  SELECT count(*), COALESCE(sum((entry.value #>> '{}')::numeric), 0)
    INTO v_bucket_count, v_total
    FROM jsonb_each(p_grade) entry
   WHERE left(entry.key, 1) <> '_';

  -- {} e objetos apenas com metadados _* representam produto nao rastreado
  -- por numeracao. A trigger canonica 060 usa a mesma semantica.
  IF v_bucket_count = 0 THEN
    RETURN NULL;
  END IF;
  IF abs(v_total - COALESCE(p_quantity, 0)) > 0.0001 THEN
    RETURN 'GRADE_TOTAL_MISMATCH';
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN 'INVALID_GRADE_BUCKET';
END;
$function$;

REVOKE ALL ON FUNCTION public.stock_grade_validation_error_125(jsonb, text, numeric)
  FROM PUBLIC, anon, authenticated, service_role;

-- Aplica, dentro da mesma transacao do saldo/grade inicial, todas as colunas
-- de cadastro que o formulario conhece. A lista e derivada do catalogo, mas
-- remove explicitamente identidade, timestamps e campos fisicos. Chaves JSON
-- desconhecidas sao ignoradas por jsonb_populate_record; tipos/FKs/CHECKs
-- continuam sendo validados pelo PostgreSQL.
CREATE OR REPLACE FUNCTION public.apply_product_metadata_125(
  p_product_id uuid,
  p_metadata jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_current public.products%ROWTYPE;
  v_merged public.products%ROWTYPE;
  v_safe jsonb;
  v_columns text;
  v_values text;
BEGIN
  SELECT * INTO STRICT v_current
    FROM public.products
   WHERE id = p_product_id
   FOR UPDATE;

  v_safe := COALESCE(p_metadata, '{}'::jsonb) - ARRAY[
    'id','created_at','updated_at',
    'quantity','current_stock','reserved_stock','stock_grade',
    'blocked_qty','quarantine_qty'
  ]::text[];
  v_merged := jsonb_populate_record(v_current, v_safe);

  SELECT
    string_agg(quote_ident(attribute.attname), ', ' ORDER BY attribute.attnum),
    string_agg(
      format('populated.%I', attribute.attname), ', ' ORDER BY attribute.attnum
    )
    INTO v_columns, v_values
    FROM pg_attribute attribute
   WHERE attribute.attrelid = 'public.products'::regclass
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
     AND attribute.attgenerated = ''
     AND attribute.attname NOT IN (
       'id','created_at','updated_at',
       'quantity','current_stock','reserved_stock','stock_grade',
       'blocked_qty','quarantine_qty'
     );
  IF v_columns IS NULL OR v_values IS NULL THEN
    RAISE EXCEPTION 'Nao foi possivel montar a allow-list de metadata de products';
  END IF;

  EXECUTE format(
    'UPDATE public.products target SET (%s) = '
    || '(SELECT %s FROM jsonb_populate_record(NULL::public.products, $2) populated) '
    || 'WHERE target.id = $1',
    v_columns, v_values
  ) USING p_product_id, to_jsonb(v_merged);
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_product_metadata_125(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.execute_stock_command(
  p_command text,
  p_payload jsonb,
  p_request_id uuid,
  p_expected_snapshot jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_command text := lower(btrim(COALESCE(p_command, '')));
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_snapshot jsonb := COALESCE(p_expected_snapshot, '{}'::jsonb);
  v_request_hash text;
  v_receipt public.stock_command_receipts%ROWTYPE;
  v_receipt_id uuid := gen_random_uuid();
  -- service_role nao tem auth.uid(). A sentinela identifica esse principal de
  -- forma estavel no receipt sem fingir que ele e um usuario de auth.users.
  v_actor_id uuid := COALESCE(
    auth.uid(), '00000000-0000-0000-0000-000000000125'::uuid
  );
  v_auth_user_id uuid := auth.uid();
  v_errors jsonb := '[]'::jsonb;
  v_results jsonb := '[]'::jsonb;
  v_response jsonb;
  v_items jsonb;
  v_item jsonb;
  v_snap jsonb;
  v_index integer;
  v_applied integer := 0;
  v_seen text[] := ARRAY[]::text[];
  v_product_id uuid;
  v_product public.products%ROWTYPE;
  v_expected numeric;
  v_new_qty numeric;
  v_delta numeric;
  v_expected_grade jsonb;
  v_new_grade jsonb;
  v_grade_error text;
  v_has_new_grade boolean;
  v_has_expected_grade boolean;
  v_grade_bucket_count integer;
  v_enforce_reserved boolean;
  v_order_id uuid;
  v_created_product_id uuid;
  v_sku text;
  v_name text;
  v_category text;
  v_unit text;
  v_location text;
  v_purchase_unit text;
  v_conversion_rate numeric;
  v_unit_price numeric;
  v_min_stock numeric;
  v_max_stock numeric;
  v_group_id uuid;
  v_supplier_id uuid;
  v_color text;
  v_action text;
  v_ready_id uuid;
  v_reference_id uuid;
  v_material_variant_id uuid;
  v_ready public.ready_stock%ROWTYPE;
  v_ready_expected integer;
  v_ready_new integer;
  v_ready_delta integer;
  v_ready_key text;
  v_ready_reason text;
  v_lock_key text;
BEGIN
  IF v_command NOT IN (
    'adjust_products', 'create_product',
    'configure_product_grades', 'ready_stock'
  ) THEN
    RAISE EXCEPTION 'Comando de estoque nao suportado: %', p_command
      USING ERRCODE = '22023';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id e obrigatorio' USING ERRCODE = '22004';
  END IF;
  IF jsonb_typeof(v_payload) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_snapshot) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'payload e expected_snapshot devem ser objetos JSON'
      USING ERRCODE = '22023';
  END IF;
  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin','gerente','almoxarifado']) THEN
    RAISE EXCEPTION
      'Permission denied: comando de estoque exige Almoxarifado/Gerencia'
      USING ERRCODE = '42501';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'command', v_command,
    'payload', v_payload,
    'expected_snapshot', v_snapshot
  )::text);

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'stock-command-request:' || p_request_id::text, 0
  ));
  SELECT * INTO v_receipt
    FROM public.stock_command_receipts receipt
   WHERE receipt.client_request_id = p_request_id;
  IF FOUND THEN
    IF v_receipt.command_name IS DISTINCT FROM v_command
       OR v_receipt.request_hash IS DISTINCT FROM v_request_hash
       OR v_receipt.actor_id IS DISTINCT FROM v_actor_id THEN
      RAISE EXCEPTION 'request_id ja usado com outro comando, payload ou ator'
        USING ERRCODE = '22023';
    END IF;
    RETURN v_receipt.response || jsonb_build_object('replayed', true);
  END IF;

  IF v_command IN ('adjust_products', 'configure_product_grades') THEN
    v_items := v_payload -> 'items';
    IF jsonb_typeof(v_items) IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_items) = 0
       OR jsonb_array_length(v_items) > 500
       OR jsonb_typeof(v_snapshot -> 'products') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'items/products deve ser array nao-vazio com no maximo 500 linhas'
        USING ERRCODE = '22023';
    END IF;

    -- Advisory locks primeiro; depois row locks. Ambos em UUID ordenado.
    FOR v_lock_key IN
      SELECT DISTINCT value ->> 'product_id'
        FROM jsonb_array_elements(v_items)
       ORDER BY 1
    LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended(
        'stock-product:' || COALESCE(v_lock_key, ''), 0
      ));
    END LOOP;
    FOR v_product_id IN
      SELECT product.id
        FROM public.products product
       WHERE product.id = ANY (
         SELECT (value ->> 'product_id')::uuid
           FROM jsonb_array_elements(v_items)
       )
       ORDER BY product.id
       FOR UPDATE
    LOOP
      NULL;
    END LOOP;

    -- Fase 1: valida o lote inteiro. Nenhum efeito fisico ocorre com erro.
    v_index := 0;
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(v_items)
       ORDER BY value ->> 'product_id'
    LOOP
      v_index := v_index + 1;
      v_product_id := NULL;
      v_expected := NULL;
      v_new_qty := NULL;
      v_order_id := NULL;
      BEGIN
        IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
          RAISE EXCEPTION 'invalid item' USING ERRCODE = '22023';
        END IF;
        v_product_id := NULLIF(v_item ->> 'product_id', '')::uuid;
        v_expected := NULLIF(v_item ->> 'expected_previous_qty', '')::numeric;
        v_new_qty := CASE WHEN v_command = 'adjust_products'
          THEN NULLIF(v_item ->> 'new_qty', '')::numeric
          ELSE v_expected
        END;
        v_order_id := NULLIF(v_item ->> 'order_id', '')::uuid;
      EXCEPTION WHEN OTHERS THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'product_id', v_product_id, 'error', 'INVALID_ITEM',
          'current_db_qty', NULL));
        CONTINUE;
      END;
      IF v_product_id IS NULL OR v_expected IS NULL OR v_new_qty IS NULL
         OR v_expected::text IN ('NaN','Infinity','-Infinity')
         OR v_new_qty::text IN ('NaN','Infinity','-Infinity') THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'product_id', v_product_id, 'error', 'INVALID_ITEM',
          'current_db_qty', NULL));
        CONTINUE;
      END IF;
      IF v_product_id::text = ANY(v_seen) THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'product_id', v_product_id, 'error', 'DUPLICATE_PRODUCT',
          'current_db_qty', NULL));
        CONTINUE;
      END IF;
      v_seen := v_seen || v_product_id::text;

      SELECT * INTO v_product FROM public.products WHERE id = v_product_id;
      IF NOT FOUND THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'product_id', v_product_id, 'error', 'NOT_FOUND',
          'current_db_qty', NULL));
        CONTINUE;
      END IF;

      SELECT snap.value INTO v_snap
        FROM jsonb_array_elements(v_snapshot -> 'products') snap(value)
       WHERE snap.value ->> 'product_id' = v_product_id::text;
      IF NOT FOUND
         OR round(NULLIF(v_snap ->> 'quantity', '')::numeric, 4)
            IS DISTINCT FROM round(v_expected, 4) THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'product_id', v_product_id, 'error', 'INVALID_EXPECTED_SNAPSHOT',
          'current_db_qty', v_product.quantity));
        CONTINUE;
      END IF;

      v_has_expected_grade := v_item ? 'expected_grade';
      v_expected_grade := CASE WHEN v_has_expected_grade
        THEN v_item -> 'expected_grade' ELSE NULL END;
      IF (v_snap ? 'stock_grade') IS DISTINCT FROM v_has_expected_grade
         OR (v_has_expected_grade
             AND (v_snap -> 'stock_grade') IS DISTINCT FROM v_expected_grade) THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'product_id', v_product_id, 'error', 'INVALID_EXPECTED_SNAPSHOT',
          'current_db_qty', v_product.quantity));
        CONTINUE;
      END IF;
      IF round(v_product.quantity, 4) IS DISTINCT FROM round(v_expected, 4)
         OR (v_has_expected_grade
             AND v_product.stock_grade IS DISTINCT FROM v_expected_grade) THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'product_id', v_product_id, 'error', 'CONCURRENCY_ERROR',
          'current_db_qty', v_product.quantity));
        CONTINUE;
      END IF;

      v_has_new_grade := v_item ? 'new_grade'
        AND v_item -> 'new_grade' <> 'null'::jsonb;
      v_new_grade := CASE WHEN v_has_new_grade THEN v_item -> 'new_grade'
        ELSE NULL END;
      IF v_command = 'configure_product_grades' AND NOT v_has_new_grade THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'product_id', v_product_id, 'error', 'GRADE_REQUIRED',
          'current_db_qty', v_product.quantity));
        CONTINUE;
      END IF;
      IF v_has_new_grade AND NOT v_has_expected_grade THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'product_id', v_product_id, 'error', 'EXPECTED_GRADE_REQUIRED',
          'current_db_qty', v_product.quantity));
        CONTINUE;
      END IF;

      SELECT count(*) INTO v_grade_bucket_count
        FROM jsonb_each(COALESCE(v_product.stock_grade, '{}'::jsonb)) grade
       WHERE left(grade.key, 1) <> '_';
      IF v_grade_bucket_count > 0 AND NOT v_has_new_grade
         AND round(v_new_qty, 4) IS DISTINCT FROM round(v_product.quantity, 4) THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'product_id', v_product_id,
          'error', 'GRADE_REQUIRED_FOR_GRADED_PRODUCT',
          'current_db_qty', v_product.quantity));
        CONTINUE;
      END IF;

      IF v_new_qty < 0 THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'product_id', v_product_id, 'error', 'NEGATIVE_QTY_NOT_ALLOWED',
          'current_db_qty', v_product.quantity));
        CONTINUE;
      END IF;
      IF public.is_discrete_stock_unit(v_product.unit)
         AND v_new_qty <> trunc(v_new_qty) THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'product_id', v_product_id, 'error', 'FRACTIONAL_DISCRETE_UNIT',
          'current_db_qty', v_product.quantity));
        CONTINUE;
      END IF;

      IF v_has_new_grade THEN
        v_grade_error := public.stock_grade_validation_error_125(
          v_new_grade, v_product.unit, v_new_qty
        );
        IF v_grade_error IS NOT NULL THEN
          v_errors := v_errors || jsonb_build_array(jsonb_build_object(
            'product_id', v_product_id, 'error', v_grade_error,
            'current_db_qty', v_product.quantity));
          CONTINUE;
        END IF;
      END IF;

      v_enforce_reserved := COALESCE((v_item ->> 'enforce_reserved')::boolean, false);
      -- order_id e apenas rastreabilidade. Ele nao prova que a reserva pertence
      -- a este comando nem a consome; portanto nunca abre um bypass de saldo.
      IF v_enforce_reserved
         AND v_new_qty < COALESCE(v_product.reserved_stock, 0) THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'product_id', v_product_id, 'error', 'RESERVADO_PARA_OP',
          'current_db_qty', v_product.quantity,
          'reserved_qty', COALESCE(v_product.reserved_stock, 0)));
        CONTINUE;
      END IF;
    END LOOP;

    IF jsonb_array_length(v_errors) = 0 THEN
      -- Fase 2: todas as linhas continuam travadas; aplica e registra ledger.
      v_index := 0;
      FOR v_item IN
        SELECT value FROM jsonb_array_elements(v_items)
         ORDER BY value ->> 'product_id'
      LOOP
        v_index := v_index + 1;
        v_product_id := (v_item ->> 'product_id')::uuid;
        SELECT * INTO v_product FROM public.products WHERE id = v_product_id;
        v_new_qty := CASE WHEN v_command = 'adjust_products'
          THEN (v_item ->> 'new_qty')::numeric ELSE v_product.quantity END;
        v_has_new_grade := v_item ? 'new_grade'
          AND v_item -> 'new_grade' <> 'null'::jsonb;
        v_new_grade := CASE WHEN v_has_new_grade THEN v_item -> 'new_grade'
          ELSE NULL END;
        v_delta := v_new_qty - v_product.quantity;

        UPDATE public.products
           SET quantity = v_new_qty,
               current_stock = v_new_qty,
               stock_grade = CASE WHEN v_has_new_grade
                 THEN v_new_grade ELSE stock_grade END,
               lot_number = COALESCE(NULLIF(v_item ->> 'lot_number', ''), lot_number),
               updated_at = now()
         WHERE id = v_product_id;

        INSERT INTO public.stock_movements (
          product_id, order_id, movement_type, quantity,
          previous_stock, new_stock, previous_grade, new_grade,
          description, lot_number, responsible, created_at,
          user_id, user_email, movement_reason, correlation_id,
          stock_command_receipt_id, stock_command_item_index
        ) VALUES (
          v_product_id, NULLIF(v_item ->> 'order_id', '')::uuid,
          CASE WHEN v_delta >= 0 THEN 'in' ELSE 'out' END, abs(v_delta),
          v_product.quantity, v_new_qty,
          CASE WHEN v_has_new_grade THEN v_product.stock_grade ELSE NULL END,
          CASE WHEN v_has_new_grade THEN v_new_grade ELSE NULL END,
          COALESCE(NULLIF(btrim(v_item ->> 'reason'), ''),
            CASE WHEN v_command = 'configure_product_grades'
              THEN 'Configuracao manual de grade' ELSE 'Ajuste manual' END),
          NULLIF(v_item ->> 'lot_number', ''),
          NULLIF(v_item ->> 'responsible', ''),
          COALESCE(NULLIF(v_item ->> 'occurred_at', '')::timestamptz, now()),
          v_auth_user_id, COALESCE(auth.jwt() ->> 'email', ''),
          'ajuste', v_receipt_id,
          v_receipt_id, v_index
        );
        v_applied := v_applied + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'product_id', v_product_id,
          'previous_quantity', v_product.quantity,
          'new_quantity', v_new_qty
        ));
      END LOOP;
    END IF;

  ELSIF v_command = 'create_product' THEN
    v_items := CASE
      WHEN jsonb_typeof(v_payload -> 'product') = 'object'
        THEN jsonb_build_array(v_payload -> 'product')
      ELSE v_payload -> 'products'
    END;
    IF jsonb_typeof(v_items) IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_items) = 0
       OR jsonb_array_length(v_items) > 500 THEN
      RAISE EXCEPTION 'product/products deve conter de 1 a 500 produtos'
        USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(v_items) = 1 THEN
      IF v_snapshot ->> 'product_absent_sku' IS NULL
         AND jsonb_typeof(v_snapshot -> 'product_absent_skus') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'snapshot product_absent_sku e obrigatorio'
          USING ERRCODE = '22023';
      END IF;
    ELSIF jsonb_typeof(v_snapshot -> 'product_absent_skus') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_snapshot -> 'product_absent_skus')
          <> jsonb_array_length(v_items) THEN
      RAISE EXCEPTION 'snapshot product_absent_skus deve cobrir o lote inteiro'
        USING ERRCODE = '22023';
    END IF;

    -- Todos os SKUs sao serializados antes de consultar a ausencia. Assim dois
    -- cadastros concorrentes nao conseguem validar o mesmo SKU simultaneamente.
    FOR v_lock_key IN
      SELECT DISTINCT lower(btrim(value ->> 'sku'))
        FROM jsonb_array_elements(v_items)
       ORDER BY 1
    LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended(
        'stock-product-sku:' || COALESCE(v_lock_key, ''), 0
      ));
    END LOOP;

    v_seen := ARRAY[]::text[];
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(v_items)
       ORDER BY lower(btrim(value ->> 'sku'))
    LOOP
      BEGIN
        IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
          RAISE EXCEPTION 'invalid product' USING ERRCODE = '22023';
        END IF;
        -- Conversao read-only do payload completo: captura tipo invalido em
        -- qualquer coluna metadata antes da fase de escrita.
        PERFORM jsonb_populate_record(
          NULL::public.products,
          v_item - ARRAY[
            'reason','quantity','current_stock','reserved_stock','stock_grade',
            'blocked_qty','quarantine_qty'
          ]::text[]
        );
        v_name := btrim(COALESCE(v_item ->> 'name', ''));
        v_sku := btrim(COALESCE(v_item ->> 'sku', ''));
        v_category := btrim(COALESCE(v_item ->> 'category', ''));
        v_unit := btrim(COALESCE(v_item ->> 'unit', ''));
        v_location := COALESCE(v_item ->> 'location', '');
        v_new_qty := COALESCE(NULLIF(v_item ->> 'quantity', '')::numeric, 0);
        v_unit_price := COALESCE(NULLIF(v_item ->> 'unit_price', '')::numeric, 0);
        v_min_stock := COALESCE(NULLIF(v_item ->> 'min_stock', '')::numeric, 0);
        v_max_stock := COALESCE(NULLIF(v_item ->> 'max_stock', '')::numeric, 0);
        v_group_id := NULLIF(v_item ->> 'group_id', '')::uuid;
        v_supplier_id := NULLIF(v_item ->> 'supplier_id', '')::uuid;
        v_color := NULLIF(btrim(COALESCE(v_item ->> 'color', '')), '');
        v_purchase_unit := COALESCE(
          NULLIF(btrim(v_item ->> 'purchase_unit'), ''), v_unit
        );
        v_conversion_rate := COALESCE(
          NULLIF(v_item ->> 'conversion_rate', '')::numeric, 1
        );
        v_new_grade := CASE WHEN (v_item ? 'stock_grade')
          AND v_item -> 'stock_grade' <> 'null'::jsonb
          THEN v_item -> 'stock_grade' ELSE '{}'::jsonb END;
      EXCEPTION WHEN OTHERS THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'product_id', NULL, 'sku', v_item ->> 'sku',
          'error', 'INVALID_ITEM', 'current_db_qty', NULL));
        CONTINUE;
      END;

      IF lower(v_sku) = ANY(v_seen) THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'product_id', NULL, 'sku', v_sku,
          'error', 'DUPLICATE_SKU', 'current_db_qty', NULL));
        CONTINUE;
      END IF;
      v_seen := v_seen || lower(v_sku);

      IF NOT (
        (jsonb_array_length(v_items) = 1
          AND lower(btrim(v_snapshot ->> 'product_absent_sku')) = lower(v_sku))
        OR (
          jsonb_typeof(v_snapshot -> 'product_absent_skus') IS NOT DISTINCT FROM 'array'
          AND EXISTS (
           SELECT 1
             FROM jsonb_array_elements_text(v_snapshot -> 'product_absent_skus') sku(value)
            WHERE lower(btrim(sku.value)) = lower(v_sku)
          )
        )
      ) THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'product_id', NULL, 'sku', v_sku,
          'error', 'INVALID_EXPECTED_SNAPSHOT', 'current_db_qty', NULL));
        CONTINUE;
      END IF;
      IF v_name = '' OR v_sku = '' OR v_category = '' OR v_unit = ''
         OR v_new_qty::text IN ('NaN','Infinity','-Infinity')
         OR v_unit_price::text IN ('NaN','Infinity','-Infinity')
         OR v_min_stock::text IN ('NaN','Infinity','-Infinity')
         OR v_max_stock::text IN ('NaN','Infinity','-Infinity')
         OR v_conversion_rate::text IN ('NaN','Infinity','-Infinity')
         OR v_new_qty < 0 OR v_unit_price < 0 OR v_min_stock < 0
         OR v_max_stock < 0 OR v_conversion_rate <= 0 THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'product_id', NULL, 'sku', v_sku,
          'error', 'INVALID_ITEM', 'current_db_qty', NULL));
        CONTINUE;
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.products product
         WHERE lower(btrim(product.sku)) = lower(v_sku)
      ) THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'product_id', NULL, 'sku', v_sku,
          'error', 'SKU_ALREADY_EXISTS', 'current_db_qty', NULL));
        CONTINUE;
      END IF;
      IF public.is_discrete_stock_unit(v_unit)
         AND v_new_qty <> trunc(v_new_qty) THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'product_id', NULL, 'sku', v_sku,
          'error', 'FRACTIONAL_DISCRETE_UNIT', 'current_db_qty', NULL));
        CONTINUE;
      END IF;
      IF v_purchase_unit = v_unit AND v_conversion_rate <> 1 THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'product_id', NULL, 'sku', v_sku,
          'error', 'INVALID_CONVERSION_RATE', 'current_db_qty', NULL));
        CONTINUE;
      END IF;
      v_grade_error := public.stock_grade_validation_error_125(
        v_new_grade, v_unit, v_new_qty
      );
      IF v_grade_error IS NOT NULL THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'product_id', NULL, 'sku', v_sku,
          'error', v_grade_error, 'current_db_qty', NULL));
      END IF;
    END LOOP;

    IF jsonb_array_length(v_errors) = 0 THEN
      v_index := 0;
      FOR v_item IN
        SELECT item.value
          FROM jsonb_array_elements(v_items) WITH ORDINALITY item(value, ordinal)
         ORDER BY item.ordinal
      LOOP
        v_index := v_index + 1;
        v_name := btrim(v_item ->> 'name');
        v_sku := btrim(v_item ->> 'sku');
        v_category := btrim(v_item ->> 'category');
        v_unit := btrim(v_item ->> 'unit');
        v_location := COALESCE(v_item ->> 'location', '');
        v_new_qty := COALESCE(NULLIF(v_item ->> 'quantity', '')::numeric, 0);
        v_unit_price := COALESCE(NULLIF(v_item ->> 'unit_price', '')::numeric, 0);
        v_min_stock := COALESCE(NULLIF(v_item ->> 'min_stock', '')::numeric, 0);
        v_max_stock := COALESCE(NULLIF(v_item ->> 'max_stock', '')::numeric, 0);
        v_group_id := NULLIF(v_item ->> 'group_id', '')::uuid;
        v_supplier_id := NULLIF(v_item ->> 'supplier_id', '')::uuid;
        v_color := NULLIF(btrim(COALESCE(v_item ->> 'color', '')), '');
        v_purchase_unit := COALESCE(
          NULLIF(btrim(v_item ->> 'purchase_unit'), ''), v_unit
        );
        v_conversion_rate := COALESCE(
          NULLIF(v_item ->> 'conversion_rate', '')::numeric, 1
        );
        v_new_grade := CASE WHEN (v_item ? 'stock_grade')
          AND v_item -> 'stock_grade' <> 'null'::jsonb
          THEN v_item -> 'stock_grade' ELSE '{}'::jsonb END;

        INSERT INTO public.products (
          name, sku, category, unit, location, quantity, current_stock,
          unit_price, min_stock, max_stock, group_id, supplier_id, color,
          purchase_unit, conversion_rate, active, stock_grade
        ) VALUES (
          v_name, v_sku, v_category, v_unit, v_location, v_new_qty, v_new_qty,
          v_unit_price, v_min_stock, v_max_stock, v_group_id, v_supplier_id,
          COALESCE(v_color, ''), v_purchase_unit, v_conversion_rate, true, v_new_grade
        ) RETURNING id INTO v_created_product_id;

        -- Sobrepoe os campos normalizados/validados para que um null no JSON
        -- nao desfaça defaults como conversion_rate=1 durante o metadata merge.
        PERFORM public.apply_product_metadata_125(
          v_created_product_id,
          v_item || jsonb_build_object(
            'name', v_name,
            'sku', v_sku,
            'category', v_category,
            'unit', v_unit,
            'location', v_location,
            'unit_price', v_unit_price,
            'min_stock', v_min_stock,
            'max_stock', v_max_stock,
            'group_id', v_group_id,
            'supplier_id', v_supplier_id,
            'color', COALESCE(v_color, ''),
            'purchase_unit', v_purchase_unit,
            'conversion_rate', v_conversion_rate
          )
        );

        INSERT INTO public.stock_movements (
          product_id, movement_type, quantity, previous_stock, new_stock,
          previous_grade, new_grade, description,
          user_id, user_email, movement_reason, correlation_id,
          stock_command_receipt_id, stock_command_item_index
        ) VALUES (
          v_created_product_id, 'in', v_new_qty, 0, v_new_qty,
          NULL, v_new_grade,
          COALESCE(NULLIF(btrim(v_item ->> 'reason'), ''), 'Entrada inicial de estoque'),
          v_auth_user_id, COALESCE(auth.jwt() ->> 'email', ''),
          'ajuste', v_receipt_id, v_receipt_id, v_index
        );
        v_applied := v_applied + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'product_id', v_created_product_id,
          'name', v_name,
          'sku', v_sku,
          'previous_quantity', 0,
          'new_quantity', v_new_qty
        ));
      END LOOP;
    END IF;

  ELSE
    -- ready_stock
    v_items := v_payload -> 'operations';
    IF jsonb_typeof(v_items) IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_items) = 0
       OR jsonb_array_length(v_items) > 500
       OR jsonb_typeof(v_snapshot -> 'ready_stock') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'operations/ready_stock deve ser array nao-vazio com no maximo 500 linhas'
        USING ERRCODE = '22023';
    END IF;

    -- Todos os advisory locks de identidade sao obtidos antes de row locks.
    FOR v_lock_key IN
      SELECT DISTINCT CASE value ->> 'action'
        WHEN 'delta' THEN 'key:' || COALESCE(value ->> 'reference_id', '')
          || ':' || COALESCE(value ->> 'material_variant_id', '')
          || ':' || COALESCE(value ->> 'color', '')
          || ':' || COALESCE(value ->> 'size', '')
        ELSE 'id:' || COALESCE(value ->> 'id', '')
      END
        FROM jsonb_array_elements(v_items)
       ORDER BY 1
    LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended(
        'ready-stock:' || v_lock_key, 0
      ));
    END LOOP;

    -- Todas as linhas ja existentes sao resolvidas (por id OU identidade) e
    -- travadas em UUID ordenado. O indice unique + advisory lock protege o
    -- caso delta em que a linha ainda nao existe.
    FOR v_ready_id IN
      SELECT ready.id
        FROM public.ready_stock ready
       WHERE EXISTS (
         SELECT 1
           FROM jsonb_array_elements(v_items) operation(value)
          WHERE (
            operation.value ->> 'action' IN ('set','delete')
            AND ready.id = NULLIF(operation.value ->> 'id', '')::uuid
          ) OR (
            operation.value ->> 'action' = 'delta'
            AND ready.reference_id = NULLIF(operation.value ->> 'reference_id', '')::uuid
            AND ready.material_variant_id IS NOT DISTINCT FROM
                NULLIF(operation.value ->> 'material_variant_id', '')::uuid
            AND ready.color = COALESCE(operation.value ->> 'color', '')
            AND ready.size = COALESCE(operation.value ->> 'size', '')
          )
       )
       ORDER BY ready.id
       FOR UPDATE
    LOOP
      NULL;
    END LOOP;

    v_index := 0;
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(v_items)
       ORDER BY CASE value ->> 'action'
         WHEN 'delta' THEN 'key:' || COALESCE(value ->> 'reference_id', '')
           || ':' || COALESCE(value ->> 'material_variant_id', '')
           || ':' || COALESCE(value ->> 'color', '')
           || ':' || COALESCE(value ->> 'size', '')
         ELSE 'id:' || COALESCE(value ->> 'id', '')
       END
    LOOP
      v_index := v_index + 1;
      v_action := lower(COALESCE(v_item ->> 'action', ''));
      v_ready_id := NULL;
      v_ready_expected := NULL;
      BEGIN
        v_ready_expected := NULLIF(v_item ->> 'expected_quantity', '')::integer;
        IF v_action = 'delta' THEN
          v_reference_id := NULLIF(v_item ->> 'reference_id', '')::uuid;
          v_material_variant_id := NULLIF(v_item ->> 'material_variant_id', '')::uuid;
          v_ready_delta := NULLIF(v_item ->> 'delta', '')::integer;
          v_ready_key := 'key:' || v_reference_id::text || ':'
            || COALESCE(v_material_variant_id::text, '') || ':'
            || COALESCE(v_item ->> 'color', '') || ':'
            || COALESCE(v_item ->> 'size', '');
        ELSE
          v_ready_id := NULLIF(v_item ->> 'id', '')::uuid;
          v_ready_new := CASE WHEN v_action = 'set'
            THEN NULLIF(v_item ->> 'quantity', '')::integer ELSE 0 END;
          v_ready_key := 'id:' || v_ready_id::text;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'ready_stock_id', v_ready_id, 'error', 'INVALID_ITEM',
          'current_db_qty', NULL));
        CONTINUE;
      END;

      IF v_action NOT IN ('delta','set','delete')
         OR v_ready_expected IS NULL OR v_ready_expected < 0
         OR (v_action = 'delta' AND (
           v_reference_id IS NULL OR v_ready_delta IS NULL
           OR btrim(COALESCE(v_item ->> 'color', '')) = ''
           OR btrim(COALESCE(v_item ->> 'size', '')) = ''
         ))
         OR (v_action IN ('set','delete') AND v_ready_id IS NULL)
         OR (v_action = 'set' AND v_ready_new < 0) THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'ready_stock_id', v_ready_id, 'error', 'INVALID_ITEM',
          'current_db_qty', NULL));
        CONTINUE;
      END IF;
      IF v_action = 'delta' THEN
        SELECT * INTO v_ready
          FROM public.ready_stock ready
         WHERE ready.reference_id = v_reference_id
           AND ready.material_variant_id IS NOT DISTINCT FROM v_material_variant_id
           AND ready.color = COALESCE(v_item ->> 'color', '')
           AND ready.size = COALESCE(v_item ->> 'size', '')
         FOR UPDATE;
        IF NOT FOUND THEN
          v_ready.id := NULL;
          v_ready.quantity := 0;
        END IF;
      ELSE
        SELECT * INTO v_ready FROM public.ready_stock WHERE id = v_ready_id;
        IF NOT FOUND THEN
          v_errors := v_errors || jsonb_build_array(jsonb_build_object(
            'ready_stock_id', v_ready_id, 'error', 'NOT_FOUND',
            'current_db_qty', NULL));
          CONTINUE;
        END IF;
      END IF;

      -- Depois de resolver a identidade, set/delete e delta que apontem para
      -- a MESMA linha convergem para id:<uuid> e o lote e recusado. Para linha
      -- ainda ausente, permanece a chave composta protegida pelo indice unique.
      IF v_ready.id IS NOT NULL THEN
        v_ready_key := 'id:' || v_ready.id::text;
      END IF;
      IF v_ready_key = ANY(v_seen) THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'ready_stock_id', v_ready.id, 'error', 'DUPLICATE_READY_STOCK',
          'current_db_qty', v_ready.quantity));
        CONTINUE;
      END IF;
      v_seen := v_seen || v_ready_key;

      SELECT snap.value INTO v_snap
        FROM jsonb_array_elements(v_snapshot -> 'ready_stock') snap(value)
       WHERE (v_action = 'delta' AND snap.value ->> 'reference_id' = v_reference_id::text
              AND NULLIF(snap.value ->> 'material_variant_id', '')::uuid
                  IS NOT DISTINCT FROM v_material_variant_id
              AND snap.value ->> 'color' = COALESCE(v_item ->> 'color', '')
              AND snap.value ->> 'size' = COALESCE(v_item ->> 'size', ''))
          OR (v_action IN ('set','delete')
              AND snap.value ->> 'id' = v_ready_id::text);
      IF NOT FOUND
         OR NULLIF(v_snap ->> 'quantity', '')::integer IS DISTINCT FROM v_ready_expected THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'ready_stock_id', v_ready.id, 'error', 'INVALID_EXPECTED_SNAPSHOT',
          'current_db_qty', v_ready.quantity));
        CONTINUE;
      END IF;
      IF v_ready.quantity IS DISTINCT FROM v_ready_expected THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'ready_stock_id', v_ready.id, 'error', 'CONCURRENCY_ERROR',
          'current_db_qty', v_ready.quantity));
        CONTINUE;
      END IF;

      IF v_action = 'delta' THEN
        v_ready_new := v_ready.quantity + v_ready_delta;
        IF v_material_variant_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.reference_material_variants variant
           WHERE variant.id = v_material_variant_id
             AND variant.reference_id = v_reference_id
        ) THEN
          v_errors := v_errors || jsonb_build_array(jsonb_build_object(
            'ready_stock_id', v_ready.id, 'error', 'VARIANT_REFERENCE_MISMATCH',
            'current_db_qty', v_ready.quantity));
          CONTINUE;
        END IF;
      END IF;
      IF v_ready_new < 0 THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'ready_stock_id', v_ready.id, 'error', 'NEGATIVE_QTY_NOT_ALLOWED',
          'current_db_qty', v_ready.quantity));
        CONTINUE;
      END IF;
    END LOOP;

    IF jsonb_array_length(v_errors) = 0 THEN
      v_index := 0;
      FOR v_item IN
        SELECT value FROM jsonb_array_elements(v_items)
         ORDER BY CASE value ->> 'action'
           WHEN 'delta' THEN 'key:' || COALESCE(value ->> 'reference_id', '')
             || ':' || COALESCE(value ->> 'material_variant_id', '')
             || ':' || COALESCE(value ->> 'color', '')
             || ':' || COALESCE(value ->> 'size', '')
           ELSE 'id:' || COALESCE(value ->> 'id', '')
         END
      LOOP
        v_index := v_index + 1;
        v_action := v_item ->> 'action';
        v_ready_reason := COALESCE(NULLIF(btrim(v_item ->> 'reason'), ''),
          'Movimento manual de pronta-entrega');
        IF v_action = 'delta' THEN
          v_reference_id := (v_item ->> 'reference_id')::uuid;
          v_material_variant_id := NULLIF(v_item ->> 'material_variant_id', '')::uuid;
          v_ready_delta := (v_item ->> 'delta')::integer;
          SELECT * INTO v_ready
            FROM public.ready_stock ready
           WHERE ready.reference_id = v_reference_id
             AND ready.material_variant_id IS NOT DISTINCT FROM v_material_variant_id
             AND ready.color = COALESCE(v_item ->> 'color', '')
             AND ready.size = COALESCE(v_item ->> 'size', '');
          IF NOT FOUND THEN
            INSERT INTO public.ready_stock (
              reference_id, material_variant_id, color, size,
              quantity, location, notes
            ) VALUES (
              v_reference_id, v_material_variant_id,
              COALESCE(v_item ->> 'color', ''), COALESCE(v_item ->> 'size', ''),
              v_ready_delta, v_item ->> 'location', v_item ->> 'notes'
            ) RETURNING * INTO v_ready;
            v_ready_expected := 0;
            v_ready_new := v_ready.quantity;
          ELSE
            v_ready_expected := v_ready.quantity;
            v_ready_new := v_ready.quantity + v_ready_delta;
            UPDATE public.ready_stock
               SET quantity = v_ready_new,
                   location = COALESCE(v_item ->> 'location', location),
                   notes = COALESCE(v_item ->> 'notes', notes),
                   updated_at = now()
             WHERE id = v_ready.id;
          END IF;
        ELSE
          v_ready_id := (v_item ->> 'id')::uuid;
          SELECT * INTO v_ready FROM public.ready_stock WHERE id = v_ready_id;
          v_reference_id := v_ready.reference_id;
          v_material_variant_id := v_ready.material_variant_id;
          v_ready_expected := v_ready.quantity;
          v_ready_new := CASE WHEN v_action = 'set'
            THEN (v_item ->> 'quantity')::integer ELSE 0 END;
          v_ready_delta := v_ready_new - v_ready_expected;
          IF v_action = 'set' THEN
            UPDATE public.ready_stock
               SET quantity = v_ready_new,
                   location = COALESCE(v_item ->> 'location', location),
                   notes = COALESCE(v_item ->> 'notes', notes),
                   updated_at = now()
             WHERE id = v_ready.id;
          END IF;
        END IF;

        INSERT INTO public.ready_stock_movements (
          ready_stock_id, reference_id, material_variant_id, color, size,
          action, delta, previous_quantity, new_quantity, reason,
          stock_command_receipt_id, stock_command_item_index, actor_id
        ) VALUES (
          v_ready.id, v_reference_id, v_material_variant_id,
          v_ready.color, v_ready.size, v_action,
          CASE WHEN v_action = 'delta' THEN v_ready_delta
               ELSE v_ready_new - v_ready_expected END,
          v_ready_expected, v_ready_new, v_ready_reason,
          v_receipt_id, v_index, v_actor_id
        );
        IF v_action = 'delete' THEN
          DELETE FROM public.ready_stock WHERE id = v_ready.id;
        END IF;
        v_applied := v_applied + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'ready_stock_id', CASE WHEN v_action = 'delete' THEN NULL ELSE v_ready.id END,
          'previous_quantity', v_ready_expected,
          'new_quantity', v_ready_new,
          'action', v_action
        ));
      END LOOP;
    END IF;
  END IF;

  v_response := jsonb_build_object(
    'success', jsonb_array_length(v_errors) = 0,
    'replayed', false,
    'receipt_id', v_receipt_id,
    'client_request_id', p_request_id,
    'command', v_command,
    'applied', v_applied,
    'errors', v_errors,
    'results', v_results
  );
  IF v_command = 'create_product'
     AND v_created_product_id IS NOT NULL
     AND jsonb_array_length(v_items) = 1 THEN
    v_response := v_response || jsonb_build_object(
      'product_id', v_created_product_id
    );
  END IF;

  INSERT INTO public.stock_command_receipts (
    id, client_request_id, command_name, request_hash,
    expected_snapshot, actor_id, response
  ) VALUES (
    v_receipt_id, p_request_id, v_command, v_request_hash,
    v_snapshot, v_actor_id, v_response
  );
  RETURN v_response;
END;
$function$;

REVOKE ALL ON FUNCTION public.execute_stock_command(text, jsonb, uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_stock_command(text, jsonb, uuid, jsonb)
  TO authenticated, service_role;

-- Writers antigos deixam de ser entrypoints do browser. Funcoes internas
-- SECURITY DEFINER continuam podendo chama-los como owner; service_role fica
-- disponivel para rotinas administrativas de recuperacao.
DO $legacy_acl$
DECLARE
  v_function regprocedure;
BEGIN
  FOR v_function IN
    SELECT procedure.oid::regprocedure
      FROM pg_proc procedure
      JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND procedure.proname IN (
         'adjust_stock', 'adjust_stock_batch', 'move_stock_delta',
         'create_product_with_initial_stock', 'upsert_ready_stock_atomic'
       )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_function);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_function);
  END LOOP;
END;
$legacy_acl$;

-- Browser sem DML no ledger nem em pronta-entrega. Leitura permanece sob as
-- policies existentes; o service role conserva acesso operacional.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.stock_movements
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.stock_movements TO service_role;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.ready_stock
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ready_stock TO service_role;

-- Revoga o privilegio de tabela e devolve apenas colunas de metadados. O
-- catalogo e usado para nao congelar aqui uma lista que ficaria obsoleta; a
-- allow-list e tudo menos os seis campos fisicos explicitamente negados.
REVOKE INSERT, UPDATE ON TABLE public.products
  FROM PUBLIC, anon, authenticated;
REVOKE INSERT (
  quantity, current_stock, reserved_stock, stock_grade,
  blocked_qty, quarantine_qty
) ON public.products FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (
  quantity, current_stock, reserved_stock, stock_grade,
  blocked_qty, quarantine_qty
) ON public.products FROM PUBLIC, anon, authenticated;

DO $product_metadata_acl$
DECLARE
  v_insert_columns text;
  v_update_columns text;
BEGIN
  SELECT string_agg(quote_ident(attribute.attname), ', ' ORDER BY attribute.attnum)
    INTO v_insert_columns
    FROM pg_attribute attribute
   WHERE attribute.attrelid = 'public.products'::regclass
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
     AND attribute.attgenerated = ''
     AND attribute.attname NOT IN (
       'id','created_at','updated_at',
       'quantity','current_stock','reserved_stock','stock_grade',
       'blocked_qty','quarantine_qty'
     );
  SELECT string_agg(quote_ident(attribute.attname), ', ' ORDER BY attribute.attnum)
    INTO v_update_columns
    FROM pg_attribute attribute
   WHERE attribute.attrelid = 'public.products'::regclass
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
     AND attribute.attgenerated = ''
     AND attribute.attname NOT IN (
       'id','created_at','updated_at',
       'quantity','current_stock','reserved_stock','stock_grade',
       'blocked_qty','quarantine_qty'
     );
  IF v_insert_columns IS NULL OR v_update_columns IS NULL THEN
    RAISE EXCEPTION 'Nao foi possivel montar a ACL de metadados de products';
  END IF;
  EXECUTE format('GRANT INSERT (%s) ON public.products TO authenticated', v_insert_columns);
  EXECUTE format('GRANT UPDATE (%s) ON public.products TO authenticated', v_update_columns);
END;
$product_metadata_acl$;

-- Guard executavel e read-only do boundary. Nao cria produto nem movimenta
-- saldo; confere contratos no catalogo e no corpo instalado.
CREATE OR REPLACE FUNCTION public.run_stock_command_boundary_self_test_125()
RETURNS TABLE(test_name text, passed boolean, details text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_definition text;
BEGIN
  v_definition := pg_get_functiondef(
    'public.execute_stock_command(text,jsonb,uuid,jsonb)'::regprocedure
  );

  test_name := 'entrypoint_receipt_lock_cas';
  passed := position('stock_command_receipts' IN v_definition) > 0
    AND position('pg_advisory_xact_lock' IN v_definition) > 0
    AND position('FOR UPDATE' IN v_definition) > 0
    AND position('CONCURRENCY_ERROR' IN v_definition) > 0;
  details := 'Receipt idempotente, locks ordenados e CAS estao no entrypoint.';
  RETURN NEXT;

  test_name := 'ledger_and_reserved_guard';
  passed := position('stock_movements' IN v_definition) > 0
    AND position('ready_stock_movements' IN v_definition) > 0
    AND position('RESERVADO_PARA_OP' IN v_definition) > 0;
  details := 'Produtos e pronta-entrega geram ledger; saida pode respeitar reserva.';
  RETURN NEXT;

  test_name := 'grade_coherence';
  passed := position('stock_grade_validation_error_125' IN v_definition) > 0
    AND position('GRADE_REQUIRED_FOR_GRADED_PRODUCT' IN v_definition) > 0;
  details := 'Grade e quantity sao validadas e escritas juntas.';
  RETURN NEXT;

  test_name := 'browser_physical_acl';
  passed := NOT has_column_privilege('authenticated', 'public.products', 'quantity', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.products', 'quantity', 'INSERT')
    AND NOT has_column_privilege('authenticated', 'public.products', 'stock_grade', 'UPDATE')
    AND NOT has_column_privilege('anon', 'public.products', 'quantity', 'UPDATE')
    AND NOT has_column_privilege('anon', 'public.products', 'name', 'UPDATE')
    AND has_column_privilege('authenticated', 'public.products', 'name', 'UPDATE')
    AND has_column_privilege('authenticated', 'public.products', 'name', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.ready_stock', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.stock_movements', 'INSERT');
  details := 'Browser edita metadados, mas nao escreve saldo/grade/ledgers diretamente.';
  RETURN NEXT;

  test_name := 'entrypoint_acl';
  passed := has_function_privilege(
      'authenticated', 'public.execute_stock_command(text,jsonb,uuid,jsonb)', 'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon', 'public.execute_stock_command(text,jsonb,uuid,jsonb)', 'EXECUTE'
    );
  details := 'Somente principals autenticados entram; a funcao aplica role fail-closed.';
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.run_stock_command_boundary_self_test_125()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_stock_command_boundary_self_test_125()
  TO service_role;

DO $self_test$
DECLARE
  v_failure record;
BEGIN
  SELECT * INTO v_failure
    FROM public.run_stock_command_boundary_self_test_125()
   WHERE NOT passed
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'stock command boundary self-test falhou: % - %',
      v_failure.test_name, v_failure.details;
  END IF;
END;
$self_test$;

COMMIT;
