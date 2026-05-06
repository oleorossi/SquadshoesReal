ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS yield_per_meter numeric DEFAULT NULL,
ADD COLUMN IF NOT EXISTS yield_unit text DEFAULT 'dm²';