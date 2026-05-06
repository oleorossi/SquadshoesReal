-- Add box_type_id to products
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS box_type_id UUID REFERENCES public.box_types(id);

-- Add index
CREATE INDEX IF NOT EXISTS idx_products_box_type_id ON public.products(box_type_id);

-- Populate existing products with their group's box_type_id if they don't have one
UPDATE public.products
SET box_type_id = product_groups.box_type_id
FROM public.product_groups
WHERE products.group_id = product_groups.id
AND products.box_type_id IS NULL;
