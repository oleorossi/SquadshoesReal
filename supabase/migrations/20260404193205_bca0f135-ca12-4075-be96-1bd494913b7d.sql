
-- Fix storage: restrict certificate deletion to approved users
DROP POLICY IF EXISTS "Auth users can delete certificates" ON storage.objects;
DROP POLICY IF EXISTS "Approved users can delete certificates" ON storage.objects;
CREATE POLICY "Approved users can delete certificates" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'certificates' AND public.is_approved_user());
