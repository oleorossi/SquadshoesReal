import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SearchInput } from '@/components/ui/search-input';
import { EmptyState } from '@/components/ui/empty-state';
import { Kanban as KanbanIcon, Info, ArrowsOutSimple } from '@phosphor-icons/react';
import {
  useSectorSettings, useProductionQueueDetail, useProductionScheduleGrid,
  useEnsureFreshSchedule,
} from '@/hooks/useProductionEngine';
import { useAllOrderStages, useApontarProducao, useRealtimeOrderStages } from '@/hooks/useOrderStages';
import { useCan } from '@/hooks/useAccessControl';
import { useReferenceThumbs } from '@/hooks/useReferenceThumbs';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import { deriveCard, todayISO, KanbanCardData } from '@/components/production/kanban/kanbanDerive';
import { KanbanOpCard } from '@/components/production/kanban/KanbanOpCard';
import { DropApontarDialog } from '@/components/production/kanban/DropApontarDialog';

export default function ProducaoKanban() {
  useEnsureFreshSchedule();
  useRealtimeOrderStages();
  const { data: sectors = [] } = useSectorSettings();
  const { data: queue = [], isLoading: queueLoading } = useProductionQueueDetail();
  const orderIds = useMemo(() => queue.map(q => q.order_id), [queue]);
  const { data: allStages = [], isLoading: stagesLoading } = useAllOrderStages(orderIds);
  const { data: todayGrid = [] } = useProductionScheduleGrid(todayISO(), todayISO());
  // Foto da referência: a view manda reference_photo_url vazio (ver o hook)
  const { data: refThumbs } = useReferenceThumbs(queue.map(q => q.reference_id));
  const apontar = useApontarProducao();
  const canEdit = useCan('/producao/kanban').canEdit;

  const [search, setSearch] = useState('');
  const [dragCard, setDragCard] = useState<KanbanCardData | null>(null);
  const [dropTarget, setDropTarget] = useState<{ card: KanbanCardData; target: string } | null>(null);
  const [detailStage, setDetailStage] = useState<{ card: KanbanCardData } | null>(null);

  const flowOrder = useMemo(() => new Map(sectors.map(s => [s.sector, s.flow_order])), [sectors]);
  const stagesByOrder = useMemo(() => {
    const m = new Map<string, typeof allStages>();
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
        actions={
          <Button asChild variant="outline" size="sm" className="gap-1.5" title="Tela cheia dedicada pra gestão: todos os setores, busca com destaque e leitura de QR das fichas.">
            <Link to="/producao/kanban/gestao">
              <ArrowsOutSimple className="h-4 w-4" /> Modo Gestão
            </Link>
          </Button>
        }
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
                    <KanbanOpCard
                      key={card.q.order_id}
                      card={card}
                      photoUrl={refThumbs?.get(card.q.reference_id || '') || null}
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
          photoUrl={refThumbs?.get(dropTarget.card.q.reference_id || '') || null}
          onClose={() => setDropTarget(null)}
        />
      )}
      {detailStage && (
        <DropApontarDialog
          card={detailStage.card}
          target={null}
          flowOrder={flowOrder}
          apontar={apontar}
          photoUrl={refThumbs?.get(detailStage.card.q.reference_id || '') || null}
          onClose={() => setDetailStage(null)}
        />
      )}
    </div>
  );
}
