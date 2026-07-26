import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/number-input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Info } from '@phosphor-icons/react';
import { useApontarProducao, PointingWarning } from '@/hooks/useOrderStages';
import ConfirmPointingWarnings from '@/components/production/ConfirmPointingWarnings';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { norm, KanbanCardData } from './kanbanDerive';

/**
 * Diálogo de apontamento do drop (R5.4) e também o detalhe do card (click).
 * target=null → modo detalhe: aponta no setor da coluna atual sem mover regra.
 * Pulo de setor / volta (R5.5): avisar + confirmar, tudo pela mesma RPC.
 */
export function DropApontarDialog({
  card, target, flowOrder, apontar, onClose,
}: {
  card: KanbanCardData;
  target: string | null;
  flowOrder: Map<string, number>;
  apontar: ReturnType<typeof useApontarProducao>;
  onClose: () => void;
}) {
  const { q, stages, column, front } = card;
  const seq = stages.filter(s => s.status !== 'concluido').map(s => norm(s.stage_name));
  const colIdx = seq.indexOf(column);
  const targetIdx = target ? seq.indexOf(target) : colIdx + 1;
  const isBackward = target !== null && (flowOrder.get(target) ?? 0) < (flowOrder.get(column) ?? 0);
  // Pular = soltar além do PRÓXIMO setor pendente do fluxo da OP
  const skipped = !isBackward && target !== null && targetIdx > colIdx + 1
    ? seq.slice(colIdx + 1, targetIdx)
    : [];

  // Estágio apontado: para frente = o setor ONDE o card está (o trabalho que
  // acabou de acontecer); para trás = estorno no último setor com progresso.
  const pointedStage = isBackward
    ? front
    : (card.columnStage ?? null);
  const remaining = pointedStage
    ? pointedStage.quantity_total - pointedStage.quantity_processed
    : 0;

  const [qty, setQty] = useState<number>(() => (isBackward ? 0 : Math.max(0, remaining)));
  const [operatorEmployeeId, setOperatorEmployeeId] = useState<string>(() => {
    try { return localStorage.getItem('sector_operator_employee_id') || ''; } catch { return ''; }
  });
  const [pendingWarnings, setPendingWarnings] = useState<PointingWarning[] | null>(null);
  const [confirmSkip] = useState(skipped.length > 0 || isBackward);

  const { data: employees = [] } = useQuery({
    queryKey: ['sector_operators'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employees')
        .select('id, name, role')
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return (data || []) as { id: string; name: string; role: string | null }[];
    },
  });

  if (!pointedStage) {
    return (
      <Dialog open onOpenChange={v => { if (!v) onClose(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{q.order_number}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {isBackward
              ? 'Nada pra estornar — nenhum setor desta OP tem apontamento.'
              : 'Nenhum setor pendente pra apontar nesta OP.'}
          </p>
        </DialogContent>
      </Dialog>
    );
  }

  const doApontar = async (confirmed?: string[]) => {
    const quantity = isBackward ? -Math.abs(qty) : qty;
    if (quantity === 0) { onClose(); return; }
    try {
      if (operatorEmployeeId) {
        try { localStorage.setItem('sector_operator_employee_id', operatorEmployeeId); } catch { /* noop */ }
      }
      const willComplete = !isBackward && pointedStage.quantity_processed + quantity >= pointedStage.quantity_total;
      const res = await apontar.mutateAsync({
        orderId: q.order_id,
        stageName: pointedStage.stage_name,
        quantity,
        operatorEmployeeId: operatorEmployeeId || null,
        note: isBackward
          ? `Estorno via Kanban (${column} → ${target})`
          : (skipped.length ? `Via Kanban, pulando: ${skipped.join(', ')}` : 'Via Kanban'),
        // Finaliza o setor quando o total fecha — a RPC resolve/inicia o próximo
        finalize: willComplete,
        confirmedWarnings: confirmed,
      });
      if (res?.needs_confirmation) {
        setPendingWarnings(res.warnings || []);
        return;
      }
      // Pulo confirmado (R5.5): conclui os setores intermediários com 0 pares
      // (pulados de propósito — o motor os trata como entrega total)
      for (const skippedSector of skipped) {
        await apontar.mutateAsync({
          orderId: q.order_id,
          stageName: skippedSector,
          quantity: 0,
          operatorEmployeeId: operatorEmployeeId || null,
          note: `Setor pulado via Kanban (confirmado)`,
          finalize: true,
          confirmedWarnings: ['limite_setor_anterior', 'material_nao_reservado'],
        });
      }
      toast.success(
        isBackward
          ? `Estornado ${Math.abs(quantity)} pares de ${pointedStage.stage_name}.`
          : `${pointedStage.stage_name}: +${quantity} pares (${Math.min(pointedStage.quantity_processed + quantity, pointedStage.quantity_total)}/${pointedStage.quantity_total}).`,
      );
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
            <p className="text-xs text-muted-foreground">
              {q.reference_name}{q.color ? ` · ${q.color}` : ''} · {q.quantity} pares
              {target && !isBackward && <> · movendo pra <strong>{target}</strong></>}
            </p>

            {confirmSkip && skipped.length > 0 && (
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
                  className="font-mono w-28 h-9"
                />
                <span className="text-xs text-muted-foreground">
                  {isBackward
                    ? `de ${pointedStage.quantity_processed} apontados`
                    : `saldo do setor: ${remaining} de ${pointedStage.quantity_total}`}
                </span>
              </div>
            </div>

            <div>
              <Label className="text-xs">Operário (quem executou)</Label>
              <Select value={operatorEmployeeId} onValueChange={setOperatorEmployeeId}>
                <SelectTrigger className="h-9 mt-1">
                  <SelectValue placeholder="Selecione o operário..." />
                </SelectTrigger>
                <SelectContent>
                  {employees.map(e => (
                    <SelectItem key={e.id} value={e.id}>{e.name}{e.role ? ` — ${e.role}` : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">
                O apontamento grava também o usuário logado (autoria — R6.2).
              </p>
            </div>

            {/* Progresso por setor (transparência do card único) */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 px-2">
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
              <Button variant="outline" onClick={onClose}>Cancelar</Button>
              <Button
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
