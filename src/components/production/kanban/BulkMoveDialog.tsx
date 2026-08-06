import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { NumberInput } from '@/components/ui/number-input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ArrowRight, CheckCircle, SkipForward, Warning as AlertTriangle, UserCircle } from '@phosphor-icons/react';
import { useApontarProducao, PointingWarning } from '@/hooks/useOrderStages';
import { useCurrentProfile } from '@/hooks/useUserManagement';
import ConfirmPointingWarnings from '@/components/production/ConfirmPointingWarnings';
import { toast } from 'sonner';
import { KanbanCardData } from './kanbanDerive';
import { buildPointingPlan, applyPointing, skipBlockedByPartial, PointingPlan } from './pointingPlan';

interface StepResult {
  orderNumber: string;
  status: 'ok' | 'pulada';
  quantity: number;
}

/**
 * MOVIMENTAÇÃO EM LOTE — seleciona N OPs no quadro, escolhe UM setor destino e
 * preenche a quantidade de cada uma em telas EM SEQUÊNCIA (uma OP por vez).
 * Cada passo grava pela MESMA regra do card individual (`pointingPlan`):
 * pulo de setor, estorno e finalização idênticos, com os mesmos avisos
 * confirmáveis do servidor (R6.3) e autoria do usuário logado.
 *
 * OPs que não podem ir pro destino (ficha sem aquele setor, setor já concluído,
 * nada a estornar) NÃO viram passo: saem listadas no resumo final com o motivo.
 */
export function BulkMoveDialog({
  cards, target, flowOrder, apontar, onClose,
}: {
  cards: KanbanCardData[];
  target: string;
  flowOrder: Map<string, number>;
  apontar: ReturnType<typeof useApontarProducao>;
  onClose: () => void;
}) {
  const { data: profile } = useCurrentProfile();
  // Congela a seleção na abertura: cada apontamento invalida as queries e o
  // pai re-renderiza com cards novos — sem o snapshot o wizard trocaria de
  // passo/coluna no meio do preenchimento.
  const [frozen] = useState(() => cards);

  const { steps, blocked } = useMemo(() => {
    const s: { card: KanbanCardData; plan: PointingPlan }[] = [];
    const b: { orderNumber: string; reason: string }[] = [];
    for (const card of frozen) {
      const plan = buildPointingPlan(card, target, flowOrder);
      if (plan.available && plan.pointedStage) s.push({ card, plan });
      else b.push({ orderNumber: card.q.order_number, reason: plan.unavailableReason || 'Movimento indisponível.' });
    }
    return { steps: s, blocked: b };
  }, [frozen, target, flowOrder]);

  const [idx, setIdx] = useState(0);
  const [qty, setQty] = useState(0);
  const [results, setResults] = useState<StepResult[]>([]);
  const [pendingWarnings, setPendingWarnings] = useState<PointingWarning[] | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  /** Aceite do pulo de setor (decisão do dono 06/08/2026). Reseta a cada OP —
   *  confirmar uma do lote NÃO confirma as seguintes. */
  const [skipOk, setSkipOk] = useState(false);
  const finished = idx >= steps.length;
  const current = finished ? null : steps[idx];

  // Cada passo entra com o saldo do setor (frente) ou 0 (estorno — o usuário
  // digita quantos pares volta), igual ao diálogo de um card só.
  useEffect(() => {
    if (!current) return;
    setStepError(null);
    setSkipOk(false);
    setQty(current.plan.isBackward ? 0 : Math.max(0, current.plan.remaining));
  }, [current]);

  const advance = (r: StepResult) => {
    setResults(prev => [...prev, r]);
    setIdx(i => i + 1);
  };

  const confirmStep = async (confirmed?: string[]) => {
    if (!current) return;
    const { card, plan } = current;
    if (qty === 0) {
      advance({ orderNumber: card.q.order_number, status: 'pulada', quantity: 0 });
      return;
    }
    setStepError(null);
    try {
      const res = await applyPointing({
        card, plan, target, qty, apontar,
        confirmedWarnings: confirmed, skipAcknowledged: skipOk,
        origin: 'Via Kanban (lote)',
      });
      if (res.status === 'needs_confirmation') {
        setPendingWarnings(res.warnings);
        return;
      }
      // Pulo com origem aberta: não avança sozinho — o operador decide entre
      // fechar o setor ou tirar esta OP do lote.
      if (res.status === 'blocked') {
        setStepError(res.reason);
        return;
      }
      advance({
        orderNumber: card.q.order_number,
        status: 'ok',
        quantity: res.status === 'ok' ? Math.abs(res.quantity) : 0,
      });
    } catch (e) {
      // Não avança sozinho: falha em lote precisa de decisão explícita
      setStepError((e as Error)?.message || 'Falha ao apontar. Tente de novo ou pule esta OP.');
    }
  };

  // Mesma trava do diálogo de um card só: pular exige fechar a origem.
  // O aceite reseta a cada OP do lote — confirmar uma não confirma as outras.
  const stepSkipBlocked = !!current && skipBlockedByPartial(current.plan, qty);

  const totalOk = results.filter(r => r.status === 'ok').length;
  const totalPares = results.reduce((s, r) => s + r.quantity, 0);
  const totalPuladas = results.filter(r => r.status === 'pulada').length;

  const closeWithSummary = () => {
    if (totalOk > 0) toast.success(`Lote: ${totalOk} OP${totalOk > 1 ? 's' : ''} movida${totalOk > 1 ? 's' : ''} pra ${target} · ${totalPares} pares.`);
    onClose();
  };

  // Nada elegível: informa e sai (não abre wizard vazio)
  if (steps.length === 0) {
    return (
      <Dialog open onOpenChange={v => { if (!v) onClose(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="text-base">Mover {frozen.length} OPs pra {target}</DialogTitle></DialogHeader>
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300 space-y-1">
            <p className="font-semibold flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4" /> Nenhuma das OPs selecionadas pode ir pra {target}.
            </p>
            {blocked.slice(0, 8).map(b => (
              <p key={b.orderNumber}><span className="font-mono font-bold">{b.orderNumber}</span> — {b.reason}</p>
            ))}
            {blocked.length > 8 && <p>+{blocked.length - 8} outras.</p>}
          </div>
          <div className="flex justify-end pt-2 border-t">
            <Button className="h-11 md:h-10" onClick={onClose}>Fechar</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <>
      <Dialog open onOpenChange={v => { if (!v) { if (finished) closeWithSummary(); else onClose(); } }}>
        <DialogContent className="sm:max-w-md">
          {finished ? (
            /* ── Resumo do lote ── */
            <>
              <DialogHeader>
                <DialogTitle className="text-base flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-600" weight="fill" /> Lote concluído
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="rounded-md border border-border bg-muted/30 p-3 font-mono text-sm space-y-1">
                  <p><strong className="text-base">{totalOk}</strong> OP{totalOk === 1 ? '' : 's'} movida{totalOk === 1 ? '' : 's'} pra <strong>{target}</strong></p>
                  <p><strong className="text-base">{totalPares.toLocaleString('pt-BR')}</strong> pares apontados</p>
                  {totalPuladas > 0 && <p className="text-muted-foreground">{totalPuladas} pulada{totalPuladas === 1 ? '' : 's'} (quantidade zerada)</p>}
                </div>
                {blocked.length > 0 && (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300 space-y-1">
                    <p className="font-semibold">{blocked.length} OP{blocked.length > 1 ? 's' : ''} não pôde{blocked.length > 1 ? 'ram' : ''} ir pra {target}:</p>
                    {blocked.slice(0, 6).map(b => (
                      <p key={b.orderNumber}><span className="font-mono font-bold">{b.orderNumber}</span> — {b.reason}</p>
                    ))}
                    {blocked.length > 6 && <p>+{blocked.length - 6} outras.</p>}
                  </div>
                )}
                <div className="flex justify-end pt-2 border-t">
                  <Button className="h-11 md:h-10" onClick={closeWithSummary}>Concluir</Button>
                </div>
              </div>
            </>
          ) : current && (
            /* ── Passo N: uma OP por vez ── */
            <>
              <DialogHeader>
                <DialogTitle className="text-base">
                  Mover em lote — {idx + 1} de {steps.length}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                {/* Progresso do lote */}
                <div className="h-1.5 rounded-full bg-muted overflow-hidden" role="progressbar" aria-valuenow={idx} aria-valuemin={0} aria-valuemax={steps.length}>
                  <div className="h-full bg-primary transition-all" style={{ width: `${(idx / steps.length) * 100}%` }} />
                </div>

                <div>
                  <p className="font-mono text-sm font-bold">{current.card.q.order_number}</p>
                  <p className="text-xs text-muted-foreground">
                    {current.card.q.reference_name}{current.card.q.color ? ` · ${current.card.q.color}` : ''} · {current.card.q.quantity} pares
                  </p>
                  <p className="text-xs font-semibold mt-1.5 flex items-center gap-1.5">
                    {current.card.column} <ArrowRight className="h-3.5 w-3.5" /> {target}
                  </p>
                </div>

                {current.plan.skipped.length > 0 && !stepSkipBlocked && (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300">
                    <strong>Pulando setor{current.plan.skipped.length > 1 ? 'es' : ''}:</strong> {current.plan.skipped.join(', ')}.
                    Eles serão marcados como concluídos <strong>sem produção apontada</strong> — fica
                    registrado no histórico com o seu usuário.
                    <label className="mt-2 flex items-start gap-2 font-medium cursor-pointer">
                      <Checkbox
                        checked={skipOk}
                        onCheckedChange={v => setSkipOk(v === true)}
                        className="mt-0.5 shrink-0"
                      />
                      <span>Confirmo que {current.plan.skipped.length > 1 ? 'esses setores não vão' : 'esse setor não vai'} produzir este lote.</span>
                    </label>
                  </div>
                )}
                {stepSkipBlocked && (
                  <div className="rounded-md border border-red-500/50 bg-red-500/10 p-2.5 text-xs text-red-700 dark:text-red-300">
                    <strong>Pra pular setor, {current.plan.pointedStage?.stage_name} tem que fechar.</strong>{' '}
                    Com {qty} de {current.plan.remaining} pares, os{' '}
                    <strong>{current.plan.remaining - qty} restantes</strong> ficariam sem passar por{' '}
                    {current.plan.skipped.join(', ')}. Aponte o saldo cheio ou pule esta OP do lote.
                  </div>
                )}
                {current.plan.isBackward && (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300">
                    <strong>Voltando no fluxo:</strong> os pares informados serão estornados de{' '}
                    <strong>{current.plan.pointedStage?.stage_name}</strong> (lançamento negativo no ledger).
                  </div>
                )}

                <div>
                  <Label className="text-xs">
                    {current.plan.isBackward ? 'Pares a estornar' : 'Quantidade executada (pares)'}
                  </Label>
                  <div className="flex items-center gap-2 mt-1">
                    <NumberInput
                      autoFocus
                      min={0}
                      decimals={0}
                      value={qty}
                      onChange={n => setQty(Math.max(0, Math.round(n)))}
                      className="font-mono w-28 h-11 md:h-9"
                    />
                    <span className="text-xs text-muted-foreground">
                      {current.plan.isBackward
                        ? `de ${current.plan.pointedStage?.quantity_processed ?? 0} apontados`
                        : `saldo do setor: ${current.plan.remaining} de ${current.plan.pointedStage?.quantity_total ?? 0}`}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Zerar a quantidade pula esta OP sem gravar nada.
                  </p>
                </div>

                {stepError && (
                  <div className="rounded-md border border-red-500/40 bg-red-500/10 p-2.5 text-xs text-red-600">
                    {stepError}
                  </div>
                )}

                <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                  <UserCircle className="h-4 w-4 shrink-0" />
                  Lançamento registrado como{' '}
                  <strong className="text-foreground">{profile?.full_name || profile?.email || 'usuário logado'}</strong>
                </p>

                <div className="flex justify-between gap-2 pt-2 border-t">
                  <Button
                    variant="ghost"
                    className="h-11 md:h-10 gap-1.5"
                    onClick={() => advance({ orderNumber: current.card.q.order_number, status: 'pulada', quantity: 0 })}
                    disabled={apontar.isPending}
                  >
                    <SkipForward className="h-4 w-4" /> Pular
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="outline" className="h-11 md:h-10" onClick={onClose} disabled={apontar.isPending}>
                      Cancelar lote
                    </Button>
                    <Button className="h-11 md:h-10" onClick={() => confirmStep()} disabled={apontar.isPending || stepSkipBlocked || (current.plan.skipped.length > 0 && !skipOk)}>
                      {idx + 1 === steps.length ? 'Confirmar e finalizar' : 'Confirmar e seguir'}
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* R6.3: avisos do servidor no passo atual — confirmar grava com autoria */}
      <ConfirmPointingWarnings
        open={!!pendingWarnings}
        warnings={pendingWarnings || []}
        contextLabel={current ? `${current.card.q.order_number} → ${target}, ${current.plan.isBackward ? '-' : '+'}${qty} pares` : ''}
        onConfirm={() => {
          const codes = (pendingWarnings || []).map(w => w.code);
          setPendingWarnings(null);
          confirmStep(codes);
        }}
        onCancel={() => setPendingWarnings(null)}
        confirming={apontar.isPending}
      />
    </>
  );
}
