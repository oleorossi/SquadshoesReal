
ALTER TABLE public.product_groups ADD COLUMN parent_group_id UUID REFERENCES public.product_groups(id) ON DELETE SET NULL DEFAULT NULL;

-- Set tira groups as children of Componentes
UPDATE public.product_groups 
SET parent_group_id = 'c0ce741a-6035-4d4e-9c30-35bcecc4e833'
WHERE name ILIKE '%tira%' AND id != 'c0ce741a-6035-4d4e-9c30-35bcecc4e833';
