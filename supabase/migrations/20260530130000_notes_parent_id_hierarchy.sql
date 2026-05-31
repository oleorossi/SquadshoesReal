-- =============================================================================
-- NOTES: hierarquia de páginas (sub-notas) — 2026-05-30
-- =============================================================================
-- Aplicada via MCP em ssvxfoybzmjlypnipqzn em 2026-05-30.
--
-- Upgrade Notion-like em /notas: notas podem ser pais de outras notas.
-- UI reescrita em src/pages/Notes.tsx pra mostrar tree com expand/collapse
-- + drag-drop pra reorganizar hierarquia.
--
-- ON DELETE CASCADE: deletar pai derruba toda a subárvore. Confirm
-- explícito no frontend antes de chamar delete.
-- =============================================================================

ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.notes(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_notes_parent_id ON public.notes(parent_id);

COMMENT ON COLUMN public.notes.parent_id IS
  'Nota pai (hierarquia tipo Notion). NULL = nota root. ON DELETE CASCADE: deletar pai derruba todas as filhas.';
