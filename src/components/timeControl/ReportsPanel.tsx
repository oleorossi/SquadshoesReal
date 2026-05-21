import { useState, useMemo } from 'react';
import { FileText, CircleNotch as Loader2, Users as Users2, Clock, TrendUp as TrendingUp, MagnifyingGlass as Search } from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  useWorkSchedules, useHolidays, useTimeRecords, useImportBatches,
  calculateDaySummary, WorkSchedule,
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

export default function ReportsPanel() {
  const { data: batches = [] } = useImportBatches();
  const [selectedBatch, setSelectedBatch] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [searchEmployee, setSearchEmployee] = useState('');
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
    tolerance_minutes: 10, minimum_overtime_minutes: 0, is_default: true, created_at: '', updated_at: '',
  };

  const batchDateRange = resolvedFilters.dateRange;

  // Pre-compute holiday sets for O(1) lookups
  const holidayDates = useMemo(() => new Set(holidays.filter(h => !h.recurring).map(h => h.holiday_date)), [holidays]);
  const recurringHolidayMMDD = useMemo(() => new Set(holidays.filter(h => h.recurring).map(h => h.holiday_date.slice(5))), [holidays]);
  const isHolidayDate = (dateStr: string) => holidayDates.has(dateStr) || recurringHolidayMMDD.has(dateStr.slice(5));
  const reportData = useMemo(() => {
    if (records.length === 0) return [];
    const map = new Map<string, typeof records>();
    // linkedOnly:true descarta funcionários só do relógio sem cadastro
    // (fix 22/05/2026 — user pediu que esses não apareçam em relatórios).
    records.forEach(r => {
      const match = findEmployeeMatch(employees, r.employee_name, r.employee_external_id, { linkedOnly: true });
      if (!match) return;
      const resolvedName = match.name;
      if (!map.has(resolvedName)) map.set(resolvedName, []);
      map.get(resolvedName)!.push(r);
    });

    const results: Array<{
      name: string;
      days: number;
      workedMinutes: number;
      expectedMinutes: number;
      overtimeMinutes: number;
      absences: number;
      incomplete: number;
      salary: number;
      overtimeCost: number;
      adherencePct: number;
    }> = [];

    map.forEach((empRecords, name) => {
      const recordMap = new Map<string, string[]>();
      empRecords.forEach(rec => recordMap.set(rec.record_date, rec.punches as string[]));

      // Resolve employee and their individual schedule
      const firstRecord = empRecords[0];
      const emp = findEmployeeMatch(employees, name, firstRecord?.employee_external_id);
      const empSchedule = (emp?.work_schedule_id && schedules.find(s => s.id === emp.work_schedule_id)) || defaultSchedule;

      // Build day summaries
      const allDays: Array<{
        date: string; dayOfWeek: number; punches: string[];
        workedMinutes: number; expectedMinutes: number; overtimeMinutes: number;
        isHoliday: boolean; isAbsent: boolean; status: string;
      }> = [];

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
          const s = calculateDaySummary(punches, dayOfWeek, empSchedule, isHol);
          allDays.push({ date: dateStr, dayOfWeek, punches, ...s });
          cursor.setDate(cursor.getDate() + 1);
        }
      } else {
        empRecords.forEach(rec => {
          const date = new Date(rec.record_date + 'T12:00:00');
          const isHol = isHolidayDate(rec.record_date);
          const s = calculateDaySummary(rec.punches as string[], date.getDay(), empSchedule, isHol);
          allDays.push({ date: rec.record_date, dayOfWeek: date.getDay(), punches: rec.punches as string[], ...s });
        });
      }

      // Use unified weekly calculation with employee's own schedule
      const period = calculateWeeklyPeriod(allDays, empSchedule);

      const salary = emp?.salary || 0;
      const hourlySalary = salary / 220;
      // Deficit compensates overtime before computing cost
      const compensatedOvertime = Math.max(0, period.totalOvertimeMinutes - period.totalDeficitMinutes);
      const holidayWorkedMins = allDays
        .filter(d => d.isHoliday && d.workedMinutes > 0)
        .reduce((s, d) => s + d.workedMinutes, 0);
      const holidayOTMins = Math.min(compensatedOvertime, holidayWorkedMins);
      const normalOTMins = Math.max(0, compensatedOvertime - holidayOTMins);
      // Use per-employee overtime rate when configured; use empSchedule multipliers as fallback
      const hasCustomRate = emp?.overtime_hourly_rate != null && emp.overtime_hourly_rate > 0;
      const effectiveOTRate = hasCustomRate ? emp!.overtime_hourly_rate! : hourlySalary * empSchedule.overtime_multiplier;
      const effectiveHolidayRate = hasCustomRate
        ? emp!.overtime_hourly_rate! * (empSchedule.holiday_multiplier / empSchedule.overtime_multiplier)
        : hourlySalary * empSchedule.holiday_multiplier;
      const overtimeCost = (normalOTMins / 60) * effectiveOTRate
        + (holidayOTMins / 60) * effectiveHolidayRate;
      const adherencePct = period.totalExpectedMinutes > 0 ? Math.min(100, (period.totalWorkedMinutes / period.totalExpectedMinutes) * 100) : 0;

      results.push({
        name,
        days: empRecords.length,
        workedMinutes: period.totalWorkedMinutes,
        expectedMinutes: period.totalExpectedMinutes,
        overtimeMinutes: compensatedOvertime,
        absences: period.totalAbsences,
        incomplete: period.totalIncomplete,
        salary,
        overtimeCost,
        adherencePct,
      });
    });

    return results.sort((a, b) => a.name.localeCompare(b.name));
  }, [records, batchDateRange, isHolidayDate, defaultSchedule, schedules, employees]);

  const filteredReportData = useMemo(() => {
    if (!searchEmployee.trim()) return reportData;
    const term = searchEmployee.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return reportData.filter(e => e.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(term));
  }, [reportData, searchEmployee]);

  const totals = useMemo(() => ({
    worked: filteredReportData.reduce((s, e) => s + e.workedMinutes, 0),
    expected: filteredReportData.reduce((s, e) => s + e.expectedMinutes, 0),
    overtime: filteredReportData.reduce((s, e) => s + e.overtimeMinutes, 0),
    absences: filteredReportData.reduce((s, e) => s + e.absences, 0),
    overtimeCost: filteredReportData.reduce((s, e) => s + e.overtimeCost, 0),
  }), [filteredReportData]);

  if (isLoading) return <Loader2 className="h-6 w-6 animate-spin mx-auto my-8" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <FileText className="h-5 w-5" /> Relatórios de Frequência
          </h3>
          <p className="text-xs text-muted-foreground">Relatório consolidado por funcionário</p>
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
            <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione..." /></SelectTrigger>
            <SelectContent>
              {batches.map(b => <SelectItem key={b} value={b}>{b.replace(/_\d+$/, '')}</SelectItem>)}
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
          <Label className="text-xs font-medium">Funcionário</Label>
          <Select
            value={reportData.some(e => e.name === searchEmployee) ? searchEmployee : '__all__'}
            onValueChange={(v) => setSearchEmployee(v === '__all__' ? '' : v)}
          >
            <SelectTrigger className="mt-1">
              <SelectValue placeholder="Todos os funcionários" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="__all__">Todos os funcionários</SelectItem>
              {reportData.map(e => (
                <SelectItem key={e.name} value={e.name}>{e.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-56">
          <Label className="text-xs font-medium">Buscar (texto livre)</Label>
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
      </div>

      {filteredReportData.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <FileText className="h-12 w-12 mb-4 opacity-40" />
            <p className="font-medium">Selecione um período para gerar o relatório</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card><CardContent className="p-4 text-center">
              <Users2 className="h-5 w-5 mx-auto mb-1 text-primary" />
              <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Funcionários</p>
              <p className="text-2xl font-black font-mono">{filteredReportData.length}</p>
            </CardContent></Card>
            <Card><CardContent className="p-4 text-center">
              <Clock className="h-5 w-5 mx-auto mb-1 text-primary" />
              <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Total HE</p>
              <p className="text-2xl font-black font-mono text-amber-600">{minutesToDisplay(totals.overtime)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-4 text-center">
              <TrendingUp className="h-5 w-5 mx-auto mb-1 text-amber-500" />
              <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Custo HE</p>
              <p className="text-2xl font-black font-mono text-amber-600">{formatCurrency(totals.overtimeCost)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-4 text-center">
              <TrendingUp className="h-5 w-5 mx-auto mb-1 text-destructive" />
              <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Faltas</p>
              <p className="text-2xl font-black font-mono text-destructive">{totals.absences}</p>
            </CardContent></Card>
          </div>

          {/* Table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Detalhamento por Funcionário</CardTitle>
            </CardHeader>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Funcionário</TableHead>
                    <TableHead className="text-right">Dias</TableHead>
                    <TableHead className="text-right">Trabalhadas</TableHead>
                    <TableHead className="text-right">Esperadas</TableHead>
                    <TableHead className="text-right">HE</TableHead>
                    <TableHead className="text-right">Faltas</TableHead>
                    <TableHead className="text-right">Aderência</TableHead>
                    <TableHead className="text-right">Custo HE</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredReportData.map(emp => (
                    <TableRow key={emp.name}>
                      <TableCell className="font-medium text-sm">{emp.name}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{emp.days}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{minutesToDisplay(emp.workedMinutes)}</TableCell>
                      <TableCell className="text-right font-mono text-sm text-muted-foreground">{minutesToDisplay(emp.expectedMinutes)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {emp.overtimeMinutes > 0 ? <span className="text-amber-600 font-medium">{minutesToDisplay(emp.overtimeMinutes)}</span> : '—'}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {emp.absences > 0 ? <Badge variant="outline" className="text-xs text-destructive border-destructive/30">{emp.absences}</Badge> : <span className="text-green-600">✓</span>}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        <div className="flex items-center gap-2 justify-end">
                          <Progress value={emp.adherencePct} className="w-16 h-1.5" />
                          <span className={`font-mono text-xs font-medium ${emp.adherencePct >= 95 ? 'text-green-600' : emp.adherencePct >= 80 ? 'text-amber-600' : 'text-destructive'}`}>
                            {emp.adherencePct.toFixed(0)}%
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {emp.overtimeCost > 0 ? <span className="text-amber-600">{formatCurrency(emp.overtimeCost)}</span> : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/30 font-semibold border-t-2">
                    <TableCell>TOTAL</TableCell>
                    <TableCell className="text-right font-mono text-sm">—</TableCell>
                    <TableCell className="text-right font-mono text-sm">{minutesToDisplay(totals.worked)}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-muted-foreground">{minutesToDisplay(totals.expected)}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-amber-600">{minutesToDisplay(totals.overtime)}</TableCell>
                    <TableCell className="text-right text-sm text-destructive">{totals.absences}</TableCell>
                    <TableCell></TableCell>
                    <TableCell className="text-right font-mono text-sm text-amber-600">{formatCurrency(totals.overtimeCost)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
