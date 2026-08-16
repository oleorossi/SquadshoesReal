-- =============================================================================
-- /ajuste-estoque: unidade discreta, coerência de grade e trilha por numeração
-- =============================================================================
-- Não arredonda saldos legados. A partir desta migration, novos ajustes são
-- validados na RPC e toda alteração de grade precisa fechar com products.quantity.

ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS previous_grade jsonb,
  ADD COLUMN IF NOT EXISTS new_grade jsonb;

COMMENT ON COLUMN public.stock_movements.previous_grade IS
  'Grade anterior quando a movimentação altera estoque por numeração; metadados _* podem estar presentes.';
COMMENT ON COLUMN public.stock_movements.new_grade IS
  'Grade resultante quando a movimentação altera estoque por numeração; permite auditar redistribuição com delta total zero.';

CREATE OR REPLACE FUNCTION public.is_discrete_stock_unit(p_unit text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public'
AS $function$
  SELECT lower(btrim(COALESCE(p_unit, ''))) = ANY (ARRAY[
    'un', 'unid', 'unidade', 'und',
    'par',
    'placa', 'chapa',
    'cx', 'caixa',
    'pc', 'peça', 'peca',
    'rl', 'rolo',
    'fh', 'folha',
    'jg', 'jogo'
  ]::text[])
$function$;

COMMENT ON FUNCTION public.is_discrete_stock_unit(text) IS
  'Retorna true para unidades de contagem cujo saldo físico deve ser inteiro.';

CREATE OR REPLACE FUNCTION public.check_grade_quantity_coherence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_total numeric := 0;
BEGIN
  IF NEW.stock_grade IS NULL THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW.stock_grade) <> 'object' THEN
    RAISE EXCEPTION 'stock_grade deve ser um objeto JSON (produto %)', NEW.id;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_each(NEW.stock_grade) AS g(k, v)
     WHERE left(g.k, 1) <> '_'
       AND jsonb_typeof(g.v) IS DISTINCT FROM 'number'
  ) THEN
    RAISE EXCEPTION 'stock_grade contém quantidade não numérica (produto %)', NEW.id;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_each(NEW.stock_grade) AS g(k, v)
     WHERE left(g.k, 1) <> '_'
       AND (g.v #>> '{}')::numeric < 0
  ) THEN
    RAISE EXCEPTION 'stock_grade contém quantidade negativa (produto %)', NEW.id;
  END IF;

  IF public.is_discrete_stock_unit(NEW.unit) AND EXISTS (
    SELECT 1
      FROM jsonb_each(NEW.stock_grade) AS g(k, v)
     WHERE left(g.k, 1) <> '_'
       AND (g.v #>> '{}')::numeric <> trunc((g.v #>> '{}')::numeric)
  ) THEN
    RAISE EXCEPTION 'stock_grade contém fração em unidade discreta % (produto %)', NEW.unit, NEW.id;
  END IF;

  SELECT COALESCE(sum((g.v #>> '{}')::numeric), 0)
    INTO v_total
    FROM jsonb_each(NEW.stock_grade) AS g(k, v)
   WHERE left(g.k, 1) <> '_';

  IF abs(v_total - COALESCE(NEW.quantity, 0)) > 0.0001 THEN
    RAISE EXCEPTION
      'Incoerência de grade no produto %: soma % difere de quantity %',
      NEW.id, v_total, COALESCE(NEW.quantity, 0);
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_check_grade_quantity_coherence ON public.products;
DROP TRIGGER IF EXISTS trg_check_grade_quantity_coherence_insert ON public.products;

CREATE TRIGGER trg_check_grade_quantity_coherence
  BEFORE UPDATE OF stock_grade, quantity, unit ON public.products
  FOR EACH ROW
  WHEN (NEW.stock_grade IS NOT NULL)
  EXECUTE FUNCTION public.check_grade_quantity_coherence();

CREATE TRIGGER trg_check_grade_quantity_coherence_insert
  BEFORE INSERT ON public.products
  FOR EACH ROW
  WHEN (NEW.stock_grade IS NOT NULL)
  EXECUTE FUNCTION public.check_grade_quantity_coherence();

CREATE OR REPLACE FUNCTION public.adjust_stock_batch(
  p_items jsonb,
  p_enforce_reserved boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item              jsonb;
  v_product_id        uuid;
  v_expected          numeric;
  v_new_qty           numeric;
  v_new_grade         jsonb;
  v_previous_grade    jsonb;
  v_actual_qty        numeric;
  v_reserved          numeric;
  v_unit              text;
  v_grade_total       numeric;
  v_errors            jsonb := '[]'::jsonb;
  v_seen              uuid[] := '{}';
  v_applied           integer := 0;
  v_actual_delta      numeric;
  v_movement_type     text;
  v_bad_bucket        boolean;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'p_items tem que ser um array JSON não-vazio';
  END IF;
  IF jsonb_array_length(p_items) > 500 THEN
    RAISE EXCEPTION 'Lote grande demais: máx. 500 itens por ajuste';
  END IF;

  -- Fase 1: trava e valida o lote inteiro, sem escrever.
  FOR v_item IN
    SELECT it.value
      FROM jsonb_array_elements(p_items) AS it(value)
     ORDER BY it.value->>'product_id'
  LOOP
    v_product_id := NULL;
    v_expected := NULL;
    v_new_qty := NULL;
    v_new_grade := NULL;

    BEGIN
      IF jsonb_typeof(v_item) <> 'object' THEN
        RAISE EXCEPTION 'INVALID_ITEM' USING ERRCODE = '22P02';
      END IF;
      v_product_id := NULLIF(v_item->>'product_id', '')::uuid;
      v_expected := NULLIF(v_item->>'expected_previous_qty', '')::numeric;
      v_new_qty := NULLIF(v_item->>'new_qty', '')::numeric;
      IF v_item ? 'new_grade' AND v_item->'new_grade' <> 'null'::jsonb THEN
        IF jsonb_typeof(v_item->'new_grade') <> 'object' THEN
          RAISE EXCEPTION 'INVALID_ITEM' USING ERRCODE = '22P02';
        END IF;
        v_new_grade := v_item->'new_grade';
      END IF;
    EXCEPTION
      WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'product_id', v_product_id, 'error', 'INVALID_ITEM', 'current_db_qty', NULL));
        CONTINUE;
    END;

    IF v_product_id IS NULL OR v_expected IS NULL OR v_new_qty IS NULL THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'product_id', v_product_id, 'error', 'INVALID_ITEM', 'current_db_qty', NULL));
      CONTINUE;
    END IF;

    IF v_product_id = ANY(v_seen) THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'product_id', v_product_id, 'error', 'DUPLICATE_PRODUCT', 'current_db_qty', NULL));
      CONTINUE;
    END IF;
    v_seen := v_seen || v_product_id;

    SELECT quantity, COALESCE(reserved_stock, 0), unit
      INTO v_actual_qty, v_reserved, v_unit
      FROM public.products
     WHERE id = v_product_id
       FOR UPDATE;

    IF NOT FOUND THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'product_id', v_product_id, 'error', 'NOT_FOUND', 'current_db_qty', NULL));
      CONTINUE;
    END IF;

    IF v_new_qty < 0 THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'product_id', v_product_id, 'error', 'NEGATIVE_QTY_NOT_ALLOWED', 'current_db_qty', v_actual_qty));
      CONTINUE;
    END IF;

    IF public.is_discrete_stock_unit(v_unit) AND v_new_qty <> trunc(v_new_qty) THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'product_id', v_product_id, 'error', 'FRACTIONAL_DISCRETE_UNIT', 'current_db_qty', v_actual_qty));
      CONTINUE;
    END IF;

    IF v_new_grade IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1
          FROM jsonb_each(v_new_grade) AS g(k, v)
         WHERE left(g.k, 1) <> '_'
           AND jsonb_typeof(g.v) IS DISTINCT FROM 'number'
      ) INTO v_bad_bucket;
      IF v_bad_bucket THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'product_id', v_product_id, 'error', 'INVALID_GRADE_BUCKET', 'current_db_qty', v_actual_qty));
        CONTINUE;
      END IF;

      SELECT EXISTS (
        SELECT 1
          FROM jsonb_each(v_new_grade) AS g(k, v)
         WHERE left(g.k, 1) <> '_'
           AND (g.v #>> '{}')::numeric < 0
      ) INTO v_bad_bucket;
      IF v_bad_bucket THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'product_id', v_product_id, 'error', 'NEGATIVE_GRADE_BUCKET', 'current_db_qty', v_actual_qty));
        CONTINUE;
      END IF;

      IF public.is_discrete_stock_unit(v_unit) THEN
        SELECT EXISTS (
          SELECT 1
            FROM jsonb_each(v_new_grade) AS g(k, v)
           WHERE left(g.k, 1) <> '_'
             AND (g.v #>> '{}')::numeric <> trunc((g.v #>> '{}')::numeric)
        ) INTO v_bad_bucket;
        IF v_bad_bucket THEN
          v_errors := v_errors || jsonb_build_array(jsonb_build_object(
            'product_id', v_product_id, 'error', 'FRACTIONAL_GRADE_BUCKET', 'current_db_qty', v_actual_qty));
          CONTINUE;
        END IF;
      END IF;

      SELECT COALESCE(sum((g.v #>> '{}')::numeric), 0)
        INTO v_grade_total
        FROM jsonb_each(v_new_grade) AS g(k, v)
       WHERE left(g.k, 1) <> '_';

      IF abs(v_grade_total - v_new_qty) > 0.0001 THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'product_id', v_product_id,
          'error', 'GRADE_TOTAL_MISMATCH',
          'current_db_qty', v_actual_qty,
          'grade_total', v_grade_total));
        CONTINUE;
      END IF;
    END IF;

    IF round(v_actual_qty, 4) <> round(v_expected, 4) THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'product_id', v_product_id, 'error', 'CONCURRENCY_ERROR', 'current_db_qty', v_actual_qty));
      CONTINUE;
    END IF;

    IF p_enforce_reserved AND v_new_qty < v_reserved THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'product_id', v_product_id, 'error', 'RESERVADO_PARA_OP', 'current_db_qty', v_actual_qty));
      CONTINUE;
    END IF;
  END LOOP;

  IF jsonb_array_length(v_errors) > 0 THEN
    RETURN jsonb_build_object('success', false, 'applied', 0, 'errors', v_errors);
  END IF;

  -- Fase 2: aplica com todas as linhas ainda travadas.
  FOR v_item IN
    SELECT it.value
      FROM jsonb_array_elements(p_items) AS it(value)
     ORDER BY it.value->>'product_id'
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_new_qty := (v_item->>'new_qty')::numeric;
    v_new_grade := CASE
      WHEN jsonb_typeof(v_item->'new_grade') = 'object' THEN v_item->'new_grade'
      ELSE NULL
    END;

    SELECT quantity, stock_grade
      INTO v_actual_qty, v_previous_grade
      FROM public.products
     WHERE id = v_product_id;

    v_actual_delta := v_new_qty - v_actual_qty;
    v_movement_type := CASE WHEN v_actual_delta >= 0 THEN 'in' ELSE 'out' END;

    UPDATE public.products
       SET quantity = v_new_qty,
           current_stock = v_new_qty,
           stock_grade = COALESCE(v_new_grade, stock_grade),
           updated_at = now()
     WHERE id = v_product_id;

    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity, previous_stock, new_stock,
      previous_grade, new_grade,
      description, order_id, user_id, user_email
    ) VALUES (
      v_product_id, v_movement_type, abs(v_actual_delta), v_actual_qty, v_new_qty,
      CASE WHEN v_new_grade IS NOT NULL THEN v_previous_grade ELSE NULL END,
      v_new_grade,
      COALESCE(NULLIF(btrim(v_item->>'reason'), ''), 'Ajuste manual'),
      NULL, auth.uid(), COALESCE(auth.jwt() ->> 'email', '')
    );

    v_applied := v_applied + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'applied', v_applied, 'errors', '[]'::jsonb);
END;
$function$;

COMMENT ON FUNCTION public.adjust_stock_batch(jsonb, boolean) IS
  'Ajuste transacional da tela /ajuste-estoque. Valida concorrência, negativos, unidades discretas, soma/inteireza da grade e registra grade anterior/nova no histórico.';

GRANT EXECUTE ON FUNCTION public.adjust_stock_batch(jsonb, boolean) TO authenticated;
