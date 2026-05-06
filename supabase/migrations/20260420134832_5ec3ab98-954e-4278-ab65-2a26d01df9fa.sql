DROP POLICY IF EXISTS "Allow all access to material_reservations" ON public.material_reservations;
DROP POLICY IF EXISTS "Auth users can view material_reservations" ON public.material_reservations;

DROP POLICY IF EXISTS "Approved users can view material_reservations" ON public.material_reservations;
CREATE POLICY "Approved users can view material_reservations"
  ON public.material_reservations
  FOR SELECT
  TO authenticated
  USING (is_approved_user());