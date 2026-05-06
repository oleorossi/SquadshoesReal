-- Add new columns to products table
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS brand TEXT,
ADD COLUMN IF NOT EXISTS model TEXT,
ADD COLUMN IF NOT EXISTS price_wholesale DECIMAL(12,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS price_retail DECIMAL(12,2) DEFAULT 0;

-- Add new columns to product_variants table
ALTER TABLE public.product_variants 
ADD COLUMN IF NOT EXISTS size_eu TEXT,
ADD COLUMN IF NOT EXISTS size_us TEXT,
ADD COLUMN IF NOT EXISTS size_uk TEXT;