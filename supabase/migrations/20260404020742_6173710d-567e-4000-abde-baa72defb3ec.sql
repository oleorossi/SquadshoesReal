DROP POLICY IF EXISTS "Auth users can view employees" ON public.employees;
DROP POLICY IF EXISTS "Approved users can view employees" ON public.employees;
CREATE POLICY "Approved users can view employees" ON public.employees
FOR SELECT TO authenticated USING (public.is_approved_user());