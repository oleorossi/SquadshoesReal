-- =============================================================================
-- Fix profiles RLS to prevent self-approval privilege escalation
-- =============================================================================
-- Audit-38 finding [1]: The "Users can update own profile" RLS policy only
-- checks id = auth.uid() with no column-level restriction. A pending
-- (approved=false) user can PATCH /rest/v1/profiles?id=eq.<own-uid> with
-- body {"approved":true} and grant themselves access, bypassing the entire
-- is_approved_user() gate used on all other tables.
--
-- Fix: add WITH CHECK that locks the `approved` and `role`-adjacent columns
-- to their current DB values (user can only update non-privileged fields like
-- display_name, avatar_url, etc., but cannot flip their own approved flag).
-- The admin-only useApproveUser flow calls the DB as service-role which
-- bypasses RLS, so this does not break the approval workflow.
-- =============================================================================

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

DROP POLICY IF EXISTS "Users can update own non-privileged profile fields" ON public.profiles;
CREATE POLICY "Users can update own non-privileged profile fields"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING  (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    -- Prevent self-approval: approved must not change via this policy.
    -- Approved changes go through service-role (useApproveUser bypasses RLS).
    AND approved = (SELECT approved FROM public.profiles WHERE id = auth.uid())
  );

COMMENT ON POLICY "Users can update own non-privileged profile fields" ON public.profiles IS
  'Authenticated users may update their own profile row, but cannot flip the '
  'approved column. Self-approval privilege escalation is blocked by the WITH '
  'CHECK predicate; admin approval goes through service-role (bypasses RLS).';
