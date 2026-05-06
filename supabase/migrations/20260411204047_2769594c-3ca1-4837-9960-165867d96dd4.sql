
-- Make bucket private
UPDATE storage.buckets SET public = false WHERE id = 'service-orders';

-- Drop the old public SELECT policy
DROP POLICY IF EXISTS "Anyone can view service order photos" ON storage.objects;

-- Add authenticated-only SELECT policy
CREATE POLICY "Approved users can view service order photos"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'service-orders' AND public.is_approved_user());
