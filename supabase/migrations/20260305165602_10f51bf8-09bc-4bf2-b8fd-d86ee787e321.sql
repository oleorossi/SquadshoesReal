
-- Add extra fields to reference_materials for full technical spec
ALTER TABLE public.reference_materials
  ADD COLUMN color text DEFAULT '',
  ADD COLUMN width text DEFAULT '',
  ADD COLUMN weight text DEFAULT '',
  ADD COLUMN supplier text DEFAULT '',
  ADD COLUMN notes text DEFAULT '';

-- Stock movements history table
CREATE TABLE public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  movement_type text NOT NULL DEFAULT 'out',
  quantity numeric NOT NULL DEFAULT 0,
  previous_stock numeric NOT NULL DEFAULT 0,
  new_stock numeric NOT NULL DEFAULT 0,
  description text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can view movements" ON public.stock_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth users can insert movements" ON public.stock_movements FOR INSERT TO authenticated WITH CHECK (true);

-- Enable realtime for stock_movements
ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_movements;

-- Replace the debit function to also validate stock and log movements
CREATE OR REPLACE FUNCTION public.debit_stock_for_order(p_reference_id uuid, p_order_quantity integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mat RECORD;
  required numeric;
  current_qty numeric;
BEGIN
  -- First validate all materials have sufficient stock
  FOR mat IN
    SELECT rm.product_id, rm.quantity_per_unit, p.quantity AS current_stock, p.name
    FROM public.reference_materials rm
    JOIN public.products p ON p.id = rm.product_id
    WHERE rm.reference_id = p_reference_id
  LOOP
    required := mat.quantity_per_unit * p_order_quantity;
    IF mat.current_stock < required THEN
      RAISE EXCEPTION 'Estoque insuficiente para "%": disponível %, necessário %', 
        mat.name, mat.current_stock, required;
    END IF;
  END LOOP;

  -- Debit and log movements
  FOR mat IN
    SELECT rm.product_id, rm.quantity_per_unit, p.quantity AS current_stock
    FROM public.reference_materials rm
    JOIN public.products p ON p.id = rm.product_id
    WHERE rm.reference_id = p_reference_id
  LOOP
    required := mat.quantity_per_unit * p_order_quantity;
    current_qty := mat.current_stock;

    -- Update stock
    UPDATE public.products
    SET quantity = quantity - required, updated_at = now()
    WHERE id = mat.product_id;

    -- Log movement
    INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description)
    VALUES (mat.product_id, 'out', required, current_qty, current_qty - required, 
            'Débito automático - Pedido');
  END LOOP;
END;
$$;

-- Function to check stock availability without debiting
CREATE OR REPLACE FUNCTION public.check_stock_availability(p_reference_id uuid, p_order_quantity integer)
RETURNS TABLE(product_id uuid, product_name text, required numeric, available numeric, sufficient boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    rm.product_id,
    p.name,
    (rm.quantity_per_unit * p_order_quantity)::numeric AS required,
    p.quantity AS available,
    (p.quantity >= rm.quantity_per_unit * p_order_quantity) AS sufficient
  FROM public.reference_materials rm
  JOIN public.products p ON p.id = rm.product_id
  WHERE rm.reference_id = p_reference_id;
END;
$$;
