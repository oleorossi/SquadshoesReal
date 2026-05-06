
ALTER TABLE public.contractors ADD COLUMN payment_days integer NOT NULL DEFAULT 15;

ALTER TABLE public.service_orders ADD COLUMN signed_photo_url text DEFAULT NULL;

INSERT INTO storage.buckets (id, name, public) VALUES ('service-orders', 'service-orders', true);

DROP POLICY IF EXISTS "Anyone can view service order photos" ON storage.objects;
CREATE POLICY "Anyone can view service order photos" ON storage.objects FOR SELECT USING (bucket_id = 'service-orders');
DROP POLICY IF EXISTS "Authenticated users can upload service order photos" ON storage.objects;
CREATE POLICY "Authenticated users can upload service order photos" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'service-orders');
DROP POLICY IF EXISTS "Authenticated users can update service order photos" ON storage.objects;
CREATE POLICY "Authenticated users can update service order photos" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'service-orders');
DROP POLICY IF EXISTS "Authenticated users can delete service order photos" ON storage.objects;
CREATE POLICY "Authenticated users can delete service order photos" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'service-orders');
