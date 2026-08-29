import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const SQL = read('supabase/migrations/20270101013900_duplicate_note_task.sql');
const PAGE = read('src/pages/Tarefas.tsx');
const DETAIL = read('src/components/tasks/TaskDetailSheet.tsx');
const HOOK = read('src/hooks/useNoteTasks.ts');

describe('central de tarefas em formato to-do', () => {
  it('duplica raiz e subtarefas numa transação, sempre reabrindo a cópia', () => {
    expect(SQL).toContain('FUNCTION public.duplicate_note_task(p_task_id uuid)');
    expect(SQL).toContain('SECURITY INVOKER');
    expect(SQL).toContain('parent_task_id IS NULL');
    expect(SQL).toContain('WITH source AS MATERIALIZED');
    expect(SQL).toContain('children AS MATERIALIZED');
    expect(SQL).toContain("source.text || ' (cópia)'");
    expect(SQL).toContain("'todo',");
    expect(SQL).toContain('child.parent_task_id = p_task_id');
    expect(SQL).toContain('GRANT EXECUTE ON FUNCTION public.duplicate_note_task(uuid) TO authenticated');
    expect(HOOK).toContain("invalidateQueries({ queryKey: ['note_tasks'] })");
  });

  it('mantém a Lista como fila principal sem remover Agenda e Quadro', () => {
    expect(PAGE).toContain('<TaskScopeNav scope={scope}');
    expect(PAGE).toContain('<TaskQuickCapture canCreate={perm.canCreate} />');
    expect(PAGE).toContain("{ key: 'agenda' as const");
    expect(PAGE).toContain("{ key: 'quadro' as const");
    expect(PAGE).toContain('aria-pressed={view === key}');
    expect(PAGE).toContain('aria-expanded={open}');
  });

  it('aplica permissões de edição e criação também no detalhe', () => {
    expect(DETAIL).toContain('disabled={!perm.canEdit}');
    expect(DETAIL).toContain('perm.canCreate && onDuplicate');
    expect(DETAIL).toContain('{perm.canCreate && (');
    expect(DETAIL).toContain('canDelete={perm.canDelete}');
    expect(DETAIL).toContain('return flushPendingSaves');
    expect(DETAIL).toContain("duplicatePending ? 'Duplicando…' : 'Duplicar'");
  });
});
