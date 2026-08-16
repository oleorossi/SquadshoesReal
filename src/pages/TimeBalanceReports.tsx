import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarBlank,
  CheckCircle,
  Clock,
  Printer,
  TrendDown,
  TrendUp,
  User,
  Warning,
} from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel } from '@/components/ui/panel';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { PeriodRangeFilter } from '@/components/hr/PeriodRangeFilter';
import { TableSkeleton } from '@/components/layout/PageSkeleton';
import { useEmployees } from '@/hooks/useEmployees';
import { useAbsences } from '@/hooks/useRH';
import { useHolidays, useSwapSets, useTimesheetCoverage, useWorkSchedules } from '@/hooks/useTimesheet';
import { fetchTimeRecordsInRange } from '@/lib/ponto/fetchTimeRecords';
import { expandAbsenceDatesByEmployee, resolveHolidaysForPayrollRange } from '@/lib/ponto/periodDates';
import {
  buildTimeBalanceReports,
  formatBalanceMinutes,
  reportsForKind,
  type EmployeeTimeBalanceReport,
  type TimeBalanceDay,
  type TimeBalanceReportKind,
  type TimeBalanceWeek,
} from '@/lib/ponto/timeBalanceReports';
import { computeComparativoRows } from '@/lib/payrollComparativo';
import { printTimeBalanceReports } from '@/lib/printTimeBalanceReports';
import { cn } from '@/lib/utils';

const DAY_LABELS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function monthBounds(date = new Date()): { from: string; to: string } {
  const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` };
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timeout);
  }, [value, delay]);
  return debounced;
}

function periodLabel(from: string, to: string): string {
  if (!from || !to) return 'Período inválido';
  return `${from.split('-').reverse().join('/')} a ${to.split('-').reverse().join('/')}`;
}

function shortDate(date: string): string {
  return date ? `${date.slice(8, 10)}/${date.slice(5, 7)}` : '—';
}

function daySlot(dayOfWeek: number): number {
  return dayOfWeek === 0 ? 6 : dayOfWeek - 1;
}

function dayBalanceLabel(day: TimeBalanceDay): string {
  if (day.status === 'pending') return 'Batida pendente';
  if (day.status === 'excused') return 'Abonado';
  if (day.status === 'neutral') return 'Folga';
  return formatBalanceMinutes(day.balanceMinutes);
}

function dayPunchesLabel(day: TimeBalanceDay): string {
  if (day.punches.length === 0) return 'Sem batidas';
  if (day.punches.length <= 2) return day.punches.join(' · ');
  return `${day.punches[0]} → ${day.punches[day.punches.length - 1]}`;
}

function BalanceDayCell({ day }: { day?: TimeBalanceDay }) {
  if (!day) return <div className="min-h-28 border-l border-t border-border/60 bg-muted/10" aria-hidden="true" />;
  const isPending = day.status === 'pending';
  const isPositive = !isPending && day.balanceMinutes > 0;
  const isNegative = !isPending && day.balanceMinutes < 0;
  return (
    <div
      className={cn(
        'min-h-28 border-l border-t border-border/60 p-2.5 transition-colors',
        isPositive && 'bg-success/5',
        isNegative && 'bg-destructive/5',
        isPending && 'bg-warning/10',
        !isPositive && !isNegative && !isPending && 'bg-muted/20',
      )}
      title={day.punches.join(' · ') || undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-[11px] font-semibold text-muted-foreground">{shortDate(day.date)}</span>
        {day.isHoliday && <span className="text-[10px] font-semibold text-warning">FER.</span>}
      </div>
      <p className="mt-2 truncate font-mono text-[11px] text-foreground">{dayPunchesLabel(day)}</p>
      <p className="mt-1 text-[10px] tabular-nums text-muted-foreground">
        {formatBalanceMinutes(day.workedMinutes, false)} / {formatBalanceMinutes(day.expectedMinutes, false)}
      </p>
      <p className={cn(
        'mt-2 text-xs font-bold tabular-nums',
        isPositive && 'text-success',
        isNegative && 'text-destructive',
        isPending && 'text-warning',
        !isPositive && !isNegative && !isPending && 'text-muted-foreground',
      )}>
        {dayBalanceLabel(day)}
      </p>
    </div>
  );
}

function WeekSummaryCell({ week }: { week: TimeBalanceWeek }) {
  const target = Math.max(1, week.expectedMinutes);
  const fulfilled = Math.min(100, Math.round((week.workedMinutes / target) * 100));
  return (
    <div className="min-h-28 border-t border-border/60 bg-muted/35 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {shortDate(week.startDate)}–{shortDate(week.endDate)}
      </p>
      <p className="mt-2 text-xs font-semibold tabular-nums text-foreground">
        {formatBalanceMinutes(week.workedMinutes, false)} de {formatBalanceMinutes(week.expectedMinutes, false)}
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border/70" aria-hidden="true">
        <div
          className={cn('h-full rounded-full', week.deficitMinutes > 0 ? 'bg-destructive' : 'bg-success')}
          style={{ width: `${fulfilled}%` }}
        />
      </div>
      <p className={cn(
        'mt-2 font-mono text-sm font-bold tabular-nums',
        week.balanceMinutes > 0 ? 'text-success' : week.balanceMinutes < 0 ? 'text-destructive' : 'text-foreground',
      )}>
        {formatBalanceMinutes(week.balanceMinutes)}
      </p>
      {week.hasPendingPunches && <p className="mt-1 text-[10px] font-semibold text-warning">Há batida incompleta</p>}
    </div>
  );
}

function EmployeeBalanceCalendar({ report, kind }: { report: EmployeeTimeBalanceReport; kind: TimeBalanceReportKind }) {
  const mainMinutes = kind === 'overtime' ? report.totalOvertimeMinutes : -report.totalDeficitMinutes;
  const mainWeeks = kind === 'overtime' ? report.overtimeWeeks : report.deficitWeeks;
  return (
    <Panel
      eyebrow={kind === 'overtime' ? 'CRÉDITO SEMANAL' : 'ABAIXO DA META SEMANAL'}
      title={report.name}
      subtitle={`${report.department} · ${mainWeeks} ${mainWeeks === 1 ? 'semana' : 'semanas'} no relatório`}
      actions={
        <Badge variant="outline" className={cn(
          'font-mono text-xs tabular-nums',
          kind === 'overtime'
            ? 'border-success/30 bg-success/10 text-success'
            : 'border-destructive/30 bg-destructive/10 text-destructive',
        )}>
          {formatBalanceMinutes(mainMinutes)}
        </Badge>
      }
      flush
    >
      <div className="overflow-x-auto">
        <div className="min-w-[940px]">
          <div className="grid grid-cols-[160px_repeat(7,minmax(104px,1fr))] border-b border-border bg-muted/20">
            <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Fechamento semanal</div>
            {DAY_LABELS.map(label => <div key={label} className="border-l border-border/60 px-2 py-2 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>)}
          </div>
          {report.weeks.map(week => {
            const slots = Array.from<TimeBalanceDay | undefined>({ length: 7 });
            for (const day of week.days) slots[daySlot(day.dayOfWeek)] = day;
            return (
              <div key={week.key} className="grid grid-cols-[160px_repeat(7,minmax(104px,1fr))]">
                <WeekSummaryCell week={week} />
                {slots.map((day, index) => <BalanceDayCell key={day?.date || `${week.key}-${index}`} day={day} />)}
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-border px-4 py-3 text-[11px] text-muted-foreground">
        <span><strong className="text-foreground">Célula:</strong> batidas · trabalhado/meta · saldo diário</span>
        <span><strong className="text-foreground">Semana:</strong> créditos e débitos se compensam somente dentro dela</span>
        {report.pendingPunchDays > 0 && <span className="font-semibold text-warning">{report.pendingPunchDays} {report.pendingPunchDays === 1 ? 'dia com batida pendente' : 'dias com batida pendente'}</span>}
      </div>
    </Panel>
  );
}

export default function TimeBalanceReports() {
  const [range, setRange] = useState(monthBounds);
  const [kind, setKind] = useState<TimeBalanceReportKind>('overtime');
  const [scope, setScope] = useState('all');
  const appliedRange = useDebouncedValue(range, 350);
  const validRange = !!appliedRange.from && !!appliedRange.to && appliedRange.from <= appliedRange.to;

  const { data: employees = [], isLoading: employeesLoading } = useEmployees();
  const { data: schedules = [], isLoading: schedulesLoading } = useWorkSchedules();
  const { data: holidays = [] } = useHolidays();
  const { swapWorkedSet, swapOffSet } = useSwapSets();
  const { data: coverage, isLoading: coverageLoading } = useTimesheetCoverage(appliedRange.from, appliedRange.to);
  const { data: absences = [] } = useAbsences({ from: appliedRange.from, to: appliedRange.to });
  const { data: timeRecords = [], isLoading: recordsLoading } = useQuery({
    queryKey: ['time-balance-report-records', appliedRange.from, appliedRange.to],
    enabled: validRange,
    staleTime: 60_000,
    queryFn: () => fetchTimeRecordsInRange(appliedRange.from, appliedRange.to),
  });

  const defaultSchedule = useMemo(
    () => schedules.find(schedule => schedule.is_default) || schedules[0] || null,
    [schedules],
  );
  const holidaysSet = useMemo(
    () => resolveHolidaysForPayrollRange(holidays, appliedRange.from, appliedRange.to),
    [holidays, appliedRange],
  );
  const absenceDatesByEmployee = useMemo(
    () => expandAbsenceDatesByEmployee(absences, appliedRange.from, appliedRange.to),
    [absences, appliedRange],
  );
  const employeeMap = useMemo(() => new Map(employees.map(employee => [employee.id, employee])), [employees]);

  const reports = useMemo(() => {
    if (!validRange) return [];
    const period = appliedRange.from.slice(0, 7);
    const calculated = computeComparativoRows({
      employees,
      schedules,
      defaultSchedule,
      holidaysSet,
      swapWorkedSet,
      swapOffSet,
      timeRecords,
      advancesList: [],
      absenceDatesByEmployee,
      producaoRows: [],
      range: appliedRange,
      period,
      maxCovered: coverage?.maxCovered || null,
    });
    return buildTimeBalanceReports(calculated.rows.map(row => {
      const employee = employeeMap.get(row.id);
      return {
        id: row.id,
        name: row.name,
        department: employee?.department,
        paymentType: employee?.payment_type,
        ledger: row.result.day_ledger,
      };
    }));
  }, [validRange, appliedRange, employees, schedules, defaultSchedule, holidaysSet, swapWorkedSet, swapOffSet, timeRecords, absenceDatesByEmployee, coverage?.maxCovered, employeeMap]);

  const overtimeReports = useMemo(() => reportsForKind(reports, 'overtime'), [reports]);
  const deficitReports = useMemo(() => reportsForKind(reports, 'deficit'), [reports]);
  const eligibleReports = kind === 'overtime' ? overtimeReports : deficitReports;
  const deficitEnabled = deficitReports.length > 0;

  useEffect(() => {
    if (kind === 'deficit' && !deficitEnabled) setKind('overtime');
  }, [kind, deficitEnabled]);
  useEffect(() => {
    if (scope !== 'all' && !eligibleReports.some(report => report.id === scope)) setScope('all');
  }, [scope, eligibleReports]);

  const visibleReports = scope === 'all'
    ? eligibleReports
    : eligibleReports.filter(report => report.id === scope);
  const totalMinutes = eligibleReports.reduce(
    (sum, report) => sum + (kind === 'overtime' ? report.totalOvertimeMinutes : report.totalDeficitMinutes),
    0,
  );
  const totalWeeks = eligibleReports.reduce(
    (sum, report) => sum + (kind === 'overtime' ? report.overtimeWeeks : report.deficitWeeks),
    0,
  );
  const title = periodLabel(appliedRange.from, appliedRange.to);
  const loading = employeesLoading || schedulesLoading || coverageLoading || recordsLoading;

  const handlePrint = () => {
    if (visibleReports.length === 0) return;
    printTimeBalanceReports(visibleReports, kind, title);
  };

  return (
    <div className="space-y-4 page-enter">
      <div className="grid gap-3 lg:grid-cols-2">
        <button
          type="button"
          aria-pressed={kind === 'overtime'}
          onClick={() => setKind('overtime')}
          className={cn(
            'group flex min-h-24 items-center gap-4 rounded-lg border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            kind === 'overtime' ? 'border-success/40 bg-success/10' : 'border-border bg-card hover:bg-muted/30',
          )}
        >
          <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-lg', kind === 'overtime' ? 'bg-success text-success-foreground' : 'bg-muted text-muted-foreground')}>
            <TrendUp className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 text-sm font-bold text-foreground">
              Horas extras
              <Badge variant="outline" className="h-5 font-mono text-[10px] tabular-nums">{overtimeReports.length}</Badge>
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">Quem fechou alguma semana acima da jornada mínima.</span>
          </span>
          {kind === 'overtime' && <CheckCircle className="h-5 w-5 shrink-0 text-success" weight="fill" />}
        </button>

        <button
          type="button"
          aria-pressed={kind === 'deficit'}
          aria-disabled={!deficitEnabled}
          disabled={!deficitEnabled}
          onClick={() => setKind('deficit')}
          className={cn(
            'group flex min-h-24 items-center gap-4 rounded-lg border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            kind === 'deficit' && 'border-destructive/40 bg-destructive/10',
            kind !== 'deficit' && deficitEnabled && 'border-border bg-card hover:bg-muted/30',
            !deficitEnabled && 'cursor-not-allowed border-border bg-muted/30 opacity-60',
          )}
        >
          <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-lg', kind === 'deficit' ? 'bg-destructive text-destructive-foreground' : 'bg-muted text-muted-foreground')}>
            <TrendDown className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 text-sm font-bold text-foreground">
              Pendências semanais
              <Badge variant="outline" className="h-5 font-mono text-[10px] tabular-nums">{deficitReports.length}</Badge>
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
              {deficitEnabled ? 'Somente quem não atingiu a jornada mínima em uma ou mais semanas.' : 'Desabilitado: todos atingiram a jornada mínima no período.'}
            </span>
          </span>
          {kind === 'deficit' && <Warning className="h-5 w-5 shrink-0 text-destructive" weight="fill" />}
        </button>
      </div>

      <PeriodRangeFilter value={range} onChange={setRange} label="Período do ponto" />

      {coverage && coverage.count === 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
          <Warning className="h-4 w-4 shrink-0" />
          Nenhuma batida do relógio foi importada para este período. Importe o arquivo na aba Ponto para habilitar os relatórios.
        </div>
      )}

      <Panel
        eyebrow="RELÓGIO DE PONTO · FECHAMENTO SEMANAL"
        title={kind === 'overtime' ? 'Relatório de horas extras' : 'Relatório de pendências'}
        subtitle={kind === 'overtime'
          ? 'Horas acima da jornada depois da compensação dentro de cada semana.'
          : 'Aparecem apenas funcionários cuja semana ficou abaixo da jornada mínima.'}
        actions={<Badge variant="outline" className="hidden font-mono text-[10px] tabular-nums sm:inline-flex">{title}</Badge>}
      >
        <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_auto] lg:items-end">
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Funcionário</p>
            <SearchableSelect
              value={scope}
              onChange={setScope}
              disabled={eligibleReports.length === 0}
              icon={<User className="h-4 w-4" />}
              options={[
                { value: 'all', label: `Todos os funcionários do relatório (${eligibleReports.length})`, description: 'Imprimir em lote' },
                ...eligibleReports.map(report => ({
                  value: report.id,
                  label: report.name,
                  description: report.department,
                  keywords: report.department,
                })),
              ]}
              placeholder="Buscar funcionário..."
              searchPlaceholder="Buscar por nome ou setor..."
              emptyText="Nenhum funcionário neste relatório."
              heading="Funcionários"
            />
          </div>
          <Button type="button" className="gap-2" onClick={handlePrint} disabled={visibleReports.length === 0}>
            <Printer className="h-4 w-4" />
            {scope === 'all' ? `Imprimir todos (${visibleReports.length})` : 'Imprimir funcionário'}
          </Button>
        </div>

        <div className="mt-4 grid gap-2 border-t border-border pt-4 sm:grid-cols-3">
          <div className="rounded-md bg-muted/35 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Funcionários</p>
            <p className="mt-1 font-mono text-lg font-bold tabular-nums text-foreground">{eligibleReports.length}</p>
          </div>
          <div className="rounded-md bg-muted/35 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Semanas</p>
            <p className="mt-1 font-mono text-lg font-bold tabular-nums text-foreground">{totalWeeks}</p>
          </div>
          <div className={cn('rounded-md px-3 py-2', kind === 'overtime' ? 'bg-success/10' : 'bg-destructive/10')}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{kind === 'overtime' ? 'Total de horas extras' : 'Total em débito'}</p>
            <p className={cn('mt-1 font-mono text-lg font-bold tabular-nums', kind === 'overtime' ? 'text-success' : 'text-destructive')}>
              {formatBalanceMinutes(kind === 'overtime' ? totalMinutes : -totalMinutes)}
            </p>
          </div>
        </div>
      </Panel>

      {loading ? (
        <div className="rounded-lg border border-border bg-card p-4"><TableSkeleton rows={6} /></div>
      ) : visibleReports.length === 0 ? (
        <Panel>
          <EmptyState
            icon={kind === 'overtime' ? Clock : CalendarBlank}
            title={kind === 'overtime' ? 'Nenhuma hora extra neste período' : 'Nenhuma pendência semanal'}
            description={kind === 'overtime'
              ? 'Nenhum funcionário fechou uma semana acima da jornada mínima nas batidas importadas.'
              : 'Todos os funcionários atingiram a jornada mínima semanal no período selecionado.'}
            size="sm"
          />
        </Panel>
      ) : (
        <div className="space-y-4">
          {visibleReports.map(report => <EmployeeBalanceCalendar key={report.id} report={report} kind={kind} />)}
        </div>
      )}

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <CalendarBlank className="h-3.5 w-3.5" />
        Fonte: arquivo do relógio de ponto · atualizado conforme o período importado · hoje {isoDate(new Date()).split('-').reverse().join('/')}
      </p>
    </div>
  );
}
