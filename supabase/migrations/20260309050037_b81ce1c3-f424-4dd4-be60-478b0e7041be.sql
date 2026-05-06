
ALTER TABLE public.clients ADD COLUMN logo_url text DEFAULT '' ;

INSERT INTO storage.buckets (id, name, public) VALUES ('client-logos', 'client-logos', true) ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Auth users can upload client logos" ON storage.objects;
CREATE POLICY "Auth users can upload client logos" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'client-logos');
DROP POLICY IF EXISTS "Auth users can update client logos" ON storage.objects;
CREATE POLICY "Auth users can update client logos" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'client-logos');
DROP POLICY IF EXISTS "Auth users can delete client logos" ON storage.objects;
CREATE POLICY "Auth users can delete client logos" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'client-logos');
DROP POLICY IF EXISTS "Anyone can view client logos" ON storage.objects;
CREATE POLICY "Anyone can view client logos" ON storage.objects FOR SELECT TO public USING (bucket_id = 'client-logos');
