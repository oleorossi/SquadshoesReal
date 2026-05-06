
DROP POLICY IF EXISTS "Allow anon read on technical_sheet_sole_colors" ON public.technical_sheet_sole_colors;

DROP POLICY IF EXISTS "Approved users can view technical_sheet_sole_colors" ON public.technical_sheet_sole_colors;
CREATE POLICY "Approved users can view technical_sheet_sole_colors"
  ON public.technical_sheet_sole_colors
  FOR SELECT
  TO authenticated
  USING (is_approved_user());
