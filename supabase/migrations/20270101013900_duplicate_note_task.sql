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
  v_source public.note_tasks%ROWTYPE;
  v_new_task_id uuid := gen_random_uuid();
BEGIN
  SELECT *
    INTO v_source
    FROM public.note_tasks
   WHERE id = p_task_id
     AND parent_task_id IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tarefa não encontrada ou sem permissão para duplicar.'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.note_tasks (
    id,
    note_id,
    text,
    description,
    priority,
    status,
    done,
    due_date,
    tags,
    parent_task_id
  ) VALUES (
    v_new_task_id,
    v_source.note_id,
    v_source.text || ' (cópia)',
    v_source.description,
    v_source.priority,
    'todo',
    false,
    v_source.due_date,
    v_source.tags,
    NULL
  );

  INSERT INTO public.note_tasks (
    id,
    note_id,
    text,
    description,
    priority,
    status,
    done,
    due_date,
    tags,
    parent_task_id
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
    v_new_task_id
  FROM public.note_tasks child
  WHERE child.parent_task_id = p_task_id
  ORDER BY child.created_at, child.id;

  RETURN v_new_task_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.duplicate_note_task(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.duplicate_note_task(uuid) TO authenticated;

COMMENT ON FUNCTION public.duplicate_note_task(uuid) IS
  'Duplica uma tarefa top-level e suas subtarefas; zera conclusão e atribui a cópia ao usuário autenticado via trigger.';
