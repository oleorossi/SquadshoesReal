CREATE OR REPLACE FUNCTION public.convert_reservation_to_out(p_order_id UUID, p_product_id UUID DEFAULT NULL)
RETURNS void AS $$
DECLARE
    r RECORD;
BEGIN
    -- Loop through all reserved materials for this order (optionally filtered by product)
    FOR r IN 
        SELECT product_id, quantity, id
        FROM public.material_reservations
        WHERE order_id = p_order_id 
          AND (p_product_id IS NULL OR product_id = p_product_id)
          AND status = 'reserved'
        FOR UPDATE
    LOOP
        -- Decrease both current_stock and reserved_stock
        UPDATE public.products
        SET current_stock = current_stock - r.quantity,
            reserved_stock = reserved_stock - r.quantity
        WHERE id = r.product_id;

        -- Mark reservation as converted
        UPDATE public.material_reservations
        SET status = 'converted',
            updated_at = now()
        WHERE id = r.id;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;