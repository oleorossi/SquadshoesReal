
-- Add industrial conversion and purchase fields to products
ALTER TABLE public.products 
  ADD COLUMN IF NOT EXISTS purchase_unit text DEFAULT 'un',
  ADD COLUMN IF NOT EXISTS production_unit text DEFAULT 'un',
  ADD COLUMN IF NOT EXISTS conversion_rate numeric DEFAULT 1,
  ADD COLUMN IF NOT EXISTS purchase_order_unit text DEFAULT 'un',
  ADD COLUMN IF NOT EXISTS min_order_quantity numeric DEFAULT 1;

-- Add freight/shipping fields to group_suppliers
ALTER TABLE public.group_suppliers
  ADD COLUMN IF NOT EXISTS min_free_shipping numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS standard_shipping_cost numeric DEFAULT NULL;
