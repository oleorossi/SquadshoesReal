-- =============================================================================
-- NOTE_TASKS: tarefas estruturadas por nota com prioridade (2026-05-31)
-- =============================================================================
-- Aplicada via MCP em ssvxfoybzmjlypnipqzn em 2026-05-31.
--
-- Cada nota em /notas pode ter N tarefas estruturadas (texto + prioridade
-- alta/média/baixa + done). Lista auto-ordenada no client por prioridade.
--
-- Schema:
--   - note_id FK → notes (ON DELETE CASCADE) — apagar nota apaga tarefas
--   - text obrigatório (CHECK length > 0)
--   - priority text CHECK IN ('alta','media','baixa') default 'media'
--   - done boolean default false
--   - completed_at timestamptz (auto-preenchido pelo trigger ao virar done)
--
-- Trigger tg_note_tasks_touch:
--   - Atualiza updated_at em qualquer mudança
--   - Quando done vira true → set completed_at = now()
--   - Quando done vira false → set completed_at = NULL
--
-- RLS: authenticated lê/escreve qualquer task (igual ao pattern de notes).
--
-- Frontend (commit relacionado):
--   - hook useNoteTasks (list/create/update/delete + sort client-side)
--   - 4º modo 'Tarefas' no toggle Edit/Split/Preview/Tasks em /notas
--   - NoteTasksPanel: input pra adicionar + select prioridade + lista
--     auto-ordenada (não-feitas por prioridade, feitas no fim)
--   - TaskRow: checkbox + dot prioridade + texto editável inline +
--     select prioridade + botão excluir (hover)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.note_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  text text NOT NULL CHECK (length(trim(text)) > 0),
  priority text NOT NULL DEFAULT 'media' CHECK (priority IN ('alta','media','baixa')),
  done boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_note_tasks_note_id ON public.note_tasks(note_id);
CREATE INDEX IF NOT EXISTS idx_note_tasks_priority ON public.note_tasks(priority);

CREATE OR REPLACE FUNCTION public.tg_note_tasks_touch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.done = true AND (OLD IS NULL OR OLD.done = false) THEN
    NEW.completed_at := now();
  ELSIF NEW.done = false AND OLD IS NOT NULL AND OLD.done = true THEN
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_note_tasks_touch ON public.note_tasks;
CREATE TRIGGER tg_note_tasks_touch
  BEFORE INSERT OR UPDATE ON public.note_tasks
  FOR EACH ROW EXECUTE FUNCTION public.tg_note_tasks_touch();

ALTER TABLE public.note_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "note_tasks_authenticated_all" ON public.note_tasks;
CREATE POLICY "note_tasks_authenticated_all"
  ON public.note_tasks FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.note_tasks TO authenticated;
