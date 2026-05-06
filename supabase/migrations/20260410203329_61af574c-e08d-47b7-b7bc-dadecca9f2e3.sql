-- Add box_type_id to product_groups
ALTER TABLE public.product_groups 
ADD COLUMN box_type_id UUID REFERENCES public.box_types(id) ON DELETE SET NULL;

-- Update the view or any other dependent objects if necessary (not needed for now)
