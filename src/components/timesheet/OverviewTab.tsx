import { useEffect, useMemo, useState } from 'react';
import { Users as Users2, Clock, Warning as AlertTriangle, CheckCircle as CheckCircle2, XCircle, TrendUp as TrendingUp, CalendarBlank as CalendarDays, CircleNotch as Loader2, ChartBar as BarChart3, MagnifyingGlass as Search, Funnel as Filter } from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  useWorkSchedules, useHolidays, useTimeRecords, useImportBatches,
  calculateDaySummary, WorkSchedule, DaySummary,
} from '@/hooks/useTimesheet';
import { useEmployees } from '@/hooks/useEmployees';
import { getBatchDateRange, resolveTimeControlFilters } from '@/lib/timeControlFilters';
import { calculateWeeklyPeriod } from '@/lib/weeklyTimeCalculation';
import { findEmployeeMatch, resolveEmployeeName } from '@/lib/employeeMatching';

function minutesToDisplay(mins: number) {
  const sign = mins < 0 ? '-' : '';
  const abs = Math.abs(mins);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const formatCurrency = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

interface EmployeeOverview {
  name: string;
  days: number;
  workedMinutes: number;
  expectedMinutes: number;
  overtimeMinutes: number;
  deficitMinutes: number;
  absences: number;
  incomplete: number;
  holidaysWorked: number;
  adherencePct: number;
  salary: number;
  overtimeCost: number;
}

export default function OverviewTab() {
  const [searchEmployee, setSearchEmployee] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const { data: batches = [] } = useImportBatches();
  const [selectedBatch, setSelectedBatch] = useState<string>('');
  const [filterStartDate, setFilterStartDate] = useState<string>('');
  const [filterEndDate, setFilterEndDate] = useState<string>('');

  // Fix 22/05/2026: sem filtros default, useTimeRecords fica `enabled:false`
  // e a tab fica VAZIA depois de importar. Quando há batches mas nenhum
  // filtro escolhido, auto-seleciona o batch mais recente (primeiro do
  // array — get_distinct_batches já vem desc) pra ter dados na tela.
  useEffect(() => {
    if (batches.length > 0 && !selectedBatch && !filterStartDate && !filterEndDate) {
      setSelectedBatch(batches[0]);
    }
  }, [batches, selectedBatch, filterStartDate, filterEndDate]);

  const resolvedFilters = useMemo(() => resolveTimeControlFilters({
    selectedBatch,
    filterStartDate,
    filterEndDate,
  }), [selectedBatch, filterStartDate, filterEndDate]);
  const { data: records = [], isLoading } = useTimeRecords(
    resolvedFilters.queryBatch,
    resolvedFilters.queryStartDate,
    resolvedFilters.queryEndDate,
  );
  const { data: schedules = [] } = useWorkSchedules();
  const { data: holidays = [] } = useHolidays();
  const { data: employees = [] } = useEmployees();

  const defaultSchedule: WorkSchedule = schedules.find(s => s.is_default) || schedules[0] || {
    id: '', name: 'Default', entry_time: '08:00', lunch_start: '12:00', lunch_end: '13:00',
    exit_time: '17:48', saturday_entry: '08:00', saturday_exit: '12:00', weekly_hours: 44,
    overtime_multiplier: 1.5, night_overtime_multiplier: 1.7, holiday_multiplier: 2.0,
    tolerance_minutes: 10, minimum_overtime_minutes: 0, is_default: true, works_sunday: false, works_monday: true, works_tuesday: true, works_wednesday: true, works_thursday: true, works_friday: true, works_saturday: true, created_at: '', updated_at: '',
  };

  const batchDateRange = resolvedFilters.dateRange;

  // Pre-compute holiday sets for O(1) lookups
  const holidayDates = useMemo(() => new Set(holidays.filter(h => !h.recurring).map(h => h.holiday_date)), [holidays]);
  const recurringHolidayMMDD = useMemo(() => new Set(holidays.filter(h => h.recurring).map(h => h.holiday_date.slice(5))), [holidays]);
  const isHolidayDate = (dateStr: string) => holidayDates.has(dateStr) || recurringHolidayMMDD.has(dateStr.slice(5));

  const overviewData = useMemo<EmployeeOverview[]>(() => {
    if (records.length === 0) return [];

    // Group records by employee, resolving names via employee registry
    const map = new Map<string, typeof records>();
    // linkedOnly: true pula funcionários sem coligação (demitidos s/ external_id
    // explícito). Records órfãos somem em vez de aparecer com nome do relógio.
    records.forEach(r => {
      const match = findEmployeeMatch(employees, r.employee_name, r.employee_external_id, { linkedOnly: true });
      if (!match) return;
      const resolvedName = match.name;
      if (!map.has(resolvedName)) map.set(resolvedName, []);
      map.get(resolvedName)!.push(r);
    });

    const results: EmployeeOverview[] = [];

    map.forEach((empRecords, name) => {
      const recordMap = new Map<string, string[]>();
      empRecords.forEach(rec => {
        recordMap.set(rec.record_date, rec.punches as string[]);
      });

      // Resolve employee and their individual schedule
      const firstRecord = empRecords[0];
      const emp = findEmployeeMatch(employees, name, firstRecord?.employee_external_id);
      const empSchedule = (emp?.work_schedule_id && schedules.find(s => s.id === emp.work_schedule_id)) || defaultSchedule;

      // Generate all days
      const allDays: DaySummary[] = [];
      if (batchDateRange) {
        const start = new Date(batchDateRange.startDate + 'T12:00:00');
        const end = new Date(batchDateRange.endDate + 'T12:00:00');
         const cursor = new Date(start);
         let safetyCounter = 0;
         while (cursor <= end && safetyCounter < 1000) {
           safetyCounter++;
           const dateStr = cursor.toISOString().slice(0, 10);
          const dayOfWeek = cursor.getDay();
          const isHol = isHolidayDate(dateStr);
          const punches = recordMap.get(dateStr) || [];
          const summary = calculateDaySummary(punches, dayOfWeek, empSchedule, isHol);
          allDays.push({ ...summary, date: dateStr, punches } as DaySummary);
          cursor.setDate(cursor.getDate() + 1);
        }
      } else {
        empRecords.forEach(rec => {
          const date = new Date(rec.record_date + 'T12:00:00');
          const dayOfWeek = date.getDay();
          const isHol = isHolidayDate(rec.record_date);
          const summary = calculateDaySummary(rec.punches as string[], dayOfWeek, empSchedule, isHol);
          allDays.push({ ...summary, date: rec.record_date, punches: rec.punches as string[] } as DaySummary);
        });
      }

      // Use unified weekly calculation with employee's own schedule
      const period = calculateWeeklyPeriod(allDays, empSchedule);

      const salary = emp?.salary || 0;
      const hourlySalary = salary / 220;
      // Deficit compensates overtime before computing cost
      const compensatedOT = Math.max(0, period.totalOvertimeMinutes - period.totalDeficitMinutes);
      const holidayWorkedMins = allDays
        .filter(d => d.isHoliday && d.workedMinutes > 0)
        .reduce((s, d) => s + d.workedMinutes, 0);
      const holidayOTMins = Math.min(compensatedOT, holidayWorkedMins);
      const normalOTMins = Math.max(0, compensatedOT - holidayOTMins);
      // Use per-employee overtime rate when set; use empSchedule multipliers as fallback
      const hasCustomRate = emp?.overtime_hourly_rate != null && emp.overtime_hourly_rate > 0;
      const effectiveOTRate = hasCustomRate ? emp!.overtime_hourly_rate! : hourlySalary * empSchedule.overtime_multiplier;
      const effectiveHolidayRate = hasCustomRate
        ? emp!.overtime_hourly_rate! * (empSchedule.holiday_multiplier / empSchedule.overtime_multiplier)
        : hourlySalary * empSchedule.holiday_multiplier;
      const overtimeCost = (normalOTMins / 60) * effectiveOTRate
        + (holidayOTMins / 60) * effectiveHolidayRate;

      results.push({
        name, days: allDays.length,
        workedMinutes: period.totalWorkedMinutes,
        expectedMinutes: period.totalExpectedMinutes,
        overtimeMinutes: compensatedOT,
        deficitMinutes: period.totalDeficitMinutes,
        absences: period.totalAbsences,
        incomplete: period.totalIncomplete,
        holidaysWorked: period.totalHolidaysWorked,
        adherencePct: period.totalExpectedMinutes > 0 ? Math.min(100, (period.totalWorkedMinutes / period.totalExpectedMinutes) * 100) : 0,
        salary, overtimeCost,
      });
    });

    return results.sort((a, b) => a.name.localeCompare(b.name));
  }, [records, batchDateRange, isHolidayDate, defaultSchedule, schedules, employees]);

  // Separate filtering from heavy computation so typing/filter changes don't recalculate everything
  const filteredOverviewData = useMemo(() => {
    let filtered = overviewData;
    if (searchEmployee.trim()) {
      const term = searchEmployee.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      filtered = filtered.filter(e => e.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(term));
    }
    switch (statusFilter) {
      case 'overtime':
        filtered = filtered.filter(e => e.overtimeMinutes > 0);
        break;
      case 'absences':
        filtered = filtered.filter(e => e.absences > 0);
        break;
      case 'incomplete':
        filtered = filtered.filter(e => e.incomplete > 0);
        break;
      case 'deficit':
        filtered = filtered.filter(e => e.deficitMinutes > 0);
        break;
      case 'full_adherence':
        filtered = filtered.filter(e => e.adherencePct >= 95);
        break;
      case 'low_adherence':
        filtered = filtered.filter(e => e.adherencePct < 80 && e.adherencePct > 0);
        break;
      case 'holidays_worked':
        filtered = filtered.filter(e => e.holidaysWorked > 0);
        break;
    }
    return filtered;
  }, [overviewData, searchEmployee, statusFilter]);

  // Totals (all filtered employees)
  const totals = useMemo(() => {
    const worked = filteredOverviewData.reduce((s, e) => s + e.workedMinutes, 0);
    const expected = filteredOverviewData.reduce((s, e) => s + e.expectedMinutes, 0);
    return {
      employees: filteredOverviewData.length,
      worked,
      expected,
      overtime: filteredOverviewData.reduce((s, e) => s + e.overtimeMinutes, 0),
      deficit: filteredOverviewData.reduce((s, e) => s + e.deficitMinutes, 0),
      absences: filteredOverviewData.reduce((s, e) => s + e.absences, 0),
      incomplete: filteredOverviewData.reduce((s, e) => s + e.incomplete, 0),
      holidaysWorked: filteredOverviewData.reduce((s, e) => s + e.holidaysWorked, 0),
      overtimeCost: filteredOverviewData.reduce((s, e) => s + e.overtimeCost, 0),
      adherencePct: expected > 0 ? Math.min(100, (worked / expected) * 100) : 0,
    };
  }, [filteredOverviewData]);

  if (isLoading) return <Loader2 className="h-6 w-6 animate-spin mx-auto my-8" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <BarChart3 className="h-5 w-5" /> Visão Geral
          </h3>
          <p className="text-xs text-muted-foreground">Panorama consolidado de todos os funcionários para gestão</p>
        </div>
        <div className="w-56">
          <Label className="text-xs font-medium">Importação</Label>
          <Select value={selectedBatch} onValueChange={(value) => {
            setSelectedBatch(value);
            const range = getBatchDateRange(value);
            if (range) {
              setFilterStartDate(range.startDate);
              setFilterEndDate(range.endDate);
            }
          }}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione importação..." /></SelectTrigger>
            <SelectContent>
              {batches.map(b => (
                <SelectItem key={b} value={b}>{b.replace(/_\d+$/, '')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40">
          <Label className="text-xs font-medium">Data Início</Label>
          <Input type="date" value={filterStartDate} onChange={e => setFilterStartDate(e.target.value)} className="mt-1" />
        </div>
        <div className="w-40">
          <Label className="text-xs font-medium">Data Fim</Label>
          <Input type="date" value={filterEndDate} onChange={e => setFilterEndDate(e.target.value)} className="mt-1" />
        </div>
        <div className="w-56">
          <Label className="text-xs font-medium">Buscar Funcionário</Label>
          <div className="relative mt-1">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Digitar nome..."
              value={searchEmployee}
              onChange={e => setSearchEmployee(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>
        <div className="w-52">
          <Label className="text-xs font-medium flex items-center gap-1"><Filter className="h-3 w-3" /> Filtro</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="overtime">Com hora extra</SelectItem>
              <SelectItem value="absences">Com faltas</SelectItem>
              <SelectItem value="incomplete">Incompletos</SelectItem>
              <SelectItem value="deficit">Com déficit</SelectItem>
              <SelectItem value="full_adherence">Aderência ≥ 95%</SelectItem>
              <SelectItem value="low_adherence">Aderência {'<'} 80%</SelectItem>
              <SelectItem value="holidays_worked">Trabalhou feriado</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {filteredOverviewData.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Users2 className="h-12 w-12 mb-4 opacity-40" />
            <p className="font-medium">Nenhum dado disponível</p>
            <p className="text-xs mt-1">Selecione uma importação acima para visualizar o panorama</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Card>
              <CardContent className="p-4 text-center">
                <Users2 className="h-5 w-5 mx-auto mb-1 text-primary" />
                <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Funcionários</p>
                <p className="text-2xl font-black font-mono">{totals.employees}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <Clock className="h-5 w-5 mx-auto mb-1 text-primary" />
                <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Total Trabalhadas</p>
                <p className="text-2xl font-black font-mono">{minutesToDisplay(totals.worked)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <TrendingUp className="h-5 w-5 mx-auto mb-1 text-amber-500" />
                <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Horas Extras</p>
                <p className="text-2xl font-black font-mono text-amber-600">{minutesToDisplay(totals.overtime)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <XCircle className="h-5 w-5 mx-auto mb-1 text-destructive" />
                <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Faltas</p>
                <p className="text-2xl font-black font-mono text-destructive">{totals.absences}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <AlertTriangle className="h-5 w-5 mx-auto mb-1 text-amber-500" />
                <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Incompletos</p>
                <p className="text-2xl font-black font-mono text-amber-600">{totals.incomplete}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <CheckCircle2 className="h-5 w-5 mx-auto mb-1 text-green-500" />
                <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Aderência</p>
                <p className="text-2xl font-black font-mono text-green-600">{totals.adherencePct.toFixed(1)}%</p>
              </CardContent>
            </Card>
          </div>

          {/* Custo HE */}
          {totals.overtimeCost > 0 && (
            <Card className="border-amber-500/20 bg-amber-500/5">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-amber-500/10 rounded-lg">
                    <TrendingUp className="h-5 w-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-semibold uppercase">Custo Estimado de Horas Extras</p>
                    <p className="text-xs text-muted-foreground">Baseado nos salários e taxas individuais cadastradas (HE e atraso por dia, sem compensação)</p>
                  </div>
                </div>
                <p className="text-xl font-black font-mono text-amber-600">{formatCurrency(totals.overtimeCost)}</p>
              </CardContent>
            </Card>
          )}

          {/* Detail Table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Detalhamento por Funcionário</CardTitle>
            </CardHeader>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Funcionário</TableHead>
                    <TableHead className="text-right">Trabalhadas</TableHead>
                    <TableHead className="text-right">Esperadas</TableHead>
                    <TableHead className="text-right">HE Líquida</TableHead>
                    <TableHead className="text-right">Déficit</TableHead>
                    <TableHead className="text-right">Faltas</TableHead>
                    <TableHead className="text-right">Incompl.</TableHead>
                    <TableHead className="text-right">Feriados</TableHead>
                    <TableHead className="text-right">Aderência</TableHead>
                    <TableHead className="text-right">Custo HE</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOverviewData.map(emp => {
                    const hasIssue = emp.absences >= 3 || emp.incomplete >= 3 || emp.adherencePct < 80;
                    const rowClass = hasIssue
                      ? 'bg-destructive/5 hover:bg-destructive/10'
                      : emp.overtimeMinutes > 0
                      ? 'bg-amber-500/5 hover:bg-amber-500/10'
                      : '';
                    return (
                      <TableRow key={emp.name} className={rowClass}>
                        <TableCell className="font-medium text-sm">{emp.name}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{minutesToDisplay(emp.workedMinutes)}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-muted-foreground">{minutesToDisplay(emp.expectedMinutes)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {emp.overtimeMinutes > 0 ? (
                            <Badge className="text-xs bg-amber-500/15 text-amber-700 border-amber-500/30 hover:bg-amber-500/15 font-mono">{minutesToDisplay(emp.overtimeMinutes)}</Badge>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {emp.deficitMinutes > 0 ? (
                            <span className="text-destructive font-medium">{minutesToDisplay(emp.deficitMinutes)}</span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {emp.absences > 0 ? (
                            <Badge variant="outline" className="text-xs text-destructive border-destructive/40 font-mono">{emp.absences}</Badge>
                          ) : <span className="text-green-600 text-xs">✓</span>}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {emp.incomplete > 0 ? (
                            <Badge variant="outline" className="text-xs text-amber-700 border-amber-500/40 font-mono">{emp.incomplete}</Badge>
                          ) : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {emp.holidaysWorked > 0 ? (
                            <Badge variant="outline" className="text-xs text-blue-700 border-blue-500/40 font-mono">{emp.holidaysWorked}</Badge>
                          ) : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          <div className="flex items-center gap-2 justify-end">
                            <Progress value={emp.adherencePct} className="w-14 h-1.5" />
                            <span className={`font-mono text-xs font-medium ${emp.adherencePct >= 95 ? 'text-green-600' : emp.adherencePct >= 80 ? 'text-amber-600' : 'text-destructive'}`}>
                              {emp.adherencePct.toFixed(0)}%
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {emp.overtimeCost > 0 ? (
                            <span className="text-amber-600 font-medium">{formatCurrency(emp.overtimeCost)}</span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {/* Totals */}
                  <TableRow className="bg-muted/30 font-semibold border-t-2">
                    <TableCell className="text-xs font-bold uppercase tracking-wide">TOTAL ({totals.employees})</TableCell>
                    <TableCell className="text-right font-mono text-sm">{minutesToDisplay(totals.worked)}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-muted-foreground">{minutesToDisplay(totals.expected)}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-amber-600">{minutesToDisplay(totals.overtime)}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-destructive">{minutesToDisplay(totals.deficit)}</TableCell>
                    <TableCell className="text-right text-sm text-destructive font-mono">{totals.absences}</TableCell>
                    <TableCell className="text-right text-sm text-amber-600 font-mono">{totals.incomplete}</TableCell>
                    <TableCell className="text-right text-sm text-blue-600 font-mono">{totals.holidaysWorked}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      <span className={`font-medium ${totals.adherencePct >= 95 ? 'text-green-600' : 'text-amber-600'}`}>
                        {totals.adherencePct.toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-amber-600 font-bold">{formatCurrency(totals.overtimeCost)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </Card>

          {/* Alerts */}
          {filteredOverviewData.some(e => e.absences >= 3 || e.incomplete >= 3 || e.adherencePct < 80) && (
            <Card className="border-destructive/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-4 w-4" /> Alertas
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {filteredOverviewData.filter(e => e.absences >= 3).map(e => (
                  <p key={`abs-${e.name}`} className="text-xs flex items-center gap-2">
                    <XCircle className="h-3.5 w-3.5 text-destructive" />
                    <span className="font-medium">{e.name}</span> — {e.absences} faltas no período
                  </p>
                ))}
                {filteredOverviewData.filter(e => e.incomplete >= 3).map(e => (
                  <p key={`inc-${e.name}`} className="text-xs flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                    <span className="font-medium">{e.name}</span> — {e.incomplete} registros incompletos
                  </p>
                ))}
                {filteredOverviewData.filter(e => e.adherencePct < 80 && e.adherencePct > 0).map(e => (
                  <p key={`adh-${e.name}`} className="text-xs flex items-center gap-2">
                    <CalendarDays className="h-3.5 w-3.5 text-destructive" />
                    <span className="font-medium">{e.name}</span> — aderência de apenas {e.adherencePct.toFixed(0)}%
                  </p>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
