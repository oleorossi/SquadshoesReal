
-- Add image_url to product_references
ALTER TABLE public.product_references ADD COLUMN IF NOT EXISTS image_url text DEFAULT '';

-- Create storage bucket for reference images
INSERT INTO storage.buckets (id, name, public) VALUES ('reference-images', 'reference-images', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload/view/delete reference images
DROP POLICY IF EXISTS "Auth users can upload reference images" ON storage.objects;
CREATE POLICY "Auth users can upload reference images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'reference-images');

DROP POLICY IF EXISTS "Auth users can view reference images" ON storage.objects;
CREATE POLICY "Auth users can view reference images"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'reference-images');

DROP POLICY IF EXISTS "Auth users can update reference images" ON storage.objects;
CREATE POLICY "Auth users can update reference images"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'reference-images');

DROP POLICY IF EXISTS "Auth users can delete reference images" ON storage.objects;
CREATE POLICY "Auth users can delete reference images"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'reference-images');

DROP POLICY IF EXISTS "Public can view reference images" ON storage.objects;
CREATE POLICY "Public can view reference images"
ON storage.objects FOR SELECT TO anon
USING (bucket_id = 'reference-images');
