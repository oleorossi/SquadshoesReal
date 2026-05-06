ALTER TABLE public.products 
  ADD COLUMN IF NOT EXISTS dimensions_length numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dimensions_width numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dimensions_thickness numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dimensions_unit text DEFAULT 'mm';