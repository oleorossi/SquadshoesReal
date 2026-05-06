
-- Table: product references (e.g. a shoe model, a furniture piece)
CREATE TABLE public.product_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.product_references ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can view references" ON public.product_references FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth users can insert references" ON public.product_references FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth users can update references" ON public.product_references FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth users can delete references" ON public.product_references FOR DELETE TO authenticated USING (true);

-- Trigger for updated_at
CREATE TRIGGER update_product_references_updated_at
  BEFORE UPDATE ON public.product_references
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Table: bill of materials - links a reference to inventory products with quantities
CREATE TABLE public.reference_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_id uuid NOT NULL REFERENCES public.product_references(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity_per_unit numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reference_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can view ref materials" ON public.reference_materials FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth users can insert ref materials" ON public.reference_materials FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth users can update ref materials" ON public.reference_materials FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth users can delete ref materials" ON public.reference_materials FOR DELETE TO authenticated USING (true);

-- Table: production orders
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_id uuid NOT NULL REFERENCES public.product_references(id) ON DELETE RESTRICT,
  quantity integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending',
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can view orders" ON public.orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth users can insert orders" ON public.orders FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth users can update orders" ON public.orders FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth users can delete orders" ON public.orders FOR DELETE TO authenticated USING (true);

CREATE TRIGGER update_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Function to debit stock when an order is placed
CREATE OR REPLACE FUNCTION public.debit_stock_for_order(p_reference_id uuid, p_order_quantity integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.products p
  SET quantity = p.quantity - (rm.quantity_per_unit * p_order_quantity),
      updated_at = now()
  FROM public.reference_materials rm
  WHERE rm.reference_id = p_reference_id
    AND rm.product_id = p.id;
END;
$$;
