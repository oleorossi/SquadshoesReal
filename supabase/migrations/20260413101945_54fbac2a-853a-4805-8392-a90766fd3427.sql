-- 1. factoring_config: add SELECT policy for approved users
DROP POLICY IF EXISTS "Approved users can read factoring config" ON public.factoring_config;
CREATE POLICY "Approved users can read factoring config"
  ON public.factoring_config FOR SELECT
  TO authenticated
  USING (public.is_approved_user());

-- 2. notifications: drop the old permissive SELECT that exposes broadcast to all
DROP POLICY IF EXISTS "Users can view relevant notifications" ON public.notifications;

-- 3. finance-attachments storage: add UPDATE policy
DROP POLICY IF EXISTS "Approved users can update finance attachments" ON storage.objects;
CREATE POLICY "Approved users can update finance attachments"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'finance-attachments' AND public.is_approved_user());

-- 4. employee-receipts storage: add UPDATE policy
DROP POLICY IF EXISTS "Approved users can update employee receipts" ON storage.objects;
CREATE POLICY "Approved users can update employee receipts"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'employee-receipts' AND public.is_approved_user());