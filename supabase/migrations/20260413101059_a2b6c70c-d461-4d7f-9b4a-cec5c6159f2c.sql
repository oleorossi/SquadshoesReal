
-- 1. Fix service-orders storage: require is_approved_user() for write ops
DROP POLICY IF EXISTS "Authenticated users can upload service order photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update service order photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete service order photos" ON storage.objects;

DROP POLICY IF EXISTS "Approved users can upload service order photos" ON storage.objects;
CREATE POLICY "Approved users can upload service order photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'service-orders' AND public.is_approved_user());

DROP POLICY IF EXISTS "Approved users can update service order photos" ON storage.objects;
CREATE POLICY "Approved users can update service order photos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'service-orders' AND public.is_approved_user());

DROP POLICY IF EXISTS "Approved users can delete service order photos" ON storage.objects;
CREATE POLICY "Approved users can delete service order photos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'service-orders' AND public.is_approved_user());

-- 2. Fix finance-attachments storage: require is_approved_user() for write ops
DROP POLICY IF EXISTS "Authenticated users can upload finance attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete finance attachments" ON storage.objects;

DROP POLICY IF EXISTS "Approved users can upload finance attachments" ON storage.objects;
CREATE POLICY "Approved users can upload finance attachments"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'finance-attachments' AND public.is_approved_user());

DROP POLICY IF EXISTS "Approved users can delete finance attachments" ON storage.objects;
CREATE POLICY "Approved users can delete finance attachments"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'finance-attachments' AND public.is_approved_user());

-- 3. Fix notifications: restrict broadcast (user_id IS NULL) to approved users
DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;

DROP POLICY IF EXISTS "Users can view own or broadcast notifications" ON public.notifications;
CREATE POLICY "Users can view own or broadcast notifications"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (user_id IS NULL AND public.is_approved_user())
  );
