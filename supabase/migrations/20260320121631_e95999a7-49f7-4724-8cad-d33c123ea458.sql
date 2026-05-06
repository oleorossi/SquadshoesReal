
ALTER TABLE public.technical_sheets ADD COLUMN IF NOT EXISTS sole_group_id uuid REFERENCES public.product_groups(id) ON DELETE SET NULL;
