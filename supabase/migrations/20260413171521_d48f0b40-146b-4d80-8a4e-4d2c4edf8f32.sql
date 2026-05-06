ALTER TABLE public.product_groups
  ADD COLUMN box_type_master_id uuid REFERENCES public.box_types(id) ON DELETE SET NULL,
  ADD COLUMN box_type_colmeia_id uuid REFERENCES public.box_types(id) ON DELETE SET NULL;