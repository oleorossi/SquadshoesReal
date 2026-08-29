import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarBlank,
  ChartBar,
  CheckCircle,
  Clock,
  Printer,
  TrendDown,
  TrendUp,
  User,
  Users,
  Warning,
} from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel } from '@/components/ui/panel';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { PeriodRangeFilter } from '@/components/hr/PeriodRangeFilter';
import { TableSkeleton } from '@/components/layout/PageSkeleton';
import { EmployeeBalanceCalendar } from '@/components/hr/EmployeeBalanceCalendar';
import { useEmployees } from '@/hooks/useEmployees';
import { useAbsences } from '@/hooks/useRH';
import { useHolidays, useSwapSets, useTimesheetCoverage, useWorkSchedules } from '@/hooks/useTimesheet';
import { fetchTimeRecordsInRange } from '@/lib/ponto/fetchTimeRecords';
import { expandAbsenceCreditsByEmployee, resolveHolidaysForPayrollRange } from '@/lib/ponto/periodDates';
import {
  buildEmployeeTimeBalanceReport,
  buildTimeBalanceReports,
  formatBalanceMinutes,
  reportsForKind,
  type TimeBalanceReportKind,
} from '@/lib/ponto/timeBalanceReports';
import { computeComparativoRows } from '@/lib/payrollComparativo';
import { printTimeBalanceManagementReport, printTimeBalanceReports } from '@/lib/printTimeBalanceReports';
import { cn } from '@/lib/utils';

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

export default function TimeBalanceReports() {
  const [range, setRange] = useState(monthBounds);
  const [kind, setKind] = useState<TimeBalanceReportKind>('all');
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
  const absenceCredits = useMemo(
    () => expandAbsenceCreditsByEmployee(absences, appliedRange.from, appliedRange.to),
    [absences, appliedRange],
  );
  const employeeMap = useMemo(() => new Map(employees.map(employee => [employee.id, employee])), [employees]);

  const reportInputs = useMemo(() => {
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
      absenceDatesByEmployee: absenceCredits.fullDayDates,
      absenceMinutesByEmployee: absenceCredits.partialMinutes,
      producaoRows: [],
      range: appliedRange,
      period,
      maxCovered: coverage?.maxCovered || null,
      coveredDates: coverage?.coveredDates,
    });
    return calculated.rows.map(row => {
      const employee = employeeMap.get(row.id);
      return {
        id: row.id,
        name: row.name,
        department: employee?.department,
        paymentType: employee?.payment_type,
        ledger: row.result.day_ledger,
        rawCreditMinutes: row.result.raw_credit_minutes,
        rawDebitMinutes: row.result.raw_delay_minutes,
        compensatedMinutes: row.result.compensated_minutes,
        payableOvertimeMinutes: row.result.he_minutes,
        payableDebitMinutes: row.result.atraso_minutes,
        overtimeValue: row.result.he_value,
        overtimeRateMissing: row.result.he_rate_missing,
      };
    });
  }, [validRange, appliedRange, employees, schedules, defaultSchedule, holidaysSet, swapWorkedSet, swapOffSet, timeRecords, absenceCredits, coverage?.maxCovered, coverage?.coveredDates, employeeMap]);

  const reports = useMemo(() => buildTimeBalanceReports(reportInputs), [reportInputs]);
  const managementReports = useMemo(
    () => reportInputs
      .map(buildEmployeeTimeBalanceReport)
      .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR')),
    [reportInputs],
  );

  const overtimeReports = useMemo(() => reportsForKind(reports, 'overtime'), [reports]);
  const deficitReports = useMemo(() => reportsForKind(reports, 'deficit'), [reports]);
  const eligibleReports = reportsForKind(reports, kind);
  const deficitEnabled = deficitReports.length > 0;

  useEffect(() => {
    if (kind === 'deficit' && !deficitEnabled) setKind('all');
  }, [kind, deficitEnabled]);
  useEffect(() => {
    if (scope !== 'all' && !eligibleReports.some(report => report.id === scope)) setScope('all');
  }, [scope, eligibleReports]);

  const visibleReports = scope === 'all'
    ? eligibleReports
    : eligibleReports.filter(report => report.id === scope);
  const totalMinutes = eligibleReports.reduce((sum, report) => {
    if (kind === 'overtime') return sum + report.totalOvertimeMinutes;
    if (kind === 'deficit') return sum + report.totalDeficitMinutes;
    return sum + report.finalPayableBalanceMinutes;
  }, 0);
  const totalWeeks = eligibleReports.reduce((sum, report) => {
    if (kind === 'overtime') return sum + report.overtimeWeeks;
    if (kind === 'deficit') return sum + report.deficitWeeks;
    return sum + report.weeks.length;
  }, 0);
  const title = periodLabel(appliedRange.from, appliedRange.to);
  const loading = employeesLoading || schedulesLoading || coverageLoading || recordsLoading;

  const handlePrint = () => {
    if (visibleReports.length === 0) return;
    printTimeBalanceReports(visibleReports, kind, title);
  };

  const handleManagementReport = () => {
    if (managementReports.length === 0) return;
    printTimeBalanceManagementReport(managementReports, title);
  };

  return (
    <div className="space-y-4 page-enter">
      <div className="grid gap-3 lg:grid-cols-3">
        <button
          type="button"
          aria-pressed={kind === 'all'}
          onClick={() => setKind('all')}
          className={cn(
            'group flex min-h-24 items-center gap-4 rounded-lg border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            kind === 'all' ? 'border-foreground/30 bg-muted/40' : 'border-border bg-card hover:bg-muted/30',
          )}
        >
          <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-lg', kind === 'all' ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground')}>
            <Users className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 text-sm font-bold text-foreground">
              Quadro completo
              <Badge variant="outline" className="h-5 font-mono text-[10px] tabular-nums">{reports.length}</Badge>
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">Todos os mensalistas com jornada no período, mesmo sem hora extra ou pendência.</span>
          </span>
          {kind === 'all' && <CheckCircle className="h-5 w-5 shrink-0 text-foreground" weight="fill" />}
        </button>

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

      {coverage && coverage.count === 0 && timeRecords.length === 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
          <Warning className="h-4 w-4 shrink-0" />
          Nenhuma batida do relógio foi importada para este período. Importe o arquivo na aba Ponto para habilitar os relatórios.
        </div>
      )}

      <Panel
        eyebrow="RELÓGIO DE PONTO · FECHAMENTO SEMANAL"
        title={kind === 'overtime' ? 'Relatório de horas extras' : kind === 'deficit' ? 'Relatório de pendências' : 'Espelho de ponto'}
        subtitle={kind === 'overtime'
          ? 'Horas acima da jornada depois da compensação dentro de cada semana.'
          : kind === 'deficit'
            ? 'Aparecem apenas funcionários cuja semana ficou abaixo da jornada mínima.'
            : 'Lista o quadro mensalista importado no período, com saldo zerado, extra ou pendência.'}
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
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="gap-2" onClick={handleManagementReport} disabled={managementReports.length === 0}>
              <ChartBar className="h-4 w-4" />
              Relatório gerência
            </Button>
            <Button type="button" className="gap-2" onClick={handlePrint} disabled={visibleReports.length === 0}>
              <Printer className="h-4 w-4" />
              {scope === 'all' ? `Imprimir todos (${visibleReports.length})` : 'Imprimir funcionário'}
            </Button>
          </div>
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
          <div className={cn('rounded-md px-3 py-2', kind === 'overtime' ? 'bg-success/10' : kind === 'deficit' ? 'bg-destructive/10' : 'bg-muted/35')}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{kind === 'overtime' ? 'Total de horas extras' : kind === 'deficit' ? 'Total em débito' : 'Saldo líquido'}</p>
            <p className={cn('mt-1 font-mono text-lg font-bold tabular-nums', kind === 'overtime' ? 'text-success' : kind === 'deficit' ? 'text-destructive' : 'text-foreground')}>
              {formatBalanceMinutes(kind === 'deficit' ? -totalMinutes : totalMinutes)}
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
            title={kind === 'overtime' ? 'Nenhuma hora extra neste período' : kind === 'deficit' ? 'Nenhuma pendência semanal' : 'Nenhum funcionário no período'}
            description={kind === 'overtime'
              ? 'Nenhum funcionário fechou uma semana acima da jornada mínima nas batidas importadas.'
              : kind === 'deficit'
                ? 'Todos os funcionários atingiram a jornada mínima semanal no período selecionado.'
                : 'Não há mensalista com jornada ou batida neste intervalo. Confira o cadastro e a importação do ponto.'}
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
