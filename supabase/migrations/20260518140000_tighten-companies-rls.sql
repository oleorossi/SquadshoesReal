-- =============================================================================
-- Tighten RLS on public.companies (multi-CNPJ fiscal data)
-- =============================================================================
-- Migration 20260428180000 created a single FOR ALL policy with USING(true)
-- and WITH CHECK(true), identical to the pattern fixed for
-- reference_material_variants in 20260507180000. Any authenticated user
-- (even unapproved) could read or mutate fiscal CNPJ data, certificates,
-- IE, and regime tributário. Replace with four role-restricted policies.
-- =============================================================================

-- Drop the permissive catch-all policy
DROP POLICY IF EXISTS "Auth users can manage companies" ON public.companies;

-- SELECT: only approved users
CREATE POLICY "Approved users can read companies"
  ON public.companies FOR SELECT
  TO authenticated
  USING (public.is_approved_user());

-- INSERT: only approved users
CREATE POLICY "Approved users can insert companies"
  ON public.companies FOR INSERT
  TO authenticated
  WITH CHECK (public.is_approved_user());

-- UPDATE: only approved users
CREATE POLICY "Approved users can update companies"
  ON public.companies FOR UPDATE
  TO authenticated
  USING (public.is_approved_user())
  WITH CHECK (public.is_approved_user());

-- DELETE: only approved users
CREATE POLICY "Approved users can delete companies"
  ON public.companies FOR DELETE
  TO authenticated
  USING (public.is_approved_user());
