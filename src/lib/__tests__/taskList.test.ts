import { describe, expect, it } from 'vitest';
import { applyTaskUpdate, type NoteTaskWithNote } from '@/hooks/useNoteTasks';
import { bucketTasksByDate, countTaskScopes, matchesTaskScope } from '@/lib/taskList';

const NOW = new Date(2026, 7, 29, 12, 0, 0);

function task(overrides: Partial<NoteTaskWithNote> = {}): NoteTaskWithNote {
  return {
    id: overrides.id || crypto.randomUUID(),
    note_id: null,
    text: 'Tarefa de teste',
    description: '',
    priority: 'media',
    status: 'todo',
    done: false,
    due_date: null,
    tags: [],
    parent_task_id: null,
    completed_at: null,
    created_by: 'user-1',
    created_at: '2026-08-20T12:00:00.000Z',
    updated_at: '2026-08-20T12:00:00.000Z',
    ...overrides,
  };
}

describe('fila operacional de tarefas', () => {
  it('conta escopos sem somar tarefas concluídas na fila aberta', () => {
    const tasks = [
      task({ due_date: '2026-08-28' }),
      task({ due_date: '2026-08-29' }),
      task({ due_date: '2026-09-02' }),
      task(),
      task({
        done: true,
        status: 'done',
        completed_at: '2026-08-29T14:00:00.000Z',
      }),
    ];

    expect(countTaskScopes(tasks, NOW)).toEqual({
      open: 4,
      today: 1,
      overdue: 1,
      upcoming: 1,
      noDate: 1,
      done: 1,
      completedToday: 1,
    });
  });

  it('combina o escopo com prazo e conclusão', () => {
    const overdue = task({ due_date: '2026-08-27' });
    const done = task({ done: true, status: 'done', due_date: '2026-08-27' });

    expect(matchesTaskScope(overdue, 'open', NOW)).toBe(true);
    expect(matchesTaskScope(overdue, 'overdue', NOW)).toBe(true);
    expect(matchesTaskScope(overdue, 'done', NOW)).toBe(false);
    expect(matchesTaskScope(done, 'overdue', NOW)).toBe(false);
    expect(matchesTaskScope(done, 'done', NOW)).toBe(true);
  });

  it('agrupa a lista na ordem operacional por vencimento', () => {
    const later = task({ id: 'later', due_date: '2026-09-20' });
    const weekLater = task({ id: 'week-later', due_date: '2026-09-03' });
    const weekSooner = task({ id: 'week-sooner', due_date: '2026-08-30' });
    const buckets = bucketTasksByDate([
      later,
      task({ id: 'today', due_date: '2026-08-29' }),
      weekLater,
      task({ id: 'none' }),
      weekSooner,
      task({ id: 'overdue', due_date: '2026-08-20' }),
    ], NOW);

    expect(buckets.overdue.map(item => item.id)).toEqual(['overdue']);
    expect(buckets.today.map(item => item.id)).toEqual(['today']);
    expect(buckets.week.map(item => item.id)).toEqual(['week-sooner', 'week-later']);
    expect(buckets.later.map(item => item.id)).toEqual(['later']);
    expect(buckets.noDate.map(item => item.id)).toEqual(['none']);
  });

  it('espelha done e status no cache otimista', () => {
    const original = task();
    const completed = applyTaskUpdate(original, { done: true });
    expect(completed.done).toBe(true);
    expect(completed.status).toBe('done');
    expect(completed.completed_at).not.toBeNull();

    const reopened = applyTaskUpdate(completed, { status: 'doing' });
    expect(reopened.done).toBe(false);
    expect(reopened.status).toBe('doing');
    expect(reopened.completed_at).toBeNull();
  });
});
