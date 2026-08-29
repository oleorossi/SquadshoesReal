import { differenceInCalendarDays } from 'date-fns';
import { dueDateInfo } from '@/lib/taskDates';
import type { NoteTaskWithNote } from '@/hooks/useNoteTasks';

export type TaskScope = 'open' | 'today' | 'overdue' | 'upcoming' | 'no-date' | 'done';

export interface TaskScopeCounts {
  open: number;
  today: number;
  overdue: number;
  upcoming: number;
  noDate: number;
  done: number;
  completedToday: number;
}

export interface TaskDateBuckets {
  overdue: NoteTaskWithNote[];
  today: NoteTaskWithNote[];
  week: NoteTaskWithNote[];
  later: NoteTaskWithNote[];
  noDate: NoteTaskWithNote[];
}

export function matchesTaskScope(task: NoteTaskWithNote, scope: TaskScope, now = new Date()) {
  const due = dueDateInfo(task.due_date, now);
  switch (scope) {
    case 'open': return !task.done;
    case 'today': return !task.done && due?.daysFromToday === 0;
    case 'overdue': return !task.done && !!due && due.daysFromToday < 0;
    case 'upcoming': return !task.done && !!due && due.daysFromToday > 0;
    case 'no-date': return !task.done && !due;
    case 'done': return task.done;
  }
}

export function countTaskScopes(tasks: NoteTaskWithNote[], now = new Date()): TaskScopeCounts {
  return tasks.reduce<TaskScopeCounts>((counts, task) => {
    const due = dueDateInfo(task.due_date, now);
    if (task.done) {
      counts.done += 1;
      if (task.completed_at) {
        const completed = new Date(task.completed_at);
        if (!Number.isNaN(completed.getTime()) && differenceInCalendarDays(completed, now) === 0) {
          counts.completedToday += 1;
        }
      }
      return counts;
    }

    counts.open += 1;
    if (!due) counts.noDate += 1;
    else if (due.daysFromToday < 0) counts.overdue += 1;
    else if (due.daysFromToday === 0) counts.today += 1;
    else counts.upcoming += 1;
    return counts;
  }, {
    open: 0,
    today: 0,
    overdue: 0,
    upcoming: 0,
    noDate: 0,
    done: 0,
    completedToday: 0,
  });
}

/** Agrupamento operacional da Lista e da Agenda. */
export function bucketTasksByDate(tasks: NoteTaskWithNote[], now = new Date()): TaskDateBuckets {
  const buckets: TaskDateBuckets = { overdue: [], today: [], week: [], later: [], noDate: [] };
  for (const task of tasks) {
    const due = dueDateInfo(task.due_date, now);
    if (!due) buckets.noDate.push(task);
    else if (due.daysFromToday < 0) buckets.overdue.push(task);
    else if (due.daysFromToday === 0) buckets.today.push(task);
    else if (due.daysFromToday <= 7) buckets.week.push(task);
    else buckets.later.push(task);
  }

  const byDue = (a: NoteTaskWithNote, b: NoteTaskWithNote) =>
    (a.due_date || '').localeCompare(b.due_date || '');
  buckets.overdue.sort(byDue);
  buckets.today.sort(byDue);
  buckets.week.sort(byDue);
  buckets.later.sort(byDue);
  return buckets;
}
