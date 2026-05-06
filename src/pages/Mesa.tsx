
import { useMemo, useState } from 'react';
import { SignedImage } from '@/components/ui/signed-image';
import { useNavigate } from 'react-router-dom';
import { usePersistedState } from '@/hooks/usePersistedState';
import { Layers, Filter, CheckCircle2, ChevronDown, ChevronRight, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useQueryClient } from '@tanstack/react-query';
import { useOrders } from '@/hooks/useOrders';
import { useTechnicalSheets } from '@/hooks/useTechnicalSheets';
import { useAllOrderStages } from '@/hooks/useOrderStages';
import { useSaleOrders } from '@/hooks/useSaleOrders';
import { useProductionTransitions } from '@/hooks/useProductionTransitions';
import { toast } from 'sonner';
import OrderSearchBar from '@/components/production/OrderSearchBar';
import { useOrderStraps } from '@/hooks/useOrderStraps';

const SECTOR_NAME = 'Mesa';
const SECTOR_EMOJI = '📐';

export default function Mesa() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: orders = [] } = useOrders();
  const { data: references = [] } = useTechnicalSheets();
  const orderIds = useMemo(() => orders.map(o => o.id), [orders]);
  const { data: allStages = [] } = useAllOrderStages(orderIds.length > 0 ? orderIds : undefined);
  const { data: saleOrders = [] } = useSaleOrders();
  const { getStrapsLabel } = useOrderStraps();
  const [filterStatus, setFilterStatus] = usePersistedState<string>('mesa-filterStatus', 'active');
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [finalizingOrders, setFinalizingOrders] = useState(false);
  const { finalizeSectorTask } = useProductionTransitions();
  const [collapsedSaleOrders, setCollapsedSaleOrders] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = usePersistedState('mesa-searchQuery', '');

  const toggleOrderSelection = (orderId: string) => {
    setSelectedOrders(prev => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const toggleAllOrders = () => {
    if (selectedOrders.size === mesaOrders.length) {
      setSelectedOrders(new Set());
    } else {
      setSelectedOrders(new Set(mesaOrders.map(o => o.id)));
    }
  };

  const handleFinishSelectedOrders = async () => {
    if (selectedOrders.size === 0) return;
    setFinalizingOrders(true);
    try {
      const ids = Array.from(selectedOrders);
      const settled = await Promise.allSettled(
        ids.map(id => finalizeSectorTask(id, SECTOR_NAME))
      );
      const successCount = settled.filter(
        s => s.status === 'fulfilled' && (s.value as any)?.success
      ).length;
      const failedCount = ids.length - successCount;
      if (successCount > 0) {
        if (failedCount === 0) toast.success(`${SECTOR_NAME} finalizado para ${successCount} OP(s)!`);
        else toast.warning(`${SECTOR_NAME} finalizado para ${successCount} OP(s); ${failedCount} falhou(aram).`);
        setSelectedOrders(new Set());
        queryClient.invalidateQueries({ queryKey: ['order_stages'] });
        queryClient.invalidateQueries({ queryKey: ['orders'] });
        queryClient.invalidateQueries({ queryKey: ['production_orders'] });
      } else if (failedCount > 0) {
        toast.error(`Falha ao finalizar ${failedCount} OP(s).`);
      }
    } catch (err: any) {
      toast.error(`Erro ao finalizar: ${err.message}`);
    } finally {
      setFinalizingOrders(false);
    }
  };

  const mesaOrders = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const filtered = orders.filter(order => {
      const status = (order.status || '').toLowerCase().normalize('NFC');
      if (filterStatus === 'active' && status !== 'em produção') return false;

      const stages = allStages.filter(s => s.order_id === order.id);
      const stage = stages.find(s => s.stage_name === SECTOR_NAME);
      if (!stage) return filterStatus === 'all';
      if (filterStatus === 'active' && stage.status !== 'pendente' && stage.status !== 'em_andamento') return false;

      if (q) {
        const so = saleOrders.find((s: any) => s.id === order.sale_order_id);
        const pvNumber = (so?.order_number || '').toLowerCase();
        const clientOrderNum = (so?.client_order_number || '').toLowerCase();
        const opNumber = (order.order_number || '').toLowerCase();
        const clientName = (so?.client_name || '').toLowerCase();
        if (!pvNumber.includes(q) && !clientOrderNum.includes(q) && !opNumber.includes(q) && !clientName.includes(q)) return false;
      }

      return true;
    });
    return filtered.sort((a, b) => {
      const da = (a as any).planned_delivery;
      const db = (b as any).planned_delivery;
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da.localeCompare(db);
    });
  }, [orders, allStages, filterStatus, searchQuery, saleOrders]);

  // Group by sale order
  const groupedBySaleOrder = useMemo(() => {
    const map = new Map<string, { so: any; orders: typeof mesaOrders }>();
    for (const order of mesaOrders) {
      const soId = order.sale_order_id || '__orphan__';
      if (!map.has(soId)) {
        const so = saleOrders.find((s: any) => s.id === soId);
        map.set(soId, { so, orders: [] });
      }
      map.get(soId)!.orders.push(order);
    }
    return Array.from(map.entries()).sort(([, a], [, b]) => {
      const nameA = a.so?.client_name || '';
      const nameB = b.so?.client_name || '';
      return nameA.localeCompare(nameB, 'pt-BR');
    });
  }, [mesaOrders, saleOrders]);

  return (
    <div className="space-y-5 page-enter">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            {SECTOR_EMOJI}
            Setor de {SECTOR_NAME}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Preparação de mesa — montagem de formas e materiais por OP
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedOrders.size > 0 && (
            <Button size="sm" variant="outline" onClick={() => {
              const ids = mesaOrders.filter(o => selectedOrders.has(o.id)).map(o => o.id).join(',');
              navigate(`/orders/grouped-summary?sector=mesa&ids=${ids}`);
            }}>
              <Layers className="h-3.5 w-3.5 mr-1" /> Agrupar ({selectedOrders.size})
            </Button>
          )}
          {selectedOrders.size > 0 && (
            <Button
              size="sm"
              variant="default"
              disabled={finalizingOrders}
              onClick={handleFinishSelectedOrders}
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
              Finalizar {SECTOR_NAME} ({selectedOrders.size})
            </Button>
          )}
          <Button
            size="sm"
            variant={selectedOrders.size === mesaOrders.length && mesaOrders.length > 0 ? 'default' : 'outline'}
            onClick={toggleAllOrders}
            disabled={mesaOrders.length === 0}
          >
            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
            {selectedOrders.size === mesaOrders.length && mesaOrders.length > 0 ? 'Desmarcar' : `Selecionar (${mesaOrders.length})`}
          </Button>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-32 h-8 text-xs">
              <Filter className="h-3 w-3 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Ativas</SelectItem>
              <SelectItem value="all">Todas</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <OrderSearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Buscar por PV, OP, cliente..." />

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Badge variant="outline">{mesaOrders.length} OPs</Badge>
        <Badge variant="outline">{mesaOrders.reduce((s, o) => s + (o.quantity || 0), 0)} pares</Badge>
        {selectedOrders.size > 0 && (
          <Badge variant="secondary">{selectedOrders.size} selecionadas</Badge>
        )}
      </div>

      {groupedBySaleOrder.map(([soId, group]) => {
        const isSoCollapsed = collapsedSaleOrders.has(soId);
        const soTotalPairs = group.orders.reduce((s, o) => s + (o.quantity || 0), 0);
        const pvLabel = group.so?.order_number || 'Sem PV';
        const clientLabel = group.so?.client_name || '';

        return (
          <div key={soId} className="space-y-1">
            <button
              onClick={() => setCollapsedSaleOrders(prev => {
                const next = new Set(prev);
                if (next.has(soId)) next.delete(soId);
                else next.add(soId);
                return next;
              })}
              className="flex items-center gap-2 w-full text-left py-1 px-2 rounded hover:bg-muted/30 transition-colors"
            >
              {isSoCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              <Store className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium">{pvLabel}</span>
              {clientLabel && <span className="text-xs text-muted-foreground">— {clientLabel}</span>}
              <Badge variant="outline" className="ml-auto text-[10px]">{group.orders.length} OPs — {soTotalPairs} pares</Badge>
            </button>

            {!isSoCollapsed && (
              <div className="ml-4 space-y-1.5">
                {group.orders.map(order => {
                  const ref = references.find(r => r.id === order.reference_id);
                  const grade = order.grade as Record<string, number> | null;
                  const gradeSum = grade ? Object.values(grade).reduce((s, v) => s + Number(v), 0) : 0;
                  const totalPairs = order.quantity || gradeSum || 0;
                  const stages = allStages.filter(s => s.order_id === order.id);
                  const stage = stages.find(s => s.stage_name === SECTOR_NAME);
                  const stageStatus = stage?.status || 'pendente';
                  const strapsLabel = getStrapsLabel(order);
                  const images = ref?.images as string[] | null;
                  const imageUrl = images?.[0] || ref?.image_url || '';

                  return (
                    <Card key={order.id} className={`border ${stageStatus === 'concluido' ? 'opacity-60 bg-muted/20' : ''}`}>
                      <CardContent className="p-3">
                        <div className="flex items-center gap-3">
                          <Checkbox
                            checked={selectedOrders.has(order.id)}
                            onCheckedChange={() => toggleOrderSelection(order.id)}
                          />
                          {imageUrl && (
                            <SignedImage src={imageUrl} alt={ref?.name || ''} className="w-12 h-12 rounded object-contain border" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-xs font-bold">{order.order_number}</span>
                              <Badge variant="outline" className="text-[10px]">{ref?.code || ''}</Badge>
                              <Badge variant="secondary" className="text-[10px]">{order.color || '—'}</Badge>
                              {strapsLabel && <Badge variant="outline" className="text-[10px]">🔗 {strapsLabel}</Badge>}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {ref?.name || ''} — {totalPairs} pares
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Badge
                              variant={stageStatus === 'concluido' ? 'default' : stageStatus === 'em_andamento' ? 'secondary' : 'outline'}
                              className="text-[10px]"
                            >
                              {stageStatus === 'concluido' ? '✅ Concluído' : stageStatus === 'em_andamento' ? '🔄 Em andamento' : '⏳ Pendente'}
                            </Badge>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {mesaOrders.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <span className="text-4xl mb-3 block">{SECTOR_EMOJI}</span>
            <p className="text-lg font-medium">Nenhuma OP pendente de {SECTOR_NAME}</p>
            <p className="text-sm">As OPs aparecerão aqui quando tiverem o setor de {SECTOR_NAME} configurado na ficha técnica.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
