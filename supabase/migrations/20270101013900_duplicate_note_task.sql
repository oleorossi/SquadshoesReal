-- Duplica uma tarefa pessoal e suas subtarefas em uma única transação.
-- A função é SECURITY INVOKER de propósito: o SELECT da origem e os INSERTs
-- continuam submetidos às RLS de note_tasks. O trigger de ownership grava o
-- usuário autenticado como dono da cópia, inclusive quando um admin duplica
-- uma tarefa de outra pessoa.

CREATE OR REPLACE FUNCTION public.duplicate_note_task(p_task_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_new_task_id uuid := gen_random_uuid();
BEGIN
  -- Um único statement dá ao pai e às filhas o mesmo snapshot em READ COMMITTED.
  -- Assim uma edição concorrente não produz uma cópia híbrida de dois instantes.
  WITH source AS MATERIALIZED (
    SELECT task.*
    FROM public.note_tasks task
    WHERE task.id = p_task_id
      AND task.parent_task_id IS NULL
  ),
  children AS MATERIALIZED (
    SELECT child.*
    FROM public.note_tasks child
    WHERE child.parent_task_id = p_task_id
  ),
  inserted_parent AS (
    INSERT INTO public.note_tasks (
      id, note_id, text, description, priority, status, done,
      due_date, tags, parent_task_id
    )
    SELECT
      v_new_task_id,
      source.note_id,
      source.text || ' (cópia)',
      source.description,
      source.priority,
      'todo',
      false,
      source.due_date,
      source.tags,
      NULL
    FROM source
    RETURNING id
  ),
  inserted_children AS (
    INSERT INTO public.note_tasks (
      id, note_id, text, description, priority, status, done,
      due_date, tags, parent_task_id
    )
    SELECT
      gen_random_uuid(),
      NULL,
      child.text,
      child.description,
      child.priority,
      'todo',
      false,
      child.due_date,
      child.tags,
      parent.id
    FROM children child
    CROSS JOIN inserted_parent parent
    ORDER BY child.created_at, child.id
    RETURNING id
  )
  SELECT parent.id
    INTO v_new_task_id
    FROM inserted_parent parent
    CROSS JOIN (SELECT count(*) FROM inserted_children) copied_children;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tarefa não encontrada ou sem permissão para duplicar.'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN v_new_task_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.duplicate_note_task(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.duplicate_note_task(uuid) TO authenticated;

COMMENT ON FUNCTION public.duplicate_note_task(uuid) IS
  'Duplica uma tarefa top-level e suas subtarefas; zera conclusão e atribui a cópia ao usuário autenticado via trigger.';
