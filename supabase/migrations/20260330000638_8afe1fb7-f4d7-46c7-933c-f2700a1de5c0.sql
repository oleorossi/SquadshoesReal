-- Make reference-images bucket public
UPDATE storage.buckets SET public = true WHERE id = 'reference-images';

-- Ensure policies allow public read
CREATE POLICY "Public Access" ON storage.objects FOR SELECT USING (bucket_id = 'reference-images');
