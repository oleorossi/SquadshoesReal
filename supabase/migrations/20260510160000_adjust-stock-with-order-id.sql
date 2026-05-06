-- =============================================================================
-- adjust_stock(): suporte a `order_id` na movimentação
-- =============================================================================
--
-- A função `adjust_stock` (criada em 20260425155923) é o RPC concorrência-safe
-- usado pela UI de ajuste de estoque. Várias páginas (Contractors, baixa
-- manual, consumíveis, grade de solado) faziam SELECT/UPDATE direto +
-- stock_movements.insert separado para conseguir gravar `order_id` — isso
-- bypassava o `SELECT FOR UPDATE` do RPC, abrindo brecha para race condition.
--
-- Esta migration adiciona o parâmetro opcional `p_order_id` (default NULL)
-- e propaga o valor para `stock_movements.order_id`. Callers existentes
-- continuam funcionando sem alteração porque o parâmetro tem default.
-- =============================================================================

DROP FUNCTION IF EXISTS public.adjust_stock(uuid, numeric, numeric, numeric, text, jsonb);

CREATE OR REPLACE FUNCTION public.adjust_stock(
    p_product_id UUID,
    p_expected_previous_qty NUMERIC,
    p_new_qty NUMERIC,
    p_delta NUMERIC,
    p_reason TEXT,
    p_new_grade JSONB DEFAULT NULL,
    p_order_id UUID DEFAULT NULL
)
RETURNS TABLE (
    success BOOLEAN,
    current_db_qty NUMERIC,
    error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actual_qty NUMERIC;
    v_movement_type TEXT;
    v_actual_delta NUMERIC;
BEGIN
    SELECT quantity INTO v_actual_qty
    FROM public.products
    WHERE id = p_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 0::NUMERIC, 'Produto não encontrado'::TEXT;
        RETURN;
    END IF;

    IF v_actual_qty != p_expected_previous_qty THEN
        RETURN QUERY SELECT false, v_actual_qty, 'CONCURRENCY_ERROR'::TEXT;
        RETURN;
    END IF;

    v_actual_delta := p_new_qty - v_actual_qty;
    v_movement_type := CASE WHEN v_actual_delta >= 0 THEN 'in' ELSE 'out' END;

    UPDATE public.products
    SET quantity     = p_new_qty,
        current_stock = p_new_qty,
        stock_grade  = COALESCE(p_new_grade, stock_grade),
        updated_at   = NOW()
    WHERE id = p_product_id;

    INSERT INTO public.stock_movements (
        product_id,
        movement_type,
        quantity,
        previous_stock,
        new_stock,
        description,
        order_id
    ) VALUES (
        p_product_id,
        v_movement_type,
        ABS(v_actual_delta),
        v_actual_qty,
        p_new_qty,
        p_reason,
        p_order_id
    );

    RETURN QUERY SELECT true, p_new_qty, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.adjust_stock(uuid, numeric, numeric, numeric, text, jsonb, uuid) TO authenticated;

COMMENT ON FUNCTION public.adjust_stock(uuid, numeric, numeric, numeric, text, jsonb, uuid) IS
  'Ajuste atômico de estoque com SELECT FOR UPDATE. Aceita p_order_id opcional '
  'para vincular a movimentação a uma OP/OS, alinhando o RPC com o que callers '
  'em Contractors.tsx faziam manualmente.';
