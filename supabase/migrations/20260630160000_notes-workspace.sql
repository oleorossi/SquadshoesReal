-- =============================================================================
-- NOTAS (workspace tipo Notion) — pastas + páginas livres em markdown
-- =============================================================================
-- Caso de uso: salvar anotações por função (ex.: valores de mercadoria por
-- fornecedor) em páginas markdown com tabelas (GFM). Fica em Comercial > Notas.
-- Aplicado em produção via MCP.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.note_folders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  parent_id   uuid REFERENCES public.note_folders(id) ON DELETE CASCADE,
  position    integer NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id   uuid REFERENCES public.note_folders(id) ON DELETE SET NULL,
  title       text NOT NULL DEFAULT 'Sem título',
  content     text NOT NULL DEFAULT '',
  icon        text,
  pinned      boolean NOT NULL DEFAULT false,
  position    integer NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES auth.users(id),
  updated_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notes_folder ON public.notes (folder_id, position);
CREATE INDEX IF NOT EXISTS idx_notes_updated ON public.notes (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_note_folders_parent ON public.note_folders (parent_id, position);
CREATE INDEX IF NOT EXISTS idx_notes_search
  ON public.notes USING gin (to_tsvector('portuguese', title || ' ' || content));

DROP TRIGGER IF EXISTS trg_notes_updated_at ON public.notes;
CREATE TRIGGER trg_notes_updated_at BEFORE UPDATE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_note_folders_updated_at ON public.note_folders;
CREATE TRIGGER trg_note_folders_updated_at BEFORE UPDATE ON public.note_folders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.note_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth read note_folders" ON public.note_folders;
CREATE POLICY "auth read note_folders" ON public.note_folders FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "auth write note_folders" ON public.note_folders;
CREATE POLICY "auth write note_folders" ON public.note_folders FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "auth read notes" ON public.notes;
CREATE POLICY "auth read notes" ON public.notes FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "auth write notes" ON public.notes;
CREATE POLICY "auth write notes" ON public.notes FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
