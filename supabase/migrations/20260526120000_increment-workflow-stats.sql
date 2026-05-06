-- =============================================================================
-- Atomic workflow stats increment
-- =============================================================================
-- Audit-40 finding [5]: useRunWorkflow reads workflow.execution_count from
-- the React Query cache then does UPDATE SET execution_count = cached + 1.
-- Concurrent triggers both read the same stale value and one increment is lost.
-- Fix: atomic SQL increment inside a SECURITY INVOKER function so the DB
-- computes the delta against the locked row, not the stale cached value.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.increment_workflow_stats(
  p_id      uuid,
  p_success boolean DEFAULT true
)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
AS $$
  UPDATE public.automation_workflows
  SET execution_count = execution_count + 1,
      success_count   = success_count + (CASE WHEN p_success THEN 1 ELSE 0 END),
      last_run_at     = now()
  WHERE id = p_id;
$$;

COMMENT ON FUNCTION public.increment_workflow_stats IS
  'Atomically increments execution_count and (optionally) success_count on '
  'automation_workflows. Replaces read-then-write pattern that loses concurrent increments.';
