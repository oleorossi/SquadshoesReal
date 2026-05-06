-- Fix product_groups: change all 4 policies from public to authenticated
DROP POLICY IF EXISTS "Auth users can view groups" ON public.product_groups;
DROP POLICY IF EXISTS "Auth users can insert groups" ON public.product_groups;
DROP POLICY IF EXISTS "Auth users can update groups" ON public.product_groups;
DROP POLICY IF EXISTS "Auth users can delete groups" ON public.product_groups;

DROP POLICY IF EXISTS "Auth users can view groups" ON public.product_groups;
CREATE POLICY "Auth users can view groups" ON public.product_groups
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Auth users can insert groups" ON public.product_groups;
CREATE POLICY "Auth users can insert groups" ON public.product_groups
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Auth users can update groups" ON public.product_groups;
CREATE POLICY "Auth users can update groups" ON public.product_groups
  FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "Auth users can delete groups" ON public.product_groups;
CREATE POLICY "Auth users can delete groups" ON public.product_groups
  FOR DELETE TO authenticated USING (true);

-- Fix profiles INSERT policy: restrict to service_role (used by handle_new_user trigger)
DROP POLICY IF EXISTS "System can insert profiles" ON public.profiles;

CREATE POLICY "System can insert profiles" ON public.profiles
  FOR INSERT TO service_role WITH CHECK (true)