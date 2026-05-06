
-- Add new columns to products table
ALTER TABLE public.products 
  ADD COLUMN IF NOT EXISTS max_stock numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS image_url text DEFAULT '';

-- Add new columns to product_references table
ALTER TABLE public.product_references 
  ADD COLUMN IF NOT EXISTS code text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS collection text DEFAULT '',
  ADD COLUMN IF NOT EXISTS shoe_category text DEFAULT '',
  ADD COLUMN IF NOT EXISTS sizes text DEFAULT '33-41',
  ADD COLUMN IF NOT EXISTS colors text DEFAULT '',
  ADD COLUMN IF NOT EXISTS cost_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sale_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Ativo';
