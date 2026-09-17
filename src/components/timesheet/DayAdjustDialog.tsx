import { useMemo, useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import {
  Clipboard as ClipboardEdit,
  Plus,
  Trash as Trash2,
  FloppyDisk as Save,
  X,
  Clock,
  Moon,
  FirstAid,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { TimeRecord, WorkSchedule } from '@/hooks/useTimesheet';
import { mapThreePunchesToNamedSlots } from '@/lib/ponto/interpretDayPunches';
import { detectOvernightCarries } from '@/lib/ponto/overnightPunches';
import {
  useCreateAbsence,
  useDeleteAbsence,
  ABSENCE_KIND_OPTIONS,
  ABSENCE_LABEL,
  type AbsenceKind,
  type EmployeeAbsence,
} from '@/hooks/useEmployeeAbsences';

const DAYS_FULL = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

const SLOT_DEFS = [
  { key: 'entrada', label: 'Entrada' },
  { key: 'saidaAlmoco', label: 'Saída Almoço' },
  { key: 'voltaAlmoco', label: 'Volta Almoço' },
  { key: 'saida', label: 'Saída' },
] as const;
type SlotKey = (typeof SLOT_DEFS)[number]['key'];
type Slots = Record<SlotKey, string>;
type SlotManual = Record<SlotKey, boolean>;

export type DayAdjustMode = 'punches' | 'absence';

export interface DayAdjustDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string;
  employeeName: string;
  dateStr: string;
  existingRecord: TimeRecord | null;
  /** Registro do dia seguinte (pra virada). */
  nextDayRecord: TimeRecord | null;
  schedule: WorkSchedule;
  /** Ausência que cobre este dia, se houver. */
  coveringAbsence: (EmployeeAbsence & { employees?: { name: string; department: string } | null }) | null;
}

function isManualPunch(p: string) {
  return p.endsWith('*');
}
function cleanPunch(p: string) {
  return p.replace(/\*$/, '');
}
function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
const emptySlots = (): Slots => ({ entrada: '', saidaAlmoco: '', voltaAlmoco: '', saida: '' });
const emptyManual = (): SlotManual => ({
  entrada: false,
  saidaAlmoco: false,
  voltaAlmoco: false,
  saida: false,
});

function punchesToSlots(punches: string[]): { slots: Slots; slotManual: SlotManual; extras: string[] } {
  const sorted = [...(punches || [])].sort(
    (a, b) => timeToMinutes(cleanPunch(a)) - timeToMinutes(cleanPunch(b)),
  );
  const slots = emptySlots();
  const slotManual = emptyManual();
  const extras: string[] = [];
  const set = (k: SlotKey, p: string) => {
    slots[k] = cleanPunch(p);
    slotManual[k] = isManualPunch(p);
  };
  if (sorted.length === 2) {
    set('entrada', sorted[0]);
    set('saida', sorted[1]);
  } else if (sorted.length === 3) {
    const named = mapThreePunchesToNamedSlots(sorted);
    const keys: SlotKey[] = ['entrada', 'saidaAlmoco', 'voltaAlmoco', 'saida'];
    if (named) {
      keys.forEach(k => {
        if (named[k]) set(k, named[k]);
      });
    } else {
      sorted.forEach((p, i) => {
        if (i < 4) set(keys[i], p);
      });
    }
  } else {
    const keys: SlotKey[] = ['entrada', 'saidaAlmoco', 'voltaAlmoco', 'saida'];
    sorted.forEach((p, i) => {
      if (i < 4) set(keys[i], p);
      else extras.push(p);
    });
  }
  return { slots, slotManual, extras };
}

function slotsToPunches(slots: Slots, slotManual: SlotManual, extras: string[]): string[] {
  const out: string[] = [];
  for (const { key } of SLOT_DEFS) {
    const v = (slots[key] || '').trim();
    if (v) out.push(v + (slotManual[key] ? '*' : ''));
  }
  out.push(...extras);
  return out.sort((a, b) => timeToMinutes(cleanPunch(a)) - timeToMinutes(cleanPunch(b)));
}

const manualClient = supabase as unknown as {
  rpc: (
    name: 'upsert_manual_time_record',
    args: {
      p_employee_id: string;
      p_record_date: string;
      p_punches: string[];
      p_reason: string;
      p_time_record_id: string | null;
    },
  ) => Promise<{ error: { message: string } | null }>;
};

/**
 * Janela única de ajuste do dia: batidas OU ausência (exclusivo), com atalho de virada.
 */
export default function DayAdjustDialog({
  open,
  onOpenChange,
  employeeId,
  employeeName,
  dateStr,
  existingRecord,
  nextDayRecord,
  schedule,
  coveringAbsence,
}: DayAdjustDialogProps) {
  const queryClient = useQueryClient();
  const createAbsence = useCreateAbsence();
  const deleteAbsence = useDeleteAbsence();

  const initial = useMemo(() => punchesToSlots(existingRecord ? (existingRecord.punches as string[]) : []), [existingRecord]);

  const [mode, setMode] = useState<DayAdjustMode>('punches');
  const [slots, setSlots] = useState<Slots>(initial.slots);
  const [slotManual, setSlotManual] = useState<SlotManual>(initial.slotManual);
  const [extras, setExtras] = useState<string[]>(initial.extras);
  const [newPunch, setNewPunch] = useState('');
  const [manualReason, setManualReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [absenceType, setAbsenceType] = useState<AbsenceKind>('atestado');
  const [absenceEnd, setAbsenceEnd] = useState(dateStr);
  const [absenceNotes, setAbsenceNotes] = useState('');

  const overnightCarry = useMemo(() => {
    const byDate = new Map<string, string[]>();
    byDate.set(dateStr, existingRecord ? ((existingRecord.punches as string[]) || []) : []);
    if (nextDayRecord) {
      byDate.set(nextDayRecord.record_date, (nextDayRecord.punches as string[]) || []);
    } else {
      const [y, m, d] = dateStr.split('-').map(Number);
      const next = new Date(Date.UTC(y, m - 1, d + 1));
      const nextStr = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
      byDate.set(nextStr, []);
    }
    return detectOvernightCarries(byDate).find(c => c.workDate === dateStr) ?? null;
  }, [dateStr, existingRecord, nextDayRecord]);

  useEffect(() => {
    if (!open) return;
    const mapped = punchesToSlots(existingRecord ? (existingRecord.punches as string[]) : []);
    setSlots(mapped.slots);
    setSlotManual(mapped.slotManual);
    setExtras(mapped.extras);
    setNewPunch('');
    setManualReason(overnightCarry ? 'Virada à noite' : '');
    setMode(coveringAbsence ? 'absence' : 'punches');
    setAbsenceType((coveringAbsence?.absence_type as AbsenceKind) || 'atestado');
    setAbsenceEnd(coveringAbsence?.end_date || dateStr);
    setAbsenceNotes(coveringAbsence?.notes || '');
  }, [open, existingRecord, coveringAbsence, dateStr, overnightCarry]);

  const punchCount =
    SLOT_DEFS.filter(({ key }) => slots[key].trim()).length + extras.length;
  const hasPunches = punchCount > 0 || !!(existingRecord && (existingRecord.punches as string[])?.length);

  const setSlot = (key: SlotKey, value: string) => {
    setSlots(s => ({ ...s, [key]: value }));
    setSlotManual(m => ({ ...m, [key]: true }));
  };

  const addExtra = () => {
    const clean = newPunch.trim();
    if (!/^\d{2}:\d{2}$/.test(clean)) {
      toast.error('Formato inválido. Use HH:MM');
      return;
    }
    setExtras(e => [...e, clean + '*']);
    setNewPunch('');
  };

  const fillStandardDay = () => {
    const dow = new Date(dateStr + 'T12:00:00').getDay();
    if (dow === 0) {
      toast.info('Domingo não tem expediente padrão. Adicione manualmente se houve trabalho.');
      return;
    }
    const entry = (dow === 6 ? schedule.saturday_entry : schedule.entry_time) || '08:00';
    const exit = (dow === 6 ? schedule.saturday_exit : schedule.exit_time) || '17:48';
    setSlots({ entrada: entry, saidaAlmoco: '', voltaAlmoco: '', saida: exit });
    setSlotManual({ entrada: true, saidaAlmoco: false, voltaAlmoco: false, saida: true });
    setExtras([]);
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['time_records'] });
    queryClient.invalidateQueries({ queryKey: ['v_time_pendings'] });
    queryClient.invalidateQueries({ queryKey: ['pending-time-records'] });
    queryClient.invalidateQueries({ queryKey: ['employee-pending-summary'] });
    queryClient.invalidateQueries({ queryKey: ['employee_absences'] });
  };

  const savePunches = async () => {
    if (coveringAbsence) {
      toast.error('Remova a justificativa deste dia antes de editar batidas.');
      return;
    }
    if (manualReason.trim().length < 4) {
      toast.error('Informe uma justificativa com pelo menos 4 caracteres.');
      return;
    }
    setSaving(true);
    try {
      const punches = slotsToPunches(slots, slotManual, extras);
      if (!existingRecord && punches.length === 0) throw new Error('Adicione pelo menos uma batida.');
      const { error } = await manualClient.rpc('upsert_manual_time_record', {
        p_employee_id: employeeId,
        p_record_date: dateStr,
        p_punches: punches,
        p_reason: manualReason.trim(),
        p_time_record_id: existingRecord?.id || null,
      });
      if (error) throw new Error(error.message);
      toast.success('Registro salvo!');
      invalidate();
      onOpenChange(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const clearPunches = async () => {
    if (!existingRecord) return;
    if (manualReason.trim().length < 4) {
      toast.error('Informe uma justificativa com pelo menos 4 caracteres.');
      return;
    }
    setSaving(true);
    try {
      const { error } = await manualClient.rpc('upsert_manual_time_record', {
        p_employee_id: employeeId,
        p_record_date: dateStr,
        p_punches: [],
        p_reason: manualReason.trim(),
        p_time_record_id: existingRecord.id,
      });
      if (error) throw new Error(error.message);
      toast.success('Registro limpo');
      invalidate();
      onOpenChange(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erro ao limpar');
    } finally {
      setSaving(false);
    }
  };

  const applyOvernight = async () => {
    if (!overnightCarry) return;
    if (coveringAbsence) {
      toast.error('Remova a justificativa deste dia antes de aplicar a virada.');
      return;
    }
    const reason = (manualReason.trim().length >= 4 ? manualReason.trim() : 'Virada à noite');
    setSaving(true);
    try {
      const work = await manualClient.rpc('upsert_manual_time_record', {
        p_employee_id: employeeId,
        p_record_date: overnightCarry.workDate,
        p_punches: overnightCarry.workPunchesAfter,
        p_reason: reason,
        p_time_record_id: existingRecord?.id || null,
      });
      if (work.error) throw new Error(work.error.message);

      if (overnightCarry.remainingNextPunches.length > 0 || nextDayRecord) {
        const next = await manualClient.rpc('upsert_manual_time_record', {
          p_employee_id: employeeId,
          p_record_date: overnightCarry.nextDate,
          p_punches: overnightCarry.remainingNextPunches,
          p_reason: 'Virada à noite (madrugada movida pro dia anterior)',
          p_time_record_id: nextDayRecord?.id || null,
        });
        if (next.error) throw new Error(next.error.message);
      }

      toast.success('Virada à noite aplicada');
      invalidate();
      onOpenChange(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Falha ao gravar a virada.');
    } finally {
      setSaving(false);
    }
  };

  const saveAbsence = async () => {
    if (coveringAbsence) {
      toast.info('Já existe justificativa neste dia. Remova-a para cadastrar outra.');
      return;
    }
    if (hasPunches) {
      toast.error('Este dia tem batidas. Limpe as batidas antes de justificar a ausência.');
      return;
    }
    setSaving(true);
    try {
      await createAbsence.mutateAsync({
        employee_id: employeeId,
        start_date: dateStr,
        end_date: absenceEnd || dateStr,
        absence_type: absenceType,
        notes: absenceNotes.trim() || undefined,
      });
      onOpenChange(false);
    } catch {
      // toast already in hook
    } finally {
      setSaving(false);
    }
  };

  const removeAbsence = async () => {
    if (!coveringAbsence) return;
    setSaving(true);
    try {
      await deleteAbsence.mutateAsync(coveringAbsence.id);
      onOpenChange(false);
    } catch {
      // toast in hook
    } finally {
      setSaving(false);
    }
  };

  const dow = new Date(dateStr + 'T12:00:00').getDay();
  const punchesDisabled = mode === 'absence' || !!coveringAbsence;
  const absenceDisabled = mode === 'punches' && hasPunches && !coveringAbsence;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardEdit className="h-4 w-4" /> Ajustar o dia
          </DialogTitle>
          <DialogDescription>
            Complete batidas esquecidas ou justifique a ausência — uma intenção por vez.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-border/70 bg-muted/30 p-3 space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Funcionário</span>
              <span className="font-medium">{employeeName}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Data</span>
              <span className="font-mono">
                {DAYS_FULL[dow]},{' '}
                {new Date(dateStr + 'T12:00:00').toLocaleDateString('pt-BR')}
              </span>
            </div>
          </div>

          <div
            className="grid grid-cols-2 gap-1 rounded-md border border-border/60 bg-muted/40 p-1"
            role="tablist"
            aria-label="Tipo de ajuste"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'punches'}
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-semibold transition-colors',
                mode === 'punches'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setMode('punches')}
              disabled={!!coveringAbsence}
            >
              <Clock className="h-3.5 w-3.5" /> Batidas
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'absence'}
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-semibold transition-colors',
                mode === 'absence'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => {
                if (hasPunches && !coveringAbsence) {
                  toast.error('Limpe as batidas do dia antes de justificar ausência.');
                  return;
                }
                setMode('absence');
              }}
            >
              <FirstAid className="h-3.5 w-3.5" /> Ausência
            </button>
          </div>

          {mode === 'punches' && (
            <div className={cn('space-y-3', punchesDisabled && 'pointer-events-none opacity-50')}>
              {coveringAbsence && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Dia justificado ({ABSENCE_LABEL[coveringAbsence.absence_type] || coveringAbsence.absence_type}).
                  Remova a justificativa para editar batidas.
                </p>
              )}

              {overnightCarry && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                  <p className="text-xs text-foreground">
                    Saída na madrugada seguinte detectada
                    {' '}
                    <span className="font-mono">
                      ({overnightCarry.carriedPunches.map(cleanPunch).join(', ')})
                    </span>
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="w-full gap-1.5"
                    onClick={() => void applyOvernight()}
                    disabled={saving || punchesDisabled}
                  >
                    <Moon className="h-3.5 w-3.5" /> Saída na madrugada seguinte
                  </Button>
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-xs font-semibold">Horários do dia</Label>
                <div className="grid grid-cols-2 gap-2">
                  {SLOT_DEFS.map(({ key, label }) => {
                    const val = slots[key];
                    const manual = slotManual[key];
                    return (
                      <div key={key} className="space-y-1">
                        <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                          {label}
                          {val && manual && <span className="text-emerald-600">· manual</span>}
                        </span>
                        <div className="flex items-center gap-1">
                          <Input
                            type="time"
                            value={val}
                            onChange={e => setSlot(key, e.target.value)}
                            className={cn(
                              'font-mono tabular-nums h-9',
                              val
                                ? manual
                                  ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30'
                                  : ''
                                : 'border-amber-500/40',
                            )}
                          />
                          {val && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-9 w-8 p-0 shrink-0 text-muted-foreground hover:text-destructive"
                              aria-label={`Limpar ${label}`}
                              onClick={() => setSlot(key, '')}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {extras.length > 0 && (
                  <div className="space-y-1 pt-1">
                    <span className="text-[11px] text-muted-foreground">Batidas extras</span>
                    <div className="flex flex-wrap gap-1">
                      {extras.map((p, idx) => (
                        <Badge key={idx} variant="outline" className="font-mono text-xs gap-1">
                          {cleanPunch(p)}
                          <button
                            aria-label={`Remover ${cleanPunch(p)}`}
                            onClick={() => setExtras(e => e.filter((_, i) => i !== idx))}
                            className="hover:text-destructive"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {punchCount % 2 !== 0 && (
                  <p className="text-xs text-amber-600">
                    Número ímpar de horários — falta uma batida (entrada ou saída)
                  </p>
                )}
              </div>

              <Button variant="outline" size="sm" onClick={fillStandardDay} className="w-full gap-1.5">
                <Clock className="h-3.5 w-3.5" /> Preencher entrada/saída padrão
              </Button>

              <div className="space-y-1.5">
                <Label className="text-xs">Adicionar batida extra</Label>
                <div className="flex gap-2">
                  <Input
                    type="time"
                    value={newPunch}
                    onChange={e => setNewPunch(e.target.value)}
                    className="font-mono tabular-nums h-9"
                    onKeyDown={e => e.key === 'Enter' && addExtra()}
                  />
                  <Button size="sm" variant="outline" onClick={addExtra} className="gap-1 h-9">
                    <Plus className="h-3.5 w-3.5" /> Adicionar
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="day-adjust-reason" className="text-xs">
                  Justificativa obrigatória
                </Label>
                <Textarea
                  id="day-adjust-reason"
                  value={manualReason}
                  onChange={e => setManualReason(e.target.value)}
                  placeholder="Ex.: esquecimento confirmado com o responsável"
                  rows={2}
                />
              </div>

              <div className="flex gap-2 justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-muted-foreground text-xs"
                  onClick={() => void clearPunches()}
                  disabled={!existingRecord || saving || manualReason.trim().length < 4}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Limpar dia
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void savePunches()}
                    disabled={saving || manualReason.trim().length < 4 || punchesDisabled}
                    className="gap-1"
                  >
                    <Save className="h-3.5 w-3.5" /> {saving ? 'Salvando...' : 'Salvar'}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {mode === 'absence' && (
            <div className={cn('space-y-3', absenceDisabled && !coveringAbsence && 'opacity-80')}>
              {coveringAbsence ? (
                <div className="space-y-3">
                  <div className="rounded-lg border border-border/70 bg-muted/30 p-3 space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tipo</span>
                      <span className="font-medium">
                        {ABSENCE_LABEL[coveringAbsence.absence_type] || coveringAbsence.absence_type}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Período</span>
                      <span className="font-mono text-xs">
                        {coveringAbsence.start_date} → {coveringAbsence.end_date}
                      </span>
                    </div>
                    {coveringAbsence.notes && (
                      <p className="text-xs text-muted-foreground pt-1">{coveringAbsence.notes}</p>
                    )}
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                      Fechar
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => void removeAbsence()}
                      disabled={saving}
                    >
                      Remover justificativa
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  {hasPunches && (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Há batidas neste dia. Limpe-as no modo Batidas antes de justificar.
                    </p>
                  )}
                  <div className="space-y-1.5">
                    <Label className="text-xs">Tipo</Label>
                    <Select
                      value={absenceType}
                      onValueChange={v => setAbsenceType(v as AbsenceKind)}
                      disabled={hasPunches}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ABSENCE_KIND_OPTIONS.map(k => (
                          <SelectItem key={k} value={k}>
                            {ABSENCE_LABEL[k]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Até (opcional — multi-dia)</Label>
                    <Input
                      type="date"
                      value={absenceEnd}
                      min={dateStr}
                      onChange={e => setAbsenceEnd(e.target.value)}
                      className="h-9"
                      disabled={hasPunches}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Observação</Label>
                    <Textarea
                      value={absenceNotes}
                      onChange={e => setAbsenceNotes(e.target.value)}
                      rows={2}
                      disabled={hasPunches}
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                      Cancelar
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void saveAbsence()}
                      disabled={saving || hasPunches}
                      className="gap-1"
                    >
                      <Save className="h-3.5 w-3.5" /> {saving ? 'Salvando...' : 'Salvar justificativa'}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
