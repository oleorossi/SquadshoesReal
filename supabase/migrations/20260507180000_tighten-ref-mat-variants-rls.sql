-- =============================================================================
-- Audit-2 Batch C: tighten RLS on reference_material_variants
-- =============================================================================
--
-- Audit Agent1 #5 / #12 (high): the RLS policy created in
-- 20260507130000_reference-material-variants.sql was
--   FOR ALL TO authenticated USING (true) WITH CHECK (true)
-- which lets ANY authenticated user (even unapproved ones, e.g. someone
-- whose account was created but not yet approved by an admin) view, insert,
-- update, and delete material variants — including changing fiscal SKU/NCM
-- codes used on NF-e. Replace with the standard approved-user check used by
-- the rest of the codebase.
-- =============================================================================

DROP POLICY IF EXISTS "authenticated_rw_ref_mat_variants"
  ON public.reference_material_variants;

CREATE POLICY "approved_select_ref_mat_variants"
  ON public.reference_material_variants
  FOR SELECT TO authenticated
  USING (public.is_approved_user());

CREATE POLICY "approved_insert_ref_mat_variants"
  ON public.reference_material_variants
  FOR INSERT TO authenticated
  WITH CHECK (public.is_approved_user());

CREATE POLICY "approved_update_ref_mat_variants"
  ON public.reference_material_variants
  FOR UPDATE TO authenticated
  USING (public.is_approved_user())
  WITH CHECK (public.is_approved_user());

CREATE POLICY "approved_delete_ref_mat_variants"
  ON public.reference_material_variants
  FOR DELETE TO authenticated
  USING (public.is_approved_user());
