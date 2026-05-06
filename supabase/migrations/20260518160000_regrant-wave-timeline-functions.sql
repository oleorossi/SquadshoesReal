-- =============================================================================
-- Re-grant EXECUTE on wave timeline functions
-- =============================================================================
-- Migrations 20260510130000, 20260510190000, 20260511120000, 20260513120000,
-- and 20260515120000 all recreate compute_wave_timeline / update_wave_timeline
-- / get_wave_material_needs via CREATE OR REPLACE FUNCTION without a subsequent
-- GRANT EXECUTE. CREATE OR REPLACE preserves existing ACLs in PG but any
-- DROP FUNCTION + re-create (or a Supabase schema reload that revokes PUBLIC)
-- would leave authenticated callers with "permission denied for function".
-- Re-issue the grants idempotently here.
-- =============================================================================

GRANT EXECUTE ON FUNCTION public.compute_wave_timeline(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_wave_timeline(uuid)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_wave_material_needs(uuid) TO authenticated;
