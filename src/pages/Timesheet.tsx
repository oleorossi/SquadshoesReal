import ExceptionsTab from '@/components/timesheet/ExceptionsTab';
import CoverageCalendar from '@/components/timesheet/CoverageCalendar';
import ManualEntryTab from '@/components/timesheet/ManualEntryTab';
import ImportHistoryPanel from '@/components/timesheet/ImportHistoryPanel';
import PendingTimeRecordsPanel from '@/components/timesheet/PendingTimeRecordsPanel';
import EmployeeAbsences from './EmployeeAbsences';
import { useState, useRef, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Clock, Upload, Plus, Trash as Trash2, CircleNotch as Loader2, Calendar, Gear as Settings2, Warning as AlertTriangle, FileXls as FileSpreadsheet, CaretDown as ChevronDown, Sun, Moon, Coffee, CheckCircle as CheckCircle2, XCircle, MinusCircle, Printer, Users as Users2, CurrencyDollar as DollarSign, Link as Link2, Shield, FileText, Clipboard as ClipboardEdit, Alarm as AlarmClock, ClockCounterClockwise as History, Wallet, ArrowsLeftRight, FirstAid } from '@phosphor-icons/react';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import {
  useWorkSchedules, useAddWorkSchedule, useUpdateWorkSchedule, useDeleteWorkSchedule,
  useHolidays, useAddHoliday, useDeleteHoliday,
  useWorkdaySwaps, useAddWorkdaySwap, useDeleteWorkdaySwap, useSwapSets,
  useTimeRecords, useImportBatches, useImportTimeRecords, useDeleteBatch,
  useAllImportsDateRange,
  parseTimesheetXlsx, parseTimesheetTxt, calculateDaySummary, resolveTimesheetRecordDate,
  WorkSchedule, Holiday, TimeRecord, ParsedEmployee, DaySummary,
} from '@/hooks/useTimesheet';
import { useEmployees } from '@/hooks/useEmployees';
import { computePeriodFolha, SALARY_HOUR_DIVISOR } from '@/lib/salaryPayroll';
import { getBatchDateRange, resolveTimeControlFilters } from '@/lib/timeControlFilters';
import { findEmployeeMatch, resolveEmployeeName } from '@/lib/employeeMatching';
import { resolveHolidaysForPayrollRange } from '@/lib/ponto/periodDates';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { PeriodRangeFilter } from '@/components/hr/PeriodRangeFilter';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import { usePendingTotal } from '@/hooks/useTimePendings';
import { cn } from '@/lib/utils';

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
    name: 'Jornada padrão',
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
    is_default: false,
  });

  const openAdd = () => {
    setEditing(null);
    setForm({
      name: 'Jornada padrão', entry_time: '08:00', lunch_start: '12:00', lunch_end: '13:00',
      exit_time: '17:48', saturday_entry: '08:00', saturday_exit: '12:00',
      weekly_hours: 44, overtime_multiplier: 1.5, night_overtime_multiplier: 1.7,
      holiday_multiplier: 1.5, tolerance_minutes: 10, minimum_overtime_minutes: 0, is_default: false,
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
          <p className="text-xs text-muted-foreground">Configure jornadas de referência para avaliar o ponto e contratos PJ.</p>
        </div>
        <Button onClick={openAdd} size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" /> Novo Horário
        </Button>
      </div>

      {schedules.length === 0 ? (
        <Panel flush>
          <EmptyState
            icon={Clock}
            title="Nenhum horário cadastrado"
            description="Cadastre uma jornada de referência para avaliar horas, pendências e valores contratados."
          />
        </Panel>
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
                    {s.is_default && <Badge className="text-xs">Padrão</Badge>}
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(s)}>
                      <Settings2 className="h-3.5 w-3.5" />
                    </Button>
                    <DeleteConfirmButton onConfirm={() => deleteSchedule.mutate(s.id)} title="Excluir escala?" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div className="flex items-center gap-1.5"><Sun className="h-3 w-3 text-amber-500" /> Entrada: <span className="font-mono tabular-nums font-medium">{s.entry_time}</span></div>
                  <div className="flex items-center gap-1.5"><Coffee className="h-3 w-3 text-orange-500" /> Almoço: <span className="font-mono tabular-nums font-medium">{s.lunch_start}–{s.lunch_end}</span></div>
                  <div className="flex items-center gap-1.5"><Moon className="h-3 w-3 text-indigo-500" /> Saída: <span className="font-mono tabular-nums font-medium">{s.exit_time}</span></div>
                  <div>Sáb: <span className="font-mono tabular-nums font-medium">{s.saturday_entry || '—'}–{s.saturday_exit || '—'}</span></div>
                </div>
                <Separator />
                <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                  <div>Semanal: <span className="font-medium text-foreground">{s.weekly_hours}h</span></div>
                  <div>Dia: <span className="font-medium text-foreground">{dailyHours.toFixed(1)}h</span></div>
                  <div>Sáb: <span className="font-medium text-foreground">{satLabel}</span></div>
                </div>
                <div className="rounded-md border border-primary/20 bg-primary/5 px-2.5 py-2 text-xs text-muted-foreground">
                  Na folha, excessos compensam atrasos parciais no período. Saldo positivo acima de 10min vira HE pelas taxas do funcionário.
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
            <DialogDescription>Configure somente a jornada. As regras e taxas financeiras da folha são centralizadas.</DialogDescription>
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

  // ⚠ SÓ feriados de DATA FIXA. Feriados MÓVEIS (Carnaval, Sexta-feira Santa,
  // Corpus Christi) NÃO entram aqui: a data muda todo ano, então cadastrá-los como
  // MM-DD recorrente planta feriado-fantasma em dia errado (ex.: seed em 2026 punha
  // Sexta-Santa em 18/04 = a data de 2025, num sábado). Os móveis já vêm com as
  // datas certas 2024-2030 no seed do banco (migration 20260527220000); adicione
  // anos futuros manualmente pela data real, sem "recorrente".
  const defaultHolidays = [
    // Nacionais (data fixa)
    { name: 'Confraternização Universal', date: '01-01', cat: 'Nacional' },
    { name: 'Tiradentes', date: '04-21', cat: 'Nacional' },
    { name: 'Dia do Trabalho', date: '05-01', cat: 'Nacional' },
    { name: 'Independência do Brasil', date: '09-07', cat: 'Nacional' },
    { name: 'Nossa Sra. Aparecida', date: '10-12', cat: 'Nacional' },
    { name: 'Finados', date: '11-02', cat: 'Nacional' },
    { name: 'Proclamação da República', date: '11-15', cat: 'Nacional' },
    { name: 'Natal', date: '12-25', cat: 'Nacional' },
    // Estaduais RJ (data fixa)
    { name: 'Dia de São Jorge (RJ)', date: '04-23', cat: 'Estadual RJ' },
    { name: 'Dia da Consciência Negra (RJ)', date: '11-20', cat: 'Estadual RJ' },
    // Municipais Belford Roxo (data fixa)
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
        <Panel flush>
          <EmptyState
            icon={Calendar}
            title="Nenhum feriado cadastrado"
            description="Cadastre os feriados para cálculo correto de horas extras."
          />
        </Panel>
      ) : (
        <Panel flush>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
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
                    <TableCell>{h.recurring ? <Badge variant="outline" className="text-xs">Sim</Badge> : '—'}</TableCell>
                    <TableCell>
                      <DeleteConfirmButton onConfirm={() => deleteHoliday.mutate(h.id)} title="Excluir feriado?" description={`O feriado "${h.name}" será removido. Esta ação não pode ser desfeita.`} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Panel>
      )}
    </div>
  );
}

// ── Trocas de Dia / Compensação Tab ─────────────────────
// Cadastro de dias trabalhados em TROCA de outro (ponte/compensação). O dia
// trabalhado é lido como dia útil NORMAL (não vira hora extra), e a folga
// compensatória não gera falta. Vale pra todos os funcionários (igual feriados).
function WorkdaySwapsTab() {
  const { data: swaps = [], isLoading } = useWorkdaySwaps();
  const addSwap = useAddWorkdaySwap();
  const deleteSwap = useDeleteWorkdaySwap();
  const [form, setForm] = useState({ name: '', work_date: '', off_date: '' });
  const [adding, setAdding] = useState(false);

  const handleAdd = () => {
    if (!form.name || !form.work_date) { toast.error('Preencha descrição e o dia trabalhado'); return; }
    if (form.off_date && form.off_date === form.work_date) { toast.error('A folga não pode ser o mesmo dia trabalhado'); return; }
    addSwap.mutate({ name: form.name, work_date: form.work_date, off_date: form.off_date || null });
    setForm({ name: '', work_date: '', off_date: '' });
    setAdding(false);
  };

  const fmtDate = (d?: string | null) => d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR') : '—';

  if (isLoading) return <Loader2 className="h-6 w-6 animate-spin mx-auto my-8" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Trocas de Dia</h3>
          <p className="text-xs text-muted-foreground">
            Dias trabalhados em troca de outro (ponte/compensação). O dia trabalhado
            é contado como <span className="font-medium text-foreground">normal</span>, não como hora extra.
          </p>
        </div>
        <Button size="sm" onClick={() => setAdding(!adding)} className="gap-1.5">
          <Plus className="h-4 w-4" /> Nova troca
        </Button>
      </div>

      {adding && (
        <Card>
          <CardContent className="p-4 flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[150px]">
              <Label className="text-xs">Descrição</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="mt-1" placeholder="Ex: Ponte Corpus Christi" />
            </div>
            <div className="w-40">
              <Label className="text-xs">Dia trabalhado</Label>
              <Input type="date" value={form.work_date} onChange={e => setForm(f => ({ ...f, work_date: e.target.value }))} className="mt-1" />
            </div>
            <div className="w-40">
              <Label className="text-xs">Folga compensatória <span className="text-muted-foreground">(opcional)</span></Label>
              <Input type="date" value={form.off_date} onChange={e => setForm(f => ({ ...f, off_date: e.target.value }))} className="mt-1" />
            </div>
            <Button size="sm" onClick={handleAdd}>Adicionar</Button>
          </CardContent>
        </Card>
      )}

      {swaps.length === 0 ? (
        <Panel flush>
          <EmptyState
            icon={ArrowsLeftRight}
            title="Nenhuma troca cadastrada"
            description="Cadastre os dias trabalhados em troca de outro para serem lidos como dia normal."
          />
        </Panel>
      ) : (
        <Panel flush>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                  <TableHead>Descrição</TableHead>
                  <TableHead>Dia trabalhado</TableHead>
                  <TableHead>Folga compensatória</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {swaps.map(s => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium text-sm">{s.name || '—'}</TableCell>
                    <TableCell className="font-mono text-sm">{fmtDate(s.work_date)}</TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">{fmtDate(s.off_date)}</TableCell>
                    <TableCell>
                      <DeleteConfirmButton onConfirm={() => deleteSwap.mutate(s.id)} title="Excluir troca de dia?" description="O registro de troca será removido. Esta ação não pode ser desfeita." />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Panel>
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
  const handleRangeChange = ({ from, to }: { from: string; to: string }) => {
    setSelectedBatch('');
    setFilterStartDate(from);
    setFilterEndDate(to);
  };
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
  const { swapWorkedSet, swapOffSet, swapModeFor } = useSwapSets();
  const { data: employees = [] } = useEmployees();
  const importRecords = useImportTimeRecords();
  const deleteBatch = useDeleteBatch();

  const fileRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  // Mantém o File original junto com o preview pra permitir arquivá-lo no
  // bucket timesheet-imports após confirmação da importação (PR Frente 2).
  const [preview, setPreview] = useState<{ employees: ParsedEmployee[]; startDate: string; endDate: string; rawFile?: File } | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<string>('');
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [, setRhSearchParams] = useSearchParams(); // navegar Ponto → Relatórios
  const defaultSchedule: WorkSchedule = schedules.find(s => s.is_default) || schedules[0] || {
    id: '', name: 'Default', entry_time: '08:00', lunch_start: '12:00', lunch_end: '13:00',
    exit_time: '17:48', saturday_entry: '08:00', saturday_exit: '12:00', weekly_hours: 44,
    overtime_multiplier: 1.5, night_overtime_multiplier: 1.7, holiday_multiplier: 1.5,
    tolerance_minutes: 10, minimum_overtime_minutes: 0, is_default: true, created_at: '', updated_at: '',
    works_sunday: false, works_monday: true, works_tuesday: true, works_wednesday: true,
    works_thursday: true, works_friday: true, works_saturday: false,
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
        if (!parsed.dateRange?.from || !parsed.dateRange?.to) {
          throw new Error('Arquivo válido mas sem batidas — não há datas pra importar. Confira o conteúdo do relógio.');
        }
        result = {
          employees: Array.from(empMap.values()),
          startDate: parsed.dateRange.from,
          endDate: parsed.dateRange.to,
        };
        toast.info(`Detectado formato ${parsed.format} — ${parsed.totalRows} batidas em ${parsed.employees.length} funcionários`);
      } else if (isTxt) {
        result = await parseTimesheetTxt(file);
      } else {
        result = await parseTimesheetXlsx(file);
      }
      const datedResult = {
        ...result,
        employees: result.employees.map(emp => ({
          ...emp,
          records: emp.records.map(record => ({
            ...record,
            dateStr: record.dateStr || resolveTimesheetRecordDate(record.day, result.startDate, result.endDate),
          })),
        })),
      };
      setPreview({ ...datedResult, rawFile: file });
      const matched = datedResult.employees.filter(emp => emp.records.some(record =>
        !!findEmployeeMatch(employees, emp.name, emp.externalId, {
          recordDate: record.dateStr,
          allowNameFallback: false,
        }),
      )).length;
      const pending = datedResult.employees.reduce((sum, emp) => sum + emp.records.filter(r => r.punches.length % 2 === 1).length, 0);
      toast.success(`${datedResult.employees.length} IDs encontrados, ${matched} vinculados pelo relógio${pending ? `; ${pending} dia(s) pendente(s)` : ''}`);
    } catch (err: any) {
      toast.error('Erro ao ler arquivo: ' + err.message);
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const doImport = () => {
    if (!preview) return;
    const importStartDate = preview.startDate;
    const importEndDate = preview.endDate;
    importRecords.mutate({
      // Preserva exatamente o nome exportado como evidência; relatórios resolvem
      // o cadastro por ID do relógio e vigência, nunca por este rótulo.
      employees: preview.employees,
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

  // Aviso de matrícula não-casada (2026-06-02): o arquivo do relógio traz o
  // cadastro INTEIRO (dezenas de matrículas, muitas ex-funcionários ou sem
  // batida no período). NÃO bloquear o import por causa disso — antes o
  // window.confirm floodava e impedia importar os ativos ("aparece importado
  // mas não entra"). Agora importa SEMPRE; só AVISA (sem travar) sobre
  // matrículas que TÊM horas e não casam com funcionário ativo — só essas
  // perderiam horas na folha (as sem batida são irrelevantes).
  const handleImport = () => {
    if (!preview) return;
    const unmatchedWithHours = preview.employees.filter(e =>
      !findEmployeeMatch(employees, e.name, e.externalId, { allowNameFallback: false }) &&
      Array.isArray(e.records) && e.records.some((r: any) => Array.isArray(r.punches) && r.punches.length > 0),
    );
    if (unmatchedWithHours.length > 0) {
      const list = unmatchedWithHours.map(e => `${e.name || '?'} (matr. ${e.externalId || '?'})`).join(', ');
      toast.warning(
        `${unmatchedWithHours.length} matrícula(s) com horas não casam com funcionário ativo e NÃO entram na folha: ${list}. ` +
        `Cadastre a matrícula em Funcionários e reimporte se for o caso.`,
        { duration: 12000 },
      );
    }
    doImport();
  };

  // Group records by employee, resolving names via employee registry.
  // Fix 22/05/2026: usa findEmployeeMatch com linkedOnly:true e DESCARTA
  // records de funcionários sem coligação (ex: nomes que só existem no
  // relógio de ponto como "alex", "anaCarolina"). Antes esses apareciam
  // com 13 faltas no relatório porque o sistema gerava linhas vazias pra
  // todo o período mesmo sem cadastro. User pediu que só apareçam quem
  // tem cadastro no sistema E está vinculado ao relógio (active +
  // external_id ou match fuzzy com active).
  const employeeGroups = useMemo(() => {
    const map = new Map<string, TimeRecord[]>();
    records.forEach(r => {
      const match = findEmployeeMatch(employees, r.employee_name, r.employee_external_id, { linkedOnly: true, recordDate: r.record_date, allowNameFallback: false });
      if (!match) return; // pula funcionários órfãos (só no relógio, sem cadastro)
      const resolvedName = match.name;
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

  // Use the same dateRange logic as OverviewTab (via timeControlFilters) for consistency
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

  // Resolve uma vez por intervalo: feriado recorrente vale em todos os anos do ponto.
  const holidayDates = useMemo(
    () => batchDateRange
      ? resolveHolidaysForPayrollRange(holidays, batchDateRange.startDate, batchDateRange.endDate)
      : new Set<string>(),
    [holidays, batchDateRange],
  );
  // Troca de dia: qualquer data de troca (work/off) prevalece sobre feriado — o dia
  // é lido pela regra flex (normal quando trabalhado, neutro quando não).
  const isHolidayDate = (dateStr: string) =>
    !swapWorkedSet.has(dateStr) && !swapOffSet.has(dateStr)
    && (holidayDates.has(dateStr) || resolveHolidaysForPayrollRange(holidays, dateStr, dateStr).has(dateStr));

  const calcSummariesForEmployee = (empName: string) => {
    const empRecords = employeeGroups.get(empName) || [];
    const recordMap = new Map<string, string[]>();
    empRecords.forEach(rec => {
      recordMap.set(rec.record_date, rec.punches as string[]);
    });

    // Resolve admission + termination dates — fix 2026-05-18 user report:
    // relatório calculava horas esperadas sobre o PRAZO TOTAL do batch,
    // inflando expected pra dias ANTES da admissão E APÓS a demissão.
    const emp = employees.find(e =>
      e.name.toLowerCase().trim() === empName.toLowerCase().trim()
    );
    const admissionDateStr = (emp as any)?.admission_date as string | null | undefined;
    const terminationDateStr = (emp as any)?.termination_date as string | null | undefined;
    // Escala INDIVIDUAL do funcionário (fallback default) — antes usava sempre
    // a default, ignorando work_schedule_id.
    const empSchedule = ((emp as any)?.work_schedule_id && schedules.find(s => s.id === (emp as any).work_schedule_id)) || defaultSchedule;

    // Generate all days in the date range
    if (!batchDateRange) {
      // Fallback: only use existing records
      return empRecords.map(rec => {
        const date = new Date(rec.record_date + 'T12:00:00');
        const dayOfWeek = date.getDay();
        const isHol = isHolidayDate(rec.record_date);
        const summary = calculateDaySummary(rec.punches as string[], dayOfWeek, empSchedule, isHol, swapModeFor(rec.record_date));
        return { ...summary, date: rec.record_date, punches: rec.punches as string[] } as DaySummary;
      });
    }

    // Respeita admission_date + termination_date: efetivo start = max(batch.start,
    // admission_date) e efetivo end = min(batch.end, termination_date).
    // Dias fora do contrato (antes da admissão / depois da demissão) são pulados.
    // Tolerante a datas null/inválidas (cai no batch range original).
    const effectiveStartStr = (admissionDateStr && /^\d{4}-\d{2}-\d{2}$/.test(admissionDateStr) && admissionDateStr > batchDateRange.startDate)
      ? admissionDateStr
      : batchDateRange.startDate;
    const effectiveEndStr = (terminationDateStr && /^\d{4}-\d{2}-\d{2}$/.test(terminationDateStr) && terminationDateStr < batchDateRange.endDate)
      ? terminationDateStr
      : batchDateRange.endDate;

    const allDays: DaySummary[] = [];
    const start = new Date(effectiveStartStr + 'T12:00:00');
    const end = new Date(effectiveEndStr + 'T12:00:00');
     const cursor = new Date(start);
     let safetyCounter = 0;

     while (cursor <= end && safetyCounter < 1000) {
       safetyCounter++;
       const dateStr = cursor.toISOString().slice(0, 10);
      const dayOfWeek = cursor.getDay();
      const isHol = isHolidayDate(dateStr);
      const punches = recordMap.get(dateStr) || [];
      const summary = calculateDaySummary(punches, dayOfWeek, empSchedule, isHol, swapModeFor(dateStr));
      allDays.push({ ...summary, date: dateStr, punches } as DaySummary);
      cursor.setDate(cursor.getDate() + 1);
    }

    return allDays;
  };

  // Calculate summaries for selected employee
  const summaries = useMemo(() => {
    if (selectedEmployee === '__all__' || !selectedEmployee) return [];
    return calcSummariesForEmployee(selectedEmployee);
  }, [selectedEmployee, employeeGroups, defaultSchedule, holidays, swapWorkedSet, swapOffSet, batchDateRange, employees]);

  // Folha líquida do período de UM funcionário (a MESMA conta da aba Folha): monta os dias
  // da escala (esperado/feriado) + batidas e calcula HE líquida / atraso / falta.
  // DEFINIDA AQUI (antes de allEmployeeSummaries/folhaInd que a usam) — senão dá TDZ.
  const folhaForEmployee = (empName: string, dayData: { date: string; punches?: string[] }[]) => {
    const emp = findEmployeeMatch(employees, empName);
    const salary = Number(emp?.salary) || 0;
    const sch = (emp?.work_schedule_id && schedules.find(s => s.id === emp.work_schedule_id)) || defaultSchedule;
    const punchesByDate = new Map<string, string[]>(dayData.map(d => [d.date, Array.isArray(d.punches) ? d.punches : []]));
    const from = dayData[0]?.date || '';
    const to = dayData[dayData.length - 1]?.date || '';
    return computePeriodFolha({
      salary, from, to,
      schedule: sch, holidaysSet: resolveHolidaysForPayrollRange(holidays, from, to), swapWorkedSet, swapOffSet, punchesByDate,
      // HE em R$/h por funcionário + regime — pra o Espelho/Ponto bater com a Folha (spec req.15).
      payRegime: (String((emp as any)?.payment_type || 'mensalista').toLowerCase() as 'mensalista' | 'remoto' | 'diarista'),
      dailyRate: Number((emp as any)?.daily_rate) || 0,
      heNormalRate: Number((emp as any)?.he_normal_rate) || 0,
      heSundayHolidayRate: Number((emp as any)?.he_sunday_holiday_rate) || 0,
    });
  };

  // All employees summary (weekly-based)
  const allEmployeeSummaries = useMemo(() => {
    if (selectedEmployee !== '__all__') return [];
    return employeeNames.map(name => {
      const dayData = calcSummariesForEmployee(name);
      const f = folhaForEmployee(name, dayData);   // ALINHADO À FOLHA (HE líquida)
      return {
        name,
        worked: f.worked_minutes,
        expected: f.expected_minutes,
        overtime: f.he_minutes,      // hora extra LÍQUIDA do período
        absent: f.falta_days,
        incomplete: f.pending_days,
        days: dayData.length,
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmployee, employeeNames, employeeGroups, defaultSchedule, holidays, holidayDates, swapWorkedSet, swapOffSet, schedules, batchDateRange, employees]);

  // ALINHADO À FOLHA: os números de PAGAMENTO da tela (trabalhadas, esperadas, hora extra,
  // atraso, faltas) vêm do MESMO motor da folha (computePeriodFolha — HE líquida do período,
  // esperado da escala), não mais do regime semanal 528. O Espelho/banco seguem no caminho legal.
  const folhaInd = useMemo(() => {
    if (!selectedEmployee || selectedEmployee === '__all__' || summaries.length === 0) return null;
    return folhaForEmployee(selectedEmployee, summaries);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmployee, summaries, holidayDates, swapWorkedSet, swapOffSet, schedules, employees, defaultSchedule]);

  const totalWorked = folhaInd?.worked_minutes ?? 0;
  const totalExpected = folhaInd?.expected_minutes ?? 0;
  const compensatedOvertime = folhaInd?.he_minutes ?? 0;   // hora extra LÍQUIDA do período
  const remainingDeficit = folhaInd?.atraso_minutes ?? 0;  // atraso/déficit LÍQUIDO
  const totalOvertime = compensatedOvertime;               // não há "bruta" no modelo líquido
  const faltasFolha = folhaInd?.falta_days ?? 0;
  const heValueFolha = folhaInd?.he_value ?? 0;
  const atrasoDescontoFolha = folhaInd?.atraso_desconto ?? 0;
  const absences = faltasFolha;
  const holidayWorked = summaries.filter(d => d.isHoliday && d.workedMinutes > 0).length;

  // overtimeDays removido: overtimeMinutes por dia é sempre 0 (HE é do período).
  const deficitDays = summaries.filter(d => d.expectedMinutes > 0 && d.workedMinutes > 0 && d.workedMinutes < d.expectedMinutes);
  const absentDays = summaries.filter(d => d.isAbsent);

  // Period label from batch
  const periodLabel = filterStartDate && filterEndDate 
    ? `${filterStartDate.split('-').reverse().join('/')} - ${filterEndDate.split('-').reverse().join('/')}`
    : (selectedBatch ? selectedBatch.replace(/_\d+$/, '').split('_').map(d => d.split('-').reverse().join('/')).join(' - ') : 'Período');

  // Build EmployeeTimesheetData for printing
  const getHourlySalary = (empName: string) => {
    const emp = findEmployeeMatch(employees, empName);
    if (!emp || !emp.salary) return 0;
    return emp.salary / SALARY_HOUR_DIVISOR; // valor-hora = salário ÷ 220
  };

  // ── Impressão de relatórios de ponto migrou para RH → Relatórios ──
  // (src/components/hr/RelatoriosRH.tsx — 4 visões: Horas, Pagamento, Calendário,
  // Espelho, com seletor Todos↔funcionário). Aquele componente monta o
  // EmployeeTimesheetData e chama as funções de impressão. Esta tela ficou só com
  // Importar + revisão na tela + Pendências. Unificado em 2026-06-04.

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
      <Panel className="border-primary/25 bg-primary/[0.025]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <Upload className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="section-label text-primary">COMECE AQUI</p>
              <h3 className="mt-1 text-base font-bold">Selecione o arquivo do relógio</h3>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                Aceita AGL_001.TXT, XLS e XLSX. Antes de gravar, você confere o período, os funcionários vinculados e as batidas encontradas.
              </p>
            </div>
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.txt" className="hidden" onChange={handleFileUpload} />
          <Button className="w-full shrink-0 gap-1.5 sm:w-auto" onClick={() => fileRef.current?.click()} disabled={parsing}>
            {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {parsing ? 'Lendo arquivo...' : 'Selecionar arquivo'}
          </Button>
        </div>
      </Panel>

      <details className="group rounded-lg border border-border/70 bg-card">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2 text-sm font-medium">
            <AlarmClock className="h-4 w-4 text-muted-foreground" />
            Como fechar o ponto deste período
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="grid gap-4 border-t border-border/70 px-4 py-4 md:grid-cols-3">
          {[
            ['1', 'Importe', 'Confira período, matrículas vinculadas e dias com batidas.'],
            ['2', 'Corrija', 'Resolva batidas ímpares ou esquecidas antes do cálculo.'],
            ['3', 'Justifique e confira', 'Registre ausências justificadas e revise os totais na Folha.'],
          ].map(([step, title, description]) => (
            <div key={step} className="flex gap-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-foreground">{step}</span>
              <p className="text-xs leading-relaxed text-muted-foreground">
                <strong className="block text-sm text-foreground">{title}</strong>
                {description}
              </p>
            </div>
          ))}
        </div>
      </details>

      {preview && (() => {
        const matchedEmployees = preview.employees.filter(emp =>
          emp.records.some(record => findEmployeeMatch(employees, emp.name, emp.externalId, {
            recordDate: record.dateStr || `${preview.startDate.slice(0, 7)}-${String(record.day).padStart(2, '0')}`,
            allowNameFallback: false,
          })),
        );
        const unmatchedEmps = preview.employees.filter(emp => !matchedEmployees.includes(emp));
        const matchedCount = matchedEmployees.length;
        const totalRecords = preview.employees.reduce((s, e) => s + e.records.length, 0);
        // Range REAL de batidas (ignora placeholders punches=[]) — pra avisar
        // quando o arquivo do relógio termina antes do esperado. Causa nº1 de
        // "importei mas não entrou": a exportação do relógio não incluiu os dias
        // novos (o parser não trunca — confirmado; ele lê tudo que está no arquivo).
        const punchDates = preview.employees
          .flatMap(e => e.records)
          .filter((r: any) => Array.isArray(r.punches) && r.punches.length > 0)
          .map((r: any) => (r.dateStr as string) || '')
          .filter(Boolean)
          .sort();
        const firstPunch = punchDates[0] || preview.startDate;
        const lastPunch = punchDates[punchDates.length - 1] || preview.endDate;
        const punchDayCount = new Set(punchDates).size;
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const gapToToday = Math.round(
          (new Date(`${todayStr}T00:00:00`).getTime() - new Date(`${lastPunch}T00:00:00`).getTime()) / 86400000,
        );
        const staleFile = Number.isFinite(gapToToday) && gapToToday >= 3;
        const fmtBR = (d: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('/') : '—');
        return (
          <Card className="border-primary/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4" />
                Prévia da Importação — {preview.startDate} a {preview.endDate}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Banner de range REAL: a 1ª coisa que o usuário vê. Mostra de quando
                  até quando o arquivo tem batida; se o último dia está 3+ dias atrás,
                  alerta que a exportação do relógio provavelmente ficou desatualizada. */}
              <div className={`rounded-md border p-3 ${staleFile ? 'border-amber-500/40 bg-amber-500/5' : 'border-border bg-muted/30'}`}>
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Calendar className="h-4 w-4 shrink-0" />
                  <span>Ponto de <strong>{fmtBR(firstPunch)}</strong> até <strong>{fmtBR(lastPunch)}</strong> · {punchDayCount} dia{punchDayCount === 1 ? '' : 's'} com batida</span>
                </div>
                {staleFile && (
                  <div className="mt-2 flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>
                      O dia mais recente do arquivo é <strong>{fmtBR(lastPunch)}</strong> (~{gapToToday} dias atrás).
                      Se você esperava dias mais novos, a exportação do relógio <strong>não os incluiu</strong> — refaça
                      o download no relógio cobrindo o período correto e reimporte. O sistema só calcula a folha até
                      o último dia com batida.
                    </span>
                  </div>
                )}
              </div>
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
                        <TableHead className="text-xs">Status</TableHead>
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
                          <TableCell className="py-1.5 text-xs text-muted-foreground">
                            Cadastre a matrícula do relógio no funcionário antes de importar.
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

              <p className="text-xs text-muted-foreground">
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
      <Panel
        eyebrow="CONFERÊNCIA"
        title="Período para revisão"
        subtitle={fullDateRange
          ? `Histórico disponível de ${fullDateRange.startDate.split('-').reverse().join('/')} a ${fullDateRange.endDate.split('-').reverse().join('/')} · ${fullDateRange.totalRecords.toLocaleString('pt-BR')} registros em ${batches.length} importações.`
          : 'Escolha as datas ou uma importação específica para conferir as batidas.'}
      >
        <div className="space-y-3">
          <PeriodRangeFilter
            value={{ from: filterStartDate, to: filterEndDate }}
            onChange={handleRangeChange}
            min={fullDateRange?.startDate}
            max={fullDateRange?.endDate}
            label="Período das batidas"
          />
          <div className="grid items-end gap-3 sm:grid-cols-[minmax(240px,1fr)_auto]">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Importação específica</Label>
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
              <SelectTrigger className="w-full"><SelectValue placeholder="Todas as importações" /></SelectTrigger>
              <SelectContent>
                {batches.map(b => (
                  <SelectItem key={b} value={b}>{b.replace(/_\d+$/, '').split('_').map(d => d.split('-').reverse().join('/')).join(' a ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap gap-2 sm:justify-end">
            {fullDateRange && (
              <Button
                variant="secondary"
                size="sm"
                className="h-10 flex-1 gap-1.5 sm:flex-none"
                onClick={() => {
                  setSelectedBatch('');
                  setFilterStartDate(fullDateRange.startDate);
                  setFilterEndDate(fullDateRange.endDate);
                }}
              >
                <Calendar className="h-3.5 w-3.5" />
                Todo o histórico
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
                Limpar filtros
              </Button>
            )}

            {selectedBatch && (
              <Button 
                variant="outline" 
                size="icon" 
                className="h-10 w-10 text-destructive" 
                aria-label="Excluir a importação selecionada"
                title="Excluir a importação selecionada"
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

        {employeeNames.length > 0 && (
          <div className="-mx-4 -mb-4 mt-4 flex flex-col gap-3 border-t border-border bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-2.5">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-medium">
                  {employeeNames.length} funcionário{employeeNames.length === 1 ? '' : 's'} com batidas neste período
                </p>
                <p className="text-xs text-muted-foreground">
                  Corrija batidas pendentes antes de conferir os valores calculados na Folha.
                </p>
              </div>
            </div>
            <Button
              size="sm" variant="outline" className="w-full shrink-0 gap-1.5 sm:w-auto"
              onClick={() => setRhSearchParams(p => { const n = new URLSearchParams(p); n.set('tab', 'folha'); return n; }, { replace: true })}
            >
              <FileText className="h-3.5 w-3.5" /> Abrir folha
            </Button>
          </div>
        )}
      </Panel>

      {/* Employee selector OCULTO (2026-06-20): o Ponto não mostra mais resumo
          por funcionário — isso é visualização e vive no RH → Relatórios. */}
      {false && employeeNames.length > 0 && (
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
          {selectedEmployee && selectedEmployee !== '__all__' && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setReportDialogOpen(true)}>
              <Users2 className="h-3.5 w-3.5" /> Resumo Individual
            </Button>
          )}
        </div>
      )}

      {/* Resumo/financeiro/registro-diário por funcionário REMOVIDOS do Ponto
          (2026-06-20): tudo isso é visualização e vive no RH → Relatórios (Horas,
          Pagamento, Espelho, Calendário). O Ponto é SÓ ENTRADA. */}

      {records.length === 0 && !preview && (
        <Panel flush>
          <EmptyState
            icon={FileSpreadsheet}
            title="Nenhum registro de ponto importado"
            description="Importe o arquivo .xlsx ou .txt (AGL) gerado pelo relógio de ponto."
          />
        </Panel>
      )}

      {/* Individual employee report dialog */}
      <Dialog open={reportDialogOpen} onOpenChange={setReportDialogOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users2 className="h-5 w-5" />
              Resumo Individual — {selectedEmployee}
            </DialogTitle>
            <DialogDescription>Horas trabalhadas, esperadas e déficit do funcionário no período.</DialogDescription>
          </DialogHeader>

          {selectedEmployee && selectedEmployee !== '__all__' && summaries.length > 0 && (() => {
            // Ponto é SÓ ENTRADA: este diálogo mostra apenas HORAS (trabalhadas/
            // esperadas/faltas/déficit). Os valores em R$ (HE, descontos, líquido)
            // vivem na aba FOLHA — não duplicar pagamento aqui (2026-06-28).
            return (
              <div className="space-y-5 mt-2">
                {/* Summary cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Card><CardContent className="p-3 text-center">
                    <p className="text-xs text-muted-foreground uppercase">Trabalhadas</p>
                    <p className="text-lg font-bold font-mono">{minutesToDisplay(totalWorked)}</p>
                  </CardContent></Card>
                  <Card><CardContent className="p-3 text-center">
                    <p className="text-xs text-muted-foreground uppercase">Esperadas</p>
                    <p className="text-lg font-bold font-mono">{minutesToDisplay(totalExpected)}</p>
                  </CardContent></Card>
                  <Card><CardContent className="p-3 text-center">
                    <p className="text-xs text-muted-foreground uppercase">HE Líquida</p>
                    <p className="text-lg font-bold font-mono text-green-600">{minutesToDisplay(compensatedOvertime)}</p>
                  </CardContent></Card>
                  <Card><CardContent className="p-3 text-center">
                    <p className="text-xs text-muted-foreground uppercase">Faltas</p>
                    <p className="text-lg font-bold text-destructive">{absences}</p>
                  </CardContent></Card>
                </div>

                {/* Resumo Financeiro (valor/hora, HE em R$, descontos, líquido) REMOVIDO
                    daqui (2026-06-28): pagamento é SAÍDA, vive na aba Folha. O Ponto é
                    só entrada — este diálogo fica só com horas. */}

                {/* "Dias com Hora Extra" REMOVIDO (auditoria 2026-06-17): HE é do
                    PERÍODO, não diária — overtimeMinutes por dia é sempre 0. Ver
                    card "Hora Extra" (motor da folha). */}

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
                              <TableCell><div className="flex flex-wrap gap-1">{d.punches.map((p, i) => <Badge key={i} variant="outline" className="text-xs font-mono">{p}</Badge>)}</div></TableCell>
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
                        </TableRow></TableHeader>
                        <TableBody>
                          {absentDays.map(d => (
                            <TableRow key={d.date}>
                              <TableCell className="font-mono text-sm">{new Date(d.date + 'T12:00:00').toLocaleDateString('pt-BR')}</TableCell>
                              <TableCell className="text-xs">{DAYS_PT[d.dayOfWeek]}</TableCell>
                              <TableCell className="text-right font-mono text-sm text-destructive">{minutesToDisplay(d.expectedMinutes)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                {/* Impressão/PDF migrou para RH → Relatórios (visão Horas/Pagamento
                    por funcionário). Este diálogo é só a revisão rápida na tela. */}
                <div className="flex justify-end pt-2 border-t">
                  <Button
                    size="sm" variant="outline" className="gap-1.5"
                    onClick={() => { setReportDialogOpen(false); setRhSearchParams(p => { const n = new URLSearchParams(p); n.set('tab', 'relatorios'); return n; }, { replace: true }); }}
                  >
                    <FileText className="h-3.5 w-3.5" /> Imprimir em Relatórios
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
  const { value: activeTab, setValue: setActiveTab } = useUrlTabState({
    values: ['records', 'manual', 'ausencias', 'calendario', 'config'] as const,
    defaultValue: 'records',
    param: 'subtab',
    aliases: {
      overview: 'records', late: 'manual', occurrences: 'manual', pending: 'manual',
      reports: 'records', overtime: 'records', history: 'config', schedule: 'config', holidays: 'config',
    },
  });
  const { total: pendingTotal, overdueTotal } = usePendingTotal(30);
  const sections = [
    {
      value: 'records',
      label: 'Importar',
      description: 'Envie o arquivo do relógio e escolha o período que deseja conferir.',
      icon: FileSpreadsheet,
      step: '1',
    },
    {
      value: 'manual',
      label: 'Corrigir',
      description: 'Resolva batidas ímpares, esquecidas ou lançamentos manuais.',
      icon: ClipboardEdit,
      step: '2',
    },
    {
      value: 'ausencias',
      label: 'Justificar',
      description: 'Registre faltas e atrasos justificados antes de fechar a folha.',
      icon: FirstAid,
      step: '3',
    },
    {
      value: 'calendario',
      label: 'Cobertura',
      description: 'Consulte a cobertura da equipe no calendário.',
      icon: Calendar,
      step: undefined,
    },
    {
      value: 'config',
      label: 'Ajustes',
      description: 'Gerencie feriados, trocas de dia e o histórico de arquivos.',
      icon: Settings2,
      step: undefined,
    },
  ] as const;
  const activeSection = sections.find(section => section.value === activeTab) ?? sections[0];

  return (
    <div className="space-y-4 page-enter">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        {/* Refocus 2026-06-01 (folha por hora): Ponto gira só em torno das
            batidas + feriados. Resolução HE, divergências, atrasos, validação
            de jornada e escala foram aposentados — o modelo por hora não usa
            jornada esperada. */}
        <div className="rounded-lg border border-border/70 bg-card p-2">
          <TabsList
            indicator="none"
            className="grid h-auto w-full grid-cols-6 gap-1 border-0 bg-transparent p-0 md:flex"
            aria-label="Fluxo do controle de ponto"
          >
            {sections.map((section, index) => (
              <TabsTrigger
                key={section.value}
                value={section.value}
                className={cn(
                  'group min-h-10 gap-1.5 rounded-md border-b-0 px-2 py-2 font-sans text-xs font-semibold normal-case tracking-normal data-[state=active]:bg-muted data-[state=active]:text-foreground md:col-auto md:flex-1 md:px-3',
                  index < 3 ? 'col-span-2' : 'col-span-3',
                  index === 3 && 'md:ml-2',
                )}
              >
                {section.step ? (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-background text-[10px] font-bold text-muted-foreground group-data-[state=active]:border-primary group-data-[state=active]:bg-primary group-data-[state=active]:text-primary-foreground">
                    {section.step}
                  </span>
                ) : (
                  <section.icon className="h-4 w-4 shrink-0 text-muted-foreground group-data-[state=active]:text-primary" />
                )}
                {section.label}
                {section.value === 'manual' && pendingTotal > 0 && (
                  <>
                    <span
                      className={cn('h-2 w-2 shrink-0 rounded-full sm:hidden', overdueTotal > 0 ? 'bg-destructive' : 'bg-amber-500')}
                      title={`${pendingTotal} pendências de ponto`}
                    />
                    <span className="sr-only">{pendingTotal} pendências de ponto</span>
                    <Badge
                      variant="outline"
                      aria-hidden="true"
                      className={cn(
                        'ml-0.5 hidden h-5 shrink-0 px-1.5 text-[10px] tabular-nums sm:inline-flex',
                        overdueTotal > 0
                          ? 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400'
                          : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
                      )}
                      title={`${pendingTotal} pendências de ponto`}
                    >
                      {pendingTotal}
                    </Badge>
                  </>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
          <p className="px-2 pb-1 pt-2 text-xs text-muted-foreground">{activeSection.description}</p>
        </div>

        <TabsContent value="records"><TimesheetRecordsTab /></TabsContent>
        {/* Lançamento + Pendências UNIFICADOS (2026-06-21, pedido do dono): as duas
            abas se complementavam — Pendências lista os dias com batida ímpar/faltando
            (fix inline + "18:00 a todos"); o Lançamento é a grade livre pra editar
            qualquer dia. Juntas numa tela só → vê o que falta e resolve no mesmo lugar.
            Ordem: pendências (o que resolver) → grade (onde resolver) → exceções. */}
        <TabsContent value="manual" className="space-y-6">
          <PendingTimeRecordsPanel />
          <Separator />
          <ManualEntryTab />
          <Separator />
          <ExceptionsTab />
        </TabsContent>
        {/* Faltas/atrasos justificados (spec req.10): registra a ausência em
            employee_absences → o motor da folha ABONA (não desconta falta nem atraso
            do dia). Mesma tela reaproveitada de /rh/ausencias. */}
        <TabsContent value="ausencias"><EmployeeAbsences embedded /></TabsContent>
        <TabsContent value="calendario"><CoverageCalendar /></TabsContent>
        <TabsContent value="config" className="space-y-6">
          <HolidaysTab />
          <Separator />
          <WorkdaySwapsTab />
          <Separator />
          <ImportHistoryPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
