import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskDetailSheet } from '@/components/tasks/TaskDetailSheet';
import type { NoteTask, NoteTaskWithNote } from '@/hooks/useNoteTasks';

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
  access: {
    canCreate: true,
    canEdit: true,
    canDelete: true,
    canView: true,
  },
}));

vi.mock('@/hooks/useAccessControl', () => ({
  useCan: () => mocks.access,
}));

vi.mock('@/hooks/useNoteTasks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useNoteTasks')>();
  return {
    ...actual,
    useUpdateNoteTask: () => ({ mutate: mocks.update, isPending: false }),
    useCreateNoteTask: () => ({ mutate: mocks.create, isPending: false }),
    useDeleteNoteTask: () => ({ mutate: mocks.remove, isPending: false }),
  };
});

const TASK: NoteTaskWithNote = {
  id: 'task-1',
  note_id: null,
  text: 'Título original',
  description: 'Descrição original',
  priority: 'media',
  status: 'todo',
  done: false,
  due_date: null,
  tags: [],
  parent_task_id: null,
  completed_at: null,
  created_by: 'user-1',
  created_at: '2026-08-29T10:00:00.000Z',
  updated_at: '2026-08-29T10:00:00.000Z',
};

const SUBTASK: NoteTask = {
  ...TASK,
  id: 'subtask-1',
  text: 'Conferir material',
  parent_task_id: TASK.id,
};

function sheet(task: NoteTaskWithNote | null, subtasks: NoteTask[] = []) {
  return (
    <TaskDetailSheet
      task={task}
      subtasks={subtasks}
      onClose={vi.fn()}
    />
  );
}

describe('TaskDetailSheet', () => {
  beforeEach(() => {
    mocks.update.mockReset();
    mocks.create.mockReset();
    mocks.remove.mockReset();
    Object.assign(mocks.access, {
      canCreate: true,
      canEdit: true,
      canDelete: true,
      canView: true,
    });
  });

  it('salva imediatamente a edição pendente ao trocar ou fechar a tarefa', () => {
    const { rerender } = render(sheet(TASK));

    fireEvent.change(screen.getByLabelText('Título da tarefa'), {
      target: { value: 'Título revisado' },
    });
    expect(mocks.update).not.toHaveBeenCalled();

    rerender(sheet(null));

    expect(mocks.update).toHaveBeenCalledWith({
      id: TASK.id,
      note_id: null,
      data: { text: 'Título revisado' },
    });
  });

  it('separa as permissões de criar e excluir subtarefas da permissão de editar', () => {
    mocks.access.canCreate = false;
    mocks.access.canDelete = false;

    render(sheet(TASK, [SUBTASK]));

    expect(screen.queryByPlaceholderText('+ Adicionar subtarefa (Enter)')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Excluir subtarefa' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Editar subtarefa: ${SUBTASK.text}` })).toBeEnabled();
  });
});
