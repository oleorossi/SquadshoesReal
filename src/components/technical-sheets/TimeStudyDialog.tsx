/**
 * Dialog de cronoanálise reutilizável — usado em DOIS lugares:
 *
 *  1. Ficha técnica → aba Operações (botão de cronômetro por operação): abre
 *     PRÉ-PREENCHIDO (referência travada, operação/setor/custo-hora da própria
 *     linha do BOM) — o local natural de cronometrar, sem redigitar contexto.
 *  2. Página /cronoanalise (lista geral): criação/edição livre, com seletor de
 *     referência (comportamento original, extraído de Cronoanalise.tsx).
 *
 * Novidades vs o form original:
 *  - CRONÔMETRO de verdade (iniciar → marcar volta → parar): cada volta vira um
 *    ciclo em segundos; a digitação manual continua disponível.
 *  - "Salvar e aplicar ao BOM": grava o estudo e já chama apply_time_study_to_bom
 *    (a operação vira time_source='cronoanalise' e o custeio re-dispara via
 *    trigger) — antes eram 2 passos em telas diferentes.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Timer, Plus, X, Gauge, Play, Stop, Flag, ArrowsClockwise as ApplyIcon } from '@phosphor-icons/react';
import { PRODUCTION_STAGES } from '@/hooks/useBomOperations';
import {
  useAddTimeStudy, useUpdateTimeStudy, useApplyTimeStudyToBom, deriveTimeStudy,
  type TimeStudy, type TimeStudyFormData,
} from '@/hooks/useTimeStudies';

const fmtBRL = (v: number) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtMin = (v: number) => `${(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} min`;

export interface TimeStudySheetOption { id: string; name: string; code: string }

/** Contexto vindo da linha do BOM (ficha técnica) — trava a referência. */
export interface TimeStudyPrefill {
  sheetId: string;
  sheetLabel: string;
  bomOperationId?: string | null;
  operationName?: string;
  stage?: string;
  costPerHour?: number;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Estudo existente (edição, página Cronoanálise). */
  study?: TimeStudy | null;
  /** Pré-preenchimento vindo da ficha (referência travada). */
  prefill?: TimeStudyPrefill | null;
  /** Opções de referência quando não há prefill (página Cronoanálise). */
  sheets?: TimeStudySheetOption[];
  /** Ficha default do seletor quando não há prefill nem estudo. */
  defaultSheetId?: string;
}

const emptyForm = (sheetId = ''): TimeStudyFormData => ({
  sheet_id: sheetId,
  bom_operation_id: null,
  operation_name: '',
  stage: '',
  cycles_seconds: [],
  rating_pct: 100,
  allowance_pct: 15,
  cost_per_hour: 0,
  observed_by: '',
  notes: '',
});

export default function TimeStudyDialog({ open, onOpenChange, study, prefill, sheets, defaultSheetId }: Props) {
  const addStudy = useAddTimeStudy();
  const updateStudy = useUpdateTimeStudy();
  const applyToBom = useApplyTimeStudyToBom();

  const [form, setForm] = useState<TimeStudyFormData>(emptyForm());
  const [cycleInput, setCycleInput] = useState('');

  // ── Cronômetro ──────────────────────────────────────────────────────────────
  const [runningSince, setRunningSince] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (runningSince == null) {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      return;
    }
    tickRef.current = setInterval(() => setElapsedMs(Date.now() - runningSince), 100);
    return () => { if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; } };
  }, [runningSince]);

  const lap = (stop: boolean) => {
    if (runningSince == null) return;
    const secs = Math.round((Date.now() - runningSince) / 100) / 10; // 0,1s de precisão
    if (secs > 0) setForm((f) => ({ ...f, cycles_seconds: [...f.cycles_seconds, secs] }));
    if (stop) { setRunningSince(null); setElapsedMs(0); }
    else setRunningSince(Date.now());
  };

  // Reset na abertura: edição > prefill > vazio.
  useEffect(() => {
    if (!open) { setRunningSince(null); setElapsedMs(0); return; }
    setCycleInput('');
    if (study) {
      setForm({
        sheet_id: study.sheet_id,
        bom_operation_id: study.bom_operation_id,
        operation_name: study.operation_name,
        stage: study.stage,
        cycles_seconds: study.cycles_seconds ?? [],
        rating_pct: study.rating_pct,
        allowance_pct: study.allowance_pct,
        cost_per_hour: study.cost_per_hour,
        observed_by: study.observed_by,
        notes: study.notes,
      });
    } else if (prefill) {
      setForm({
        ...emptyForm(prefill.sheetId),
        bom_operation_id: prefill.bomOperationId ?? null,
        operation_name: prefill.operationName ?? '',
        stage: prefill.stage ?? '',
        cost_per_hour: prefill.costPerHour ?? 0,
      });
    } else {
      setForm(emptyForm(defaultSheetId ?? ''));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const derived = useMemo(
    () => deriveTimeStudy(form.cycles_seconds, form.rating_pct, form.allowance_pct, form.cost_per_hour),
    [form.cycles_seconds, form.rating_pct, form.allowance_pct, form.cost_per_hour],
  );

  function addCycle() {
    const v = parseFloat(cycleInput.replace(',', '.'));
    if (!Number.isFinite(v) || v <= 0) return;
    setForm((f) => ({ ...f, cycles_seconds: [...f.cycles_seconds, v] }));
    setCycleInput('');
  }
  function removeCycle(idx: number) {
    setForm((f) => ({ ...f, cycles_seconds: f.cycles_seconds.filter((_, i) => i !== idx) }));
  }

  async function save(applyAfter: boolean) {
    // mutateAsync rejeita em erro (toast no onError) — só fecha se resolver.
    let studyId: string;
    if (study) {
      await updateStudy.mutateAsync({ id: study.id, data: form });
      studyId = study.id;
    } else {
      studyId = await addStudy.mutateAsync(form);
    }
    if (applyAfter) await applyToBom.mutateAsync(studyId);
    onOpenChange(false);
  }

  const saving = addStudy.isPending || updateStudy.isPending || applyToBom.isPending;
  const lockedSheet = !!prefill || !!study;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!saving) onOpenChange(v); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Timer className="size-5" /> {study ? 'Editar' : 'Nova'} cronoanálise
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Referência (ficha técnica)</Label>
              {lockedSheet ? (
                <Input
                  value={prefill?.sheetLabel ?? sheets?.find((s) => s.id === form.sheet_id)?.name ?? '—'}
                  readOnly
                  className="bg-muted/40 text-muted-foreground"
                />
              ) : (
                <Select value={form.sheet_id} onValueChange={(v) => setForm((f) => ({ ...f, sheet_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {sheets?.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.code ? `${s.code} · ${s.name}` : s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Setor</Label>
              <Select value={form.stage} onValueChange={(v) => setForm((f) => ({ ...f, stage: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {PRODUCTION_STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Operação</Label>
            <Input
              value={form.operation_name}
              onChange={(e) => setForm((f) => ({ ...f, operation_name: e.target.value }))}
              placeholder="Ex.: Costura do cabedal"
            />
          </div>

          {/* Cronômetro ao vivo */}
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-baseline gap-2">
                <span className="font-display text-3xl tabular-nums leading-none">
                  {(elapsedMs / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                </span>
                <span className="text-sm text-muted-foreground">s</span>
              </div>
              <div className="flex items-center gap-1.5">
                {runningSince == null ? (
                  <Button type="button" size="sm" className="gap-1.5" onClick={() => { setElapsedMs(0); setRunningSince(Date.now()); }}>
                    <Play className="size-3.5" weight="fill" /> Iniciar
                  </Button>
                ) : (
                  <>
                    <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => lap(false)}>
                      <Flag className="size-3.5" /> Marcar volta
                    </Button>
                    <Button type="button" size="sm" variant="destructive" className="gap-1.5" onClick={() => lap(true)}>
                      <Stop className="size-3.5" weight="fill" /> Parar e marcar
                    </Button>
                  </>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Cada volta vira um ciclo (segundos por par). Dá pra digitar manualmente abaixo também.
            </p>
          </div>

          {/* Ciclos (manuais + do cronômetro) */}
          <div className="space-y-1.5">
            <Label>Ciclos cronometrados <span className="text-muted-foreground font-normal">(segundos por par)</span></Label>
            <div className="flex gap-2">
              <Input
                value={cycleInput}
                onChange={(e) => setCycleInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCycle(); } }}
                placeholder="ex.: 42"
                inputMode="decimal"
                className="w-32"
              />
              <span className="self-center text-sm text-muted-foreground">s</span>
              <Button type="button" variant="outline" onClick={addCycle} className="gap-1">
                <Plus className="size-4" /> Adicionar ciclo
              </Button>
            </div>
            {form.cycles_seconds.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {form.cycles_seconds.map((c, i) => (
                  <Badge key={i} variant="secondary" className="gap-1 tabular-nums">
                    {c}s
                    <button type="button" onClick={() => removeCycle(i)} className="hover:text-destructive"><X className="size-3" /></button>
                  </Badge>
                ))}
                <Badge variant="outline" className="tabular-nums">média {derived.observedAvgSeconds.toFixed(1)}s</Badge>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Ritmo / avaliação <span className="text-muted-foreground font-normal">(%)</span></Label>
              <div className="flex items-center gap-1">
                <Input type="number" value={form.rating_pct} onChange={(e) => setForm((f) => ({ ...f, rating_pct: parseFloat(e.target.value) || 0 }))} />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Tolerância PF&D <span className="text-muted-foreground font-normal">(%)</span></Label>
              <div className="flex items-center gap-1">
                <Input type="number" value={form.allowance_pct} onChange={(e) => setForm((f) => ({ ...f, allowance_pct: parseFloat(e.target.value) || 0 }))} />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Custo do recurso <span className="text-muted-foreground font-normal">(R$/h)</span></Label>
              <div className="flex items-center gap-1">
                <span className="text-sm text-muted-foreground">R$</span>
                <Input type="number" value={form.cost_per_hour} onChange={(e) => setForm((f) => ({ ...f, cost_per_hour: parseFloat(e.target.value) || 0 }))} />
                <span className="text-sm text-muted-foreground">/h</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Observado por</Label>
              <Input value={form.observed_by ?? ''} onChange={(e) => setForm((f) => ({ ...f, observed_by: e.target.value }))} placeholder="Nome do cronoanalista" />
            </div>
            <div className="space-y-1.5">
              <Label>Observações</Label>
              <Textarea value={form.notes ?? ''} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={1} />
            </div>
          </div>

          {/* Resultado derivado ao vivo */}
          <div className="rounded-lg border border-border bg-muted/40 p-3 flex items-center gap-4 flex-wrap">
            <Gauge className="size-5 text-muted-foreground" />
            <div className="text-sm">
              <span className="text-muted-foreground">Tempo normal: </span>
              <span className="font-semibold tabular-nums">{fmtMin(derived.normalMin)}</span>
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">Tempo-padrão: </span>
              <span className="font-bold tabular-nums">{fmtMin(derived.standardMin)}</span>
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">Custo/min: </span>
              <span className="font-semibold tabular-nums">{fmtBRL(derived.costPerMinute)}</span>
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">Custo/par: </span>
              <span className="font-bold tabular-nums">{fmtBRL(derived.costPerPair)}</span>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button variant="secondary" onClick={() => save(false)} disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
          <Button onClick={() => save(true)} disabled={saving} className="gap-1.5" title="Grava o estudo e aplica o tempo-padrão na operação do BOM — o custeio re-dispara sozinho.">
            <ApplyIcon className="size-4" /> Salvar e aplicar ao BOM
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
