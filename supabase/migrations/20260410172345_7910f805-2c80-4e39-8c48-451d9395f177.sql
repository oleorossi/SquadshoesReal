-- 1. Add reserved_stock column to products
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS reserved_stock NUMERIC DEFAULT 0;

-- 2. Create material_reservations table
CREATE TABLE IF NOT EXISTS public.material_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
    quantity NUMERIC NOT NULL,
    status TEXT NOT NULL DEFAULT 'reserved', -- 'reserved', 'converted', 'cancelled'
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.material_reservations ENABLE ROW LEVEL SECURITY;

-- Create policies (allowing authenticated users for now, adjust as needed)
CREATE POLICY "Allow all access to material_reservations" ON public.material_reservations FOR ALL USING (auth.role() = 'authenticated');

-- 3. Function to reserve material
CREATE OR REPLACE FUNCTION reserve_material_for_order(p_order_id UUID, p_product_id UUID, p_quantity_needed NUMERIC)
RETURNS void AS $$
DECLARE
    v_available NUMERIC;
BEGIN
    -- Lock the row to avoid race conditions
    SELECT (current_stock - reserved_stock) INTO v_available
    FROM public.products WHERE id = p_product_id FOR UPDATE;

    IF v_available < p_quantity_needed THEN
        RAISE EXCEPTION 'Saldo insuficiente para reserva. Disponível: %, Necessário: %', v_available, p_quantity_needed;
    END IF;

    -- Update reserved stock
    UPDATE public.products 
    SET reserved_stock = reserved_stock + p_quantity_needed
    WHERE id = p_product_id;

    -- Record the reservation
    INSERT INTO public.material_reservations (order_id, product_id, quantity, status)
    VALUES (p_order_id, p_product_id, p_quantity_needed, 'reserved');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Function to convert reservation to actual output
CREATE OR REPLACE FUNCTION convert_reservation_to_out(p_order_id UUID, p_product_id UUID)
RETURNS void AS $$
DECLARE
    v_reserved_qty NUMERIC;
BEGIN
    -- Get the reserved quantity for this order/product
    SELECT quantity INTO v_reserved_qty
    FROM public.material_reservations
    WHERE order_id = p_order_id AND product_id = p_product_id AND status = 'reserved'
    FOR UPDATE;

    IF v_reserved_qty IS NOT NULL THEN
        -- Decrease both current_stock and reserved_stock
        UPDATE public.products
        SET current_stock = current_stock - v_reserved_qty,
            reserved_stock = reserved_stock - v_reserved_qty
        WHERE id = p_product_id;

        -- Mark reservation as converted
        UPDATE public.material_reservations
        SET status = 'converted',
            updated_at = now()
        WHERE order_id = p_order_id AND product_id = p_product_id AND status = 'reserved';
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;