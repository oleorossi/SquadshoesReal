-- =============================================================================
-- Audit-2 Batch C: tighten RLS on reference_material_variants
-- =============================================================================

DROP POLICY IF EXISTS "authenticated_rw_ref_mat_variants"
  ON public.reference_material_variants;

DROP POLICY IF EXISTS "approved_select_ref_mat_variants" ON public.reference_material_variants;
CREATE POLICY "approved_select_ref_mat_variants"
  ON public.reference_material_variants
  FOR SELECT TO authenticated
  USING (public.is_approved_user());

DROP POLICY IF EXISTS "approved_insert_ref_mat_variants" ON public.reference_material_variants;
CREATE POLICY "approved_insert_ref_mat_variants"
  ON public.reference_material_variants
  FOR INSERT TO authenticated
  WITH CHECK (public.is_approved_user());

DROP POLICY IF EXISTS "approved_update_ref_mat_variants" ON public.reference_material_variants;
CREATE POLICY "approved_update_ref_mat_variants"
  ON public.reference_material_variants
  FOR UPDATE TO authenticated
  USING (public.is_approved_user())
  WITH CHECK (public.is_approved_user());

DROP POLICY IF EXISTS "approved_delete_ref_mat_variants" ON public.reference_material_variants;
CREATE POLICY "approved_delete_ref_mat_variants"
  ON public.reference_material_variants
  FOR DELETE TO authenticated
  USING (public.is_approved_user());