import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { NumberInput } from '@/components/ui/number-input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ArrowRight, CheckCircle, SkipForward, Warning as AlertTriangle, UserCircle } from '@phosphor-icons/react';
import { useApontarProducao, PointingWarning } from '@/hooks/useOrderStages';
import { useCurrentProfile } from '@/hooks/useUserManagement';
import ConfirmPointingWarnings from '@/components/production/ConfirmPointingWarnings';
import { toast } from 'sonner';
import { KanbanCardData } from './kanbanDerive';
import { applyPointing, skipBlockedByPartial } from './pointingPlan';
import { buildBulkMoveBatch, uniqueCardsByOrder } from './bulkMovePlan';

interface StepResult {
  orderNumber: string;
  status: 'ok' | 'pulada';
  quantity: number;
  direction?: 'forward' | 'backward';
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
  cards, target, flowOrder, levelOf, apontar, onClose, onBack,
}: {
  cards: KanbanCardData[];
  target: string;
  flowOrder: Map<string, number>;
  /** Níveis do motor — sem eles, irmão paralelo é lido como setor pulado. */
  levelOf?: Map<string, number>;
  apontar: ReturnType<typeof useApontarProducao>;
  /** Fecha uma revisão sem gravações e preserva a seleção no quadro. */
  onBack?: () => void;
  /** Fecha um lote concluído/parcial e encerra o modo de seleção. */
  onClose: () => void;
}) {
  const { data: profile } = useCurrentProfile();
  const backToBoard = onBack || onClose;
  // Congela a seleção na abertura: cada apontamento invalida as queries e o
  // pai re-renderiza com cards novos — sem o snapshot o wizard trocaria de
  // passo/coluna no meio do preenchimento.
  /**
   * ⚠ UMA OP por lote, mesmo com vários cards.
   *
   * A tela já substitui um irmão paralelo quando outro é selecionado, mas o
   * diálogo mantém a deduplicação como defesa: integrações ou estado legado
   * ainda podem entregar Corte Palmilha E Corte Forração da MESMA OP. O primeiro
   * card da ordem visual vence; o irmão volta ao lote numa próxima rodada, com
   * o estado fresco.
   */
  const [frozen] = useState(() => cards);

  const { steps, blocked, duplicateCards } = useMemo(
    () => buildBulkMoveBatch(frozen, target, flowOrder, levelOf),
    [frozen, target, flowOrder, levelOf],
  );
  const sourceSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const card of uniqueCardsByOrder(frozen)) {
      counts.set(card.column, (counts.get(card.column) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => (flowOrder.get(a[0]) ?? 999) - (flowOrder.get(b[0]) ?? 999));
  }, [frozen, flowOrder]);

  const [started, setStarted] = useState(false);
  const [idx, setIdx] = useState(0);
  const [qty, setQty] = useState(0);
  const [results, setResults] = useState<StepResult[]>([]);
  const [pendingWarnings, setPendingWarnings] = useState<PointingWarning[] | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  /** Aceite do pulo de setor (decisão do dono 06/08/2026). Reseta a cada OP —
   *  confirmar uma do lote NÃO confirma as seguintes. */
  const [skipOk, setSkipOk] = useState(false);
  const finished = started && idx >= steps.length;
  const current = started && !finished ? steps[idx] : null;

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
        direction: plan.isBackward ? 'backward' : 'forward',
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
  const totalForward = results.filter(r => r.status === 'ok' && r.direction === 'forward').length;
  const totalBackward = results.filter(r => r.status === 'ok' && r.direction === 'backward').length;
  const paresForward = results
    .filter(r => r.status === 'ok' && r.direction === 'forward')
    .reduce((sum, result) => sum + result.quantity, 0);
  const paresBackward = results
    .filter(r => r.status === 'ok' && r.direction === 'backward')
    .reduce((sum, result) => sum + result.quantity, 0);

  const closeWithSummary = () => {
    if (totalOk > 0) {
      toast.success(
        `Lote concluído: ${totalOk} OP${totalOk > 1 ? 's' : ''} processada${totalOk > 1 ? 's' : ''} · ${totalPares} pares.`,
      );
    }
    onClose();
  };

  const requestClose = () => {
    if (apontar.isPending) return;
    if (!finished && totalOk > 0) {
      setConfirmCloseOpen(true);
      return;
    }
    backToBoard();
  };

  const closePartialBatch = () => {
    setConfirmCloseOpen(false);
    toast.warning(
      `Lote encerrado: ${totalOk} OP${totalOk === 1 ? '' : 's'} já processada${totalOk === 1 ? '' : 's'} permanece${totalOk === 1 ? '' : 'm'} gravada${totalOk === 1 ? '' : 's'}.`,
    );
    onClose();
  };

  // Nada elegível: informa e sai (não abre wizard vazio)
  if (steps.length === 0) {
    return (
      <Dialog open onOpenChange={v => { if (!v) backToBoard(); }}>
        <DialogContent className="min-w-0 grid-cols-[minmax(0,1fr)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Distribuir OPs para {target}</DialogTitle>
            <DialogDescription>Nenhum lançamento será gravado com esta combinação.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
            <p className="font-semibold flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4" /> Nenhuma das OPs selecionadas pode ir pra {target}.
            </p>
            {blocked.slice(0, 8).map(b => (
              <p key={b.orderNumber}><span className="font-mono font-bold">{b.orderNumber}</span> — {b.reason}</p>
            ))}
            {blocked.length > 8 && <p>+{blocked.length - 8} outras.</p>}
            {duplicateCards > 0 && (
              <p>{duplicateCards} card{duplicateCards > 1 ? 's' : ''} de setor paralelo da mesma OP ficou de fora — mova um por vez.</p>
            )}
          </div>
          <div className="flex justify-end pt-2 border-t">
            <Button className="h-11 md:h-10" onClick={backToBoard}>Fechar</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <>
      <Dialog open onOpenChange={v => { if (!v) { if (finished) closeWithSummary(); else requestClose(); } }}>
        <DialogContent className="min-w-0 grid-cols-[minmax(0,1fr)] sm:max-w-md">
          {!started ? (
            /* ── Revisão antes de qualquer gravação ── */
            <>
              <DialogHeader>
                <DialogTitle className="text-base">Revisar distribuição</DialogTitle>
                <DialogDescription>Confira o destino e as OPs aptas antes de iniciar os lançamentos.</DialogDescription>
              </DialogHeader>
              <div className="min-w-0 space-y-3">
                <div className="border-2 border-foreground bg-card p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Destino do lote</p>
                  <p className="mt-1 flex min-w-0 items-center gap-2 text-sm font-semibold">
                    <span className="min-w-0 flex-1 truncate">
                      {sourceSummary.map(([sector, count]) => `${sector} (${count})`).join(' · ')}
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-primary" />
                    <strong className="max-w-[45%] shrink-0 truncate text-primary sm:max-w-none">{target}</strong>
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md border border-success/30 bg-success/10 p-2.5">
                    <p className="font-mono text-xl font-bold text-success">{steps.length}</p>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-success">aptas para distribuir</p>
                  </div>
                  <div className={`rounded-md border p-2.5 ${
                    blocked.length > 0 ? 'border-warning/30 bg-warning/10' : 'border-border bg-muted/30'
                  }`}>
                    <p className={`font-mono text-xl font-bold ${blocked.length > 0 ? 'text-warning' : 'text-muted-foreground'}`}>{blocked.length}</p>
                    <p className={`text-[10px] font-semibold uppercase tracking-wide ${blocked.length > 0 ? 'text-warning' : 'text-muted-foreground'}`}>bloqueadas</p>
                  </div>
                </div>

                {blocked.length > 0 && (
                  <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs text-warning">
                    <p className="font-semibold">Estas OPs não entram no lote:</p>
                    {blocked.map(item => (
                      <p key={item.orderNumber}>
                        <span className="font-mono font-bold">{item.orderNumber}</span> — {item.reason}
                      </p>
                    ))}
                  </div>
                )}

                {duplicateCards > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {duplicateCards} card{duplicateCards > 1 ? 's paralelos' : ' paralelo'} da mesma OP foi removido do lote para evitar apontamento duplicado.
                  </p>
                )}

                <p className="text-xs leading-snug text-muted-foreground">
                  A distribuição será confirmada uma OP por vez. Você ainda poderá ajustar a quantidade ou pular uma OP sem gravar.
                </p>

                <div className="flex flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:justify-end">
                  <Button variant="outline" className="h-11 md:h-10" onClick={requestClose}>
                    Voltar ao quadro
                  </Button>
                  <Button className="h-11 gap-2 md:h-10" onClick={() => setStarted(true)}>
                    Iniciar distribuição <span className="font-mono opacity-80">({steps.length})</span>
                  </Button>
                </div>
              </div>
            </>
          ) : finished ? (
            /* ── Resumo do lote ── */
            <>
              <DialogHeader>
                <DialogTitle className="text-base flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-success" weight="fill" /> Lote concluído
                </DialogTitle>
                <DialogDescription>Resumo dos lançamentos feitos nesta distribuição.</DialogDescription>
              </DialogHeader>
              <div className="min-w-0 space-y-3">
                <div className="rounded-md border border-border bg-muted/30 p-3 font-mono text-sm space-y-1">
                  <p><strong className="text-base">{totalOk}</strong> OP{totalOk === 1 ? '' : 's'} processada{totalOk === 1 ? '' : 's'}</p>
                  {totalForward > 0 && (
                    <p><strong>{totalForward}</strong> distribuída{totalForward === 1 ? '' : 's'} para <strong>{target}</strong> · {paresForward.toLocaleString('pt-BR')} pares</p>
                  )}
                  {totalBackward > 0 && (
                    <p><strong>{totalBackward}</strong> estornada{totalBackward === 1 ? '' : 's'} · {paresBackward.toLocaleString('pt-BR')} pares</p>
                  )}
                  {totalPuladas > 0 && <p className="text-muted-foreground">{totalPuladas} pulada{totalPuladas === 1 ? '' : 's'} (quantidade zerada)</p>}
                </div>
                {blocked.length > 0 && (
                  <div className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs text-warning">
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
                <DialogDescription>Revise a quantidade desta OP antes de confirmar e seguir.</DialogDescription>
              </DialogHeader>
              <div className="min-w-0 space-y-3">
                {/* Progresso do lote */}
                <div
                  className="h-1.5 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-label="Progresso da distribuição"
                  aria-valuenow={idx + 1}
                  aria-valuemin={1}
                  aria-valuemax={steps.length}
                  aria-valuetext={`OP ${idx + 1} de ${steps.length}`}
                >
                  <div className="h-full bg-primary transition-all" style={{ width: `${((idx + 1) / steps.length) * 100}%` }} />
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
                  <div className="rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs text-warning">
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
                  <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2.5 text-xs text-destructive">
                    <strong>Pra pular setor, {current.plan.pointedStage?.stage_name} tem que fechar.</strong>{' '}
                    Com {qty} de {current.plan.stageRemaining} pares, os{' '}
                    <strong>{current.plan.stageRemaining - qty} restantes</strong> ficariam sem passar por{' '}
                    {current.plan.skipped.join(', ')}. Aponte o saldo cheio ou pule esta OP do lote.
                  </div>
                )}
                {current.plan.isBackward && (
                  <div className="rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs text-warning">
                    <strong>Voltando no fluxo:</strong> os pares informados serão estornados de{' '}
                    <strong>{current.plan.pointedStage?.stage_name}</strong> (lançamento negativo no ledger).
                  </div>
                )}

                <div>
                  <Label htmlFor="bulk-move-quantity" className="text-xs">
                    {current.plan.isBackward ? 'Pares a estornar' : 'Quantidade executada (pares)'}
                  </Label>
                  <div className="flex items-center gap-2 mt-1">
                    <NumberInput
                      id="bulk-move-quantity"
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
                  <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
                    {stepError}
                  </div>
                )}

                <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                  <UserCircle className="h-4 w-4 shrink-0" />
                  Lançamento registrado como{' '}
                  <strong className="text-foreground">{profile?.full_name || profile?.email || 'usuário logado'}</strong>
                </p>

                <div className="flex flex-col gap-2 border-t pt-2 sm:flex-row sm:items-center sm:justify-between">
                  <Button
                    variant="ghost"
                    className="h-11 gap-1.5 sm:w-auto md:h-10"
                    onClick={() => advance({ orderNumber: current.card.q.order_number, status: 'pulada', quantity: 0 })}
                    disabled={apontar.isPending}
                  >
                    <SkipForward className="h-4 w-4" /> Pular
                  </Button>
                  <div className="grid grid-cols-1 gap-2 sm:flex">
                    <Button variant="outline" className="h-11 md:h-10" onClick={requestClose} disabled={apontar.isPending}>
                      {totalOk > 0 ? 'Encerrar lote' : 'Cancelar lote'}
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

      <AlertDialog open={confirmCloseOpen} onOpenChange={setConfirmCloseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Encerrar uma distribuição já iniciada?</AlertDialogTitle>
            <AlertDialogDescription>
              {totalOk} OP{totalOk === 1 ? '' : 's'} já {totalOk === 1 ? 'foi processada' : 'foram processadas'} neste lote.
              Esses lançamentos permanecem gravados; somente as OPs restantes deixarão de ser processadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar o lote</AlertDialogCancel>
            <AlertDialogAction onClick={closePartialBatch}>Encerrar mesmo assim</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
