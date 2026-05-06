-- Add new columns to the products table
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS linked_last_id UUID REFERENCES public.products(id),
ADD COLUMN IF NOT EXISTS sole_material TEXT,
ADD COLUMN IF NOT EXISTS heel_height NUMERIC;

-- Add a comment to the columns for better documentation
COMMENT ON COLUMN public.products.linked_last_id IS 'Links the product (e.g., a sole) to a "Last" (Fôrma)';
COMMENT ON COLUMN public.products.sole_material IS 'The material of the sole (e.g., TR, PVC, Leather)';
COMMENT ON COLUMN public.products.heel_height IS 'The height of the heel in numeric value';