
-- Add commercial columns to technical_sheets
ALTER TABLE public.technical_sheets 
  ADD COLUMN IF NOT EXISTS collection text DEFAULT '',
  ADD COLUMN IF NOT EXISTS colors text DEFAULT '',
  ADD COLUMN IF NOT EXISTS cost_price numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sale_price numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS barcode text DEFAULT '',
  ADD COLUMN IF NOT EXISTS has_straps boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS strap_colors jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS image_url text DEFAULT '';

-- Update orders to reference technical_sheets instead of product_references
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_reference_id_fkey;
ALTER TABLE public.orders ADD CONSTRAINT orders_reference_id_fkey 
  FOREIGN KEY (reference_id) REFERENCES public.technical_sheets(id);

-- Update ready_stock to reference technical_sheets
ALTER TABLE public.ready_stock DROP CONSTRAINT IF EXISTS ready_stock_reference_id_fkey;
ALTER TABLE public.ready_stock ADD CONSTRAINT ready_stock_reference_id_fkey 
  FOREIGN KEY (reference_id) REFERENCES public.technical_sheets(id);

-- Update sale_order_items to reference technical_sheets
ALTER TABLE public.sale_order_items DROP CONSTRAINT IF EXISTS sale_order_items_reference_id_fkey;
ALTER TABLE public.sale_order_items ADD CONSTRAINT sale_order_items_reference_id_fkey 
  FOREIGN KEY (reference_id) REFERENCES public.technical_sheets(id);

-- Update reference_materials to reference technical_sheets
ALTER TABLE public.reference_materials DROP CONSTRAINT IF EXISTS reference_materials_reference_id_fkey;
ALTER TABLE public.reference_materials ADD CONSTRAINT reference_materials_reference_id_fkey 
  FOREIGN KEY (reference_id) REFERENCES public.technical_sheets(id);
