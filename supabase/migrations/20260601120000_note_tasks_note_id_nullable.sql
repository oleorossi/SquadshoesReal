-- =============================================================================
-- NOTE_TASKS: note_id nullable — permite tarefas standalone (2026-06-01)
-- =============================================================================
-- Aplicada via MCP em ssvxfoybzmjlypnipqzn em 2026-06-01.
--
-- Tarefas viram módulo standalone em /tarefas (rota separada na sidebar).
-- Antes: cada task pertencia obrigatoriamente a uma nota (note_id NOT NULL).
-- Agora: nullable — pode ser standalone (sem nota) OU manter vínculo.
-- =============================================================================

ALTER TABLE public.note_tasks
  ALTER COLUMN note_id DROP NOT NULL;

COMMENT ON COLUMN public.note_tasks.note_id IS
  'FK opcional pra notes — quando preenchido, task aparece dentro da nota. NULL = task standalone (criada via /tarefas).';
