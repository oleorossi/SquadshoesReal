
-- Fix certificates INSERT policy
DROP POLICY IF EXISTS "Auth users can upload certificates" ON storage.objects;
DROP POLICY IF EXISTS "Approved users can upload certificates" ON storage.objects;
CREATE POLICY "Approved users can upload certificates" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'certificates' AND public.is_approved_user());

-- Fix employee-receipts INSERT policy
DROP POLICY IF EXISTS "Auth users can upload receipts" ON storage.objects;
DROP POLICY IF EXISTS "Approved users can upload employee-receipts" ON storage.objects;
CREATE POLICY "Approved users can upload employee-receipts" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'employee-receipts' AND public.is_approved_user());

-- Fix employee-receipts DELETE policy
DROP POLICY IF EXISTS "Auth users can delete receipts" ON storage.objects;
DROP POLICY IF EXISTS "Approved users can delete employee-receipts" ON storage.objects;
CREATE POLICY "Approved users can delete employee-receipts" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'employee-receipts' AND public.is_approved_user());
