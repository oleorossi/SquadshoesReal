import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/number-input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Info, UserCircle } from '@phosphor-icons/react';
import { useApontarProducao, PointingWarning } from '@/hooks/useOrderStages';
import { useCurrentProfile } from '@/hooks/useUserManagement';
import ConfirmPointingWarnings from '@/components/production/ConfirmPointingWarnings';
import { toast } from 'sonner';
import { thumbUrl } from '@/lib/imageThumb';
import { norm, fmtDate, KanbanCardData } from './kanbanDerive';
import { buildPointingPlan, moveOptions, applyPointing } from './pointingPlan';

/** Valor-sentinela do select de mover (shadcn Select não aceita value vazio). */
const MOVE_ATUAL = '__atual';

/**
 * Diálogo de apontamento do drop (R5.4) e também o detalhe do card (click).
 * target=null → modo detalhe: aponta no setor da coluna atual sem mover regra,
 * e expõe o select "Mover para" — MESMA semântica do drop (pulo/estorno), pra
 * celular/iPad onde o HTML5 drag & drop não dispara com toque (e como
 * alternativa de teclado no desktop).
 * Pulo de setor / volta (R5.5): avisar + confirmar, tudo pela mesma RPC.
 */
export function DropApontarDialog({
  card, target, flowOrder, apontar, onClose, photoUrl, onApontado,
}: {
  card: KanbanCardData;
  target: string | null;
  flowOrder: Map<string, number>;
  apontar: ReturnType<typeof useApontarProducao>;
  onClose: () => void;
  /** Foto da referência já resolvida pela página (`useReferenceThumbs`). */
  photoUrl?: string | null;
  /** Apontou com sucesso — a página usa pra dar o halo de pouso no card. */
  onApontado?: (orderId: string) => void;
}) {
  const { q, stages, column } = card;
  const { data: profile } = useCurrentProfile();
  const referencePhoto = thumbUrl(photoUrl || q.reference_photo_url, 112);

  // Modo detalhe (target=null): o usuário pode escolher um destino no select —
  // vale como se tivesse arrastado o card até lá.
  const [moveTarget, setMoveTarget] = useState<string>('');
  const effTarget = target ?? (moveTarget || null);

  const plan = buildPointingPlan(card, effTarget, flowOrder);
  const { pointedStage, isBackward, skipped, remaining } = plan;

  const { fwdOptions, backOption } = moveOptions(card, flowOrder);
  const showMove = target === null && (fwdOptions.length > 0 || backOption !== null);

  const columnRemaining = card.columnStage
    ? card.columnStage.quantity_total - card.columnStage.quantity_processed
    : 0;

  const [qty, setQty] = useState<number>(() => (isBackward ? 0 : Math.max(0, remaining)));
  const [pendingWarnings, setPendingWarnings] = useState<PointingWarning[] | null>(null);

  // Entrega incompleta = o setor recebe menos do que o total da OP. É o que
  // faz o card nascer ÂMBAR no destino, mostrando "84/120" (R5.3).
  const willBePartial = !isBackward && !!pointedStage
    && qty > 0
    && pointedStage.quantity_processed + qty < pointedStage.quantity_total;

  // Acima do saldo: o servidor aceita (com confirmação) mas os dois lados
  // DIVERGEM — o estágio é clampado no total da OP e o ledger grava o valor
  // digitado. Sem dizer isso aqui, o operador confirma um aviso genérico e
  // fica com 300/300 na tela e 350 no histórico de produção.
  const excess = !isBackward && !!pointedStage
    ? Math.max(0, pointedStage.quantity_processed + qty - pointedStage.quantity_total)
    : 0;

  const handleMoveChange = (v: string) => {
    const t = v === MOVE_ATUAL ? '' : v;
    setMoveTarget(t);
    // Reancora a quantidade no novo sentido: frente = saldo do setor atual;
    // trás = 0 (o usuário digita quantos pares estorna), igual ao drop.
    const back = t !== '' && (flowOrder.get(t) ?? 0) < (flowOrder.get(column) ?? 0);
    setQty(back ? 0 : Math.max(0, columnRemaining));
  };

  if (!pointedStage) {
    return (
      <Dialog open onOpenChange={v => { if (!v) onClose(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{q.order_number}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {plan.unavailableReason ?? 'Nenhum setor pendente pra apontar nesta OP.'}
          </p>
        </DialogContent>
      </Dialog>
    );
  }

  const doApontar = async (confirmed?: string[]) => {
    if (qty === 0) { onClose(); return; }
    try {
      const res = await applyPointing({ card, plan, target: effTarget, qty, apontar, confirmedWarnings: confirmed });
      if (res.status === 'needs_confirmation') {
        setPendingWarnings(res.warnings);
        return;
      }
      if (res.status === 'ok') {
        toast.success(
          isBackward
            ? `Estornado ${Math.abs(res.quantity)} pares de ${pointedStage.stage_name}.`
            : `${pointedStage.stage_name}: +${res.quantity} pares (${Math.min(pointedStage.quantity_processed + res.quantity, pointedStage.quantity_total)}/${pointedStage.quantity_total}).`,
        );
        onApontado?.(q.order_id);
      }
      onClose();
    } catch {
      // toast de erro já emitido pela mutation (estorno em setor concluído é
      // permitido desde a auditoria 2026-07-13 — reabre o estágio)
    }
  };

  return (
    <>
      <Dialog open onOpenChange={v => { if (!v) onClose(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">
              {isBackward ? 'Estornar produção' : `Apontar ${pointedStage.stage_name}`} — {q.order_number}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* Identidade da referência: a foto GRANDE é o que confirma, num
                relance, que a OP arrastada é mesmo a que se quer apontar —
                antes só havia uma linha de texto. */}
            <div className="flex gap-3.5 rounded-lg border border-border bg-muted/40 p-3">
              {referencePhoto ? (
                <img
                  src={referencePhoto}
                  alt={q.reference_name || 'Referência'}
                  className="h-28 w-28 shrink-0 rounded-md border border-border bg-muted object-contain"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-[10px] text-muted-foreground">
                  sem foto
                </div>
              )}
              <dl className="grid min-w-0 flex-1 grid-cols-[auto_1fr] content-start gap-x-3 gap-y-0.5 text-xs">
                <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Referência</dt>
                <dd className="truncate font-semibold text-primary">
                  {q.reference_name || '—'}{q.color ? <span className="font-normal text-muted-foreground"> · {q.color}</span> : null}
                </dd>
                <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Pedido</dt>
                <dd className="truncate font-mono">{q.sale_order_number || '—'}</dd>
                <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Cliente</dt>
                <dd className="truncate">{q.client_name || '—'}</dd>
                <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</dt>
                <dd className="font-mono">{q.quantity.toLocaleString('pt-BR')} pares</dd>
                <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Entrega</dt>
                <dd className="font-mono">
                  {fmtDate(q.due_date)}
                  {q.late_days > 0 && <span className="text-red-600"> · +{q.late_days}d</span>}
                </dd>
              </dl>
            </div>

            {effTarget && !isBackward && (
              <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                De <strong className="text-foreground">{column}</strong>{' '}
                <span className="text-primary">→</span>{' '}
                para <strong className="text-foreground">{effTarget}</strong>
              </p>
            )}

            {/* Mover sem drag (touch/teclado): mesma semântica do drop */}
            {showMove && (
              <div>
                <Label className="text-xs">Mover OP para</Label>
                <Select value={moveTarget || MOVE_ATUAL} onValueChange={handleMoveChange}>
                  <SelectTrigger className="h-11 md:h-9 mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={MOVE_ATUAL}>Setor atual — {column}</SelectItem>
                    {fwdOptions.map((s, i) => (
                      <SelectItem key={s} value={s}>
                        {s}{i > 0 ? ' — pula setor' : ''}
                      </SelectItem>
                    ))}
                    {backOption && (
                      <SelectItem value={backOption}>
                        ← {backOption} — voltar (estorno)
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground mt-1">
                  No celular/tablet o arrasto não existe — mover por aqui tem o mesmo efeito do drag.
                </p>
              </div>
            )}

            {skipped.length > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300">
                <strong>Pulando setor{skipped.length > 1 ? 'es' : ''}:</strong> {skipped.join(', ')}.
                Eles serão marcados como concluídos sem produção apontada — fica registrado.
              </div>
            )}
            {isBackward && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300">
                <strong>Voltando no fluxo:</strong> os pares informados serão estornados de{' '}
                <strong>{pointedStage.stage_name}</strong> (lançamento negativo no ledger).
              </div>
            )}

            <div>
              <Label className="text-xs">
                {isBackward ? 'Pares a estornar' : 'Quantidade executada (pares)'}
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
                  {isBackward
                    ? `de ${pointedStage.quantity_processed} apontados`
                    : `saldo do setor: ${remaining} de ${pointedStage.quantity_total}`}
                </span>
              </div>
              {excess > 0 && (
                <p className="mt-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] leading-snug text-amber-700 dark:text-amber-300">
                  <strong>{excess} {excess === 1 ? 'par acima' : 'pares acima'} do total da OP.</strong>{' '}
                  O setor vai fechar em {pointedStage.quantity_total}/{pointedStage.quantity_total},
                  mas o histórico de produção registra os {pointedStage.quantity_processed + qty} digitados —
                  os dois números deixam de bater. Se produziu a mais de verdade, ajuste a quantidade da OP;
                  se foi engano, corrija aqui.
                </p>
              )}
            </div>

            {/* Prévia da consequência: mostra COMO o card vai ficar antes do
                clique. Apontou menos que o total do setor → o bloco fica âmbar
                aqui mesmo, igualzinho ao card que vai nascer no destino. */}
            {!isBackward && (
              <div
                className={`flex items-center gap-3 rounded-lg border p-2.5 transition-colors ${
                  willBePartial
                    ? 'border-amber-500/50 bg-amber-500/10'
                    : 'border-border bg-muted/30'
                }`}
              >
                <span className="font-mono text-xl font-bold leading-none">
                  <span className={willBePartial ? 'text-amber-600 dark:text-amber-400' : ''}>
                    {Math.min(pointedStage.quantity_processed + qty, pointedStage.quantity_total)}
                  </span>
                  <span className="font-normal opacity-60">/{pointedStage.quantity_total}</span>
                </span>
                <span className="text-[11px] leading-snug text-muted-foreground">
                  {qty <= 0
                    ? 'Nada será apontado com 0 pares.'
                    : willBePartial
                      ? <>Chega em <strong className="text-amber-600 dark:text-amber-400">{effTarget || pointedStage.stage_name}</strong> marcada como <strong className="text-amber-600 dark:text-amber-400">PARCIAL</strong> — faltam {pointedStage.quantity_total - pointedStage.quantity_processed - qty} pares pra fechar.</>
                      : <>Entrega completa. O card chega em <strong className="text-foreground">{effTarget || pointedStage.stage_name}</strong> sem marcação.</>}
                </span>
              </div>
            )}

            {/* Autoria: quem responde pelo lançamento é o usuário logado — não
                se escolhe operário aqui (decisão do dono 2026-07-26). */}
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <UserCircle className="h-4 w-4 shrink-0" />
              Lançamento registrado como{' '}
              <strong className="text-foreground">{profile?.full_name || profile?.email || 'usuário logado'}</strong>
            </p>

            {/* Progresso por setor (transparência do card único) */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 text-xs gap-1 px-2">
                  <Info className="h-3 w-3" /> Progresso por setor
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 text-xs space-y-1">
                {stages.map(s => (
                  <div key={s.id} className="flex justify-between font-mono">
                    <span className={s.status === 'concluido' ? 'text-muted-foreground line-through' : ''}>
                      {norm(s.stage_name)}
                    </span>
                    <span>{s.quantity_processed}/{s.quantity_total}</span>
                  </div>
                ))}
              </PopoverContent>
            </Popover>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" className="h-11 md:h-10" onClick={onClose}>Cancelar</Button>
              <Button
                className="h-11 md:h-10"
                onClick={() => doApontar()}
                disabled={apontar.isPending || qty === 0}
              >
                {isBackward ? 'Estornar' : 'Apontar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* R6.3: avisos do servidor — confirmar grava com autoria */}
      <ConfirmPointingWarnings
        open={!!pendingWarnings}
        warnings={pendingWarnings || []}
        contextLabel={`${pointedStage.stage_name} — ${q.order_number}, ${isBackward ? '-' : '+'}${qty} pares`}
        onConfirm={() => {
          const codes = (pendingWarnings || []).map(w => w.code);
          setPendingWarnings(null);
          doApontar(codes);
        }}
        onCancel={() => setPendingWarnings(null)}
        confirming={apontar.isPending}
      />
    </>
  );
}
