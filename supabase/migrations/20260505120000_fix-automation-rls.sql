-- Replace open USING(true) RLS policies on automation tables with role-restricted ones.
-- Any approved user could previously create/modify/delete workflow definitions and
-- fake execution history via direct PostgREST API calls.

DROP POLICY IF EXISTS "auto_workflows_all"  ON public.automation_workflows;
DROP POLICY IF EXISTS "auto_executions_all" ON public.automation_executions;

CREATE POLICY "auto_workflows_admin"
  ON public.automation_workflows
  FOR ALL
  USING  (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));

CREATE POLICY "auto_executions_admin"
  ON public.automation_executions
  FOR ALL
  USING  (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));
