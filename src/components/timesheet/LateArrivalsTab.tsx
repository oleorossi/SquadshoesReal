import { useMemo, useState } from 'react';
import { WarningCircle as AlertCircle, CaretDown as ChevronDown, CaretRight as ChevronRight, Clock, MagnifyingGlass as Search, Users as Users2 } from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import {
  useWorkSchedules, useHolidays, useTimeRecords, useImportBatches,
  WorkSchedule,
} from '@/hooks/useTimesheet';
import { useEmployees } from '@/hooks/useEmployees';
import { getBatchDateRange, resolveTimeControlFilters } from '@/lib/timeControlFilters';
import { findEmployeeMatch, resolveEmployeeName } from '@/lib/employeeMatching';

const DAYS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function timeToMinutes(t: string): number {
  const [h, m] = (t || '00:00').split(':').map(Number);
  return h * 60 + m;
}

function minutesToHHMM(mins: number): string {
  const h = Math.floor(Math.abs(mins) / 60);
  const m = Math.abs(mins) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function cleanPunch(p: string) { return p.replace(/\*$/, ''); }

function getISOWeekKey(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay() || 7;
  d.setDate(d.getDate() + 4 - day);
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

interface LateRecord {
  employeeName: string;
  date: string;
  dayOfWeek: number;
  weekKey: string;
  scheduledEntry: string;
  actualEntry: string;
  lateMinutes: number;
}

interface WeekGroup {
  weekKey: string;
  weekLabel: string;
  records: LateRecord[];
  totalLateMinutes: number;
  employeeCount: number;
}

export default function LateArrivalsTab() {
  const { data: batches = [] } = useImportBatches();
  const [selectedBatch, setSelectedBatch] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [searchEmployee, setSearchEmployee] = useState('');
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());
  const [minLateMinutes, setMinLateMinutes] = useState(5);

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

  const holidayDates = useMemo(() => new Set(holidays.filter(h => !h.recurring).map(h => h.holiday_date)), [holidays]);
  const recurringHolidayMMDD = useMemo(() => new Set(holidays.filter(h => h.recurring).map(h => h.holiday_date.slice(5))), [holidays]);
  const isHolidayDate = (d: string) => holidayDates.has(d) || recurringHolidayMMDD.has(d.slice(5));

  const lateRecords = useMemo<LateRecord[]>(() => {
    const result: LateRecord[] = [];

    for (const rec of records) {
      const punches = (rec.punches as string[]) || [];
      if (punches.length === 0) continue;

      const date = new Date(rec.record_date + 'T12:00:00');
      const dow = date.getDay();
      const isHol = isHolidayDate(rec.record_date);
      if (isHol || dow === 0) continue; // skip holidays and sundays

      // Resolve employee — linkedOnly pula demitidos sem coligação explícita
      const emp = findEmployeeMatch(employees, rec.employee_name, rec.employee_external_id, { linkedOnly: true });
      if (!emp) continue;
      const resolvedName = emp.name;
      const empSchedule = (emp.work_schedule_id && schedules.find(s => s.id === emp.work_schedule_id)) || defaultSchedule;

      const isSaturday = dow === 6;
      const hasSaturday = !!(empSchedule.saturday_entry && empSchedule.saturday_exit);
      if (isSaturday && !hasSaturday) continue; // skip Saturday if no Saturday schedule

      const scheduledEntry = isSaturday
        ? (empSchedule.saturday_entry || empSchedule.entry_time)
        : empSchedule.entry_time;

      const tolerance = empSchedule.tolerance_minutes || 10;
      const scheduledMin = timeToMinutes(scheduledEntry);

      // Find first punch (entry)
      const cleanedPunches = punches.map(cleanPunch).sort();
      const firstPunchMin = timeToMinutes(cleanedPunches[0]);

      // Only count as late if strictly beyond scheduled + tolerance
      const lateMinutes = firstPunchMin - scheduledMin - tolerance;
      if (lateMinutes <= 0) continue;
      if (lateMinutes < minLateMinutes) continue;

      result.push({
        employeeName: resolvedName,
        date: rec.record_date,
        dayOfWeek: dow,
        weekKey: getISOWeekKey(rec.record_date),
        scheduledEntry,
        actualEntry: cleanedPunches[0],
        lateMinutes,
      });
    }

    result.sort((a, b) => a.date.localeCompare(b.date) || a.employeeName.localeCompare(b.employeeName));
    return result;
  }, [records, employees, schedules, defaultSchedule, holidayDates, recurringHolidayMMDD, minLateMinutes]);

  const filteredRecords = useMemo(() => {
    if (!searchEmployee.trim()) return lateRecords;
    const term = searchEmployee.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return lateRecords.filter(r =>
      r.employeeName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(term)
    );
  }, [lateRecords, searchEmployee]);

  const weekGroups = useMemo<WeekGroup[]>(() => {
    const map = new Map<string, LateRecord[]>();
    filteredRecords.forEach(r => {
      if (!map.has(r.weekKey)) map.set(r.weekKey, []);
      map.get(r.weekKey)!.push(r);
    });
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekKey, recs]) => ({
        weekKey,
        weekLabel: formatWeekLabel(weekKey, recs[0].date),
        records: recs,
        totalLateMinutes: recs.reduce((s, r) => s + r.lateMinutes, 0),
        employeeCount: new Set(recs.map(r => r.employeeName)).size,
      }));
  }, [filteredRecords]);

  const topLate = useMemo(() => {
    const map = new Map<string, number>();
    filteredRecords.forEach(r => {
      map.set(r.employeeName, (map.get(r.employeeName) || 0) + r.lateMinutes);
    });
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [filteredRecords]);

  const toggleWeek = (wk: string) => {
    setExpandedWeeks(prev => {
      const next = new Set(prev);
      if (next.has(wk)) next.delete(wk); else next.add(wk);
      return next;
    });
  };

  const expandAll = () => setExpandedWeeks(new Set(weekGroups.map(w => w.weekKey)));
  const collapseAll = () => setExpandedWeeks(new Set());

  const totalLateOccurrences = filteredRecords.length;
  const totalLateMinutes = filteredRecords.reduce((s, r) => s + r.lateMinutes, 0);
  const uniqueLateEmployees = new Set(filteredRecords.map(r => r.employeeName)).size;

  if (isLoading) {
    return <div className="flex justify-center py-12 text-muted-foreground">Carregando...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-500" /> Relatório de Atrasos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1.5 min-w-[200px]">
              <Label className="text-xs">Importação</Label>
              <Select value={selectedBatch} onValueChange={v => {
                setSelectedBatch(v);
                const range = getBatchDateRange(v);
                if (range) { setFilterStartDate(range.startDate); setFilterEndDate(range.endDate); }
              }}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                <SelectContent>
                  {batches.map(b => <SelectItem key={b} value={b}>{b.replace(/_\d+$/, '')}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Data Início</Label>
              <Input type="date" value={filterStartDate} onChange={e => setFilterStartDate(e.target.value)} className="h-9 w-40" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Data Fim</Label>
              <Input type="date" value={filterEndDate} onChange={e => setFilterEndDate(e.target.value)} className="h-9 w-40" />
            </div>
            <div className="space-y-1.5 min-w-[180px]">
              <Label className="text-xs">Buscar Funcionário</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Digitar nome..."
                  value={searchEmployee}
                  onChange={e => setSearchEmployee(e.target.value)}
                  className="h-9 pl-8"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Mín. atraso (min)</Label>
              <Input
                type="number"
                min="1"
                value={minLateMinutes}
                onChange={e => setMinLateMinutes(Math.max(1, Number(e.target.value)))}
                className="h-9 w-24"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {records.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Clock className="h-8 w-8 mx-auto mb-2 opacity-40" />
            Selecione uma importação ou intervalo de datas para visualizar os atrasos.
          </CardContent>
        </Card>
      ) : filteredRecords.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-40 text-green-500" />
            <p className="font-medium text-green-600">Nenhum atraso encontrado!</p>
            <p className="text-xs mt-1">Todos os funcionários chegaram dentro da tolerância no período.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-4 text-center">
                <AlertCircle className="h-5 w-5 mx-auto mb-1 text-amber-500" />
                <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Ocorrências</p>
                <p className="text-2xl font-black font-mono text-amber-600">{totalLateOccurrences}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <Users2 className="h-5 w-5 mx-auto mb-1 text-destructive" />
                <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Funcionários</p>
                <p className="text-2xl font-black font-mono text-destructive">{uniqueLateEmployees}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <Clock className="h-5 w-5 mx-auto mb-1 text-orange-500" />
                <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Total Atraso</p>
                <p className="text-2xl font-black font-mono text-orange-600">{minutesToHHMM(totalLateMinutes)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <Clock className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Média/ocorr.</p>
                <p className="text-2xl font-black font-mono">
                  {totalLateOccurrences > 0 ? minutesToHHMM(Math.round(totalLateMinutes / totalLateOccurrences)) : '—'}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Top 5 late employees */}
          {topLate.length > 0 && (
            <Card className="border-amber-500/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-amber-600">
                  <AlertCircle className="h-4 w-4" /> Funcionários com mais atraso acumulado
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-2">
                  {topLate.map(([name, totalMins], i) => (
                    <div key={name} className="flex items-center gap-3 text-sm">
                      <span className="text-muted-foreground font-mono w-5 text-right">{i + 1}.</span>
                      <span className="flex-1 font-medium">{name}</span>
                      <Badge variant="outline" className="font-mono text-xs text-amber-700 border-amber-500/40 bg-amber-500/10">
                        {minutesToHHMM(totalMins)}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Week-by-week groups */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={expandAll}>Expandir tudo</Button>
            <span>·</span>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={collapseAll}>Recolher tudo</Button>
          </div>

          <div className="space-y-2">
            {weekGroups.map(wg => {
              const expanded = expandedWeeks.has(wg.weekKey);
              return (
                <Card key={wg.weekKey} className="overflow-hidden">
                  <button
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors text-left"
                    onClick={() => toggleWeek(wg.weekKey)}
                  >
                    {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                    <span className="font-semibold text-sm flex-1">{wg.weekLabel}</span>
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="text-[10px] font-mono text-amber-700 border-amber-500/30 bg-amber-500/10">
                        {wg.records.length} atraso{wg.records.length !== 1 ? 's' : ''}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {wg.employeeCount} func.
                      </Badge>
                      <span className="font-mono text-xs text-orange-600 font-semibold">
                        {minutesToHHMM(wg.totalLateMinutes)}
                      </span>
                    </div>
                  </button>
                  {expanded && (
                    <div className="border-t">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/20">
                            <TableHead className="text-xs py-2">Funcionário</TableHead>
                            <TableHead className="text-xs py-2">Data</TableHead>
                            <TableHead className="text-xs py-2">Dia</TableHead>
                            <TableHead className="text-xs py-2 text-right">Previsto</TableHead>
                            <TableHead className="text-xs py-2 text-right">Chegada</TableHead>
                            <TableHead className="text-xs py-2 text-right">Atraso</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {wg.records.map((r, idx) => (
                            <TableRow key={idx} className="text-sm">
                              <TableCell className="font-medium py-2">{r.employeeName}</TableCell>
                              <TableCell className="font-mono py-2">
                                {new Date(r.date + 'T12:00:00').toLocaleDateString('pt-BR')}
                              </TableCell>
                              <TableCell className="py-2 text-muted-foreground">{DAYS_PT[r.dayOfWeek]}</TableCell>
                              <TableCell className="text-right font-mono py-2 text-muted-foreground">
                                {r.scheduledEntry}
                              </TableCell>
                              <TableCell className="text-right font-mono py-2">
                                {r.actualEntry}
                              </TableCell>
                              <TableCell className="text-right py-2">
                                <Badge
                                  variant="outline"
                                  className={`font-mono text-xs ${
                                    r.lateMinutes >= 60
                                      ? 'text-destructive border-destructive/40 bg-destructive/10'
                                      : r.lateMinutes >= 30
                                      ? 'text-orange-600 border-orange-500/40 bg-orange-500/10'
                                      : 'text-amber-600 border-amber-500/40 bg-amber-500/10'
                                  }`}
                                >
                                  +{minutesToHHMM(r.lateMinutes)}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                          {/* Week total */}
                          <TableRow className="bg-muted/20 font-semibold">
                            <TableCell colSpan={4} className="text-xs py-2 text-muted-foreground">
                              SUBTOTAL — {wg.employeeCount} funcionário{wg.employeeCount !== 1 ? 's' : ''}, {wg.records.length} ocorrência{wg.records.length !== 1 ? 's' : ''}
                            </TableCell>
                            <TableCell className="text-right py-2" />
                            <TableCell className="text-right font-mono text-xs py-2 text-orange-600">
                              +{minutesToHHMM(wg.totalLateMinutes)}
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function formatWeekLabel(weekKey: string, sampleDate: string): string {
  const d = new Date(sampleDate + 'T12:00:00');
  const day = d.getDay() || 7;
  const monday = new Date(d);
  monday.setDate(monday.getDate() - day + 1);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  const fmtBR = (dt: Date) => dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return `Semana ${weekKey.split('-W')[1]} — ${fmtBR(monday)} a ${fmtBR(sunday)}`;
}
