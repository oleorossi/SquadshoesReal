
-- =============================================
-- ORDENS DE PRODUÇÃO (expanded)
-- =============================================

-- Add new columns to orders table for full OP lifecycle
ALTER TABLE public.orders 
  ADD COLUMN IF NOT EXISTS order_number text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS color text DEFAULT '',
  ADD COLUMN IF NOT EXISTS grade jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS planned_start date,
  ADD COLUMN IF NOT EXISTS planned_delivery date,
  ADD COLUMN IF NOT EXISTS production_line text DEFAULT '',
  ADD COLUMN IF NOT EXISTS responsible text DEFAULT '',
  ADD COLUMN IF NOT EXISTS sale_order_id uuid DEFAULT NULL;

-- =============================================
-- PEDIDOS DE VENDA
-- =============================================
CREATE TABLE IF NOT EXISTS public.sale_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL DEFAULT '',
  client_name text NOT NULL DEFAULT '',
  client_cnpj text DEFAULT '',
  client_contact text DEFAULT '',
  representative text DEFAULT '',
  payment_condition text DEFAULT '',
  delivery_deadline date,
  notes text DEFAULT '',
  status text NOT NULL DEFAULT 'Pendente',
  total numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sale_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can view sale_orders" ON public.sale_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth users can insert sale_orders" ON public.sale_orders FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth users can update sale_orders" ON public.sale_orders FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth users can delete sale_orders" ON public.sale_orders FOR DELETE TO authenticated USING (true);

-- Sale order items
CREATE TABLE IF NOT EXISTS public.sale_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_order_id uuid NOT NULL REFERENCES public.sale_orders(id) ON DELETE CASCADE,
  reference_id uuid NOT NULL REFERENCES public.product_references(id),
  color text DEFAULT '',
  grade jsonb DEFAULT '{}',
  unit_price numeric NOT NULL DEFAULT 0,
  quantity integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sale_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can view sale_order_items" ON public.sale_order_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth users can insert sale_order_items" ON public.sale_order_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth users can update sale_order_items" ON public.sale_order_items FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth users can delete sale_order_items" ON public.sale_order_items FOR DELETE TO authenticated USING (true);

-- Add FK from orders to sale_orders
ALTER TABLE public.orders 
  ADD CONSTRAINT orders_sale_order_id_fkey 
  FOREIGN KEY (sale_order_id) REFERENCES public.sale_orders(id) ON DELETE SET NULL;

-- Auto-generate OP number
CREATE OR REPLACE FUNCTION public.generate_op_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.order_number = '' OR NEW.order_number IS NULL THEN
    NEW.order_number := 'OP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('op_number_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE SEQUENCE IF NOT EXISTS public.op_number_seq START 1;

CREATE TRIGGER set_op_number
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_op_number();

-- Auto-generate PV number  
CREATE OR REPLACE FUNCTION public.generate_pv_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.order_number = '' OR NEW.order_number IS NULL THEN
    NEW.order_number := 'PV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('pv_number_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE SEQUENCE IF NOT EXISTS public.pv_number_seq START 1;

CREATE TRIGGER set_pv_number
  BEFORE INSERT ON public.sale_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_pv_number();

-- Updated_at triggers
CREATE TRIGGER update_sale_orders_updated_at
  BEFORE UPDATE ON public.sale_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
