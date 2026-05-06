
CREATE TABLE public.group_colors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID NOT NULL REFERENCES public.product_groups(id) ON DELETE CASCADE,
  color_id UUID NOT NULL REFERENCES public.colors(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(group_id, color_id)
);

ALTER TABLE public.group_colors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read group_colors" ON public.group_colors;
CREATE POLICY "Authenticated users can read group_colors"
  ON public.group_colors FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert group_colors" ON public.group_colors;
CREATE POLICY "Authenticated users can insert group_colors"
  ON public.group_colors FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can delete group_colors" ON public.group_colors;
CREATE POLICY "Authenticated users can delete group_colors"
  ON public.group_colors FOR DELETE
  TO authenticated
  USING (true);
