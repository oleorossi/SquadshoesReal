import { useState, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  useWorkSchedules, useTimeRecords, useImportBatches,
  WorkSchedule, TimeRecord,
} from '@/hooks/useTimesheet';
import { useEmployees } from '@/hooks/useEmployees';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Clipboard as ClipboardEdit, Plus, Trash as Trash2, FloppyDisk as Save, CaretLeft as ChevronLeft, CaretRight as ChevronRight, User, Users as Users2, X, Clock } from '@phosphor-icons/react';
import { getBatchDateRange } from '@/lib/timeControlFilters';

const DAYS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const DAYS_FULL = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

function isManualPunch(p: string) { return p.endsWith('*'); }
function cleanPunch(p: string) { return p.replace(/\*$/, ''); }

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  d.setHours(12, 0, 0, 0);
  return d;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

function formatDateBR(dateStr: string) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

interface CellDialogState {
  employeeName: string;
  dateStr: string;
  existingRecord: TimeRecord | null;
  punches: string[];
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export default function ManualEntryTab() {
  const queryClient = useQueryClient();
  const { data: schedules = [] } = useWorkSchedules();
  const { data: batches = [] } = useImportBatches();
  const { data: employees = [] } = useEmployees();

  const [selectedBatch, setSelectedBatch] = useState<string>('__latest__');
  const [filterEmployee, setFilterEmployee] = useState<string>('__all__');
  const [weekStart, setWeekStart] = useState<Date>(() => getMonday(new Date()));
  const [cellDialog, setCellDialog] = useState<CellDialogState | null>(null);
  const [newPunch, setNewPunch] = useState('');
  const [saving, setSaving] = useState(false);

  const activeBatchId = selectedBatch === '__latest__' ? batches[0] : selectedBatch;
  const batchRange = activeBatchId ? getBatchDateRange(activeBatchId) : null;

  const weekDates = useMemo(() => Array.from({ length: 6 }, (_, i) => toDateStr(addDays(weekStart, i))), [weekStart]);
  const weekEnd = weekDates[5];

  const startDate = batchRange ? batchRange.startDate : weekDates[0];
  const endDate = batchRange ? batchRange.endDate : weekEnd;

  const { data: records = [], isLoading } = useTimeRecords(
    activeBatchId || undefined,
    startDate,
    endDate,
  );

  const defaultSchedule: WorkSchedule = schedules.find(s => s.is_default) || schedules[0] || {
    id: '', name: 'Default', entry_time: '08:00', lunch_start: '12:00', lunch_end: '13:00',
    exit_time: '17:48', saturday_entry: '08:00', saturday_exit: '12:00', weekly_hours: 44,
    overtime_multiplier: 1.5, night_overtime_multiplier: 1.7, holiday_multiplier: 2.0,
    tolerance_minutes: 10, minimum_overtime_minutes: 0, is_default: true, created_at: '', updated_at: '',
  };

  // Map of "employeeName|dateStr" → TimeRecord
  const recordMap = useMemo(() => {
    const m = new Map<string, TimeRecord>();
    records.forEach(r => m.set(`${r.employee_name}|${r.record_date}`, r));
    return m;
  }, [records]);

  const employeeNames = useMemo(() => {
    const fromRecords = new Set(records.map(r => r.employee_name));
    const fromRegistry = employees.map(e => e.name);
    fromRegistry.forEach(n => fromRecords.add(n));
    return Array.from(fromRecords).sort();
  }, [records, employees]);

  const displayedEmployees = useMemo(() => {
    if (filterEmployee === '__all__') return employeeNames;
    return [filterEmployee];
  }, [employeeNames, filterEmployee]);

  const prevWeek = () => setWeekStart(d => addDays(d, -7));
  const nextWeek = () => setWeekStart(d => addDays(d, 7));
  const goToCurrentWeek = () => setWeekStart(getMonday(new Date()));

  const openCell = useCallback((employeeName: string, dateStr: string) => {
    const existing = recordMap.get(`${employeeName}|${dateStr}`) || null;
    setCellDialog({
      employeeName,
      dateStr,
      existingRecord: existing,
      punches: existing ? [...(existing.punches as string[])] : [],
    });
    setNewPunch('');
  }, [recordMap]);

  const addPunchToDialog = () => {
    if (!newPunch || !cellDialog) return;
    const clean = newPunch.trim();
    if (!/^\d{2}:\d{2}$/.test(clean)) {
      toast.error('Formato inválido. Use HH:MM');
      return;
    }
    const marked = clean + '*';
    const updated = [...cellDialog.punches, marked]
      .sort((a, b) => timeToMinutes(cleanPunch(a)) - timeToMinutes(cleanPunch(b)));
    setCellDialog(d => d ? { ...d, punches: updated } : d);
    setNewPunch('');
  };

  const removePunch = (idx: number) => {
    if (!cellDialog) return;
    const updated = cellDialog.punches.filter((_, i) => i !== idx);
    setCellDialog(d => d ? { ...d, punches: updated } : d);
  };

  const saveCell = async () => {
    if (!cellDialog) return;
    setSaving(true);
    try {
      const { employeeName, dateStr, existingRecord, punches } = cellDialog;
      if (existingRecord) {
        const { error } = await supabase
          .from('time_records')
          .update({ punches })
          .eq('id', existingRecord.id);
        if (error) throw error;
      } else {
        const batchId = activeBatchId || `manual_${new Date().toISOString().slice(0, 10)}`;
        const { error } = await supabase
          .from('time_records')
          .insert({
            employee_name: employeeName,
            employee_external_id: null,
            department: '',
            record_date: dateStr,
            punches,
            import_batch: batchId,
          });
        if (error) throw error;
      }
      toast.success('Registro salvo!');
      queryClient.invalidateQueries({ queryKey: ['time_records'] });
      setCellDialog(null);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const clearCell = async (employeeName: string, dateStr: string) => {
    const rec = recordMap.get(`${employeeName}|${dateStr}`);
    if (!rec) return;
    const { error } = await supabase
      .from('time_records')
      .update({ punches: [] })
      .eq('id', rec.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Registro limpo');
    queryClient.invalidateQueries({ queryKey: ['time_records'] });
  };

  const weekLabel = `${formatDateBR(weekDates[0])} – ${formatDateBR(weekDates[5])}`;

  return (
    <div className="space-y-4">
      <Card className="border-emerald-300/40 bg-emerald-50/30 dark:bg-emerald-950/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
            <ClipboardEdit className="h-4 w-4" /> Lançamento Manual de Ponto
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Use quando o funcionário esqueceu de bater, o relógio falhou, ou para corrigir batidas erradas.
            Clique em qualquer célula da grade para adicionar / editar batidas. Marcações ficam destacadas em verde.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1.5 min-w-[200px]">
              <Label className="text-xs">Importação</Label>
              <Select value={selectedBatch} onValueChange={setSelectedBatch}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__latest__">Última importação</SelectItem>
                  {batches.map(b => (
                    <SelectItem key={b} value={b}>{b}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 min-w-[200px]">
              <Label className="text-xs">Funcionário</Label>
              <Select value={filterEmployee} onValueChange={setFilterEmployee}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">
                    <span className="flex items-center gap-1.5"><Users2 className="h-3.5 w-3.5" /> Todos</span>
                  </SelectItem>
                  {employeeNames.map(n => (
                    <SelectItem key={n} value={n}>
                      <span className="flex items-center gap-1.5"><User className="h-3.5 w-3.5" /> {n}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1 pb-0.5">
              <Button variant="outline" size="sm" onClick={prevWeek} className="h-9 w-9 p-0">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="text-sm font-medium min-w-[130px] text-center">{weekLabel}</div>
              <Button variant="outline" size="sm" onClick={nextWeek} className="h-9 w-9 p-0">
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={goToCurrentWeek} className="h-9 text-xs text-muted-foreground">
                Hoje
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Clique em uma célula para registrar ou editar os horários do funcionário naquele dia. Batidas manuais ficam marcadas em verde.
          </p>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-12 text-muted-foreground">Carregando...</div>
      ) : displayedEmployees.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Users2 className="h-8 w-8 mx-auto mb-2 opacity-40" />
            Nenhum funcionário encontrado.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-muted/30 border-b">
                    <th className="text-left py-2 px-3 font-medium text-xs text-muted-foreground w-40 sticky left-0 bg-muted/30 z-10">
                      Funcionário
                    </th>
                    {weekDates.map(dateStr => {
                      const d = new Date(dateStr + 'T12:00:00');
                      const dow = d.getDay();
                      const isToday = dateStr === toDateStr(new Date());
                      return (
                        <th key={dateStr} className={`py-2 px-2 text-center font-medium text-xs min-w-[110px] ${isToday ? 'bg-primary/10' : ''}`}>
                          <div className={`font-semibold ${isToday ? 'text-primary' : dow === 0 || dow === 6 ? 'text-muted-foreground' : ''}`}>
                            {DAYS_PT[dow]}
                          </div>
                          <div className="font-mono text-xs text-muted-foreground">{formatDateBR(dateStr)}</div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {displayedEmployees.map((empName, rowIdx) => (
                    <tr key={empName} className={`border-b hover:bg-muted/20 ${rowIdx % 2 === 0 ? '' : 'bg-muted/10'}`}>
                      <td className={`py-2 px-3 font-medium text-xs sticky left-0 z-10 ${rowIdx % 2 === 0 ? 'bg-card' : 'bg-muted/10'}`}>
                        <span className="truncate block max-w-[140px]">{empName}</span>
                      </td>
                      {weekDates.map(dateStr => {
                        const rec = recordMap.get(`${empName}|${dateStr}`);
                        const punches = (rec?.punches as string[] | undefined) || [];
                        const d = new Date(dateStr + 'T12:00:00');
                        const dow = d.getDay();
                        const isWeekend = dow === 0 || dow === 6;
                        const isToday = dateStr === toDateStr(new Date());
                        const hasManual = punches.some(isManualPunch);
                        const cleanPunches = punches.map(cleanPunch).sort();

                        return (
                          <td
                            key={dateStr}
                            className={`py-1 px-2 text-center cursor-pointer transition-colors align-top
                              ${isToday ? 'bg-primary/5' : ''}
                              ${isWeekend && !rec ? 'bg-muted/5 opacity-60' : ''}
                              hover:bg-primary/10
                            `}
                            onClick={() => openCell(empName, dateStr)}
                          >
                            {cleanPunches.length === 0 ? (
                              <div className="text-muted-foreground/40 text-xs py-1">—</div>
                            ) : (
                              <div className="space-y-0.5">
                                {cleanPunches.map((p, i) => (
                                  <div
                                    key={i}
                                    className={`font-mono text-xs rounded px-1 inline-block mx-0.5 ${
                                      isManualPunch(punches[i] || '') || hasManual
                                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                        : 'bg-muted/60 text-foreground'
                                    }`}
                                  >
                                    {p}
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cell edit dialog */}
      <Dialog open={!!cellDialog} onOpenChange={open => { if (!open) setCellDialog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardEdit className="h-4 w-4" /> Editar Registro de Ponto
            </DialogTitle>
          </DialogHeader>
          {cellDialog && (
            <div className="space-y-4">
              <div className="rounded-lg border p-3 space-y-1.5 bg-muted/30">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Funcionário</span>
                  <span className="font-medium">{cellDialog.employeeName}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Data</span>
                  <span className="font-mono">
                    {DAYS_FULL[new Date(cellDialog.dateStr + 'T12:00:00').getDay()]},{' '}
                    {new Date(cellDialog.dateStr + 'T12:00:00').toLocaleDateString('pt-BR')}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Horário previsto</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {defaultSchedule.entry_time} – {defaultSchedule.exit_time}
                  </span>
                </div>
              </div>

              {/* Punches list */}
              <div className="space-y-2">
                <Label className="text-xs font-semibold">Batidas registradas</Label>
                {cellDialog.punches.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">Nenhuma batida registrada</p>
                ) : (
                  <div className="space-y-1">
                    {cellDialog.punches.map((p, idx) => {
                      const clean = cleanPunch(p);
                      const manual = isManualPunch(p);
                      const label = idx % 2 === 0 ? 'Entrada' : 'Saída';
                      return (
                        <div key={idx} className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-12 text-right">{label}</span>
                          <Badge
                            variant="outline"
                            className={`font-mono text-xs flex-1 justify-center ${manual
                              ? 'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-700'
                              : ''}`}
                          >
                            <Clock className="h-3 w-3 mr-1" />{clean}
                            {manual && <span className="ml-1 text-xs opacity-70">manual</span>}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                            onClick={() => removePunch(idx)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      );
                    })}
                    {cellDialog.punches.length % 2 !== 0 && (
                      <p className="text-xs text-amber-600 flex items-center gap-1 mt-1">
                        ⚠ Número ímpar de batidas — adicione a batida faltante
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Add punch */}
              <div className="space-y-1.5">
                <Label className="text-xs">Adicionar batida manual</Label>
                <div className="flex gap-2">
                  <Input
                    type="time"
                    value={newPunch}
                    onChange={e => setNewPunch(e.target.value)}
                    className="font-mono h-9"
                    placeholder="HH:MM"
                    onKeyDown={e => e.key === 'Enter' && addPunchToDialog()}
                  />
                  <Button size="sm" variant="outline" onClick={addPunchToDialog} className="gap-1 h-9">
                    <Plus className="h-3.5 w-3.5" /> Adicionar
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Batidas manuais são marcadas em verde</p>
              </div>

              <div className="flex gap-2 justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-muted-foreground text-xs"
                  onClick={() => { if (cellDialog) clearCell(cellDialog.employeeName, cellDialog.dateStr); setCellDialog(null); }}
                  disabled={!cellDialog.existingRecord}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Limpar dia
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setCellDialog(null)}>Cancelar</Button>
                  <Button size="sm" onClick={saveCell} disabled={saving} className="gap-1">
                    <Save className="h-3.5 w-3.5" /> {saving ? 'Salvando...' : 'Salvar'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
