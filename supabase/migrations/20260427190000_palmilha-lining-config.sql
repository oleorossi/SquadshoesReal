-- Adds insole lining flag and palmilha color mapping to technical sheets.
-- insole_has_lining = true  → palmilha follows the same color as cabedal (default)
-- insole_has_lining = false → use technical_sheet_palmilha_colors to look up palmilha color per cabedal color

ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS insole_has_lining BOOLEAN DEFAULT TRUE;

-- Maps cabedal/product color → palmilha (insole) color for sheets without insole lining.
-- Example: "Preto" → "Preto", "Caramelo" → "Caramelo", "__DEFAULT__" → "Caramelo"
CREATE TABLE IF NOT EXISTS public.technical_sheet_palmilha_colors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id uuid NOT NULL REFERENCES public.technical_sheets(id) ON DELETE CASCADE,
  cabedal_color text NOT NULL,   -- product/shoe color (key)
  palmilha_color text NOT NULL,  -- insole color to use for that cabedal color
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(sheet_id, cabedal_color)
);

ALTER TABLE public.technical_sheet_palmilha_colors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_palmilha_colors"
  ON public.technical_sheet_palmilha_colors
  FOR ALL USING (true) WITH CHECK (true);
