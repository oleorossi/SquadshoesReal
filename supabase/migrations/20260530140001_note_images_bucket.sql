-- =============================================================================
-- STORAGE: bucket note-images — uploads de fotos em /notas (2026-05-30)
-- =============================================================================
-- Aplicada via MCP em ssvxfoybzmjlypnipqzn em 2026-05-30.
--
-- Permite que /notas aceite upload de imagens via 3 caminhos:
--   1. Botão "Imagem" na toolbar (file picker)
--   2. Drag-drop de arquivo direto no editor
--   3. Paste (Cmd+V) de imagem do clipboard
--
-- Resultado: insere ![alt](public_url) no markdown da nota. Preview
-- renderiza via tag <img> nativa (sem signed URLs — bucket é público).
--
-- Limite: 10 MB por imagem (file_size_limit). MIME whitelist restrita.
-- Path convention: notes/<noteId>/<timestamp>-<slug>.<ext>
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'note-images',
  'note-images',
  true,
  10485760,
  ARRAY['image/png','image/jpeg','image/jpg','image/webp','image/gif','image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "note_images_public_read" ON storage.objects;
CREATE POLICY "note_images_public_read"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'note-images');

DROP POLICY IF EXISTS "note_images_auth_insert" ON storage.objects;
CREATE POLICY "note_images_auth_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'note-images');

DROP POLICY IF EXISTS "note_images_auth_update" ON storage.objects;
CREATE POLICY "note_images_auth_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'note-images');

DROP POLICY IF EXISTS "note_images_auth_delete" ON storage.objects;
CREATE POLICY "note_images_auth_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'note-images');
