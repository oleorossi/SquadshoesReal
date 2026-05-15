import AppLayout from "@/components/layout/AppLayout";
import ExceptionsTab from '@/components/timesheet/ExceptionsTab';
import DivergencesTab from '@/components/timesheet/DivergencesTab';
import OverviewTab from '@/components/timesheet/OverviewTab';
import ManualEntryTab from '@/components/timesheet/ManualEntryTab';
import LateArrivalsTab from '@/components/timesheet/LateArrivalsTab';
import ImportHistoryPanel from '@/components/timesheet/ImportHistoryPanel';
import PendingTimeRecordsPanel from '@/components/timesheet/PendingTimeRecordsPanel';
import TimeValidationPanel from '@/components/timeControl/TimeValidationPanel';
import ReportsPanel from '@/components/timeControl/ReportsPanel';
import { OvertimeResolutionPanel } from '@/components/timesheet/OvertimeResolutionPanel';
import { WeeklyOvertimeResolutionPanel } from '@/components/timesheet/WeeklyOvertimeResolutionPanel';
import { TimesheetPeriodSelector } from '@/components/timesheet/TimesheetPeriodSelector';
import { useState, useRef, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Clock, Upload, Plus, Trash as Trash2, CircleNotch as Loader2, Calendar, Gear as Settings2, Warning as AlertTriangle, FileXls as FileSpreadsheet, CaretDown as ChevronDown, Sun, Moon, Coffee, CheckCircle as CheckCircle2, XCircle, MinusCircle, Printer, Users as Users2, CurrencyDollar as DollarSign, Link as Link2, Unlink2, Shield, FileText, Clipboard as ClipboardEdit, Alarm as AlarmClock, ClockCounterClockwise as History, Wallet } from '@phosphor-icons/react';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { HubTabsList } from '@/components/layout/HubTabs';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import {
  useWorkSchedules, useAddWorkSchedule, useUpdateWorkSchedule, useDeleteWorkSchedule,
  useHolidays, useAddHoliday, useDeleteHoliday,
  useTimeRecords, useImportBatches, useImportTimeRecords, useDeleteBatch,
  useAllImportsDateRange,
  parseTimesheetXlsx, parseTimesheetTxt, calculateDaySummary,
  WorkSchedule, Holiday, TimeRecord, ParsedEmployee, DaySummary,
} from '@/hooks/useTimesheet';
import { useEmployees, useUpdateEmployee } from '@/hooks/useEmployees';
import { printAllEmployeesTimesheet, printEmployeeTimesheet, printAllIndividualTimesheets, printCalendarReport, printIndividualCalendarReport, saveEmployeeTimesheetPdf, EmployeeTimesheetData } from '@/lib/printTimesheet';
import { printTimeMirror } from '@/lib/printTimeMirror';
import { useBankHoursBalances } from '@/hooks/useRH';
import { getBatchDateRange, resolveTimeControlFilters } from '@/lib/timeControlFilters';
import { calculateWeeklyPeriod } from '@/lib/weeklyTimeCalculation';
import { findEmployeeMatch, resolveEmployeeName } from '@/lib/employeeMatching';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';

const DAYS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const formatCurrency = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

// ── Work Schedule Tab ──────────────────────────────────
function WorkScheduleTab() {
  const { data: schedules = [], isLoading } = useWorkSchedules();
  const addSchedule = useAddWorkSchedule();
  const updateSchedule = useUpdateWorkSchedule();
  const deleteSchedule = useDeleteWorkSchedule();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<WorkSchedule | null>(null);
  const [form, setForm] = useState({
    name: 'Padrão CLT 44h',
    entry_time: '08:00',
    lunch_start: '12:00',
    lunch_end: '13:00',
    exit_time: '17:48',
    saturday_entry: '08:00',
    saturday_exit: '12:00',
    weekly_hours: 44,
    overtime_multiplier: 1.5,
    night_overtime_multiplier: 1.7,
    holiday_multiplier: 2.0,
    tolerance_minutes: 10,
    minimum_overtime_minutes: 0,
    is_default: false,
  });

  const openAdd = () => {
    setEditing(null);
    setForm({
      name: 'Padrão CLT 44h', entry_time: '08:00', lunch_start: '12:00', lunch_end: '13:00',
      exit_time: '17:48', saturday_entry: '08:00', saturday_exit: '12:00',
      weekly_hours: 44, overtime_multiplier: 1.5, night_overtime_multiplier: 1.7,
      holiday_multiplier: 2.0, tolerance_minutes: 10, minimum_overtime_minutes: 0, is_default: false,
    });
    setDialogOpen(true);
  };

  const openEdit = (s: WorkSchedule) => {
    setEditing(s);
    setForm({
      name: s.name, entry_time: s.entry_time, lunch_start: s.lunch_start,
      lunch_end: s.lunch_end, exit_time: s.exit_time,
      saturday_entry: s.saturday_entry || '08:00', saturday_exit: s.saturday_exit || '12:00',
      weekly_hours: s.weekly_hours, overtime_multiplier: s.overtime_multiplier,
      night_overtime_multiplier: s.night_overtime_multiplier, holiday_multiplier: s.holiday_multiplier,
      tolerance_minutes: s.tolerance_minutes, minimum_overtime_minutes: s.minimum_overtime_minutes || 0,
      is_default: s.is_default,
    });
    setDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editing) {
      updateSchedule.mutate({ id: editing.id, data: form });
    } else {
      addSchedule.mutate(form);
    }
    setDialogOpen(false);
  };

  if (isLoading) return <Loader2 className="h-6 w-6 animate-spin mx-auto my-8" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Horários de Trabalho</h3>
          <p className="text-xs text-muted-foreground">Configure os padrões de jornada CLT (44h semanais)</p>
        </div>
        <Button onClick={openAdd} size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" /> Novo Horário
        </Button>
      </div>

      {schedules.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Clock className="h-10 w-10 mb-3 opacity-50" />
            <p>Nenhum horário cadastrado</p>
            <p className="text-xs mt-1">Cadastre o horário padrão CLT para calcular horas extras e faltas</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {schedules.map(s => {
            // Compute daily working minutes for display
            const toMin = (t: string) => {
              const [h, m] = t.split(':').map(Number);
              return h * 60 + (m || 0);
            };
            const entryMin = toMin(s.entry_time);
            const lunchStartMin = toMin(s.lunch_start);
            const lunchEndMin = toMin(s.lunch_end);
            const exitMin = toMin(s.exit_time);
            const lunchDuration = lunchEndMin - lunchStartMin;
            const dailyMins = (exitMin - entryMin) - lunchDuration;
            const dailyHours = dailyMins / 60;
            const satMin = s.saturday_entry && s.saturday_exit
              ? toMin(s.saturday_exit) - toMin(s.saturday_entry)
              : 0;
            const satLabel = satMin > 0 ? `${(satMin / 60).toFixed(1)}h` : '—';
            return (
            <Card key={s.id} className={s.is_default ? 'ring-2 ring-primary/30' : ''}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-sm">{s.name}</h4>
                    {s.is_default && <Badge className="text-[10px]">Padrão</Badge>}
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(s)}>
                      <Settings2 className="h-3.5 w-3.5" />
                    </Button>
                    <DeleteConfirmButton onConfirm={() => deleteSchedule.mutate(s.id)} title="Excluir escala?" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div className="flex items-center gap-1.5"><Sun className="h-3 w-3 text-amber-500" /> Entrada: <span className="font-mono font-medium">{s.entry_time}</span></div>
                  <div className="flex items-center gap-1.5"><Coffee className="h-3 w-3 text-orange-500" /> Almoço: <span className="font-mono font-medium">{s.lunch_start}–{s.lunch_end}</span></div>
                  <div className="flex items-center gap-1.5"><Moon className="h-3 w-3 text-indigo-500" /> Saída: <span className="font-mono font-medium">{s.exit_time}</span></div>
                  <div>Sáb: <span className="font-mono font-medium">{s.saturday_entry || '—'}–{s.saturday_exit || '—'}</span></div>
                </div>
                <Separator />
                <div className="grid grid-cols-4 gap-2 text-xs text-muted-foreground">
                  <div>Semanal: <span className="font-medium text-foreground">{s.weekly_hours}h</span></div>
                  <div>Dia: <span className="font-medium text-foreground">{dailyHours.toFixed(1)}h</span></div>
                  <div>Sáb: <span className="font-medium text-foreground">{satLabel}</span></div>
                  <div>Tolerância: <span className="font-medium text-foreground">{s.tolerance_minutes}min</span></div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                  <div>HE normal: <span className="font-medium text-foreground">{s.overtime_multiplier}x</span></div>
                  <div>HE feriado: <span className="font-medium text-foreground">{s.holiday_multiplier}x</span></div>
                  <div>Mín. HE: <span className="font-medium text-foreground">{s.minimum_overtime_minutes > 0 ? `${s.minimum_overtime_minutes}min` : 'sem mínimo'}</span></div>
                </div>
              </CardContent>
            </Card>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar Horário' : 'Novo Horário de Trabalho'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div>
              <Label>Nome</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="mt-1" />
            </div>

            <div className="border rounded-lg p-3 space-y-3">
              <Label className="text-sm font-semibold">Jornada Seg–Sex</Label>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">Entrada</Label><Input type="time" value={form.entry_time} onChange={e => setForm(f => ({ ...f, entry_time: e.target.value }))} className="mt-1 font-mono" /></div>
                <div><Label className="text-xs">Saída</Label><Input type="time" value={form.exit_time} onChange={e => setForm(f => ({ ...f, exit_time: e.target.value }))} className="mt-1 font-mono" /></div>
                <div><Label className="text-xs">Início Almoço</Label><Input type="time" value={form.lunch_start} onChange={e => setForm(f => ({ ...f, lunch_start: e.target.value }))} className="mt-1 font-mono" /></div>
                <div><Label className="text-xs">Fim Almoço</Label><Input type="time" value={form.lunch_end} onChange={e => setForm(f => ({ ...f, lunch_end: e.target.value }))} className="mt-1 font-mono" /></div>
              </div>
            </div>

            <div className="border rounded-lg p-3 space-y-3">
              <Label className="text-sm font-semibold">Sábado</Label>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">Entrada</Label><Input type="time" value={form.saturday_entry} onChange={e => setForm(f => ({ ...f, saturday_entry: e.target.value }))} className="mt-1 font-mono" /></div>
                <div><Label className="text-xs">Saída</Label><Input type="time" value={form.saturday_exit} onChange={e => setForm(f => ({ ...f, saturday_exit: e.target.value }))} className="mt-1 font-mono" /></div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Horas Semanais</Label><Input type="number" value={form.weekly_hours} onChange={e => setForm(f => ({ ...f, weekly_hours: Number(e.target.value) }))} className="mt-1" /></div>
              <div><Label className="text-xs">Tolerância (min)</Label><Input type="number" value={form.tolerance_minutes} onChange={e => setForm(f => ({ ...f, tolerance_minutes: Number(e.target.value) }))} className="mt-1" /></div>
              <div><Label className="text-xs">Mín. HE para contar (min)</Label><Input type="number" min="0" value={form.minimum_overtime_minutes} onChange={e => setForm(f => ({ ...f, minimum_overtime_minutes: Number(e.target.value) }))} className="mt-1" placeholder="0 = sem mínimo" /></div>
              <div><Label className="text-xs">Multiplicador HE</Label><Input type="number" step="0.1" value={form.overtime_multiplier} onChange={e => setForm(f => ({ ...f, overtime_multiplier: Number(e.target.value) }))} className="mt-1" /></div>
              <div><Label className="text-xs">Multiplicador Feriado</Label><Input type="number" step="0.1" value={form.holiday_multiplier} onChange={e => setForm(f => ({ ...f, holiday_multiplier: Number(e.target.value) }))} className="mt-1" /></div>
              <div><Label className="text-xs">Mult. HE Noturna</Label><Input type="number" step="0.1" value={form.night_overtime_multiplier} onChange={e => setForm(f => ({ ...f, night_overtime_multiplier: Number(e.target.value) }))} className="mt-1" /></div>
            </div>

            <div className="flex items-center gap-3">
              <Switch checked={form.is_default} onCheckedChange={v => setForm(f => ({ ...f, is_default: v }))} />
              <Label>Horário padrão</Label>
            </div>

            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit">{editing ? 'Salvar' : 'Cadastrar'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Holidays Tab ──────────────────────────────────
function HolidaysTab() {
  const { data: holidays = [], isLoading } = useHolidays();
  const addHoliday = useAddHoliday();
  const deleteHoliday = useDeleteHoliday();
  const [form, setForm] = useState({ name: '', holiday_date: '', recurring: false });
  const [adding, setAdding] = useState(false);

  const handleAdd = () => {
    if (!form.name || !form.holiday_date) { toast.error('Preencha nome e data'); return; }
    addHoliday.mutate(form);
    setForm({ name: '', holiday_date: '', recurring: false });
    setAdding(false);
  };

  const defaultHolidays = [
    // Nacionais
    { name: 'Confraternização Universal', date: '01-01', cat: 'Nacional' },
    { name: 'Carnaval', date: '03-04', cat: 'Nacional' },
    { name: 'Sexta-feira Santa', date: '04-18', cat: 'Nacional' },
    { name: 'Tiradentes', date: '04-21', cat: 'Nacional' },
    { name: 'Dia do Trabalho', date: '05-01', cat: 'Nacional' },
    { name: 'Corpus Christi', date: '06-19', cat: 'Nacional' },
    { name: 'Independência do Brasil', date: '09-07', cat: 'Nacional' },
    { name: 'Nossa Sra. Aparecida', date: '10-12', cat: 'Nacional' },
    { name: 'Finados', date: '11-02', cat: 'Nacional' },
    { name: 'Proclamação da República', date: '11-15', cat: 'Nacional' },
    { name: 'Natal', date: '12-25', cat: 'Nacional' },
    // Estaduais RJ
    { name: 'Dia de São Jorge (RJ)', date: '04-23', cat: 'Estadual RJ' },
    { name: 'Dia da Consciência Negra (RJ)', date: '11-20', cat: 'Estadual RJ' },
    // Municipais Belford Roxo
    { name: 'Aniversário de Belford Roxo', date: '04-01', cat: 'Belford Roxo' },
    { name: 'Dia de São Cristóvão (Belford Roxo)', date: '07-25', cat: 'Belford Roxo' },
  ];

  const addDefaultHolidays = () => {
    const year = new Date().getFullYear();
    defaultHolidays.forEach(h => {
      addHoliday.mutate({ name: `${h.name}`, holiday_date: `${year}-${h.date}`, recurring: true });
    });
  };

  if (isLoading) return <Loader2 className="h-6 w-6 animate-spin mx-auto my-8" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Feriados</h3>
          <p className="text-xs text-muted-foreground">Cadastre os feriados para cálculo correto de horas extras</p>
        </div>
        <div className="flex gap-2">
          {holidays.length === 0 && (
            <Button variant="outline" size="sm" onClick={addDefaultHolidays} className="gap-1.5 text-xs">
              <Calendar className="h-3.5 w-3.5" /> Adicionar Feriados (Nacionais + RJ + Belford Roxo)
            </Button>
          )}
          <Button size="sm" onClick={() => setAdding(!adding)} className="gap-1.5">
            <Plus className="h-4 w-4" /> Novo
          </Button>
        </div>
      </div>

      {adding && (
        <Card>
          <CardContent className="p-4 flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[150px]">
              <Label className="text-xs">Nome</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="mt-1" placeholder="Ex: Natal" />
            </div>
            <div className="w-40">
              <Label className="text-xs">Data</Label>
              <Input type="date" value={form.holiday_date} onChange={e => setForm(f => ({ ...f, holiday_date: e.target.value }))} className="mt-1" />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.recurring} onCheckedChange={v => setForm(f => ({ ...f, recurring: v }))} />
              <Label className="text-xs">Recorrente</Label>
            </div>
            <Button size="sm" onClick={handleAdd}>Adicionar</Button>
          </CardContent>
        </Card>
      )}

      {holidays.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Calendar className="h-10 w-10 mb-3 opacity-50" />
            <p>Nenhum feriado cadastrado</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Recorrente</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {holidays.map(h => (
                  <TableRow key={h.id}>
                    <TableCell className="font-medium text-sm">{h.name}</TableCell>
                    <TableCell className="font-mono text-sm">{new Date(h.holiday_date + 'T12:00:00').toLocaleDateString('pt-BR')}</TableCell>
                    <TableCell>{h.recurring ? <Badge variant="outline" className="text-[10px]">Sim</Badge> : '—'}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteHoliday.mutate(h.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Import & Records Tab ──────────────────────────────
function TimesheetRecordsTab() {
  const { data: batches = [] } = useImportBatches();
  const { data: fullDateRange } = useAllImportsDateRange();
  // Quando NÃO houver filtro de data setado, default = mês corrente.
  // Auto-preenchimento elimina a necessidade de selecionar um batch específico
  // pra começar a ver dados — usuário pode mudar pra qualquer período depois.
  const today = new Date();
  const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
  const [selectedBatch, setSelectedBatch] = useState<string>('');
  const [filterStartDate, setFilterStartDate] = useState<string>(monthStart);
  const [filterEndDate, setFilterEndDate] = useState<string>(monthEnd);
  // Período de ponto cadastrado (Bloco A da reformulação) — quando setado,
  // preenche as datas de filtro automaticamente.
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
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
  const { data: bankBalances = [] } = useBankHoursBalances();
  const importRecords = useImportTimeRecords();
  const updateEmployee = useUpdateEmployee();
  const deleteBatch = useDeleteBatch();

  const fileRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  // Mantém o File original junto com o preview pra permitir arquivá-lo no
  // bucket timesheet-imports após confirmação da importação (PR Frente 2).
  const [preview, setPreview] = useState<{ employees: ParsedEmployee[]; startDate: string; endDate: string; rawFile?: File } | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<string>('');
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  // Employee matching: parsed name → registered employee name
  const [employeeMatches, setEmployeeMatches] = useState<Record<string, string>>({});

  // Employee matching uses shared utility from '@/lib/employeeMatching'

  const findBestEmployeeMatch = (sourceName: string, externalId?: string) => {
    return findEmployeeMatch(employees, sourceName, externalId);
  };

  // Auto-match parsed employees to registered ones
  const autoMatchEmployees = (parsed: ParsedEmployee[]) => {
    const matches: Record<string, string> = {};
    for (const emp of parsed) {
      const match = findBestEmployeeMatch(emp.name, emp.externalId);
      if (match) {
        matches[emp.name] = match.name;
      }
    }
    setEmployeeMatches(matches);
  };

  const defaultSchedule: WorkSchedule = schedules.find(s => s.is_default) || schedules[0] || {
    id: '', name: 'Default', entry_time: '08:00', lunch_start: '12:00', lunch_end: '13:00',
    exit_time: '17:48', saturday_entry: '08:00', saturday_exit: '12:00', weekly_hours: 44,
    overtime_multiplier: 1.5, night_overtime_multiplier: 1.7, holiday_multiplier: 2.0,
    tolerance_minutes: 10, minimum_overtime_minutes: 0, is_default: true, created_at: '', updated_at: '',
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    try {
      const name = file.name.toLowerCase();
      const isTxt = name.endsWith('.txt');
      const isCsv = name.endsWith('.csv');
      const isJson = name.endsWith('.json');

      // Detecta arquivo do relógio AGL (UTF-16 LE BOM) lendo primeiros bytes
      let isAGLClock = false;
      if (isTxt || isCsv || isJson) {
        const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
        isAGLClock = isTxt && head.length >= 2 && head[0] === 0xFF && head[1] === 0xFE;
      }

      let result: { employees: ParsedEmployee[]; startDate: string; endDate: string };
      if (isAGLClock || isCsv || isJson) {
        const { parseTimeClockFile, groupPunchesByDay } = await import('@/lib/timeClockParser');
        const parsed = await parseTimeClockFile(file);
        const days = groupPunchesByDay(parsed.punches);
        // Converte pro formato ParsedEmployee
        const empMap = new Map<string, ParsedEmployee>();
        for (const day of days) {
          const key = day.employee_external_id;
          if (!empMap.has(key)) {
            empMap.set(key, {
              externalId: day.employee_external_id,
              name: day.employee_name,
              department: '',
              records: [],
            });
          }
          const e = empMap.get(key)!;
          const dayNum = parseInt(day.date.split('-')[2], 10);
          e.records.push({ day: dayNum, dateStr: day.date, punches: day.punches });
        }
        result = {
          employees: Array.from(empMap.values()),
          startDate: parsed.dateRange?.from || '',
          endDate: parsed.dateRange?.to || '',
        };
        toast.info(`Detectado formato ${parsed.format} — ${parsed.totalRows} batidas em ${parsed.employees.length} funcionários`);
      } else if (isTxt) {
        result = await parseTimesheetTxt(file);
      } else {
        result = await parseTimesheetXlsx(file);
      }
      setPreview({ ...result, rawFile: file });
      autoMatchEmployees(result.employees);
      const matched = result.employees.filter(emp => !!findBestEmployeeMatch(emp.name, emp.externalId)).length;
      toast.success(`${result.employees.length} funcionários encontrados, ${matched} vinculados automaticamente`);
    } catch (err: any) {
      toast.error('Erro ao ler arquivo: ' + err.message);
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleImport = () => {
    if (!preview) return;
    // Replace parsed names with matched registered names
    const mappedEmployees = preview.employees.map(emp => ({
      ...emp,
      name: employeeMatches[emp.name] || emp.name,
    }));

    // Auto-save external_id to matched employees that don't have one yet
    for (const emp of preview.employees) {
      const matchedName = employeeMatches[emp.name];
      if (matchedName && emp.externalId) {
        const registeredEmp = employees.find(e => e.name === matchedName);
        if (registeredEmp && !registeredEmp.external_id) {
          updateEmployee.mutate({ id: registeredEmp.id, data: { external_id: emp.externalId } });
        }
      }
    }

    const importStartDate = preview.startDate;
    const importEndDate = preview.endDate;
    importRecords.mutate({
      employees: mappedEmployees,
      startDate: importStartDate,
      endDate: importEndDate,
      file: preview.rawFile, // arquiva no bucket timesheet-imports
    }, {
      onSuccess: () => {
        // Set date filters to the imported period so records are visible across all batches
        setFilterStartDate(importStartDate);
        setFilterEndDate(importEndDate);
        setSelectedBatch('');
        setSelectedEmployee('__all__');
      }
    });
    setPreview(null);
  };

  // Group records by employee, resolving names via employee registry
  const employeeGroups = useMemo(() => {
    const map = new Map<string, TimeRecord[]>();
    records.forEach(r => {
      const resolvedName = resolveEmployeeName(employees, r.employee_name, r.employee_external_id);
      if (!map.has(resolvedName)) map.set(resolvedName, []);
      map.get(resolvedName)!.push(r);
    });
    return map;
  }, [records, employees]);

  const employeeNames = useMemo(() => [...employeeGroups.keys()].sort(), [employeeGroups]);

  useEffect(() => {
    if (employeeNames.length === 0) {
      if (selectedEmployee) setSelectedEmployee('');
      return;
    }

    if (!selectedEmployee || (selectedEmployee !== '__all__' && !employeeGroups.has(selectedEmployee))) {
      setSelectedEmployee('__all__');
    }
  }, [employeeNames.length, employeeGroups, selectedEmployee]);

  // Use the same dateRange logic as OverviewTab and ReportsPanel for consistency
  const batchDateRange = useMemo(() => {
    // If resolved filters provide a date range (from batch or manual), use it directly
    if (resolvedFilters.dateRange) {
      return resolvedFilters.dateRange;
    }

    // Fallback: derive from actual record dates
    if (records.length === 0) return null;
    const dates = records.map(r => r.record_date).sort();
    return { startDate: dates[0], endDate: dates[dates.length - 1] };
  }, [resolvedFilters.dateRange, records]);

  // Pre-compute holiday sets for O(1) lookups
  const holidayDates = useMemo(() => new Set(holidays.filter(h => !h.recurring).map(h => h.holiday_date)), [holidays]);
  const recurringHolidayMMDD = useMemo(() => new Set(holidays.filter(h => h.recurring).map(h => h.holiday_date.slice(5))), [holidays]);
  const isHolidayDate = (dateStr: string) => holidayDates.has(dateStr) || recurringHolidayMMDD.has(dateStr.slice(5));

  const calcSummariesForEmployee = (empName: string) => {
    const empRecords = employeeGroups.get(empName) || [];
    const recordMap = new Map<string, string[]>();
    empRecords.forEach(rec => {
      recordMap.set(rec.record_date, rec.punches as string[]);
    });

    // Generate all days in the date range
    if (!batchDateRange) {
      // Fallback: only use existing records
      return empRecords.map(rec => {
        const date = new Date(rec.record_date + 'T12:00:00');
        const dayOfWeek = date.getDay();
        const isHol = isHolidayDate(rec.record_date);
        const summary = calculateDaySummary(rec.punches as string[], dayOfWeek, defaultSchedule, isHol);
        return { ...summary, date: rec.record_date, punches: rec.punches as string[] } as DaySummary;
      });
    }

    const allDays: DaySummary[] = [];
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
      const summary = calculateDaySummary(punches, dayOfWeek, defaultSchedule, isHol);
      allDays.push({ ...summary, date: dateStr, punches } as DaySummary);
      cursor.setDate(cursor.getDate() + 1);
    }

    return allDays;
  };

  // Calculate summaries for selected employee
  const summaries = useMemo(() => {
    if (selectedEmployee === '__all__' || !selectedEmployee) return [];
    return calcSummariesForEmployee(selectedEmployee);
  }, [selectedEmployee, employeeGroups, defaultSchedule, holidays, batchDateRange]);

  // All employees summary (weekly-based)
  const allEmployeeSummaries = useMemo(() => {
    if (selectedEmployee !== '__all__') return [];
    return employeeNames.map(name => {
      const dayData = calcSummariesForEmployee(name);
      const period = calculateWeeklyPeriod(dayData, defaultSchedule);
      return {
        name,
        worked: period.totalWorkedMinutes,
        expected: period.totalExpectedMinutes,
        overtime: period.totalOvertimeMinutes,
        absent: period.totalAbsences,
        incomplete: period.totalIncomplete,
        days: dayData.length,
      };
    });
  }, [selectedEmployee, employeeNames, employeeGroups, defaultSchedule, holidays, batchDateRange]);

  // Individual employee period (weekly-based)
  const periodSummary = useMemo(() => calculateWeeklyPeriod(summaries, defaultSchedule), [summaries, defaultSchedule]);

  const totalWorked = periodSummary.totalWorkedMinutes;
  const totalExpected = periodSummary.totalExpectedMinutes;
  const totalOvertime = periodSummary.totalOvertimeMinutes;
  const absences = periodSummary.totalAbsences;
  const holidayWorked = periodSummary.totalHolidaysWorked;

  // Deficit/compensation: deficit offsets OT before applying multiplier (mirrors printTimesheet logic)
  const deficitMinutes = periodSummary.totalDeficitMinutes;
  const compensatedOvertime = Math.max(0, totalOvertime - deficitMinutes);
  const remainingDeficit = Math.max(0, deficitMinutes - totalOvertime);
  const overtimeDays = summaries.filter(d => d.overtimeMinutes > 0);
  const deficitDays = summaries.filter(d => d.expectedMinutes > 0 && d.workedMinutes > 0 && d.workedMinutes < d.expectedMinutes);
  const absentDays = summaries.filter(d => d.isAbsent);

  // Period label from batch
  const periodLabel = filterStartDate && filterEndDate 
    ? `${filterStartDate.split('-').reverse().join('/')} - ${filterEndDate.split('-').reverse().join('/')}`
    : (selectedBatch ? selectedBatch.replace(/_\d+$/, '').split('_').map(d => d.split('-').reverse().join('/')).join(' - ') : 'Período');

  // Build EmployeeTimesheetData for printing
  const getHourlySalary = (empName: string) => {
    const emp = findBestEmployeeMatch(empName);
    if (!emp || !emp.salary) return 0;
    return emp.salary / 220; // CLT: 220h/mês
  };

  // Returns the employee's schedule (individual or fallback to default)
  const getEmpSchedule = (empName: string) => {
    const emp = findBestEmployeeMatch(empName);
    return (emp?.work_schedule_id && schedules.find(s => s.id === emp.work_schedule_id)) || defaultSchedule;
  };

  // Returns the effective overtime R$/hr for an employee (custom rate or derived from their schedule)
  const getOvertimeRate = (empName: string) => {
    const emp = findBestEmployeeMatch(empName);
    if (!emp) return 0;
    if (emp.overtime_hourly_rate != null && emp.overtime_hourly_rate > 0) return emp.overtime_hourly_rate;
    const sched = getEmpSchedule(empName);
    return (emp.salary / 220) * sched.overtime_multiplier;
  };

  const buildPrintData = (empName: string): EmployeeTimesheetData => {
    const emp = findBestEmployeeMatch(empName);
    const sched = getEmpSchedule(empName);
    return {
      name: empName,
      days: calcSummariesForEmployee(empName),
      schedule: { overtime_multiplier: sched.overtime_multiplier, holiday_multiplier: sched.holiday_multiplier, minimum_overtime_minutes: sched.minimum_overtime_minutes || 0 },
      hourlySalary: emp?.salary ? emp.salary / 220 : 0,
      overtimeHourlyRate: emp?.overtime_hourly_rate ?? null,
    };
  };

  const handlePrintIndividual = () => {
    if (!selectedEmployee || selectedEmployee === '__all__') return;
    printEmployeeTimesheet(buildPrintData(selectedEmployee), periodLabel);
  };

  const handlePrintTimeMirror = () => {
    if (!selectedEmployee || selectedEmployee === '__all__') return;
    const emp = findBestEmployeeMatch(selectedEmployee);
    const data = buildPrintData(selectedEmployee);
    const balance = bankBalances.find(b => b.employee_id === emp?.id);
    const days = data.days.map(d => ({
      date: d.date,
      dayOfWeek: d.dayOfWeek,
      punches: d.punches,
      workedMinutes: d.workedMinutes,
      expectedMinutes: d.expectedMinutes,
      overtimeMinutes: d.overtimeMinutes,
      status: d.status,
      notes: d.isHoliday ? 'FERIADO' : '',
    }));
    printTimeMirror({
      employee: {
        name: emp?.name || selectedEmployee,
        external_id: (emp as any)?.external_id,
        role: emp?.role,
        department: emp?.department,
        cpf: (emp as any)?.cpf,
        pis: (emp as any)?.pis,
        admission_date: emp?.admission_date,
      },
      company: {
        name: (typeof window !== 'undefined' && (window as any).COMPANY_NAME) || 'Empresa',
      },
      period: periodLabel.includes('-') ? periodLabel : new Date().toISOString().slice(0, 7),
      days,
      bankHoursBalance: balance?.balance_min,
    });
  };

  const handlePrintAll = () => {
    const allData = employeeNames.map(n => buildPrintData(n));
    printAllEmployeesTimesheet(allData, periodLabel);
  };

  const handlePrintAllIndividual = () => {
    const allData = employeeNames.map(n => buildPrintData(n));
    printAllIndividualTimesheets(allData, periodLabel);
  };

  const handlePrintCalendar = () => {
    const allData = employeeNames.map(n => buildPrintData(n));
    printCalendarReport(allData, periodLabel);
  };

  const statusIcon = (status: DaySummary['status']) => {
    switch (status) {
      case 'normal': return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
      case 'overtime': return <Clock className="h-3.5 w-3.5 text-amber-500" />;
      case 'absent': return <XCircle className="h-3.5 w-3.5 text-destructive" />;
      case 'holiday': return <Calendar className="h-3.5 w-3.5 text-blue-500" />;
      case 'weekend': return <MinusCircle className="h-3.5 w-3.5 text-muted-foreground" />;
      case 'incomplete': return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
    }
  };

  const minutesToDisplay = (mins: number) => {
    const sign = mins < 0 ? '-' : '';
    const abs = Math.abs(mins);
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Registro de Ponto</h3>
          <p className="text-xs text-muted-foreground">Importe o arquivo de ponto (AGL_001.TXT, RegistroPresença.xls, etc.)</p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.txt" className="hidden" onChange={handleFileUpload} />
          <Button size="sm" className="gap-1.5" onClick={() => fileRef.current?.click()} disabled={parsing}>
            {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Importar Arquivo
          </Button>
          {employeeNames.length > 0 && (
            <>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={handlePrintAllIndividual}>
                <Printer className="h-4 w-4" />
                Imprimir todos os relatórios
              </Button>
            </>
          )}
        </div>
      </div>

      {preview && (() => {
        const unmatchedEmps = preview.employees.filter(emp => !employeeMatches[emp.name]);
        const matchedCount = Object.keys(employeeMatches).length;
        const totalRecords = preview.employees.reduce((s, e) => s + e.records.length, 0);
        return (
          <Card className="border-primary/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4" />
                Prévia da Importação — {preview.startDate} a {preview.endDate}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* R11 (audit): badges substituem texto inline pra dar peso visual
                  igual aos status de importações concluídas (ImportHistoryPanel).
                  Verde = OK, âmbar = pede ação, neutro = informativo. */}
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="outline" className="gap-1.5 font-normal">
                  <span className="text-muted-foreground">Funcionários</span>
                  <span className="font-semibold tabular-nums">{preview.employees.length}</span>
                </Badge>
                <Badge className="gap-1.5 bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20 font-normal">
                  <CheckCircle2 className="h-3 w-3" />
                  <span>Vinculados</span>
                  <span className="font-semibold tabular-nums">{matchedCount}</span>
                </Badge>
                {unmatchedEmps.length > 0 && (
                  <Badge className="gap-1.5 bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 font-normal">
                    <AlertTriangle className="h-3 w-3" />
                    <span>Não vinculados</span>
                    <span className="font-semibold tabular-nums">{unmatchedEmps.length}</span>
                  </Badge>
                )}
                <Badge variant="outline" className="gap-1.5 font-normal">
                  <span className="text-muted-foreground">Registros</span>
                  <span className="font-semibold tabular-nums">{totalRecords.toLocaleString('pt-BR')}</span>
                </Badge>
              </div>

              {unmatchedEmps.length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Nome no Arquivo (sem vínculo)</TableHead>
                        <TableHead className="text-xs">Vincular a Funcionário</TableHead>
                        <TableHead className="text-xs text-right">Dias</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {unmatchedEmps.map(emp => (
                        <TableRow key={emp.externalId || emp.name}>
                          <TableCell className="text-sm py-1.5">
                            {emp.name}
                            {emp.externalId && <span className="text-muted-foreground ml-1 text-xs">(ID: {emp.externalId})</span>}
                          </TableCell>
                          <TableCell className="py-1.5">
                            <Select
                              value="__none__"
                              onValueChange={(v) => {
                                if (v !== '__none__') {
                                  setEmployeeMatches(prev => ({ ...prev, [emp.name]: v }));
                                }
                              }}
                            >
                              <SelectTrigger className="h-7 text-xs w-full">
                                <SelectValue placeholder="Selecionar..." />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">
                                  <span className="text-muted-foreground">— Usar nome do arquivo —</span>
                                </SelectItem>
                                {employees.filter(e => e.active).map(e => (
                                  <SelectItem key={e.id} value={e.name}>{e.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm py-1.5">{emp.records.length}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {unmatchedEmps.length === 0 && (
                <p className="text-sm text-green-600 flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4" />
                  Todos os funcionários foram vinculados automaticamente!
                </p>
              )}

              <p className="text-[11px] text-muted-foreground">
                💡 Funcionários vinculados terão salário e dados usados automaticamente nos cálculos de horas extras.
              </p>
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="outline" onClick={() => setPreview(null)}>Cancelar</Button>
                <Button size="sm" onClick={handleImport} disabled={importRecords.isPending} className="gap-1.5">
                  {importRecords.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  Confirmar Importação ({totalRecords} registros)
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Filters */}
      <div className="space-y-2">
        {fullDateRange && (
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/20 rounded-lg text-xs">
            <Calendar className="h-3.5 w-3.5 text-primary" />
            <span className="text-muted-foreground">
              Importações disponíveis:{' '}
              <span className="font-medium text-foreground">
                {fullDateRange.startDate.split('-').reverse().join('/')} → {fullDateRange.endDate.split('-').reverse().join('/')}
              </span>
              {' · '}
              <span className="font-medium text-foreground">{fullDateRange.totalRecords.toLocaleString('pt-BR')}</span> registros em{' '}
              <span className="font-medium text-foreground">{batches.length}</span> importações
            </span>
            <Button
              variant="link"
              size="sm"
              className="h-auto py-0 px-1 text-xs"
              onClick={() => {
                setSelectedBatch('');
                setFilterStartDate(fullDateRange.startDate);
                setFilterEndDate(fullDateRange.endDate);
              }}
            >
              Carregar período completo
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-3 p-4 bg-muted/30 rounded-lg border border-border/50">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Período cadastrado</Label>
            <div className="w-60">
              <TimesheetPeriodSelector
                value={selectedPeriodId}
                onChange={(p) => {
                  setSelectedPeriodId(p?.id ?? null);
                  if (p) {
                    setFilterStartDate(p.start_date);
                    setFilterEndDate(p.end_date);
                    setSelectedBatch('');
                  }
                }}
                placeholder="Escolher período…"
                className="h-9"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Data Início</Label>
            <Input
              type="date"
              className="w-40"
              value={filterStartDate}
              min={fullDateRange?.startDate}
              max={fullDateRange?.endDate}
              onChange={e => {
                setFilterStartDate(e.target.value);
                setSelectedBatch('');
                setSelectedPeriodId(null);
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Data Fim</Label>
            <Input
              type="date"
              className="w-40"
              value={filterEndDate}
              min={fullDateRange?.startDate}
              max={fullDateRange?.endDate}
              onChange={e => {
                setFilterEndDate(e.target.value);
                setSelectedBatch('');
                setSelectedPeriodId(null);
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Importação (opcional)</Label>
            <div className="w-64">
              <Select 
                value={selectedBatch} 
                onValueChange={(v) => {
                  setSelectedBatch(v);
                  const range = getBatchDateRange(v);
                  if (range) {
                    setFilterStartDate(range.startDate);
                    setFilterEndDate(range.endDate);
                  }
                }}
              >
                <SelectTrigger><SelectValue placeholder="Todas as importações" /></SelectTrigger>
                <SelectContent>
                  {batches.map(b => (
                    <SelectItem key={b} value={b}>{b.replace(/_\d+$/, '').split('_').map(d => d.split('-').reverse().join('/')).join(' a ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex gap-2">
            {fullDateRange && (
              <Button
                variant="secondary"
                size="sm"
                className="h-10 gap-1.5"
                onClick={() => {
                  setSelectedBatch('');
                  setFilterStartDate(fullDateRange.startDate);
                  setFilterEndDate(fullDateRange.endDate);
                }}
              >
                <Calendar className="h-3.5 w-3.5" />
                Período Completo
              </Button>
            )}

            {(selectedBatch || filterStartDate || filterEndDate) && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-10 px-3 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setSelectedBatch('');
                  setFilterStartDate('');
                  setFilterEndDate('');
                }}
              >
                Limpar
              </Button>
            )}

            {selectedBatch && (
              <Button 
                variant="outline" 
                size="icon" 
                className="h-10 w-10 text-destructive" 
                onClick={() => { 
                  deleteBatch.mutate(selectedBatch); 
                  setSelectedBatch(''); 
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Employee selector */}
      {employeeNames.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-64">
            <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
              <SelectTrigger><SelectValue placeholder="Selecione funcionário..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">📊 Todos os Funcionários</SelectItem>
                {employeeNames.map(n => (
                  <SelectItem key={n} value={n}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-56 relative">
            <Input
              placeholder="Buscar funcionário..."
              onChange={e => {
                const term = e.target.value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                if (!term) { setSelectedEmployee('__all__'); return; }
                const match = employeeNames.find(n => n.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(term));
                if (match) setSelectedEmployee(match);
              }}
              className="pl-8"
            />
            <FileText className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <span className="text-xs text-muted-foreground">{employeeNames.length} funcionários</span>
          {selectedEmployee === '__all__' && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="gap-1.5" onClick={handlePrintAll}>
                <Printer className="h-3.5 w-3.5" /> Imprimir Relatório Geral
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={handlePrintCalendar}>
                <Calendar className="h-3.5 w-3.5" /> Calendário
              </Button>
            </div>
          )}
          {selectedEmployee && selectedEmployee !== '__all__' && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setReportDialogOpen(true)}>
                <Users2 className="h-3.5 w-3.5" /> Resumo Individual
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => {
                printIndividualCalendarReport(buildPrintData(selectedEmployee), periodLabel);
              }}>
                <Calendar className="h-3.5 w-3.5" /> Calendário Individual
              </Button>
              <Button size="sm" className="gap-1.5" onClick={() => {
                const data = buildPrintData(selectedEmployee);
                saveEmployeeTimesheetPdf(data, periodLabel);
              }}>
                <FileText className="h-3.5 w-3.5" /> Gerar PDF
              </Button>
              <Button size="sm" variant="default" className="gap-1.5" onClick={handlePrintTimeMirror}>
                <ClipboardEdit className="h-3.5 w-3.5" /> Espelho de Ponto (assinar)
              </Button>
            </div>
          )}
        </div>
      )}

      {/* All employees summary table */}
      {selectedEmployee === '__all__' && allEmployeeSummaries.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Resumo Geral — Todos os Funcionários</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Funcionário</TableHead>
                  <TableHead className="text-right">Dias</TableHead>
                  <TableHead className="text-right">Trabalhadas</TableHead>
                  <TableHead className="text-right">Esperadas</TableHead>
                  <TableHead className="text-right">Horas Extras</TableHead>
                  <TableHead className="text-right">Faltas</TableHead>
                  <TableHead className="text-right">Incompletos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allEmployeeSummaries.map(emp => (
                  <TableRow key={emp.name} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedEmployee(emp.name)}>
                    <TableCell className="font-medium text-sm">{emp.name}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{emp.days}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{minutesToDisplay(emp.worked)}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-muted-foreground">{minutesToDisplay(emp.expected)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {emp.overtime > 0 ? <span className="text-amber-600 font-medium">{minutesToDisplay(emp.overtime)}</span> : '—'}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {emp.absent > 0 ? <span className="text-destructive font-medium">{emp.absent}</span> : '—'}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {emp.incomplete > 0 ? <Badge variant="outline" className="text-[10px] text-amber-600">{emp.incomplete}</Badge> : '—'}
                    </TableCell>
                  </TableRow>
                ))}
                {/* Totals row */}
                <TableRow className="bg-muted/30 font-semibold">
                  <TableCell>TOTAL</TableCell>
                  <TableCell className="text-right font-mono text-sm">{allEmployeeSummaries.reduce((s, e) => s + e.days, 0)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{minutesToDisplay(allEmployeeSummaries.reduce((s, e) => s + e.worked, 0))}</TableCell>
                  <TableCell className="text-right font-mono text-sm text-muted-foreground">{minutesToDisplay(allEmployeeSummaries.reduce((s, e) => s + e.expected, 0))}</TableCell>
                  <TableCell className="text-right font-mono text-sm text-amber-600">{minutesToDisplay(allEmployeeSummaries.reduce((s, e) => s + e.overtime, 0))}</TableCell>
                  <TableCell className="text-right text-sm text-destructive">{allEmployeeSummaries.reduce((s, e) => s + e.absent, 0)}</TableCell>
                  <TableCell className="text-right text-sm">{allEmployeeSummaries.reduce((s, e) => s + e.incomplete, 0)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* Summary cards */}
      {selectedEmployee && selectedEmployee !== '__all__' && summaries.length > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            <Card><CardContent className="p-3 text-center">
              <p className="text-[10px] text-muted-foreground uppercase">Trabalhadas</p>
              <p className="text-lg font-bold font-mono">{minutesToDisplay(totalWorked)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3 text-center">
              <p className="text-[10px] text-muted-foreground uppercase">Esperadas</p>
              <p className="text-lg font-bold font-mono">{minutesToDisplay(totalExpected)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3 text-center">
              <p className="text-[10px] text-muted-foreground uppercase">HE Brutas</p>
              <p className="text-lg font-bold font-mono text-amber-600">{minutesToDisplay(totalOvertime)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3 text-center">
              <p className="text-[10px] text-muted-foreground uppercase">Déficit</p>
              <p className="text-lg font-bold font-mono text-destructive">{minutesToDisplay(deficitMinutes)}</p>
            </CardContent></Card>
            <Card className={compensatedOvertime > 0 ? 'ring-1 ring-green-500/30' : ''}>
              <CardContent className="p-3 text-center">
                <p className="text-[10px] text-muted-foreground uppercase">HE Líquida</p>
                <p className="text-lg font-bold font-mono text-green-600">{minutesToDisplay(compensatedOvertime)}</p>
              </CardContent>
            </Card>
            <Card><CardContent className="p-3 text-center">
              <p className="text-[10px] text-muted-foreground uppercase">Déf. Restante</p>
              <p className="text-lg font-bold font-mono text-destructive">{remainingDeficit > 0 ? minutesToDisplay(remainingDeficit) : '—'}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3 text-center">
              <p className="text-[10px] text-muted-foreground uppercase">Faltas</p>
              <p className="text-lg font-bold text-destructive">{absences}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3 text-center">
              <p className="text-[10px] text-muted-foreground uppercase">Feriados Trab.</p>
              <p className="text-lg font-bold text-blue-600">{holidayWorked}</p>
            </CardContent></Card>
          </div>

          {/* Overtime value calculation */}
          {getHourlySalary(selectedEmployee) > 0 && (compensatedOvertime > 0 || remainingDeficit > 0) && (
            <Card className="border-green-500/20 bg-green-50/30 dark:bg-green-950/10">
              <CardContent className="p-4">
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                  <DollarSign className="h-4 w-4 text-green-600" /> Cálculo de Hora Extra
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div>
                    <span className="text-muted-foreground text-xs">Valor/hora base</span>
                    <p className="font-mono font-medium">{formatCurrency(getHourlySalary(selectedEmployee))}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs">HE ({minutesToDisplay(compensatedOvertime)})</span>
                    <p className="font-mono font-medium">{formatCurrency(getOvertimeRate(selectedEmployee))}/hr</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs">Valor HE</span>
                    <p className="font-mono font-bold text-green-600">
                      {formatCurrency((compensatedOvertime / 60) * getOvertimeRate(selectedEmployee))}
                    </p>
                  </div>
                  {remainingDeficit > 0 && (
                    <div>
                      <span className="text-muted-foreground text-xs">Desconto Déficit</span>
                      <p className="font-mono font-bold text-destructive">
                        -{formatCurrency((remainingDeficit / 60) * getHourlySalary(selectedEmployee))}
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Overtime days detail */}
          {overtimeDays.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Clock className="h-4 w-4 text-amber-500" /> Dias com Hora Extra ({overtimeDays.length})
                </CardTitle>
              </CardHeader>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Dia</TableHead>
                      <TableHead>Batidas</TableHead>
                      <TableHead className="text-right">HE</TableHead>
                      <TableHead>Tipo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overtimeDays.map(d => (
                      <TableRow key={d.date}>
                        <TableCell className="font-mono text-sm">{new Date(d.date + 'T12:00:00').toLocaleDateString('pt-BR')}</TableCell>
                        <TableCell className="text-xs">{DAYS_PT[d.dayOfWeek]}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {d.punches.map((p, i) => <Badge key={i} variant="outline" className="text-[10px] font-mono">{p}</Badge>)}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm font-medium text-amber-600">{d.overtimeFormatted}</TableCell>
                        <TableCell>
                          <Badge variant={d.isHoliday ? 'default' : 'outline'} className="text-[10px]">
                            {d.isHoliday ? `Feriado ${defaultSchedule.holiday_multiplier}x` : `Normal ${defaultSchedule.overtime_multiplier}x`}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/30 font-semibold">
                      <TableCell colSpan={3}>TOTAL HE BRUTA</TableCell>
                      <TableCell className="text-right font-mono text-sm text-amber-600">{minutesToDisplay(totalOvertime)}</TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}

          {/* Day-by-day table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Registro Diário Completo</CardTitle>
            </CardHeader>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Dia</TableHead>
                    <TableHead>Batidas</TableHead>
                    <TableHead className="text-right">Trabalhado</TableHead>
                    <TableHead className="text-right">Esperado</TableHead>
                    <TableHead className="text-right">HE</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summaries.map(d => (
                    <TableRow key={d.date} className={
                      d.status === 'absent' ? 'bg-destructive/5' :
                      d.status === 'overtime' ? 'bg-amber-500/5' :
                      d.status === 'holiday' ? 'bg-blue-500/5' :
                      d.status === 'weekend' ? 'bg-muted/30' :
                      d.status === 'incomplete' ? 'bg-amber-500/5' : ''
                    }>
                      <TableCell>{statusIcon(d.status)}</TableCell>
                      <TableCell className="font-mono text-sm">{new Date(d.date + 'T12:00:00').toLocaleDateString('pt-BR')}</TableCell>
                      <TableCell className="text-xs">{DAYS_PT[d.dayOfWeek]}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {d.punches.map((p, i) => (
                            <Badge key={i} variant="outline" className="text-[10px] font-mono">{p}</Badge>
                          ))}
                          {d.punches.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">{d.workedFormatted}</TableCell>
                      <TableCell className="text-right font-mono text-sm text-muted-foreground">{minutesToDisplay(d.expectedMinutes)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {d.overtimeMinutes > 0 ? (
                          <span className="text-amber-600 font-medium">{d.overtimeFormatted}</span>
                        ) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      )}

      {records.length === 0 && !preview && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <FileSpreadsheet className="h-10 w-10 mb-3 opacity-50" />
            <p>Nenhum registro de ponto importado</p>
            <p className="text-xs mt-1">Importe o arquivo .xlsx ou .txt (AGL) gerado pelo relógio de ponto</p>
          </CardContent>
        </Card>
      )}

      {/* Individual employee report dialog */}
      <Dialog open={reportDialogOpen} onOpenChange={setReportDialogOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users2 className="h-5 w-5" />
              Resumo Individual — {selectedEmployee}
            </DialogTitle>
          </DialogHeader>

          {selectedEmployee && selectedEmployee !== '__all__' && summaries.length > 0 && (() => {
            const hourlySalary = getHourlySalary(selectedEmployee);
            const overtimeHourlyRate = getOvertimeRate(selectedEmployee);
            const overtimeValue = compensatedOvertime > 0 ? (compensatedOvertime / 60) * overtimeHourlyRate : 0;
            const deficitValue = remainingDeficit > 0 ? (remainingDeficit / 60) * hourlySalary : 0;
            const netValue = overtimeValue - deficitValue;

            return (
              <div className="space-y-5 mt-2">
                {/* Summary cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Card><CardContent className="p-3 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase">Trabalhadas</p>
                    <p className="text-lg font-bold font-mono">{minutesToDisplay(totalWorked)}</p>
                  </CardContent></Card>
                  <Card><CardContent className="p-3 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase">Esperadas</p>
                    <p className="text-lg font-bold font-mono">{minutesToDisplay(totalExpected)}</p>
                  </CardContent></Card>
                  <Card><CardContent className="p-3 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase">HE Líquida</p>
                    <p className="text-lg font-bold font-mono text-green-600">{minutesToDisplay(compensatedOvertime)}</p>
                  </CardContent></Card>
                  <Card><CardContent className="p-3 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase">Faltas</p>
                    <p className="text-lg font-bold text-destructive">{absences}</p>
                  </CardContent></Card>
                </div>

                {/* Financial summary */}
                {hourlySalary > 0 && (
                  <Card className="border-primary/20">
                    <CardContent className="p-4">
                      <h4 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                        <DollarSign className="h-4 w-4" /> Resumo Financeiro
                      </h4>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground text-xs">Valor/hora base</span>
                          <p className="font-mono font-medium">{formatCurrency(hourlySalary)}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">HE a receber ({formatCurrency(overtimeHourlyRate)}/hr)</span>
                          <p className="font-mono font-bold text-green-600">{formatCurrency(overtimeValue)}</p>
                        </div>
                        {remainingDeficit > 0 && (
                          <div>
                            <span className="text-muted-foreground text-xs">Desconto por déficit</span>
                            <p className="font-mono font-bold text-destructive">-{formatCurrency(deficitValue)}</p>
                          </div>
                        )}
                        <div className="sm:col-span-3 border-t pt-2 mt-1">
                          <span className="text-muted-foreground text-xs">Saldo Líquido</span>
                          <p className={`display text-xl tabular-nums font-mono ${netValue >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                            {netValue >= 0 ? '+' : ''}{formatCurrency(netValue)}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Overtime days */}
                {overtimeDays.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                      <Clock className="h-4 w-4 text-amber-500" /> Dias com Hora Extra ({overtimeDays.length})
                    </h4>
                    <div className="rounded-lg border overflow-hidden">
                      <Table>
                        <TableHeader><TableRow className="bg-amber-500/5">
                          <TableHead>Data</TableHead><TableHead>Dia</TableHead><TableHead>Batidas</TableHead>
                          <TableHead className="text-right">HE</TableHead><TableHead>Tipo</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                          {overtimeDays.map(d => (
                            <TableRow key={d.date}>
                              <TableCell className="font-mono text-sm">{new Date(d.date + 'T12:00:00').toLocaleDateString('pt-BR')}</TableCell>
                              <TableCell className="text-xs">{DAYS_PT[d.dayOfWeek]}</TableCell>
                              <TableCell><div className="flex flex-wrap gap-1">{d.punches.map((p, i) => <Badge key={i} variant="outline" className="text-[10px] font-mono">{p}</Badge>)}</div></TableCell>
                              <TableCell className="text-right font-mono text-sm font-medium text-amber-600">{d.overtimeFormatted}</TableCell>
                              <TableCell><Badge variant={d.isHoliday ? 'default' : 'outline'} className="text-[10px]">{d.isHoliday ? 'Feriado' : 'Normal'}</Badge></TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                {/* Deficit days */}
                {deficitDays.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                      <AlertTriangle className="h-4 w-4 text-amber-500" /> Dias com Déficit de Horas ({deficitDays.length})
                    </h4>
                    <div className="rounded-lg border overflow-hidden">
                      <Table>
                        <TableHeader><TableRow className="bg-amber-500/5">
                          <TableHead>Data</TableHead><TableHead>Dia</TableHead><TableHead>Batidas</TableHead>
                          <TableHead className="text-right">Trabalhado</TableHead><TableHead className="text-right">Esperado</TableHead>
                          <TableHead className="text-right">Déficit</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                          {deficitDays.map(d => (
                            <TableRow key={d.date}>
                              <TableCell className="font-mono text-sm">{new Date(d.date + 'T12:00:00').toLocaleDateString('pt-BR')}</TableCell>
                              <TableCell className="text-xs">{DAYS_PT[d.dayOfWeek]}</TableCell>
                              <TableCell><div className="flex flex-wrap gap-1">{d.punches.map((p, i) => <Badge key={i} variant="outline" className="text-[10px] font-mono">{p}</Badge>)}</div></TableCell>
                              <TableCell className="text-right font-mono text-sm">{d.workedFormatted}</TableCell>
                              <TableCell className="text-right font-mono text-sm text-muted-foreground">{minutesToDisplay(d.expectedMinutes)}</TableCell>
                              <TableCell className="text-right font-mono text-sm font-medium text-destructive">{minutesToDisplay(d.expectedMinutes - d.workedMinutes)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                {/* Absent days */}
                {absentDays.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                      <XCircle className="h-4 w-4 text-destructive" /> Faltas ({absentDays.length})
                    </h4>
                    <div className="rounded-lg border overflow-hidden">
                      <Table>
                        <TableHeader><TableRow className="bg-destructive/5">
                          <TableHead>Data</TableHead><TableHead>Dia</TableHead>
                          <TableHead className="text-right">Horas Devidas</TableHead>
                          {hourlySalary > 0 && <TableHead className="text-right">Desconto</TableHead>}
                        </TableRow></TableHeader>
                        <TableBody>
                          {absentDays.map(d => (
                            <TableRow key={d.date}>
                              <TableCell className="font-mono text-sm">{new Date(d.date + 'T12:00:00').toLocaleDateString('pt-BR')}</TableCell>
                              <TableCell className="text-xs">{DAYS_PT[d.dayOfWeek]}</TableCell>
                              <TableCell className="text-right font-mono text-sm text-destructive">{minutesToDisplay(d.expectedMinutes)}</TableCell>
                              {hourlySalary > 0 && (
                                <TableCell className="text-right font-mono text-sm text-destructive">
                                  -{formatCurrency((d.expectedMinutes / 60) * hourlySalary)}
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                {/* Save PDF button */}
                <div className="flex justify-end pt-2 border-t">
                  <Button size="sm" className="gap-1.5" onClick={() => {
                    if (!selectedEmployee || selectedEmployee === '__all__') return;
                    const data = buildPrintData(selectedEmployee);
                    saveEmployeeTimesheetPdf(data, periodLabel);
                  }}>
                    <FileSpreadsheet className="h-3.5 w-3.5" /> Salvar
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────
export default function Timesheet() {
  const [searchParams] = useSearchParams();
  // Quando o Timesheet é renderizado dentro do RHHub (`/rh?tab=ponto`), o param
  // `tab` já carrega o tab do hub. A sub-aba interna usa `subtab`.
  const initialTab = searchParams.get('subtab') || searchParams.get('tab') || 'records';

  // Bloco C da reformulação: as 11 abas viram 4 seções lógicas com sub-abas.
  // O initialTab (?subtab=...) é mapeado pro grupo que o contém.
  const SUBTAB_TO_GROUP: Record<string, string> = {
    records: 'importacao', history: 'importacao',
    overview: 'registros', pending: 'registros', manual: 'registros',
    late: 'registros', occurrences: 'registros',
    weekly: 'horas-extras', overtime: 'horas-extras', reports: 'horas-extras',
    schedule: 'config', holidays: 'config',
  };
  const initialGroup = SUBTAB_TO_GROUP[initialTab] || 'importacao';
  const subFor = (group: string, fallback: string) =>
    initialGroup === group ? initialTab : fallback;

  return (
    <AppLayout>
      <div className="space-y-5 page-enter editorial-stagger">
        <EditorialPageHeader
          sectionLabel="RH · PONTO"
          title="Controle de Ponto"
          description="Importação de ponto, horários, feriados e cálculo de horas extras"
        />

        <Tabs defaultValue={initialGroup} className="space-y-4">
          <HubTabsList tabs={[
            { value: 'importacao',   label: 'Importação & Período', icon: FileSpreadsheet },
            { value: 'registros',    label: 'Registros & Pendências', icon: Users2 },
            { value: 'horas-extras', label: 'Horas Extras & Banco', icon: Wallet },
            { value: 'config',       label: 'Configuração', icon: Clock },
          ]} />

          {/* ── Seção 1: Importação & Período ── */}
          <TabsContent value="importacao">
            <Tabs defaultValue={subFor('importacao', 'records')} className="space-y-4">
              <TabsList>
                <TabsTrigger value="records" className="gap-1.5"><FileSpreadsheet className="h-3.5 w-3.5" /> Ponto</TabsTrigger>
                <TabsTrigger value="history" className="gap-1.5"><History className="h-3.5 w-3.5" /> Histórico de Importações</TabsTrigger>
              </TabsList>
              <TabsContent value="records"><TimesheetRecordsTab /></TabsContent>
              <TabsContent value="history"><ImportHistoryPanel /></TabsContent>
            </Tabs>
          </TabsContent>

          {/* ── Seção 2: Registros & Pendências ── */}
          <TabsContent value="registros">
            <Tabs defaultValue={subFor('registros', 'overview')} className="space-y-4">
              <TabsList>
                <TabsTrigger value="overview" className="gap-1.5"><Users2 className="h-3.5 w-3.5" /> Visão Geral</TabsTrigger>
                <TabsTrigger value="pending" className="gap-1.5"><AlertTriangle className="h-3.5 w-3.5" /> Pendências</TabsTrigger>
                <TabsTrigger value="manual" className="gap-1.5"><ClipboardEdit className="h-3.5 w-3.5" /> Lançamento</TabsTrigger>
                <TabsTrigger value="late" className="gap-1.5"><AlarmClock className="h-3.5 w-3.5" /> Atrasos</TabsTrigger>
                <TabsTrigger value="occurrences" className="gap-1.5"><AlertTriangle className="h-3.5 w-3.5" /> Ocorrências</TabsTrigger>
              </TabsList>
              <TabsContent value="overview"><OverviewTab /></TabsContent>
              <TabsContent value="pending"><PendingTimeRecordsPanel /></TabsContent>
              <TabsContent value="manual"><ManualEntryTab /></TabsContent>
              <TabsContent value="late"><LateArrivalsTab /></TabsContent>
              <TabsContent value="occurrences" className="space-y-6">
                <DivergencesTab />
                <Separator />
                <ExceptionsTab />
                <Separator />
                <TimeValidationPanel />
              </TabsContent>
            </Tabs>
          </TabsContent>

          {/* ── Seção 3: Horas Extras & Banco ── */}
          <TabsContent value="horas-extras">
            <Tabs defaultValue={subFor('horas-extras', 'weekly')} className="space-y-4">
              <TabsList>
                <TabsTrigger value="weekly" className="gap-1.5"><AlarmClock className="h-3.5 w-3.5" /> Apuração Semanal</TabsTrigger>
                <TabsTrigger value="overtime" className="gap-1.5"><Wallet className="h-3.5 w-3.5" /> Resolução Mensal</TabsTrigger>
                <TabsTrigger value="reports" className="gap-1.5"><FileText className="h-3.5 w-3.5" /> Relatórios</TabsTrigger>
              </TabsList>
              <TabsContent value="weekly"><WeeklyOvertimeResolutionPanel /></TabsContent>
              <TabsContent value="overtime"><OvertimeResolutionPanel /></TabsContent>
              <TabsContent value="reports"><ReportsPanel /></TabsContent>
            </Tabs>
          </TabsContent>

          {/* ── Seção 4: Configuração ── */}
          <TabsContent value="config">
            <Tabs defaultValue={subFor('config', 'schedule')} className="space-y-4">
              <TabsList>
                <TabsTrigger value="schedule" className="gap-1.5"><Clock className="h-3.5 w-3.5" /> Horário Padrão</TabsTrigger>
                <TabsTrigger value="holidays" className="gap-1.5"><Calendar className="h-3.5 w-3.5" /> Feriados</TabsTrigger>
              </TabsList>
              <TabsContent value="schedule"><WorkScheduleTab /></TabsContent>
              <TabsContent value="holidays"><HolidaysTab /></TabsContent>
            </Tabs>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
