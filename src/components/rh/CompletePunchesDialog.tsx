import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Clock, Plus, Trash, Warning as AlertTriangle, CheckCircle, ArrowSquareOut } from '@phosphor-icons/react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useCompletePunches, type TimePending } from '@/hooks/useTimePendings';

/**
 * Dialog pra completar as batidas faltantes de um time_record.
 * Exibe as batidas atuais e permite adicionar/editar até formar pares
 * entrada/saída pareados (formato HH:MM).
 */
export interface CompletePunchesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: TimePending | null;
}

const HH_MM_RE = /^[0-2][0-9]:[0-5][0-9]$/;

function toMinutes(hhmm: string): number | null {
  if (!HH_MM_RE.test(hhmm)) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function diffPairs(punches: string[]): { workedMin: number; valid: boolean; errors: string[] } {
  const errs: string[] = [];
  let worked = 0;
  if (punches.length === 0) return { workedMin: 0, valid: false, errors: ['Adicione pelo menos um par de batidas.'] };
  if (punches.length % 2 !== 0) errs.push('Número de batidas deve ser PAR (entrada/saída pareados).');
  for (let i = 0; i < punches.length; i++) {
    if (!HH_MM_RE.test(punches[i])) errs.push(`Batida ${i + 1}: formato deve ser HH:MM.`);
  }
  if (errs.length > 0) return { workedMin: 0, valid: false, errors: errs };
  // Soma diferença em pares
  for (let i = 0; i < punches.length; i += 2) {
    const a = toMinutes(punches[i])!;
    const b = toMinutes(punches[i + 1])!;
    if (b <= a) errs.push(`Par ${(i / 2) + 1}: saída deve ser depois da entrada.`);
    else worked += (b - a);
  }
  return { workedMin: worked, valid: errs.length === 0, errors: errs };
}

const fmtHHMM = (mins: number) =>
  `${Math.floor(mins / 60).toString().padStart(2, '0')}h${(mins % 60).toString().padStart(2, '0')}`;

export function CompletePunchesDialog({ open, onOpenChange, pending }: CompletePunchesDialogProps) {
  const complete = useCompletePunches();
  const [punches, setPunches] = useState<string[]>([]);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open && pending) {
      setPunches([...pending.punches]);
      setReason('');
    }
  }, [open, pending]);

  const diff = useMemo(() => diffPairs(punches), [punches]);
  const expectedMin = pending?.day_summary?.expected_min ?? 0;
  const overUnder = diff.valid ? diff.workedMin - expectedMin : 0;

  const update = (i: number, v: string) => {
    setPunches((prev) => prev.map((p, idx) => (idx === i ? v : p)));
  };
  const remove = (i: number) => setPunches((prev) => prev.filter((_, idx) => idx !== i));
  const add = () => setPunches((prev) => [...prev, '']);

  // Aplica a sugestão do servidor (padrão observado ou schedule)
  const suggestion = pending?.suggestion ?? null;
  const canApplySuggestion = !!suggestion
    && suggestion.source !== 'none'
    && suggestion.suggested.length === 4
    && suggestion.suggested.every((p) => HH_MM_RE.test(p));
  const applySuggestion = () => {
    if (!suggestion || !canApplySuggestion) return;
    setPunches([...suggestion.suggested]);
    if (reason.trim().length === 0) {
      const src = suggestion.source === 'observed'
        ? `padrão observado (${suggestion.observed_days} dias)`
        : 'horário oficial do funcionário';
      setReason(`Completado via ${src} — batidas reais preservadas.`);
    }
  };

  // Atalho "dia normal": preenche os 4 horários da escala oficial do funcionário
  // (entrada · saída almoço · retorno · saída) de uma vez, em vez de digitar
  // batida por batida. Caso mais comum de pendência (esqueceu de bater).
  const normalDay = suggestion?.pattern.schedule ?? null;
  const canFillNormalDay = !!normalDay
    && normalDay.length === 4
    && normalDay.every((p) => HH_MM_RE.test(p));
  const fillNormalDay = () => {
    if (!canFillNormalDay || !normalDay) return;
    setPunches([...normalDay]);
    if (reason.trim().length === 0) {
      setReason('Dia normal conforme escala — batidas completadas pelo RH.');
    }
  };

  const canSubmit = !!pending && diff.valid && reason.trim().length >= 4;

  const handleSubmit = async () => {
    if (!pending || !diff.valid) return;
    await complete.mutateAsync({
      timeRecordId: pending.id,
      punches: punches.map((p) => p.trim()),
      reason: reason.trim(),
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !complete.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Completar batidas
          </DialogTitle>
          <DialogDescription>
            {pending && (
              <>
                <strong className="text-foreground">{pending.employee_name}</strong> ·{' '}
                {new Date(pending.record_date + 'T00:00:00').toLocaleDateString('pt-BR', {
                  weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
                })}
                {pending.days_since > 0 && (
                  <span className="text-muted-foreground"> · há {pending.days_since} dias</span>
                )}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {pending && (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status atual:</span>
                <Badge variant="outline" className="text-[10px] uppercase">
                  {pending.day_summary?.status}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Batidas originais:</span>
                <span className="font-mono">
                  {pending.punches.length === 0 ? '(vazio)' : pending.punches.join(' · ')}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Esperado p/ este dia:</span>
                <span className="mono font-semibold">{fmtHHMM(expectedMin)}</span>
              </div>
            </div>
          )}

          {/* ─── Alerta: dia vazio sem cobertura ─── */}
          {pending && pending.punches.length === 0 && suggestion && !suggestion.is_absent_covered && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                Dia completamente vazio
              </div>
              <p className="text-amber-800 dark:text-amber-300 text-[11px] leading-snug">
                Verifique se esse dia foi <strong>ausência justificada</strong> (férias/atestado/folga)
                antes de aplicar batidas. Cadastrar ausência isenta o dia do cálculo automaticamente.
              </p>
              <Button
                asChild
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1 border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
              >
                <Link to="/rh/ausencias" onClick={() => onOpenChange(false)}>
                  <ArrowSquareOut className="h-3 w-3" />
                  Cadastrar ausência
                </Link>
              </Button>
            </div>
          )}

          {/* ─── Alerta: dia vazio já COBERTO por ausência ─── */}
          {pending && pending.punches.length === 0 && suggestion?.is_absent_covered && (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs">
              <div className="flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-400">
                <CheckCircle className="h-3.5 w-3.5" />
                Dia já coberto por ausência justificada
              </div>
              <p className="text-emerald-800 dark:text-emerald-300 text-[11px] leading-snug mt-1">
                A isenção já está aplicada no cálculo. Você não precisa completar batidas aqui —
                a menos que o funcionário tenha trabalhado mesmo assim.
              </p>
            </div>
          )}

          {/* Atalho de 1 clique: lançamento do dia normal (escala oficial) */}
          {canFillNormalDay && normalDay && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="w-full h-9 text-xs gap-1.5"
              onClick={fillNormalDay}
            >
              <Clock className="h-3.5 w-3.5" />
              Preencher dia normal ({normalDay[0]}–{normalDay[3]})
            </Button>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Batidas (entrada/saída pareadas)</Label>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={add}>
                  <Plus className="h-3 w-3" /> Batida
                </Button>
              </div>
            </div>
            {punches.length === 0 ? (
              <div className="text-center py-4 text-xs text-muted-foreground border border-dashed border-border rounded-md">
                Nenhuma batida. Clique <strong>Batida</strong> pra começar.
              </div>
            ) : (
              <div className="space-y-1.5">
                {punches.map((p, i) => {
                  const isEntry = i % 2 === 0;
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <span className={cn(
                        'text-[10px] uppercase tracking-wider font-semibold w-12 shrink-0',
                        isEntry ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400',
                      )}>
                        {isEntry ? '→ Entr' : '← Saí'}
                      </span>
                      <Input
                        type="time"
                        value={p}
                        onChange={(e) => update(i, e.target.value)}
                        className="h-8 text-xs font-mono"
                      />
                      <Button
                        type="button" variant="ghost" size="icon" className="h-7 w-7"
                        onClick={() => remove(i)} aria-label="Remover batida"
                      >
                        <Trash className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Resumo do cálculo */}
          {diff.valid ? (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs space-y-1">
              <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-semibold">
                <CheckCircle className="h-3.5 w-3.5" />
                Batidas válidas
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Total trabalhado:</span>
                <span className="mono font-semibold">{fmtHHMM(diff.workedMin)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">vs esperado ({fmtHHMM(expectedMin)}):</span>
                <span className={cn(
                  'mono font-semibold',
                  overUnder > 0 ? 'text-emerald-700 dark:text-emerald-400'
                  : overUnder < 0 ? 'text-red-700 dark:text-red-400'
                  : 'text-muted-foreground',
                )}>
                  {overUnder > 0 ? '+' : ''}{fmtHHMM(Math.abs(overUnder))}
                  {overUnder !== 0 && (overUnder > 0 ? ' a mais' : ' a menos')}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground italic pt-1 border-t border-emerald-500/20 mt-1">
                Lembre: hora extra real só nasce do TOTAL SEMANAL — esse + ou − ainda pode compensar nos outros dias.
              </p>
            </div>
          ) : (
            <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-xs space-y-1">
              <div className="flex items-center gap-1.5 text-red-700 dark:text-red-400 font-semibold">
                <AlertTriangle className="h-3.5 w-3.5" />
                Batidas inválidas
              </div>
              <ul className="text-red-800 dark:text-red-300 list-disc list-inside space-y-0.5">
                {diff.errors.map((err, i) => <li key={i}>{err}</li>)}
              </ul>
            </div>
          )}

          <div>
            <Label className="text-xs">Justificativa (min 4 caracteres) *</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: Esqueceu de bater saída pra almoço; conferido com encarregado."
              rows={2}
              className="mt-1 text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={complete.isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || complete.isPending}>
            {complete.isPending ? 'Salvando...' : 'Salvar batidas'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
