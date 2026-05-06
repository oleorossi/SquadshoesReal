
-- Fix packaging_configs: drop existing policies first then recreate

DROP POLICY IF EXISTS "Approved users can update packaging_configs" ON public.packaging_configs;
DROP POLICY IF EXISTS "Approved users can delete packaging_configs" ON public.packaging_configs;
DROP POLICY IF EXISTS "Approved users can insert packaging_configs" ON public.packaging_configs;
DROP POLICY IF EXISTS "Auth users can view packaging_configs" ON public.packaging_configs;

CREATE POLICY "Auth users can view packaging_configs" ON public.packaging_configs
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Approved users can insert packaging_configs" ON public.packaging_configs;
CREATE POLICY "Approved users can insert packaging_configs" ON public.packaging_configs
  FOR INSERT TO authenticated WITH CHECK (is_approved_user());
DROP POLICY IF EXISTS "Approved users can update packaging_configs" ON public.packaging_configs;
CREATE POLICY "Approved users can update packaging_configs" ON public.packaging_configs
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());
DROP POLICY IF EXISTS "Approved users can delete packaging_configs" ON public.packaging_configs;
CREATE POLICY "Approved users can delete packaging_configs" ON public.packaging_configs
  FOR DELETE TO authenticated USING (is_approved_user());

-- reservation_batches: same cleanup
DROP POLICY IF EXISTS "Approved users can update reservation_batches" ON public.reservation_batches;
DROP POLICY IF EXISTS "Approved users can delete reservation_batches" ON public.reservation_batches;
DROP POLICY IF EXISTS "Approved users can insert reservation_batches" ON public.reservation_batches;
DROP POLICY IF EXISTS "Auth users can view reservation_batches" ON public.reservation_batches;

CREATE POLICY "Auth users can view reservation_batches" ON public.reservation_batches
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Approved users can insert reservation_batches" ON public.reservation_batches;
CREATE POLICY "Approved users can insert reservation_batches" ON public.reservation_batches
  FOR INSERT TO authenticated WITH CHECK (is_approved_user());
DROP POLICY IF EXISTS "Approved users can update reservation_batches" ON public.reservation_batches;
CREATE POLICY "Approved users can update reservation_batches" ON public.reservation_batches
  FOR UPDATE TO authenticated USING (is_approved_user()) WITH CHECK (is_approved_user());
DROP POLICY IF EXISTS "Approved users can delete reservation_batches" ON public.reservation_batches;
CREATE POLICY "Approved users can delete reservation_batches" ON public.reservation_batches
  FOR DELETE TO authenticated USING (is_approved_user());
