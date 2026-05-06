-- Tighten resync_queue RLS so that only approved users can insert/update
-- queue entries. Previously the INSERT and UPDATE policies used
-- auth.uid() IS NOT NULL, meaning any authenticated but unapproved
-- account could enqueue resync operations that run as SECURITY DEFINER,
-- bypassing the approval check of the processor function.

DROP POLICY IF EXISTS resync_queue_insert ON public.resync_queue;
CREATE POLICY resync_queue_insert ON public.resync_queue
  FOR INSERT TO authenticated
  WITH CHECK (public.is_approved_user());

DROP POLICY IF EXISTS resync_queue_update ON public.resync_queue;
CREATE POLICY resync_queue_update ON public.resync_queue
  FOR UPDATE TO authenticated
  USING (public.is_approved_user())
  WITH CHECK (public.is_approved_user());
