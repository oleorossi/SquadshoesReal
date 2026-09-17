import { useState, useMemo, useCallback } from 'react';
import {
  useWorkSchedules,
  useTimeRecords,
  type WorkSchedule,
  type TimeRecord,
} from '@/hooks/useTimesheet';
import { useEmployees, type Employee } from '@/hooks/useEmployees';
import { useEmployeeAbsences, type EmployeeAbsence } from '@/hooks/useEmployeeAbsences';
import { groupTimeRecordsBySystemEmployee, listSystemTimesheetEmployees } from '@/lib/ponto/systemTimesheet';
import {
  classifyDayCell,
  overnightPendingDatesByEmployee,
  rowHasNeedsFix,
  rowIsAllSettled,
  type DayCellFilter,
  type DayCellStatus,
} from '@/lib/ponto/dayCellStatus';
import DayAdjustDialog from '@/components/timesheet/DayAdjustDialog';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SearchInput } from '@/components/ui/search-input';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import {
  CaretLeft as ChevronLeft,
  CaretRight as ChevronRight,
  Users as Users2,
} from '@phosphor-icons/react';
import { toast } from 'sonner';

const DAYS_PT = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addMonths(date: Date, n: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  d.setDate(1);
  d.setHours(12, 0, 0, 0);
  return d;
}

function monthDateRange(year: number, monthIndex: number): string[] {
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const out: string[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    out.push(
      `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    );
  }
  return out;
}

function isEmploymentDate(employee: Employee, dateStr: string) {
  return (
    (!employee.admission_date || dateStr >= employee.admission_date) &&
    (!employee.termination_date || dateStr <= employee.termination_date)
  );
}

function expectsWorkOn(schedule: WorkSchedule, dateStr: string): boolean {
  const dow = new Date(dateStr + 'T12:00:00').getDay();
  const flags = [
    schedule.works_sunday,
    schedule.works_monday,
    schedule.works_tuesday,
    schedule.works_wednesday,
    schedule.works_thursday,
    schedule.works_friday,
    schedule.works_saturday,
  ];
  return !!flags[dow];
}

function absenceCovers(
  absences: EmployeeAbsence[],
  employeeId: string,
  dateStr: string,
): EmployeeAbsence | null {
  return (
    absences.find(
      a =>
        a.employee_id === employeeId &&
        a.start_date <= dateStr &&
        a.end_date >= dateStr,
    ) || null
  );
}

function statusMark(status: DayCellStatus): { label: string; className: string } | null {
  if (status === 'needs_fix') {
    return {
      label: '!',
      className: 'bg-amber-500/15 text-amber-700 border-amber-500/40 dark:text-amber-400',
    };
  }
  if (status === 'justified') {
    return {
      label: 'J',
      className: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-400',
    };
  }
  if (status === 'ok') {
    return {
      label: '·',
      className: 'text-muted-foreground',
    };
  }
  return null;
}

interface CellTarget {
  employee: Employee;
  dateStr: string;
}

/**
 * Workspace único de Ajustar: grade mês × pessoa + filtro + DayAdjustDialog.
 */
export default function AdjustmentWorkspace() {
  const { data: schedules = [] } = useWorkSchedules();
  const { data: employees = [] } = useEmployees();
  const { data: absences = [] } = useEmployeeAbsences();

  const [monthCursor, setMonthCursor] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(12, 0, 0, 0);
    return d;
  });
  const [filter, setFilter] = useState<DayCellFilter>('all');
  const [search, setSearch] = useState('');
  const [cellTarget, setCellTarget] = useState<CellTarget | null>(null);

  const year = monthCursor.getFullYear();
  const monthIndex = monthCursor.getMonth();
  const monthDates = useMemo(() => monthDateRange(year, monthIndex), [year, monthIndex]);
  const monthStart = monthDates[0];
  const monthEnd = monthDates[monthDates.length - 1];
  const todayStr = toDateStr(new Date());

  const { data: records = [], isLoading } = useTimeRecords(undefined, monthStart, monthEnd);

  const defaultSchedule = useMemo<WorkSchedule>(
    () =>
      schedules.find(s => s.is_default) ||
      schedules[0] || {
        id: '',
        name: 'Default',
        entry_time: '08:00',
        lunch_start: '12:00',
        lunch_end: '13:00',
        exit_time: '17:48',
        saturday_entry: '08:00',
        saturday_exit: '12:00',
        weekly_hours: 44,
        overtime_multiplier: 1.5,
        night_overtime_multiplier: 1.7,
        holiday_multiplier: 1.5,
        tolerance_minutes: 10,
        minimum_overtime_minutes: 0,
        is_default: true,
        works_sunday: false,
        works_monday: true,
        works_tuesday: true,
        works_wednesday: true,
        works_thursday: true,
        works_friday: true,
        works_saturday: true,
        created_at: '',
        updated_at: '',
      },
    [schedules],
  );

  const scheduleForEmployee = useCallback(
    (employeeId: string) => {
      const employee = employees.find(e => e.id === employeeId);
      return (
        (employee?.work_schedule_id && schedules.find(s => s.id === employee.work_schedule_id)) ||
        defaultSchedule
      );
    },
    [employees, schedules, defaultSchedule],
  );

  const timesheetEmployees = useMemo(
    () => listSystemTimesheetEmployees(employees, monthStart, monthEnd),
    [employees, monthStart, monthEnd],
  );

  const recordMap = useMemo(() => {
    const m = new Map<string, TimeRecord>();
    const grouped = groupTimeRecordsBySystemEmployee(employees, records).byEmployee;
    for (const [employeeId, employeeRecords] of grouped) {
      employeeRecords.forEach(record => m.set(`${employeeId}|${record.record_date}`, record));
    }
    return m;
  }, [records, employees]);

  const punchesByEmployeeDate = useMemo(() => {
    const outer = new Map<string, Map<string, string[]>>();
    const grouped = groupTimeRecordsBySystemEmployee(employees, records).byEmployee;
    for (const [employeeId, employeeRecords] of grouped) {
      const byDate = new Map<string, string[]>();
      for (const rec of employeeRecords) {
        byDate.set(rec.record_date, Array.isArray(rec.punches) ? rec.punches.map(String) : []);
      }
      outer.set(employeeId, byDate);
    }
    return outer;
  }, [employees, records]);

  const overnightByEmployee = useMemo(
    () => overnightPendingDatesByEmployee(punchesByEmployeeDate),
    [punchesByEmployeeDate],
  );

  const absenceList = absences as EmployeeAbsence[];

  const rowData = useMemo(() => {
    const q = search.trim().toLowerCase();
    return timesheetEmployees
      .filter(emp => !q || emp.name.toLowerCase().includes(q) || (emp.department || '').toLowerCase().includes(q))
      .map(employee => {
        const schedule = scheduleForEmployee(employee.id);
        const overnightDates = overnightByEmployee.get(employee.id) || new Set<string>();
        const statuses = monthDates.map(dateStr => {
          const rec = recordMap.get(`${employee.id}|${dateStr}`);
          const punches = rec ? ((rec.punches as string[]) || []) : [];
          return classifyDayCell({
            punches,
            hasAbsence: !!absenceCovers(absenceList, employee.id, dateStr),
            overnightPending: overnightDates.has(dateStr),
            expectsWork: expectsWorkOn(schedule, dateStr),
            withinEmployment: isEmploymentDate(employee, dateStr),
            isFuture: dateStr > todayStr,
          });
        });
        return { employee, statuses, schedule };
      })
      .filter(row => {
        if (filter === 'all') return true;
        if (filter === 'needs_fix') return rowHasNeedsFix(row.statuses);
        return rowIsAllSettled(row.statuses);
      });
  }, [
    timesheetEmployees,
    search,
    scheduleForEmployee,
    overnightByEmployee,
    monthDates,
    recordMap,
    absenceList,
    todayStr,
    filter,
  ]);

  const needsFixCount = useMemo(() => {
    let n = 0;
    for (const emp of timesheetEmployees) {
      const schedule = scheduleForEmployee(emp.id);
      const overnightDates = overnightByEmployee.get(emp.id) || new Set<string>();
      for (const dateStr of monthDates) {
        const rec = recordMap.get(`${emp.id}|${dateStr}`);
        const status = classifyDayCell({
          punches: rec ? ((rec.punches as string[]) || []) : [],
          hasAbsence: !!absenceCovers(absenceList, emp.id, dateStr),
          overnightPending: overnightDates.has(dateStr),
          expectsWork: expectsWorkOn(schedule, dateStr),
          withinEmployment: isEmploymentDate(emp, dateStr),
          isFuture: dateStr > todayStr,
        });
        if (status === 'needs_fix') n += 1;
      }
    }
    return n;
  }, [
    timesheetEmployees,
    scheduleForEmployee,
    overnightByEmployee,
    monthDates,
    recordMap,
    absenceList,
    todayStr,
  ]);

  const openCell = (employee: Employee, dateStr: string) => {
    if (!isEmploymentDate(employee, dateStr)) {
      toast.error('Esta data está fora da vigência do vínculo do funcionário.');
      return;
    }
    if (dateStr > todayStr) {
      toast.error('Não é permitido lançar em data futura.');
      return;
    }
    setCellTarget({ employee, dateStr });
  };

  const monthLabel = monthCursor.toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  });

  const dialogRecord = cellTarget
    ? recordMap.get(`${cellTarget.employee.id}|${cellTarget.dateStr}`) || null
    : null;

  const nextDayRecord = useMemo(() => {
    if (!cellTarget) return null;
    const [y, m, d] = cellTarget.dateStr.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    const nextStr = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
    return recordMap.get(`${cellTarget.employee.id}|${nextStr}`) || null;
  }, [cellTarget, recordMap]);

  const coveringAbsence = cellTarget
    ? absenceCovers(absenceList, cellTarget.employee.id, cellTarget.dateStr)
    : null;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/70 bg-card p-4 shadow-sm space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <span className="eyebrow text-[9px]">Ajustar o período</span>
            <h2 className="mt-0.5 text-base font-bold capitalize">{monthLabel}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Clique no dia para completar batida ou justificar ausência.
              {needsFixCount > 0 && (
                <>
                  {' '}
                  <span className="font-medium text-foreground">{needsFixCount}</span> célula
                  {needsFixCount === 1 ? '' : 's'} precisa{needsFixCount === 1 ? '' : 'm'} de ajuste.
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9 w-9 p-0"
              onClick={() => setMonthCursor(d => addMonths(d, -1))}
              aria-label="Mês anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 text-xs"
              onClick={() => {
                const d = new Date();
                d.setDate(1);
                d.setHours(12, 0, 0, 0);
                setMonthCursor(d);
              }}
            >
              Este mês
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 w-9 p-0"
              onClick={() => setMonthCursor(d => addMonths(d, 1))}
              aria-label="Próximo mês"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div
            className="inline-flex gap-1 rounded-md border border-border/60 bg-muted/40 p-1"
            role="group"
            aria-label="Filtro da grade"
          >
            {(
              [
                { value: 'all' as const, label: 'Todos' },
                { value: 'needs_fix' as const, label: 'Precisam ajuste' },
                { value: 'ok' as const, label: 'Já ok' },
              ] as const
            ).map(opt => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={filter === opt.value}
                onClick={() => setFilter(opt.value)}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors',
                  filter === opt.value
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {opt.label}
                {opt.value === 'needs_fix' && needsFixCount > 0 && (
                  <Badge
                    variant="outline"
                    className="ml-1.5 h-4 px-1 text-[10px] border-amber-500/30 bg-amber-500/10 text-amber-700"
                  >
                    {needsFixCount}
                  </Badge>
                )}
              </button>
            ))}
          </div>
          <SearchInput
            className="min-w-[200px] max-w-xs flex-1"
            placeholder="Buscar funcionário ou setor..."
            value={search}
            onChange={setSearch}
            resultCount={rowData.length}
            totalCount={timesheetEmployees.length}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12 text-muted-foreground text-sm">Carregando...</div>
      ) : rowData.length === 0 ? (
        <Panel flush>
          <EmptyState
            icon={Users2}
            title={filter === 'needs_fix' ? 'Nada pendente neste mês' : 'Nenhum funcionário'}
            description={
              filter === 'needs_fix'
                ? 'Nenhuma célula precisa de ajuste com o filtro atual.'
                : 'Não há funcionários no ponto para este período.'
            }
          />
        </Panel>
      ) : (
        <div className="rounded-xl border border-border/70 bg-card shadow-sm overflow-hidden">
          <div className="overflow-auto max-h-[min(70vh,720px)]">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted/40 border-b border-border/60">
                  <th className="text-left py-2 px-3 font-medium text-[10px] uppercase tracking-wide text-muted-foreground w-36 sticky left-0 bg-muted/40 z-10">
                    Funcionário
                  </th>
                  {monthDates.map(dateStr => {
                    const d = new Date(dateStr + 'T12:00:00');
                    const dow = d.getDay();
                    const isToday = dateStr === todayStr;
                    return (
                      <th
                        key={dateStr}
                        className={cn(
                          'py-1.5 px-0.5 text-center font-medium text-[10px] min-w-[28px]',
                          isToday && 'bg-primary/10',
                        )}
                      >
                        <div
                          className={cn(
                            'font-semibold',
                            isToday ? 'text-primary' : dow === 0 || dow === 6 ? 'text-muted-foreground' : '',
                          )}
                        >
                          {DAYS_PT[dow]}
                        </div>
                        <div className="font-mono text-[9px] text-muted-foreground tabular-nums">
                          {dateStr.slice(8)}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rowData.map(({ employee, statuses }, rowIdx) => (
                  <tr
                    key={employee.id}
                    className={cn('border-b border-border/40', rowIdx % 2 === 1 && 'bg-muted/10')}
                  >
                    <td
                      className={cn(
                        'py-1.5 px-3 font-medium text-xs sticky left-0 z-10',
                        rowIdx % 2 === 0 ? 'bg-card' : 'bg-muted/10',
                      )}
                    >
                      <span className="truncate block max-w-[140px]" title={employee.name}>
                        {employee.name}
                      </span>
                    </td>
                    {monthDates.map((dateStr, di) => {
                      const status = statuses[di];
                      const mark = statusMark(status);
                      const canEdit = status !== 'out_of_scope';
                      const rec = recordMap.get(`${employee.id}|${dateStr}`);
                      const punchPreview = rec
                        ? ((rec.punches as string[]) || [])
                            .map(p => String(p).replace(/\*$/, ''))
                            .slice(0, 2)
                            .join(' ')
                        : '';

                      return (
                        <td
                          key={dateStr}
                          className={cn(
                            'py-0.5 px-0.5 text-center align-middle',
                            dateStr === todayStr && 'bg-primary/5',
                            canEdit
                              ? 'cursor-pointer hover:bg-primary/10'
                              : 'cursor-not-allowed opacity-40',
                          )}
                          onClick={() => canEdit && openCell(employee, dateStr)}
                          title={
                            punchPreview
                              ? punchPreview
                              : status === 'needs_fix'
                                ? 'Precisa de ajuste'
                                : status === 'justified'
                                  ? 'Justificado'
                                  : undefined
                          }
                        >
                          {mark ? (
                            <span
                              className={cn(
                                'inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded border text-[10px] font-bold tabular-nums',
                                mark.className,
                              )}
                            >
                              {mark.label}
                            </span>
                          ) : status === 'empty' ? (
                            <span className="text-muted-foreground/40 text-[10px]">—</span>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {cellTarget && (
        <DayAdjustDialog
          open={!!cellTarget}
          onOpenChange={open => {
            if (!open) setCellTarget(null);
          }}
          employeeId={cellTarget.employee.id}
          employeeName={cellTarget.employee.name}
          dateStr={cellTarget.dateStr}
          existingRecord={dialogRecord}
          nextDayRecord={nextDayRecord}
          schedule={scheduleForEmployee(cellTarget.employee.id)}
          coveringAbsence={coveringAbsence}
        />
      )}
    </div>
  );
}
