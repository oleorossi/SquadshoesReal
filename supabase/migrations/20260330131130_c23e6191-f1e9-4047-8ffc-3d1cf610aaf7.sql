-- Add calculation_method to product_groups
ALTER TABLE public.product_groups ADD COLUMN IF NOT EXISTS calculation_method TEXT DEFAULT 'weight';
COMMENT ON COLUMN public.product_groups.calculation_method IS 'Determines if the unit price is calculated by weight or by area (meter)';
