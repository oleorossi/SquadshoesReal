ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS insole_has_lining BOOLEAN DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS public.technical_sheet_palmilha_colors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id uuid NOT NULL REFERENCES public.technical_sheets(id) ON DELETE CASCADE,
  cabedal_color text NOT NULL,
  palmilha_color text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(sheet_id, cabedal_color)
);

ALTER TABLE public.technical_sheet_palmilha_colors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_palmilha_colors" ON public.technical_sheet_palmilha_colors;
CREATE POLICY "allow_all_palmilha_colors"
  ON public.technical_sheet_palmilha_colors
  FOR ALL USING (true) WITH CHECK (true);