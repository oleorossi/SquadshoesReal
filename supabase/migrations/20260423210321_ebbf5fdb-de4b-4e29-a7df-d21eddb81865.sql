ALTER TABLE public.product_groups ADD COLUMN unit_weight_kg NUMERIC DEFAULT 0;
COMMENT ON COLUMN public.product_groups.unit_weight_kg IS 'Weight of a single unit (pair of outsoles, one upper, or one box) in kilograms.';
