-- Add calculation_method to products table
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS calculation_method TEXT DEFAULT 'weight';
COMMENT ON COLUMN public.products.calculation_method IS 'Determines if the unit price is calculated by weight or by area (meter)';
