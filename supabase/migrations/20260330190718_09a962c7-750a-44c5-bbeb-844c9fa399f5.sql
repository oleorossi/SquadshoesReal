
CREATE TABLE public.variant_group_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id UUID NOT NULL REFERENCES public.reference_color_variants(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.product_groups(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(variant_id, group_id)
);

ALTER TABLE public.variant_group_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage variant group images"
  ON public.variant_group_images
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
