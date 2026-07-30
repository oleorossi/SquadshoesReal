-- =============================================================================
-- NOTE_TASKS: funcionalidades Notion/Todoist no módulo /tarefas (2026-07-03)
-- =============================================================================
-- Estende a tabela note_tasks com os campos que faltavam pra experiência
-- Notion + todolist:
--
--   - description    text  — corpo markdown da tarefa (página estilo Notion)
--   - due_date       date  — vencimento (visões Hoje/Atrasadas/Próximas)
--   - tags           text[] — etiquetas livres pra filtro/organização
--   - parent_task_id uuid  — subtarefas (checklist dentro da tarefa;
--                            ON DELETE CASCADE: apagar pai apaga filhas)
--   - status         text  — coluna do quadro Kanban ('todo'|'doing'|'done'),
--                            sincronizada nos DOIS sentidos com o boolean
--                            `done` legado pelo trigger tg_note_tasks_touch
--                            (frontend antigo que só mexe em done continua
--                            funcionando; quadro novo mexe só em status).
--
-- Backfill: tarefas já concluídas (done=true) viram status='done'.
-- =============================================================================

ALTER TABLE public.note_tasks
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS parent_task_id uuid REFERENCES public.note_tasks(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'todo';

-- CHECK de status separado pra ficar idempotente com o ADD COLUMN IF NOT EXISTS
DO $$ BEGIN
  ALTER TABLE public.note_tasks
    ADD CONSTRAINT note_tasks_status_check CHECK (status IN ('todo','doing','done'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Backfill: concluídas legadas entram na coluna "done" do quadro
UPDATE public.note_tasks SET status = 'done' WHERE done = true AND status <> 'done';

CREATE INDEX IF NOT EXISTS idx_note_tasks_due_date
  ON public.note_tasks(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_note_tasks_parent
  ON public.note_tasks(parent_task_id) WHERE parent_task_id IS NOT NULL;

-- Trigger touch v2: além de updated_at/completed_at, mantém done <-> status
-- coerentes qualquer que seja o lado que o client atualizou.
CREATE OR REPLACE FUNCTION public.tg_note_tasks_touch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      -- Quadro moveu a carta → done segue o status
      NEW.done := (NEW.status = 'done');
    ELSIF NEW.done IS DISTINCT FROM OLD.done THEN
      -- Checkbox legado → status segue o done
      IF NEW.done THEN
        NEW.status := 'done';
      ELSIF OLD.status = 'done' THEN
        NEW.status := 'todo';
      END IF;
    END IF;
  ELSE
    -- INSERT: qualquer um dos dois marcado como concluído ganha
    IF NEW.status = 'done' THEN
      NEW.done := true;
    ELSIF NEW.done THEN
      NEW.status := 'done';
    END IF;
  END IF;

  NEW.updated_at := now();
  IF NEW.done = true AND (TG_OP = 'INSERT' OR OLD.done = false) THEN
    NEW.completed_at := now();
  ELSIF NEW.done = false AND TG_OP = 'UPDATE' AND OLD.done = true THEN
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_note_tasks_touch ON public.note_tasks;
CREATE TRIGGER tg_note_tasks_touch
  BEFORE INSERT OR UPDATE ON public.note_tasks
  FOR EACH ROW EXECUTE FUNCTION public.tg_note_tasks_touch();

COMMENT ON COLUMN public.note_tasks.description IS
  'Corpo markdown da tarefa (detalhe estilo página do Notion).';
COMMENT ON COLUMN public.note_tasks.due_date IS
  'Data de vencimento — alimenta as visões Hoje/Atrasadas/Próximas em /tarefas.';
COMMENT ON COLUMN public.note_tasks.tags IS
  'Etiquetas livres (lowercase por convenção do frontend) pra filtro.';
COMMENT ON COLUMN public.note_tasks.parent_task_id IS
  'FK self-referente — subtarefa quando preenchido. Subtarefas têm note_id NULL e só aparecem dentro do detalhe do pai.';
COMMENT ON COLUMN public.note_tasks.status IS
  'Coluna do Kanban (todo/doing/done). Sincronizado com done pelo trigger tg_note_tasks_touch.';
