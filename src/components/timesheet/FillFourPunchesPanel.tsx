import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Clock,
  CheckCircle,
  Warning as AlertTriangle,
  ArrowSquareOut,
  FirstAid,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  useCompletePunches,
  type TimePending,
} from '@/hooks/useTimePendings';
import {
  useCreateAbsence,
  ABSENCE_KIND_OPTIONS,
  ABSENCE_LABEL,
  type AbsenceKind,
} from '@/hooks/useEmployeeAbsences';
import {
  PUNCH_SLOT_DEFS,
  punchesToNamedSlots,
  namedSlotsToPunches,
  validateFourPunchSlots,
  emptyPunchSlots,
  type PunchSlots,
  type PunchSlotKey,
} from '@/lib/ponto/punchSlots';

export interface FillFourPunchesPanelProps {
  pending: TimePending;
  queue: TimePending[];
  onPendingChange: (next: TimePending | null) => void;
  onDone?: () => void;
  className?: string;
}

const fmtHHMM = (mins: number) =>
  `${Math.floor(mins / 60).toString().padStart(2, '0')}h${(mins % 60).toString().padStart(2, '0')}`;

/**
 * Painel de preenchimento canônico: 4 campos nomeados + “É falta” / escala.
 */
export function FillFourPunchesPanel({
  pending,
  queue,
  onPendingChange,
  onDone,
  className,
}: FillFourPunchesPanelProps) {
  const complete = useCompletePunches();
  const createAbsence = useCreateAbsence();
  const [slots, setSlots] = useState<PunchSlots>(emptyPunchSlots());
  const [extras, setExtras] = useState<string[]>([]);
  const [reason, setReason] = useState('Batidas completadas pelo RH.');
  const [mode, setMode] = useState<'punches' | 'absence'>('punches');
  const [absenceType, setAbsenceType] = useState<AbsenceKind>('atestado');
  const [absenceNotes, setAbsenceNotes] = useState('');

  useEffect(() => {
    const mapped = punchesToNamedSlots(pending.punches || []);
    setSlots(mapped.slots);
    setExtras(mapped.extras);
    setReason('Batidas completadas pelo RH.');
    setMode(pending.punches.length === 0 ? 'punches' : 'punches');
    setAbsenceType('atestado');
    setAbsenceNotes('');
  }, [pending.id, pending.punches]);

  const validation = useMemo(() => validateFourPunchSlots(slots), [slots]);
  const expectedMin = pending.day_summary?.expected_min ?? 0;
  const overUnder = validation.valid ? validation.workedMin - expectedMin : 0;
  const hasCanonical = !!pending.employee_id && !pending.employee_match_ambiguous;

  const schedule = pending.suggestion?.pattern.schedule ?? null;
  const canFillSchedule = hasCanonical && !!schedule
    && schedule.length === 4
    && schedule.every((p) => /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(p));

  const fillSchedule = () => {
    if (!canFillSchedule || !schedule) return;
    setSlots({
      entrada: schedule[0],
      saidaAlmoco: schedule[1],
      voltaAlmoco: schedule[2],
      saida: schedule[3],
    });
    setExtras([]);
    if (reason.trim().length < 4) {
      setReason('Dia normal conforme escala — batidas completadas pelo RH.');
    }
  };

  const setSlot = (key: PunchSlotKey, value: string) => {
    setSlots((s) => ({ ...s, [key]: value }));
  };

  const sameEmpNext = queue.find(
    (item) => item.id !== pending.id && !!pending.employee_id && item.employee_id === pending.employee_id,
  );
  const queueIndex = queue.findIndex((item) => item.id === pending.id);
  const nextAny = sameEmpNext
    ?? (queueIndex >= 0 && queueIndex < queue.length - 1 ? queue[queueIndex + 1] : null)
    ?? queue.find((item) => item.id !== pending.id)
    ?? null;

  const advance = (next: TimePending | null) => {
    if (next) onPendingChange(next);
    else {
      onPendingChange(null);
      onDone?.();
    }
  };

  const savePunches = async (andNext: boolean) => {
    if (!hasCanonical || !validation.valid || reason.trim().length < 4) return;
    const punches = namedSlotsToPunches(slots, extras.length > 4 ? extras : []);
    // Escape: se havia 5+ batidas originais, preserva extras no save
    const finalPunches = extras.length > 0 && pending.punches.length >= 5
      ? namedSlotsToPunches(slots, extras)
      : punches;
    await complete.mutateAsync({
      timeRecordId: pending.id,
      punches: finalPunches,
      reason: reason.trim(),
    });
    if (andNext) advance(nextAny);
    else advance(null);
  };

  const markAbsence = async () => {
    if (!hasCanonical || !pending.employee_id) return;
    await createAbsence.mutateAsync({
      employee_id: pending.employee_id,
      start_date: pending.record_date,
      end_date: pending.record_date,
      absence_type: absenceType,
      notes: absenceNotes.trim() || `Falta marcada na fila de pendências (${pending.record_date}).`,
    });
    advance(nextAny);
  };

  const busy = complete.isPending || createAbsence.isPending;
  const isEmptyDay = (pending.punches || []).length === 0;

  return (
    <div className={cn('space-y-4 rounded-xl border border-border bg-card p-4', className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-base font-semibold tracking-tight">{pending.employee_name}</h3>
          <p className="text-xs text-muted-foreground">
            {new Date(pending.record_date + 'T00:00:00').toLocaleDateString('pt-BR', {
              weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
            })}
            {pending.department ? ` · ${pending.department}` : ''}
          </p>
        </div>
        <Badge variant="outline" className="text-[10px] uppercase">
          {pending.day_summary?.status}
        </Badge>
      </div>

      {!hasCanonical && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs space-y-1.5">
          <div className="flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" />
            Sem vínculo canônico
          </div>
          <p className="text-[11px] text-amber-800 dark:text-amber-300">
            Corrija a matrícula em Pessoas antes de completar batidas.
          </p>
          <Button asChild variant="outline" size="sm" className="h-7 gap-1 text-xs">
            <Link to="/rh?tab=funcionarios">
              <ArrowSquareOut className="h-3 w-3" /> Abrir Pessoas
            </Link>
          </Button>
        </div>
      )}

      {isEmptyDay && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={mode === 'punches' ? 'default' : 'outline'}
            className="h-8 text-xs"
            onClick={() => setMode('punches')}
          >
            Completar horário
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === 'absence' ? 'default' : 'outline'}
            className="h-8 text-xs gap-1"
            onClick={() => setMode('absence')}
          >
            <FirstAid className="h-3.5 w-3.5" /> É falta
          </Button>
        </div>
      )}

      {mode === 'absence' ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Tipo de ausência</Label>
            <Select value={absenceType} onValueChange={(v) => setAbsenceType(v as AbsenceKind)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ABSENCE_KIND_OPTIONS.map((k) => (
                  <SelectItem key={k} value={k}>{ABSENCE_LABEL[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Observação (opcional)</Label>
            <Textarea
              value={absenceNotes}
              onChange={(e) => setAbsenceNotes(e.target.value)}
              rows={2}
              className="text-sm"
            />
          </div>
          <Button
            type="button"
            className="w-full"
            disabled={!hasCanonical || busy}
            onClick={() => void markAbsence()}
          >
            Confirmar falta
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs flex flex-wrap gap-x-4 gap-y-1">
            <span className="text-muted-foreground">
              Originais:{' '}
              <span className="font-mono text-foreground">
                {(pending.punches || []).length === 0 ? '(vazio)' : pending.punches.join(' · ')}
              </span>
            </span>
            <span className="text-muted-foreground">
              Esperado: <span className="font-semibold text-foreground">{fmtHHMM(expectedMin)}</span>
            </span>
          </div>

          {canFillSchedule && (
            <Button type="button" variant="secondary" size="sm" className="h-8 text-xs gap-1.5" onClick={fillSchedule}>
              <Clock className="h-3.5 w-3.5" />
              Usar escala ({schedule![0]}–{schedule![3]})
            </Button>
          )}

          <div className="grid grid-cols-2 gap-3">
            {PUNCH_SLOT_DEFS.map(({ key, label }) => (
              <div key={key} className="space-y-1">
                <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</Label>
                <Input
                  type="time"
                  value={slots[key]}
                  onChange={(e) => setSlot(key, e.target.value)}
                  className="h-9 font-mono"
                />
              </div>
            ))}
          </div>

          {extras.length > 0 && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              Batidas extras no relógio (serão preservadas se ≥5): {extras.join(' · ')}
            </p>
          )}

          {validation.errors.length > 0 && (
            <ul className="text-[11px] text-destructive space-y-0.5">
              {validation.errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}

          {validation.valid && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />
              Trabalhado {fmtHHMM(validation.workedMin)}
              {expectedMin > 0 && (
                <span className={overUnder >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                  ({overUnder >= 0 ? '+' : ''}{fmtHHMM(Math.abs(overUnder))} vs escala)
                </span>
              )}
            </p>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">Justificativa</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="text-sm"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={!hasCanonical || !validation.valid || reason.trim().length < 4 || busy}
              onClick={() => void savePunches(false)}
            >
              Salvar
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!hasCanonical || !validation.valid || reason.trim().length < 4 || busy || !nextAny}
              onClick={() => void savePunches(true)}
            >
              Salvar e próximo
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
