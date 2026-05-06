-- Recreate views with security_invoker so they respect caller's RLS
ALTER VIEW public.v_sector_board SET (security_invoker = true);
ALTER VIEW public.v_wave_detail SET (security_invoker = true);

-- Tighten RLS policies: replace permissive USING (true) with authenticated-user check
DROP POLICY IF EXISTS auth_all_waves ON public.production_waves;
DROP POLICY IF EXISTS auth_all_wave_items ON public.production_wave_items;
DROP POLICY IF EXISTS auth_all_wave_src ON public.production_wave_item_sources;
DROP POLICY IF EXISTS auth_all_wave_stages ON public.production_wave_stages;
DROP POLICY IF EXISTS auth_all_wave_pkgs ON public.production_finishing_packages;

-- production_waves
CREATE POLICY waves_select ON public.production_waves FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY waves_insert ON public.production_waves FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY waves_update ON public.production_waves FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY waves_delete ON public.production_waves FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- production_wave_items
CREATE POLICY wave_items_select ON public.production_wave_items FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY wave_items_insert ON public.production_wave_items FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY wave_items_update ON public.production_wave_items FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY wave_items_delete ON public.production_wave_items FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- production_wave_item_sources
CREATE POLICY wave_src_select ON public.production_wave_item_sources FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY wave_src_insert ON public.production_wave_item_sources FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY wave_src_update ON public.production_wave_item_sources FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY wave_src_delete ON public.production_wave_item_sources FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- production_wave_stages
CREATE POLICY wave_stages_select ON public.production_wave_stages FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY wave_stages_insert ON public.production_wave_stages FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY wave_stages_update ON public.production_wave_stages FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY wave_stages_delete ON public.production_wave_stages FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- production_finishing_packages
CREATE POLICY wave_pkgs_select ON public.production_finishing_packages FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY wave_pkgs_insert ON public.production_finishing_packages FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY wave_pkgs_update ON public.production_finishing_packages FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY wave_pkgs_delete ON public.production_finishing_packages FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);