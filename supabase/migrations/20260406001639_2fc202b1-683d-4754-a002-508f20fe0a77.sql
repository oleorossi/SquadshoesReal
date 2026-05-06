DROP POLICY "Authenticated users can manage catalog models" ON public.sheet_catalog_models;

CREATE POLICY "Approved users can manage catalog models"
  ON public.sheet_catalog_models
  FOR ALL
  TO authenticated
  USING (is_approved_user())
  WITH CHECK (is_approved_user());