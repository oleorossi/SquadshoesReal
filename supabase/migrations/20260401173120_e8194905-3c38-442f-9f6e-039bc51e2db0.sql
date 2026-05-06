
CREATE TABLE public.technical_sheet_sole_colors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sheet_id UUID NOT NULL REFERENCES public.technical_sheets(id) ON DELETE CASCADE,
  product_color TEXT NOT NULL,
  sole_group_id UUID NOT NULL REFERENCES public.product_groups(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(sheet_id, product_color)
);

ALTER TABLE public.technical_sheet_sole_colors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to technical_sheet_sole_colors"
  ON public.technical_sheet_sole_colors
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow anon read on technical_sheet_sole_colors"
  ON public.technical_sheet_sole_colors
  FOR SELECT
  TO anon
  USING (true);
