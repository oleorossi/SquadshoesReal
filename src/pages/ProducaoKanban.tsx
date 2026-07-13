import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { SearchInput } from '@/components/ui/search-input';
import { EmptyState } from '@/components/ui/empty-state';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Kanban as KanbanIcon, Warning as AlertTriangle, Info, CalendarBlank } from '@phosphor-icons/react';
import {
  useSectorSettings, useProductionQueueDetail, useProductionScheduleGrid,
  useEnsureFreshSchedule, QueueDetailRow,
} from '@/hooks/useProductionEngine';
import {
  useAllOrderStages, useApontarProducao, useRealtimeOrderStages,
  OrderStage, PointingWarning,
} from '@/hooks/useOrderStages';
import ConfirmPointingWarnings from '@/components/production/ConfirmPointingWarnings';
import { useCan } from '@/hooks/useAccessControl';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import { thumbUrl } from '@/lib/imageThumb';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const norm = (s: string) => (s === 'Mesa' ? 'Aviamento' : s);
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
const todayISO = () => new Date().toISOString().slice(0, 10);

interface KanbanCardData {
  q: QueueDetailRow;
  stages: OrderStage[];          // estágios da OP em ordem de fluxo
  column: string;                // setor onde o card está (R5.1)
  front: OrderStage | null;      // último setor com progresso (entrega pro column)
  delivered: number;             // pares entregues pro setor do card
  isPartial: boolean;            // amarelo (R5.3)
  columnStage: OrderStage | null;
}

/**
 * Posição do card (decisão do dono, entrevista 2026-07-12): UM card só por OP,
 * na coluna MAIS AVANÇADA. Arrastar Corte→Costura apontando 120/300 move o card
 * pra Costura mostrando 120/300 em AMARELO — os 180 não cortados ficam
 * implícitos no contador. O card normaliza quando a entrega completa (R5.3/5.4).
 */
function deriveCard(q: QueueDetailRow, stagesRaw: OrderStage[], flowOrder: Map<string, number>): KanbanCardData | null {
  const stages = [...stagesRaw].sort(
    (a, b) => (flowOrder.get(norm(a.stage_name)) ?? a.stage_order * 10) - (flowOrder.get(norm(b.stage_name)) ?? b.stage_order * 10),
  );
  const hasProgress = (s: OrderStage) => s.quantity_processed > 0 || s.status === 'concluido';
  let front: OrderStage | null = null;
  for (const s of stages) if (hasProgress(s)) front = s;

  let column: OrderStage | null = null;
  if (!front) {
    column = stages.find(s => s.status !== 'concluido') ?? null;
  } else {
    const idx = stages.indexOf(front);
    column = stages.slice(idx + 1).find(s => s.status !== 'concluido') ?? null;
    if (!column) {
      // front é o último setor: parcial fica nele; completo = OP saindo do quadro
      if (front.status !== 'concluido' && front.quantity_processed < front.quantity_total) column = front;
      else return null;
    }
  }
  if (!column) return null;

  const delivered = !front ? 0
    : front === column ? column.quantity_processed
    : (front.status === 'concluido' ? front.quantity_total : front.quantity_processed);
  const total = column.quantity_total || q.quantity;
  return {
    q, stages,
    column: norm(column.stage_name),
    front,
    delivered,
    isPartial: !!front && delivered < total,
    columnStage: column,
  };
}

export default function ProducaoKanban() {
  useEnsureFreshSchedule();
  useRealtimeOrderStages();
  const { data: sectors = [] } = useSectorSettings();
  const { data: queue = [], isLoading: queueLoading } = useProductionQueueDetail();
  const orderIds = useMemo(() => queue.map(q => q.order_id), [queue]);
  const { data: allStages = [], isLoading: stagesLoading } = useAllOrderStages(orderIds);
  const { data: todayGrid = [] } = useProductionScheduleGrid(todayISO(), todayISO());
  const apontar = useApontarProducao();
  const canEdit = useCan('/producao/kanban').canEdit;

  const [search, setSearch] = useState('');
  const [dragCard, setDragCard] = useState<KanbanCardData | null>(null);
  const [dropTarget, setDropTarget] = useState<{ card: KanbanCardData; target: string } | null>(null);
  const [detailStage, setDetailStage] = useState<{ card: KanbanCardData } | null>(null);

  const flowOrder = useMemo(() => new Map(sectors.map(s => [s.sector, s.flow_order])), [sectors]);
  const stagesByOrder = useMemo(() => {
    const m = new Map<string, OrderStage[]>();
    allStages.forEach(s => {
      const arr = m.get(s.order_id) || [];
      arr.push(s);
      m.set(s.order_id, arr);
    });
    return m;
  }, [allStages]);

  const cards = useMemo(() => {
    const out: KanbanCardData[] = [];
    for (const q of queue) {
      if (!searchMatchesAllTerms(search, q.order_number, q.reference_name, q.color, q.client_name, q.sale_order_number)) continue;
      const stages = stagesByOrder.get(q.order_id);
      if (!stages?.length) continue;
      const card = deriveCard(q, stages, flowOrder);
      if (card) out.push(card);
    }
    return out;
  }, [queue, stagesByOrder, flowOrder, search]);

  // Colunas: setores ativos na ordem do fluxo + qualquer setor que apareça como
  // coluna de um card (setor desligado globalmente mas presente via ficha, R1.5)
  const columns = useMemo(() => {
    const active = sectors.filter(s => s.enabled).map(s => s.sector);
    const extra = [...new Set(cards.map(c => c.column))].filter(s => !active.includes(s));
    return [...active, ...extra].sort((a, b) => (flowOrder.get(a) ?? 999) - (flowOrder.get(b) ?? 999));
  }, [sectors, cards, flowOrder]);

  const gridToday = useMemo(() => new Map(todayGrid.map(g => [g.sector, g])), [todayGrid]);

  const handleDrop = (target: string) => {
    if (!dragCard) return;
    const card = dragCard;
    setDragCard(null);
    if (target === card.column) return;
    setDropTarget({ card, target });
  };

  const isLoading = queueLoading || stagesLoading;

  return (
    <div className="space-y-4 page-enter">
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · KANBAN"
        title="Kanban"
        description="Arraste o card pro próximo setor e preencha a quantidade — o apontamento é real e alimenta o mesmo motor de todas as telas."
      />

      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Buscar por OP, referência, cor, cliente…"
        resultCount={cards.length}
        totalCount={queue.length}
      />

      {!canEdit && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Info className="h-3.5 w-3.5" /> Somente leitura — você não tem permissão de apontar produção.
        </p>
      )}

      {isLoading ? (
        <div className="flex gap-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-96 w-64 shrink-0" />)}
        </div>
      ) : cards.length === 0 && queue.length === 0 ? (
        <EmptyState
          icon={KanbanIcon}
          title="Nenhuma OP em produção"
          description="OPs criadas a partir dos PVs entram aqui automaticamente."
        />
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {columns.map(sector => {
            const colCards = cards.filter(c => c.column === sector);
            const g = gridToday.get(sector);
            return (
              <div
                key={sector}
                className="w-64 shrink-0"
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                onDrop={e => { e.preventDefault(); handleDrop(sector); }}
              >
                <div className="rounded-t-md bg-muted px-3 py-2 border border-border">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider">{sector}</span>
                    <Badge variant="outline" className="text-[10px]">{colCards.length}</Badge>
                  </div>
                  {/* R2.7: MESMO número do Planejamento (v_production_schedule_grid) */}
                  <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                    hoje: {g ? `${g.planned_pairs}/${g.capacity_pairs}` : '0'} pares
                    {g && g.carryover_pairs > 0 ? ` · +${g.carryover_pairs} atraso` : ''}
                  </p>
                </div>
                <div className="min-h-[300px] space-y-2 rounded-b-md border border-t-0 border-border bg-muted/20 p-2">
                  {colCards.map(card => (
                    <KanbanCard
                      key={card.q.order_id}
                      card={card}
                      draggable={canEdit}
                      dragging={dragCard?.q.order_id === card.q.order_id}
                      onDragStart={() => setDragCard(card)}
                      onDragEnd={() => setDragCard(null)}
                      onOpen={() => setDetailStage({ card })}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {dropTarget && (
        <DropApontarDialog
          card={dropTarget.card}
          target={dropTarget.target}
          flowOrder={flowOrder}
          apontar={apontar}
          onClose={() => setDropTarget(null)}
        />
      )}
      {detailStage && (
        <DropApontarDialog
          card={detailStage.card}
          target={null}
          flowOrder={flowOrder}
          apontar={apontar}
          onClose={() => setDetailStage(null)}
        />
      )}
    </div>
  );
}

function KanbanCard({
  card, draggable, dragging, onDragStart, onDragEnd, onOpen,
}: {
  card: KanbanCardData;
  draggable: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: () => void;
}) {
  const { q, front, delivered, isPartial, columnStage } = card;
  const total = columnStage?.quantity_total || q.quantity;
  const thumb = thumbUrl(q.reference_photo_url, 40);
  return (
    <Card
      className={`p-2.5 cursor-pointer select-none transition-all hover:shadow-md ${dragging ? 'opacity-40' : ''} ${
        isPartial
          ? 'border-amber-500/60 bg-amber-500/10'   // R5.3: AMARELO = parcial
          : 'bg-card'
      }`}
      draggable={draggable}
      onDragStart={e => { onDragStart(); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/op-id', q.order_id); }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
    >
      <div className="flex items-start gap-2">
        {thumb ? (
          <img src={thumb} alt="" className="h-10 w-10 rounded object-contain bg-muted shrink-0" loading="lazy" />
        ) : (
          <div className="h-10 w-10 rounded bg-muted shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <Link
              to={`/orders/${q.order_id}/edit`}
              onClick={e => e.stopPropagation()}
              className="font-mono text-xs font-bold hover:underline truncate"
            >
              {q.order_number}
            </Link>
            {q.late_days > 0 && (
              <Badge variant="outline" className="text-[9px] bg-red-500/10 text-red-600 border-red-500/30 gap-0.5 shrink-0">
                <AlertTriangle className="h-2.5 w-2.5" /> +{q.late_days}d
              </Badge>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground truncate">
            {q.reference_name || '—'}{q.color ? ` · ${q.color}` : ''}
          </p>
          <div className="mt-1 flex items-center justify-between">
            <span className={`font-mono text-xs font-bold ${isPartial ? 'text-amber-600 dark:text-amber-400' : ''}`}>
              {front ? `${delivered}/${total}` : `0/${total}`}
            </span>
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <CalendarBlank className="h-2.5 w-2.5" /> {fmtDate(q.due_date)}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {q.has_ficha_override && <Badge variant="outline" className="text-[9px]">ficha</Badge>}
            {q.pinned_position !== null && <Badge variant="outline" className="text-[9px]">fixada</Badge>}
          </div>
        </div>
      </div>
    </Card>
  );
}

/**
 * Diálogo de apontamento do drop (R5.4) e também o detalhe do card (click).
 * target=null → modo detalhe: aponta no setor da coluna atual sem mover regra.
 * Pulo de setor / volta (R5.5): avisar + confirmar, tudo pela mesma RPC.
 */
function DropApontarDialog({
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
  const [confirmSkip, setConfirmSkip] = useState(skipped.length > 0 || isBackward);

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
                <Input
                  type="number"
                  min={0}
                  value={qty}
                  onChange={e => setQty(Math.max(0, Math.round(Number(e.target.value) || 0)))}
                  className="font-mono w-28 h-9"
                  autoFocus
                  onFocus={e => e.target.select()}
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
