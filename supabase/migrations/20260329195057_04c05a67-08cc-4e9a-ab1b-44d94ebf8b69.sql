
-- 1) PRINT_JOBS: Remove public access
DROP POLICY IF EXISTS "Public read print_jobs" ON public.print_jobs;
CREATE POLICY "Approved users can view print_jobs"
  ON public.print_jobs FOR SELECT TO authenticated
  USING (is_approved_user());

CREATE POLICY "Approved users can insert print_jobs"
  ON public.print_jobs FOR INSERT TO authenticated
  WITH CHECK (is_approved_user());

CREATE POLICY "Approved users can delete print_jobs"
  ON public.print_jobs FOR DELETE TO authenticated
  USING (is_approved_user());

-- 2) PRINT_JOB_ITEMS: Remove public access, add full CRUD
DROP POLICY IF EXISTS "Public read print_job_items" ON public.print_job_items;
CREATE POLICY "Approved users can view print_job_items"
  ON public.print_job_items FOR SELECT TO authenticated
  USING (is_approved_user());

CREATE POLICY "Approved users can insert print_job_items"
  ON public.print_job_items FOR INSERT TO authenticated
  WITH CHECK (is_approved_user());

CREATE POLICY "Approved users can update print_job_items"
  ON public.print_job_items FOR UPDATE TO authenticated
  USING (is_approved_user()) WITH CHECK (is_approved_user());

CREATE POLICY "Approved users can delete print_job_items"
  ON public.print_job_items FOR DELETE TO authenticated
  USING (is_approved_user());

-- 3) FINANCIAL_ENTRIES: Restrict SELECT to approved users
DROP POLICY IF EXISTS "Auth users can view financial_entries" ON public.financial_entries;
CREATE POLICY "Approved users can view financial_entries"
  ON public.financial_entries FOR SELECT TO authenticated
  USING (is_approved_user());

-- 4) COGS_ENTRIES: Restrict SELECT to approved users
DROP POLICY IF EXISTS "Auth users can view cogs_entries" ON public.cogs_entries;
CREATE POLICY "Approved users can view cogs_entries"
  ON public.cogs_entries FOR SELECT TO authenticated
  USING (is_approved_user());

-- 5) TIME_RECORDS: Restrict SELECT to approved users
DROP POLICY IF EXISTS "Auth users can view time_records" ON public.time_records;
CREATE POLICY "Approved users can view time_records"
  ON public.time_records FOR SELECT TO authenticated
  USING (is_approved_user());
