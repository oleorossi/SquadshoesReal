CREATE OR REPLACE FUNCTION public.adjust_stock(
    p_product_id UUID,
    p_expected_previous_qty NUMERIC,
    p_new_qty NUMERIC,
    p_delta NUMERIC,
    p_reason TEXT,
    p_new_grade JSONB DEFAULT NULL
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
    -- Bloqueia a linha do produto para atualização concorrente
    SELECT quantity INTO v_actual_qty
    FROM public.products
    WHERE id = p_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 0::NUMERIC, 'Produto não encontrado'::TEXT;
        RETURN;
    END IF;

    -- Validação de concorrência: o saldo esperado pelo cliente deve ser igual ao do banco
    IF v_actual_qty != p_expected_previous_qty THEN
        RETURN QUERY SELECT false, v_actual_qty, 'CONCURRENCY_ERROR'::TEXT;
        RETURN;
    END IF;

    -- Calcula o delta real baseado no que está no banco agora
    v_actual_delta := p_new_qty - v_actual_qty;
    v_movement_type := CASE WHEN v_actual_delta >= 0 THEN 'in' ELSE 'out' END;

    -- Atualiza o produto
    UPDATE public.products
    SET 
        quantity = p_new_qty,
        current_stock = p_new_qty,
        stock_grade = COALESCE(p_new_grade, stock_grade),
        updated_at = NOW()
    WHERE id = p_product_id;

    -- Registra a movimentação
    INSERT INTO public.stock_movements (
        product_id,
        movement_type,
        quantity,
        previous_stock,
        new_stock,
        description
    ) VALUES (
        p_product_id,
        v_movement_type,
        ABS(v_actual_delta),
        v_actual_qty,
        p_new_qty,
        p_reason
    );

    RETURN QUERY SELECT true, p_new_qty, NULL::TEXT;
END;
$$;