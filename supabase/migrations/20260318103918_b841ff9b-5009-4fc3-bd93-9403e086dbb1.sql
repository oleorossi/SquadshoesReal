
-- Remover políticas de SELECT públicas e garantir que todas exijam autenticação
DROP POLICY IF EXISTS "Public can view avatars" ON storage.objects;
DROP POLICY IF EXISTS "Public can view reference images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view client logos" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view receipts" ON storage.objects;

-- Criar políticas de SELECT para usuários autenticados onde faltam
CREATE POLICY "Auth users can view avatars" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'avatars');
CREATE POLICY "Auth users can view client logos" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'client-logos');
CREATE POLICY "Auth users can view receipts" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'employee-receipts');
