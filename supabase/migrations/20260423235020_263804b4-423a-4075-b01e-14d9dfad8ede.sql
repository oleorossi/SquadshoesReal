-- Add sole_product_id to sole_silk_registrations
ALTER TABLE public.sole_silk_registrations 
ADD COLUMN IF NOT EXISTS sole_product_id UUID REFERENCES public.products(id) ON DELETE CASCADE;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_sole_silk_registrations_product_id ON public.sole_silk_registrations(sole_product_id);

-- Create storage bucket for silk images if it doesn't exist
INSERT INTO storage.buckets (id, name, public) 
VALUES ('silk-images', 'silk-images', true)
ON CONFLICT (id) DO NOTHING;

-- Enable RLS for the bucket
-- Note: storage.objects RLS is usually already enabled if other buckets exist, but we ensure it.

-- Policy for public read access to silk images
DROP POLICY IF EXISTS "Public Access to Silk Images" ON storage.objects;
CREATE POLICY "Public Access to Silk Images"
ON storage.objects FOR SELECT
USING (bucket_id = 'silk-images');

-- Policy for authenticated users to upload silk images
DROP POLICY IF EXISTS "Authenticated users can upload silk images" ON storage.objects;
CREATE POLICY "Authenticated users can upload silk images"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'silk-images' AND auth.role() = 'authenticated');

-- Policy for authenticated users to update silk images
DROP POLICY IF EXISTS "Authenticated users can update silk images" ON storage.objects;
CREATE POLICY "Authenticated users can update silk images"
ON storage.objects FOR UPDATE
USING (bucket_id = 'silk-images' AND auth.role() = 'authenticated');

-- Policy for authenticated users to delete silk images
DROP POLICY IF EXISTS "Authenticated users can delete silk images" ON storage.objects;
CREATE POLICY "Authenticated users can delete silk images"
ON storage.objects FOR DELETE
USING (bucket_id = 'silk-images' AND auth.role() = 'authenticated');
