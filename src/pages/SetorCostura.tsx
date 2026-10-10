import { useMemo, useState } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { Funnel as Filter, CheckCircle as CheckCircle2, CircleNotch as Loader2, Package } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { SectorStageActions } from '@/components/production/SectorStageActions';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useQueryClient } from '@tanstack/react-query';
import { useOrders } from '@/hooks/useOrders';
import { useTechnicalSheets } from '@/hooks/useTechnicalSheets';
import { useAllOrderStages, useRealtimeOrderStages } from '@/hooks/useOrderStages';
import { sameStage } from '@/lib/production/stageFlow';
import { useSaleOrders } from '@/hooks/useSaleOrders';
import { useProductionTransitions } from '@/hooks/useProductionTransitions';
import { toast } from 'sonner';
import { OrderMultiSelectToolbar } from '@/components/orders/OrderMultiSelectToolbar';
import { useMarqueeSelection } from '@/hooks/useMarqueeSelection';
import { MarqueeOverlay } from '@/components/ui/bulk-actions-bar';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { RefChip } from '@/components/ui/ref-chip';
import {
  findIdsMatchingOrderCodes,
  matchesOrderSearch,
  parseOrderCodeList,
} from '@/lib/orderCodeSearch';
import { matchesDeliveryWeek } from '@/lib/deliveryWeekOptions';
import { confirmIfHiddenSelection } from '@/lib/confirmHiddenSelection';

/**
 * Página GENÉRICA de um setor de costura. Desde a divisão de 2026-10-01
 * (migration 20261001120000) existem DOIS setores independentes e paralelos —
 * "Acabamento Palmilha" e "Costura Cabedal" — e esta página serve os dois via
 * prop `sectorName`, em vez de duplicar o arquivo.
 *
 * Layout enxuto. O nome do arquivo é SetorCostura.tsx (não Costura.tsx)
 * porque já existe um Costura.tsx legado representando "Corte Forração"
 * (nomenclatura interna pré-rename de 2026-05-06).
 *
 * O visual A4 da ficha de operador será polido em PR seguinte.
 */
export default function SetorCostura({ sectorName = 'Acabamento Palmilha' }: { sectorName?: string } = {}) {
  const SECTOR_NAME = sectorName;
  const queryClient = useQueryClient();
  const { data: orders = [] } = useOrders();
  const { data: references = [] } = useTechnicalSheets();
  const orderIds = useMemo(() => orders.map(o => o.id), [orders]);
  const { data: allStages = [] } = useAllOrderStages(orderIds.length > 0 ? orderIds : undefined);
  // Realtime: OP liberada/apontada em outro terminal reflete aqui em ~1s.
  useRealtimeOrderStages();
  const { data: saleOrders = [] } = useSaleOrders();
  const [filterStatus, setFilterStatus] = usePersistedState<string>('costura-filter-status', 'active');
  // Busca NÃO persiste: reseta ao sair e voltar pra tela (useState remonta limpo).
  const [searchQuery, setSearchQuery] = useState('');
  const [clientFilter, setClientFilter] = useState('all');
  const [weekFilter, setWeekFilter] = useState('all');
  const [finalizing, setFinalizing] = useState(false);
  const { finalizeSectorTask } = useProductionTransitions();

  const sectorBaseOrders = useMemo(() => {
    return orders.filter(order => {
      const status = (order.status || '').toLowerCase();
      if (filterStatus === 'active' && status !== 'em produção') return false;

      const stages = allStages.filter(s => s.order_id === order.id);
      const stage = stages.find(s => sameStage(s.stage_name, SECTOR_NAME));
      if (!stage) return filterStatus === 'all';
      if (filterStatus === 'active' && stage.status !== 'pendente' && stage.status !== 'em_andamento') return false;
      return true;
    }).sort((a, b) => {
      // Prioridade (2026-06-02): terminar o PEDIDO inteiro por PRAZO. Ordena pela
      // entrega do PV (mais urgente primeiro; sem prazo por último), mantém as OPs
      // do mesmo PV juntas, e dentro do PV pela data planejada da OP.
      const dl = (o: any) => saleOrders?.find((s: any) => s.id === o.sale_order_id)?.delivery_deadline || '';
      const da = dl(a), db = dl(b);
      if (da !== db) { if (!da) return 1; if (!db) return -1; return da.localeCompare(db); }
      const sa = String(a.sale_order_id || ''), sb = String(b.sale_order_id || '');
      if (sa !== sb) return sa.localeCompare(sb);
      const pa = (a as any).planned_delivery || '', pb = (b as any).planned_delivery || '';
      if (!pa && !pb) return 0;
      if (!pa) return 1;
      if (!pb) return -1;
      return pa.localeCompare(pb);
    });
  }, [orders, allStages, filterStatus, saleOrders, SECTOR_NAME]);

  const costuraOrders = useMemo(() => {
    return sectorBaseOrders.filter(order => {
      const so = saleOrders.find((s: any) => s.id === order.sale_order_id);
      if (clientFilter !== 'all' && (so?.client_name || '').trim() !== clientFilter) return false;
      if (weekFilter !== 'all' && !matchesDeliveryWeek(so?.delivery_deadline || (order as any).planned_delivery, weekFilter)) {
        return false;
      }
      if (searchQuery.trim()) {
        const ref = references.find(r => r.id === order.reference_id);
        if (!matchesOrderSearch(searchQuery, {
          orderNumber: order.order_number,
          saleOrderNumber: so?.order_number,
          clientName: so?.client_name,
          clientOrderNumber: so?.client_order_number,
          referenceName: ref?.name,
          referenceCode: ref?.code,
          color: order.color,
        })) return false;
      }
      return true;
    });
  }, [sectorBaseOrders, searchQuery, clientFilter, weekFilter, saleOrders, references]);

  const sel = useMarqueeSelection(costuraOrders, (o) => o.id);

  const clientOptions = useMemo(() => {
    const set = new Set<string>();
    for (const order of sectorBaseOrders) {
      const so = saleOrders.find((s: any) => s.id === order.sale_order_id);
      const name = (so?.client_name || '').trim();
      if (name) set.add(name);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [sectorBaseOrders, saleOrders]);

  const pastedCodes = useMemo(() => parseOrderCodeList(searchQuery), [searchQuery]);
  const matchedCodeIds = useMemo(
    () => findIdsMatchingOrderCodes(sectorBaseOrders, pastedCodes, (o) => {
      const so = saleOrders.find((s: any) => s.id === o.sale_order_id);
      return {
        id: o.id,
        orderNumber: o.order_number,
        saleOrderNumber: so?.order_number,
      };
    }),
    [sectorBaseOrders, pastedCodes, saleOrders],
  );

  const allVisibleSelected =
    costuraOrders.length > 0 && costuraOrders.every((o) => sel.isSelected(o.id));

  const toggleVisible = () => {
    if (allVisibleSelected) sel.deselectVisible();
    else sel.selectAll();
  };

  const confirmSelection = (actionLabel: string) =>
    confirmIfHiddenSelection({
      totalSelected: sel.count,
      hiddenSelectedCount: sel.hiddenSelectedCount,
      entityLabel: 'OP',
      actionLabel,
    });

  const handleFinish = async () => {
    if (sel.count === 0) return;
    if (!confirmSelection('Finalizar')) return;
    setFinalizing(true);
    try {
      const ids = Array.from(sel.selectedIds);
      const results = (await Promise.all(
        ids.map(id => finalizeSectorTask(id, SECTOR_NAME))
      )) as any[];
      const ok = results.filter(r => r && r.success).length;
      if (ok > 0) {
        toast.success(`${SECTOR_NAME} finalizado para ${ok} OP(s)!`);
        sel.clear();
        queryClient.invalidateQueries({ queryKey: ['order_stages'] });
        queryClient.invalidateQueries({ queryKey: ['orders'] });
      }
    } catch (err: any) {
      toast.error(`Erro ao finalizar: ${err.message}`);
    } finally {
      setFinalizing(false);
    }
  };

  const totalPairs = costuraOrders.reduce((s, o) => s + (o.quantity || 0), 0);

  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · COSTURA"
        title={`Setor de ${SECTOR_NAME}`}
        description="Costura palmilha + forração e costura do cabedal."
        actions={<>
          <Button
            size="sm"
            onClick={handleFinish}
            disabled={sel.count === 0 || finalizing}
            className="bg-success hover:bg-success/90 text-success-foreground"
          >
            {finalizing ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
            Finalizar OPs selecionadas {sel.count > 0 && `(${sel.count}${sel.hiddenSelectedCount > 0 ? ` · ${sel.hiddenSelectedCount} fora do filtro` : ''})`}
          </Button>
        </>}
      />

      <OrderMultiSelectToolbar
        search={searchQuery}
        onSearchChange={setSearchQuery}
        resultCount={costuraOrders.length}
        totalCount={sectorBaseOrders.length}
        clientOptions={clientOptions}
        clientFilter={clientFilter}
        onClientFilterChange={setClientFilter}
        weekFilter={weekFilter}
        onWeekFilterChange={setWeekFilter}
        allVisibleSelected={allVisibleSelected}
        visibleCount={costuraOrders.length}
        onToggleVisible={toggleVisible}
        matchedCodeCount={matchedCodeIds.length}
        onSelectMatched={() => sel.selectMatchingIds(matchedCodeIds)}
        extraFilters={
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="h-9 w-[140px] text-xs">
              <Filter className="h-3.5 w-3.5 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">OPs Ativas</SelectItem>
              <SelectItem value="all">Todas</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      <StatGrid>
        <StatCard
          label={`OPs p/ ${SECTOR_NAME}`}
          value={costuraOrders.length.toLocaleString('pt-BR')}
          hint="na fila do setor"
          tone="primary"
        />
        <StatCard
          label="Total de pares"
          value={totalPairs.toLocaleString('pt-BR')}
          hint="somatório das OPs"
        />
        {sel.count > 0 && (
          <StatCard
            label="Selecionadas"
            value={sel.count}
            hint={sel.hiddenSelectedCount > 0 ? `${sel.hiddenSelectedCount} fora do filtro` : 'no recorte atual'}
            tone="primary"
          />
        )}
      </StatGrid>

      {costuraOrders.length === 0 ? (
        <Panel flush>
          <EmptyState
            icon={CheckCircle2}
            title={`Nenhuma OP com ${SECTOR_NAME.toLowerCase()} pendente`}
            description="As OPs aparecerão aqui quando o setor estiver configurado na ficha técnica."
          />
        </Panel>
      ) : (
        <div
          ref={sel.containerRef}
          data-marquee-container
          onMouseDown={sel.onContainerMouseDown}
          className="relative space-y-2"
        >
          {costuraOrders.map(order => {
            const ref = references.find(r => r.id === order.reference_id);
            const so = saleOrders.find((s: any) => s.id === order.sale_order_id);
            const stage = allStages.find(s => s.order_id === order.id && sameStage(s.stage_name, SECTOR_NAME));
            const stageColor = stage?.status === 'concluido' ? 'border-l-emerald-500'
              : stage?.status === 'em_andamento' ? 'border-l-amber-500'
              : 'border-l-red-500';
            const isSelected = sel.isSelected(order.id);

            return (
              <Card
                key={order.id}
                data-marquee-item
                data-marquee-id={order.id}
                className={`border-l-4 ${stageColor} ${isSelected ? 'ring-1 ring-success/30' : ''}`}
              >
                <CardHeader className="py-3 px-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => sel.toggle(order.id)}
                      />
                      <div>
                        <CardTitle className="text-sm flex items-center gap-2">
                          <span>{order.order_number}</span>
                          {ref?.code && <RefChip code={ref.code} />}
                          <span className="font-normal text-muted-foreground">{ref?.name}</span>
                        </CardTitle>
                        {so && (
                          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                            <Package className="h-3.5 w-3.5" /> <span className="font-semibold">{so.order_number}</span>
                            {so.client_order_number ? <> | Ped. Cliente: <span className="font-semibold">{so.client_order_number}</span></> : null}
                            {so.client_name ? <> | {so.client_name}</> : null}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Cor: <span className="font-medium text-foreground">{order.color || '—'}</span>
                          {' | '}
                          <span className="font-bold">{order.quantity || 0} pares</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <SectorStageActions stage={stage} orderNumber={order.order_number} />
                      <Badge variant="outline" className="text-xs">{(order.status || '').toString()}</Badge>
                    </div>
                  </div>
                </CardHeader>
              </Card>
            );
          })}
          <MarqueeOverlay rect={sel.marqueeRect} />
        </div>
      )}
    </div>
  );
}
