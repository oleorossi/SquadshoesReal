-- =============================================================================
-- adjust_stock: comparação de concorrência TOLERANTE a precisão (2026-06-20)
-- =============================================================================
-- Bug: o ajuste de estoque dava "Conflito: o estoque mudou para X enquanto você
-- editava" SEMPRE pra materiais com quantidade de precisão alta (dízima vinda da
-- conversão da NF — ex.: NAPA SOFT PRETO = 70.70606060606060600000). A tela manda
-- p_expected_previous_qty = products.quantity lido em JS (float64), que TRUNCA pra
-- ~15 dígitos (70.7060606060606). O banco guarda numeric com 20+ casas → a
-- comparação EXATA `v_actual_qty != p_expected_previous_qty` nunca casava →
-- CONCURRENCY_ERROR permanente: era IMPOSSÍVEL ajustar esses produtos.
--
-- Fix: comparar ARREDONDADO a 4 casas. Absorve o ruído do round-trip float64
-- (~1e-13) mas ainda pega qualquer mudança real ≥ 0.0001 (um débito/entrada
-- concorrente continua sendo detectado). 4 casas > precisão útil de estoque (m/un).
-- Resto da função IDÊNTICO. Aplicado via MCP. Timestamp > 20260818120000.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.adjust_stock(p_product_id uuid, p_expected_previous_qty numeric, p_new_qty numeric, p_delta numeric, p_reason text, p_new_grade jsonb DEFAULT NULL::jsonb, p_order_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(success boolean, current_db_qty numeric, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_actual_qty NUMERIC;
    v_movement_type TEXT;
    v_actual_delta NUMERIC;
BEGIN
    IF NOT public.is_approved_user() THEN
        RAISE EXCEPTION 'Permission denied: usuário não aprovado';
    END IF;

    IF p_new_qty < 0 THEN
        RETURN QUERY SELECT false, p_expected_previous_qty, 'NEGATIVE_QTY_NOT_ALLOWED'::TEXT;
        RETURN;
    END IF;

    SELECT quantity INTO v_actual_qty
    FROM public.products
    WHERE id = p_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 0::NUMERIC, 'Produto não encontrado'::TEXT;
        RETURN;
    END IF;

    -- Comparação TOLERANTE a precisão: arredonda a 4 casas pra não disparar
    -- conflito falso por causa do round-trip float64 da tela (numeric do banco tem
    -- mais casas que o float JS consegue representar). Mudança real ≥ 0.0001 ainda
    -- é detectada.
    IF round(v_actual_qty, 4) <> round(p_expected_previous_qty, 4) THEN
        RETURN QUERY SELECT false, v_actual_qty, 'CONCURRENCY_ERROR'::TEXT;
        RETURN;
    END IF;

    v_actual_delta := p_new_qty - v_actual_qty;
    v_movement_type := CASE WHEN v_actual_delta >= 0 THEN 'in' ELSE 'out' END;

    UPDATE public.products
    SET quantity      = p_new_qty,
        current_stock = p_new_qty,
        stock_grade   = COALESCE(p_new_grade, stock_grade),
        updated_at    = NOW()
    WHERE id = p_product_id;

    INSERT INTO public.stock_movements (
        product_id, movement_type, quantity,
        previous_stock, new_stock, description, order_id,
        user_id, user_email
    ) VALUES (
        p_product_id, v_movement_type, ABS(v_actual_delta),
        v_actual_qty, p_new_qty, p_reason, p_order_id,
        auth.uid(), COALESCE(auth.jwt() ->> 'email', '')
    );

    RETURN QUERY SELECT true, p_new_qty, NULL::TEXT;
END;
$function$;
