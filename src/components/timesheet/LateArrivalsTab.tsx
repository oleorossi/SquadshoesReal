import { useMemo, useState } from 'react';
import {
  WarningCircle as AlertCircle, CaretDown as ChevronDown, CaretRight as ChevronRight,
  Clock, MagnifyingGlass as Search, Users as Users2, Printer, SignOut,
} from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useWorkSchedules, useHolidays, useTimeRecords, useImportBatches,
  WorkSchedule,
} from '@/hooks/useTimesheet';
import { useEmployees } from '@/hooks/useEmployees';
import { getBatchDateRange, resolveTimeControlFilters } from '@/lib/timeControlFilters';
import { findEmployeeMatch, resolveEmployeeName } from '@/lib/employeeMatching';
import { printHtml } from '@/lib/printOrder';
import { escapeHtml } from '@/lib/htmlUtils';

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

type OccurrenceType = 'late' | 'early';

interface Occurrence {
  employeeName: string;
  date: string;
  dayOfWeek: number;
  weekKey: string;
  scheduledTime: string;
  actualTime: string;
  diffMinutes: number;
  type: OccurrenceType;
}

interface WeekGroup {
  weekKey: string;
  weekLabel: string;
  occurrences: Occurrence[];
  totalLateMin: number;
  totalEarlyMin: number;
  employeeCount: number;
}

interface EmployeeGroup {
  name: string;
  occurrences: Occurrence[];
  totalLateMin: number;
  totalEarlyMin: number;
  daysAffected: number;
}

export default function LateArrivalsTab() {
  const { data: batches = [] } = useImportBatches();
  const [selectedBatch, setSelectedBatch] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [searchEmployee, setSearchEmployee] = useState('');
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());
  const [expandedEmployees, setExpandedEmployees] = useState<Set<string>>(new Set());
  const [minDiffMinutes, setMinDiffMinutes] = useState(5);

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

  const occurrences = useMemo<Occurrence[]>(() => {
    const result: Occurrence[] = [];

    for (const rec of records) {
      const punches = (rec.punches as string[]) || [];
      if (punches.length === 0) continue;

      const date = new Date(rec.record_date + 'T12:00:00');
      const dow = date.getDay();
      const isHol = isHolidayDate(rec.record_date);
      if (isHol || dow === 0) continue;

      const resolvedName = resolveEmployeeName(employees, rec.employee_name, rec.employee_external_id);
      const emp = findEmployeeMatch(employees, resolvedName, rec.employee_external_id);
      const empSchedule = (emp?.work_schedule_id && schedules.find(s => s.id === emp.work_schedule_id)) || defaultSchedule;

      const isSaturday = dow === 6;
      const hasSaturday = !!(empSchedule.saturday_entry && empSchedule.saturday_exit);
      if (isSaturday && !hasSaturday) continue;

      const scheduledEntry = isSaturday
        ? (empSchedule.saturday_entry || empSchedule.entry_time)
        : empSchedule.entry_time;
      const scheduledExit = isSaturday
        ? (empSchedule.saturday_exit || empSchedule.exit_time)
        : empSchedule.exit_time;

      const tolerance = empSchedule.tolerance_minutes || 10;
      const scheduledEntryMin = timeToMinutes(scheduledEntry);
      const scheduledExitMin = timeToMinutes(scheduledExit);

      const cleanedPunches = punches.map(cleanPunch).sort();
      const firstPunchMin = timeToMinutes(cleanedPunches[0]);
      const lastPunchMin = timeToMinutes(cleanedPunches[cleanedPunches.length - 1]);

      // Atraso: chegou depois do horário + tolerância
      const lateMinutes = firstPunchMin - scheduledEntryMin - tolerance;
      if (lateMinutes > 0 && lateMinutes >= minDiffMinutes) {
        result.push({
          employeeName: resolvedName,
          date: rec.record_date,
          dayOfWeek: dow,
          weekKey: getISOWeekKey(rec.record_date),
          scheduledTime: scheduledEntry,
          actualTime: cleanedPunches[0],
          diffMinutes: lateMinutes,
          type: 'late',
        });
      }

      // Saída antecipada: saiu antes do horário − tolerância
      const earlyMinutes = scheduledExitMin - lastPunchMin - tolerance;
      if (earlyMinutes > 0 && earlyMinutes >= minDiffMinutes && cleanedPunches.length >= 2) {
        result.push({
          employeeName: resolvedName,
          date: rec.record_date,
          dayOfWeek: dow,
          weekKey: getISOWeekKey(rec.record_date),
          scheduledTime: scheduledExit,
          actualTime: cleanedPunches[cleanedPunches.length - 1],
          diffMinutes: earlyMinutes,
          type: 'early',
        });
      }
    }

    result.sort((a, b) =>
      a.date.localeCompare(b.date)
      || a.employeeName.localeCompare(b.employeeName)
      || a.type.localeCompare(b.type),
    );
    return result;
  }, [records, employees, schedules, defaultSchedule, holidayDates, recurringHolidayMMDD, minDiffMinutes]);

  const filteredOccurrences = useMemo(() => {
    if (!searchEmployee.trim()) return occurrences;
    const term = searchEmployee.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return occurrences.filter(r =>
      r.employeeName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(term)
    );
  }, [occurrences, searchEmployee]);

  const weekGroups = useMemo<WeekGroup[]>(() => {
    const map = new Map<string, Occurrence[]>();
    filteredOccurrences.forEach(r => {
      if (!map.has(r.weekKey)) map.set(r.weekKey, []);
      map.get(r.weekKey)!.push(r);
    });
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekKey, recs]) => ({
        weekKey,
        weekLabel: formatWeekLabel(weekKey, recs[0].date),
        occurrences: recs,
        totalLateMin: recs.filter(r => r.type === 'late').reduce((s, r) => s + r.diffMinutes, 0),
        totalEarlyMin: recs.filter(r => r.type === 'early').reduce((s, r) => s + r.diffMinutes, 0),
        employeeCount: new Set(recs.map(r => r.employeeName)).size,
      }));
  }, [filteredOccurrences]);

  const employeeGroups = useMemo<EmployeeGroup[]>(() => {
    const map = new Map<string, Occurrence[]>();
    filteredOccurrences.forEach(r => {
      if (!map.has(r.employeeName)) map.set(r.employeeName, []);
      map.get(r.employeeName)!.push(r);
    });
    return [...map.entries()]
      .map(([name, recs]) => ({
        name,
        occurrences: recs,
        totalLateMin: recs.filter(r => r.type === 'late').reduce((s, r) => s + r.diffMinutes, 0),
        totalEarlyMin: recs.filter(r => r.type === 'early').reduce((s, r) => s + r.diffMinutes, 0),
        daysAffected: new Set(recs.map(r => r.date)).size,
      }))
      .sort((a, b) =>
        (b.totalLateMin + b.totalEarlyMin) - (a.totalLateMin + a.totalEarlyMin)
        || a.name.localeCompare(b.name),
      );
  }, [filteredOccurrences]);

  const toggleWeek = (wk: string) => {
    setExpandedWeeks(prev => {
      const next = new Set(prev);
      if (next.has(wk)) next.delete(wk); else next.add(wk);
      return next;
    });
  };
  const toggleEmployee = (name: string) => {
    setExpandedEmployees(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const totalOccurrences = filteredOccurrences.length;
  const totalLateMinutes = filteredOccurrences.filter(o => o.type === 'late').reduce((s, r) => s + r.diffMinutes, 0);
  const totalEarlyMinutes = filteredOccurrences.filter(o => o.type === 'early').reduce((s, r) => s + r.diffMinutes, 0);
  const totalDebitMinutes = totalLateMinutes + totalEarlyMinutes;
  const uniqueEmployees = new Set(filteredOccurrences.map(r => r.employeeName)).size;

  const handlePrintAll = () => {
    const periodLabel = `${filterStartDate || '—'} a ${filterEndDate || '—'}`;
    const bodyHtml = buildPrintAllHtml(employeeGroups, periodLabel, totalDebitMinutes);
    printHtml('Relatório de Atrasos & Saídas Antecipadas', bodyHtml);
  };

  const handlePrintEmployee = (eg: EmployeeGroup) => {
    const periodLabel = `${filterStartDate || '—'} a ${filterEndDate || '—'}`;
    const bodyHtml = buildPrintEmployeeHtml(eg, periodLabel);
    printHtml(`Atrasos · ${eg.name}`, bodyHtml);
  };

  if (isLoading) {
    return <div className="flex justify-center py-12 text-muted-foreground">Carregando...</div>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-500" /> Relatório de Atrasos & Saídas Antecipadas
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
              <Label className="text-xs">Mín. diferença (min)</Label>
              <Input
                type="number"
                min="1"
                value={minDiffMinutes}
                onChange={e => setMinDiffMinutes(Math.max(1, Number(e.target.value)))}
                className="h-9 w-24"
              />
            </div>
            {filteredOccurrences.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-2 ml-auto"
                onClick={handlePrintAll}
              >
                <Printer className="h-4 w-4" /> Imprimir relatório
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {records.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Clock className="h-8 w-8 mx-auto mb-2 opacity-40" />
            Selecione uma importação ou intervalo de datas para visualizar.
          </CardContent>
        </Card>
      ) : filteredOccurrences.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-40 text-green-500" />
            <p className="font-medium text-green-600">Nenhuma ocorrência!</p>
            <p className="text-xs mt-1">Todos os funcionários dentro da tolerância no período.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <Card>
              <CardContent className="p-4 text-center">
                <AlertCircle className="h-5 w-5 mx-auto mb-1 text-amber-500" />
                <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Ocorrências</p>
                <p className="text-2xl font-black font-mono text-amber-600">{totalOccurrences}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <Users2 className="h-5 w-5 mx-auto mb-1 text-destructive" />
                <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Funcionários</p>
                <p className="text-2xl font-black font-mono text-destructive">{uniqueEmployees}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <Clock className="h-5 w-5 mx-auto mb-1 text-orange-500" />
                <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Atrasos</p>
                <p className="text-2xl font-black font-mono text-orange-600">{minutesToHHMM(totalLateMinutes)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <SignOut className="h-5 w-5 mx-auto mb-1 text-orange-500" />
                <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Saídas +cedo</p>
                <p className="text-2xl font-black font-mono text-orange-600">{minutesToHHMM(totalEarlyMinutes)}</p>
              </CardContent>
            </Card>
            <Card className="border-primary/30">
              <CardContent className="p-4 text-center">
                <Clock className="h-5 w-5 mx-auto mb-1 text-primary" />
                <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Débito total</p>
                <p className="text-2xl font-black font-mono text-primary">{minutesToHHMM(totalDebitMinutes)}</p>
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="por-funcionario" className="space-y-3">
            <TabsList>
              <TabsTrigger value="por-funcionario" className="gap-1.5">
                <Users2 className="h-3.5 w-3.5" /> Por funcionário
              </TabsTrigger>
              <TabsTrigger value="por-semana" className="gap-1.5">
                <Clock className="h-3.5 w-3.5" /> Por semana
              </TabsTrigger>
            </TabsList>

            <TabsContent value="por-funcionario" className="space-y-2">
              {employeeGroups.map(eg => {
                const expanded = expandedEmployees.has(eg.name);
                return (
                  <Card key={eg.name} className="overflow-hidden">
                    <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                      <button
                        className="flex items-center gap-2 flex-1 text-left"
                        onClick={() => toggleEmployee(eg.name)}
                      >
                        {expanded
                          ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                          : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                        <span className="font-semibold text-sm flex-1">{eg.name}</span>
                        <Badge variant="outline" className="text-[10px] font-mono">
                          {eg.daysAffected} dia{eg.daysAffected !== 1 ? 's' : ''}
                        </Badge>
                        {eg.totalLateMin > 0 && (
                          <Badge variant="outline" className="text-[10px] font-mono text-orange-700 border-orange-500/30 bg-orange-500/10">
                            Atraso {minutesToHHMM(eg.totalLateMin)}
                          </Badge>
                        )}
                        {eg.totalEarlyMin > 0 && (
                          <Badge variant="outline" className="text-[10px] font-mono text-orange-700 border-orange-500/30 bg-orange-500/10">
                            Saída +cedo {minutesToHHMM(eg.totalEarlyMin)}
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-[10px] font-mono font-bold text-primary border-primary/30">
                          Total {minutesToHHMM(eg.totalLateMin + eg.totalEarlyMin)}
                        </Badge>
                      </button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1.5 text-xs"
                        onClick={() => handlePrintEmployee(eg)}
                      >
                        <Printer className="h-3.5 w-3.5" /> Imprimir
                      </Button>
                    </div>
                    {expanded && (
                      <div className="border-t">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/20">
                              <TableHead className="text-xs py-2">Data</TableHead>
                              <TableHead className="text-xs py-2">Dia</TableHead>
                              <TableHead className="text-xs py-2">Tipo</TableHead>
                              <TableHead className="text-xs py-2 text-right">Previsto</TableHead>
                              <TableHead className="text-xs py-2 text-right">Real</TableHead>
                              <TableHead className="text-xs py-2 text-right">Diferença</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {eg.occurrences.map((r, idx) => (
                              <TableRow key={idx} className="text-sm">
                                <TableCell className="font-mono py-2">
                                  {new Date(r.date + 'T12:00:00').toLocaleDateString('pt-BR')}
                                </TableCell>
                                <TableCell className="py-2 text-muted-foreground">{DAYS_PT[r.dayOfWeek]}</TableCell>
                                <TableCell className="py-2">
                                  <Badge
                                    variant="outline"
                                    className={r.type === 'late'
                                      ? 'text-xs text-amber-700 border-amber-500/40 bg-amber-500/10'
                                      : 'text-xs text-orange-700 border-orange-500/40 bg-orange-500/10'}
                                  >
                                    {r.type === 'late' ? 'Atraso' : 'Saída antecipada'}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right font-mono py-2 text-muted-foreground">
                                  {r.scheduledTime}
                                </TableCell>
                                <TableCell className="text-right font-mono py-2">{r.actualTime}</TableCell>
                                <TableCell className="text-right py-2">
                                  <span className="font-mono text-xs font-semibold text-primary">
                                    +{minutesToHHMM(r.diffMinutes)}
                                  </span>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </Card>
                );
              })}
            </TabsContent>

            <TabsContent value="por-semana" className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setExpandedWeeks(new Set(weekGroups.map(w => w.weekKey)))}>
                  Expandir tudo
                </Button>
                <span>·</span>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setExpandedWeeks(new Set())}>
                  Recolher tudo
                </Button>
              </div>
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
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] font-mono">
                          {wg.employeeCount} func.
                        </Badge>
                        {wg.totalLateMin > 0 && (
                          <Badge variant="outline" className="text-[10px] font-mono text-orange-700 border-orange-500/30 bg-orange-500/10">
                            Atraso {minutesToHHMM(wg.totalLateMin)}
                          </Badge>
                        )}
                        {wg.totalEarlyMin > 0 && (
                          <Badge variant="outline" className="text-[10px] font-mono text-orange-700 border-orange-500/30 bg-orange-500/10">
                            Saída +cedo {minutesToHHMM(wg.totalEarlyMin)}
                          </Badge>
                        )}
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
                              <TableHead className="text-xs py-2">Tipo</TableHead>
                              <TableHead className="text-xs py-2 text-right">Previsto</TableHead>
                              <TableHead className="text-xs py-2 text-right">Real</TableHead>
                              <TableHead className="text-xs py-2 text-right">Diferença</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {wg.occurrences.map((r, idx) => (
                              <TableRow key={idx} className="text-sm">
                                <TableCell className="font-medium py-2">{r.employeeName}</TableCell>
                                <TableCell className="font-mono py-2">
                                  {new Date(r.date + 'T12:00:00').toLocaleDateString('pt-BR')}
                                </TableCell>
                                <TableCell className="py-2 text-muted-foreground">{DAYS_PT[r.dayOfWeek]}</TableCell>
                                <TableCell className="py-2">
                                  <Badge
                                    variant="outline"
                                    className={r.type === 'late'
                                      ? 'text-xs text-amber-700 border-amber-500/40 bg-amber-500/10'
                                      : 'text-xs text-orange-700 border-orange-500/40 bg-orange-500/10'}
                                  >
                                    {r.type === 'late' ? 'Atraso' : 'Saída +cedo'}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right font-mono py-2 text-muted-foreground">
                                  {r.scheduledTime}
                                </TableCell>
                                <TableCell className="text-right font-mono py-2">{r.actualTime}</TableCell>
                                <TableCell className="text-right py-2">
                                  <span className="font-mono text-xs font-semibold text-primary">
                                    +{minutesToHHMM(r.diffMinutes)}
                                  </span>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </Card>
                );
              })}
            </TabsContent>
          </Tabs>
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

// ── Print helpers ────────────────────────────────────────────────────

function buildPrintEmployeeHtml(eg: EmployeeGroup, periodLabel: string): string {
  const occurrenceRows = eg.occurrences.map(r => `
    <tr>
      <td>${new Date(r.date + 'T12:00:00').toLocaleDateString('pt-BR')}</td>
      <td>${DAYS_PT[r.dayOfWeek]}</td>
      <td>${r.type === 'late' ? 'Atraso' : 'Saída antecipada'}</td>
      <td class="num">${r.scheduledTime}</td>
      <td class="num">${r.actualTime}</td>
      <td class="num"><strong>+${minutesToHHMM(r.diffMinutes)}</strong></td>
    </tr>
  `).join('');

  return `
    <style>
      body { font-family: -apple-system, sans-serif; padding: 24px; color: #1a1a1a; }
      h1 { font-size: 18pt; margin: 0 0 4px 0; }
      .meta { font-size: 9pt; color: #555; margin-bottom: 16px; }
      .summary { background: #f6f6f6; border-left: 3px solid #c54a4a; padding: 10px 14px; margin: 12px 0 18px 0; font-size: 10pt; }
      .summary strong { font-size: 12pt; font-family: 'Courier New', monospace; }
      table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
      th { background: #eaeaea; text-align: left; padding: 6px 8px; border-bottom: 1px solid #888; font-weight: 700; }
      td { padding: 5px 8px; border-bottom: 1px solid #ddd; }
      td.num { font-family: 'Courier New', monospace; text-align: right; }
      .footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #ccc; font-size: 8pt; color: #555; }
      .signature { display: flex; gap: 40px; margin-top: 40px; }
      .signature > div { flex: 1; border-top: 1px solid #888; padding-top: 6px; text-align: center; font-size: 9pt; color: #555; }
    </style>
    <h1>Relatório de Atrasos & Saídas Antecipadas</h1>
    <div class="meta">
      <strong>${escapeHtml(eg.name)}</strong><br/>
      Período: ${escapeHtml(periodLabel)}<br/>
      Emitido em: ${new Date().toLocaleString('pt-BR')}
    </div>
    <div class="summary">
      ${eg.totalLateMin > 0 ? `Atraso total: <strong>${minutesToHHMM(eg.totalLateMin)}</strong>` : ''}
      ${eg.totalLateMin > 0 && eg.totalEarlyMin > 0 ? ' · ' : ''}
      ${eg.totalEarlyMin > 0 ? `Saída antecipada total: <strong>${minutesToHHMM(eg.totalEarlyMin)}</strong>` : ''}
      ${' · '}Débito total: <strong>${minutesToHHMM(eg.totalLateMin + eg.totalEarlyMin)}</strong>
      ${' · '}Dias afetados: <strong>${eg.daysAffected}</strong>
    </div>
    <table>
      <thead>
        <tr>
          <th>Data</th>
          <th>Dia</th>
          <th>Tipo</th>
          <th style="text-align: right;">Previsto</th>
          <th style="text-align: right;">Real</th>
          <th style="text-align: right;">Diferença</th>
        </tr>
      </thead>
      <tbody>${occurrenceRows}</tbody>
    </table>
    <div class="signature">
      <div>Funcionário</div>
      <div>Responsável RH</div>
    </div>
    <div class="footer">
      Documento gerado automaticamente pelo sistema RH · Squad Shoes.
      Valores calculados sobre as batidas de ponto importadas, com tolerância CLT aplicada.
    </div>
  `;
}

function buildPrintAllHtml(groups: EmployeeGroup[], periodLabel: string, totalDebit: number): string {
  const rows = groups.map(eg => `
    <tr>
      <td>${escapeHtml(eg.name)}</td>
      <td class="num">${eg.daysAffected}</td>
      <td class="num">${eg.totalLateMin > 0 ? minutesToHHMM(eg.totalLateMin) : '—'}</td>
      <td class="num">${eg.totalEarlyMin > 0 ? minutesToHHMM(eg.totalEarlyMin) : '—'}</td>
      <td class="num"><strong>${minutesToHHMM(eg.totalLateMin + eg.totalEarlyMin)}</strong></td>
    </tr>
  `).join('');

  return `
    <style>
      body { font-family: -apple-system, sans-serif; padding: 24px; color: #1a1a1a; }
      h1 { font-size: 18pt; margin: 0 0 4px 0; }
      .meta { font-size: 9pt; color: #555; margin-bottom: 16px; }
      .summary { background: #f6f6f6; border-left: 3px solid #c54a4a; padding: 10px 14px; margin: 12px 0 18px 0; font-size: 10pt; }
      .summary strong { font-size: 12pt; font-family: 'Courier New', monospace; }
      table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
      th { background: #eaeaea; text-align: left; padding: 6px 8px; border-bottom: 1px solid #888; font-weight: 700; }
      td { padding: 5px 8px; border-bottom: 1px solid #ddd; }
      td.num { font-family: 'Courier New', monospace; text-align: right; }
      tfoot td { font-weight: 700; background: #eaeaea; border-top: 2px solid #555; }
      .footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #ccc; font-size: 8pt; color: #555; }
    </style>
    <h1>Relatório Consolidado · Atrasos & Saídas Antecipadas</h1>
    <div class="meta">
      Período: ${escapeHtml(periodLabel)}<br/>
      Emitido em: ${new Date().toLocaleString('pt-BR')}
    </div>
    <div class="summary">
      Funcionários afetados: <strong>${groups.length}</strong>
      ${' · '}Débito total acumulado: <strong>${minutesToHHMM(totalDebit)}</strong>
    </div>
    <table>
      <thead>
        <tr>
          <th>Funcionário</th>
          <th style="text-align: right;">Dias afetados</th>
          <th style="text-align: right;">Atraso total</th>
          <th style="text-align: right;">Saída antecipada</th>
          <th style="text-align: right;">Débito total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td>TOTAL</td>
          <td class="num">—</td>
          <td class="num">${minutesToHHMM(groups.reduce((s, g) => s + g.totalLateMin, 0))}</td>
          <td class="num">${minutesToHHMM(groups.reduce((s, g) => s + g.totalEarlyMin, 0))}</td>
          <td class="num">${minutesToHHMM(totalDebit)}</td>
        </tr>
      </tfoot>
    </table>
    <div class="footer">
      Documento gerado automaticamente pelo sistema RH · Squad Shoes.
    </div>
  `;
}
