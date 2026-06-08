-- Auditoria de estoque 2026-06-08 — Achado #6 (alto): adjust_stock não gravava o
-- AUTOR do ajuste em stock_movements (user_id/user_email ficavam NULL/'') → sem
-- trilha de auditoria de quem ajustou cada saldo. Agora popula via auth.uid() +
-- auth.jwt()->>'email' (lê do JWT do chamador, sem acessar auth.users; SECURITY
-- DEFINER preservado). Concorrência (FOR UPDATE + expected_previous_qty) intacta.
-- Aplicada via MCP em 2026-06-08; arquivo criado p/ rastreio (GitHub Action).
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

    IF v_actual_qty != p_expected_previous_qty THEN
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
