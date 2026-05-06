ALTER TABLE public.product_groups
  ADD COLUMN IF NOT EXISTS dimensions_length numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dimensions_width numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dimensions_thickness numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dimensions_unit text DEFAULT 'mm',
  ADD COLUMN IF NOT EXISTS package_weight_kg numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS package_price numeric DEFAULT 0;