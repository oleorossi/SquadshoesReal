-- ============================================================================
-- adjust_stock_batch — ajuste de estoque em LOTE, tudo-ou-nada (/ajuste-estoque)
-- ============================================================================
-- Substitui o loop de N chamadas a adjust_stock feito pelo StockAdjustmentPage
-- (N round-trips sem transação entre eles: falha no meio deixava metade gravada).
-- Uma chamada = uma transação: valida TODAS as linhas sob FOR UPDATE antes de
-- escrever qualquer coisa; qualquer divergência aborta o lote inteiro e devolve
-- errors[] por produto pra UI apontar o culpado.
--
-- Espelha adjust_stock (mig 20261017120000) — que NÃO é alterado e continua em
-- uso por ManualStockOutDialog, SoladoGradeDialog, adjustStockSafe e outros:
--   • gate is_approved_user(), SECURITY DEFINER, search_path=public
--   • concorrência POR LINHA tolerante a precisão: round(qty,4) (mig 20260819120000)
--   • UPDATE products: quantity + current_stock + stock_grade(COALESCE) + updated_at
--   • INSERT stock_movements com description/user_id/user_email; movement_reason
--     fica NULL DE PROPÓSITO — o trigger trg_stock_movements_fill_reason
--     classifica pela description (paridade com o caminho atual; setar 'ajuste'
--     aqui quebraria a classificação 'devolucao' do preset "Devolução de
--     cliente"). search_norm é coluna GERADA — nunca inserir.

CREATE OR REPLACE FUNCTION public.adjust_stock_batch(
  p_items jsonb,
  -- itens: [{ product_id uuid, expected_previous_qty numeric, new_qty numeric,
  --           new_grade jsonb|null, reason text }]
  p_enforce_reserved boolean DEFAULT false  -- paridade com adjust_stock; a tela usa o default
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item          jsonb;
  v_product_id    uuid;
  v_expected      numeric;
  v_new_qty       numeric;
  v_new_grade     jsonb;
  v_actual_qty    numeric;
  v_reserved      numeric;
  v_errors        jsonb := '[]'::jsonb;
  v_seen          uuid[] := '{}';
  v_applied       integer := 0;
  v_actual_delta  numeric;
  v_movement_type text;
  v_bad_bucket    boolean;
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

  -- ── FASE 1: trava e valida TUDO. Nada é escrito aqui. ────────────────────
  -- Ordena por product_id pra dois lotes concorrentes travarem na MESMA ordem
  -- (senão A trava X e espera Y, B trava Y e espera X = deadlock).
  FOR v_item IN
    SELECT it.value FROM jsonb_array_elements(p_items) AS it(value)
    ORDER BY it.value->>'product_id'
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_expected   := (v_item->>'expected_previous_qty')::numeric;
    v_new_qty    := (v_item->>'new_qty')::numeric;
    v_new_grade  := CASE WHEN jsonb_typeof(v_item->'new_grade') = 'object'
                         THEN v_item->'new_grade' ELSE NULL END;

    -- Item malformado NÃO pode passar batido: expected NULL furaria a checagem
    -- de concorrência (NULL <> x é NULL ⇒ IF falso ⇒ aplicaria sem validar).
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

    IF v_new_qty < 0 THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'product_id', v_product_id, 'error', 'NEGATIVE_QTY_NOT_ALLOWED', 'current_db_qty', NULL));
      CONTINUE;
    END IF;

    -- Grade de solado: nenhum balde pode ser negativo (metadados "_*" ignorados).
    IF v_new_grade IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM jsonb_each_text(v_new_grade) AS g(k, v)
         WHERE g.k NOT LIKE E'\\_%' AND btrim(COALESCE(g.v, '')) LIKE '-%'
      ) INTO v_bad_bucket;
      IF v_bad_bucket THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'product_id', v_product_id, 'error', 'NEGATIVE_GRADE_BUCKET', 'current_db_qty', NULL));
        CONTINUE;
      END IF;
    END IF;

    SELECT quantity, COALESCE(reserved_stock, 0)
      INTO v_actual_qty, v_reserved
      FROM public.products
     WHERE id = v_product_id
       FOR UPDATE;

    IF NOT FOUND THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'product_id', v_product_id, 'error', 'NOT_FOUND', 'current_db_qty', NULL));
      CONTINUE;
    END IF;

    -- CRÍTICO: mesma detecção de concorrência do adjust_stock — POR LINHA,
    -- tolerante a precisão (round 4 casas).
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

  -- Qualquer erro ⇒ NADA foi escrito (fase 1 é só SELECT ... FOR UPDATE).
  -- Retorno normal (sem exception) pra UI receber a lista por produto.
  IF jsonb_array_length(v_errors) > 0 THEN
    RETURN jsonb_build_object('success', false, 'applied', 0, 'errors', v_errors);
  END IF;

  -- ── FASE 2: aplica. Linhas já travadas — os valores lidos não mudam. ─────
  FOR v_item IN
    SELECT it.value FROM jsonb_array_elements(p_items) AS it(value)
    ORDER BY it.value->>'product_id'
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_new_qty    := (v_item->>'new_qty')::numeric;
    v_new_grade  := CASE WHEN jsonb_typeof(v_item->'new_grade') = 'object'
                         THEN v_item->'new_grade' ELSE NULL END;

    SELECT quantity INTO v_actual_qty FROM public.products WHERE id = v_product_id;

    v_actual_delta  := v_new_qty - v_actual_qty;
    v_movement_type := CASE WHEN v_actual_delta >= 0 THEN 'in' ELSE 'out' END;

    UPDATE public.products
       SET quantity      = v_new_qty,
           current_stock = v_new_qty,
           stock_grade   = COALESCE(v_new_grade, stock_grade),
           updated_at    = NOW()
     WHERE id = v_product_id;

    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity, previous_stock, new_stock,
      description, order_id, user_id, user_email
    ) VALUES (
      v_product_id, v_movement_type, ABS(v_actual_delta), v_actual_qty, v_new_qty,
      COALESCE(NULLIF(btrim(v_item->>'reason'), ''), 'Ajuste manual'),
      NULL, auth.uid(), COALESCE(auth.jwt() ->> 'email', '')
    );

    v_applied := v_applied + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'applied', v_applied, 'errors', '[]'::jsonb);
END;
$function$;

COMMENT ON FUNCTION public.adjust_stock_batch(jsonb, boolean) IS
  'Ajuste de estoque em LOTE numa única transação (tela /ajuste-estoque). Valida expected_previous_qty POR LINHA sob FOR UPDATE (round 4 casas) antes de escrever; qualquer divergência aborta o lote inteiro e retorna errors[] por produto. Aditiva — adjust_stock permanece em uso por outras telas.';

GRANT EXECUTE ON FUNCTION public.adjust_stock_batch(jsonb, boolean) TO authenticated;
