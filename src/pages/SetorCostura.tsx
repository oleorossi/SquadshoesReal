import { useMemo, useState } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { Filter, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

const SECTOR_NAME = 'Costura';
const SECTOR_EMOJI = '🪡';

/**
 * Página do setor de Costura — costura palmilha+forração + costura cabedal.
 *
 * Layout enxuto. O nome do arquivo é SetorCostura.tsx (não Costura.tsx)
 * porque já existe um Costura.tsx legado representando "Corte Forração"
 * (nomenclatura interna pré-rename de 2026-05-06).
 *
 * O visual A4 da ficha de operador será polido em PR seguinte.
 */
export default function SetorCostura() {
  const queryClient = useQueryClient();
  const { data: orders = [] } = useOrders();
  const { data: references = [] } = useTechnicalSheets();
  const orderIds = useMemo(() => orders.map(o => o.id), [orders]);
  const { data: allStages = [] } = useAllOrderStages(orderIds.length > 0 ? orderIds : undefined);
  const { data: saleOrders = [] } = useSaleOrders();
  const [filterStatus, setFilterStatus] = usePersistedState<string>('costura-filter-status', 'active');
  const [searchQuery, setSearchQuery] = usePersistedState('costura-search', '');
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [finalizing, setFinalizing] = useState(false);
  const { finalizeSectorTask } = useProductionTransitions();

  const costuraOrders = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return orders.filter(order => {
      const status = (order.status || '').toLowerCase();
      if (filterStatus === 'active' && status !== 'em produção') return false;

      const stages = allStages.filter(s => s.order_id === order.id);
      const stage = stages.find(s => s.stage_name === SECTOR_NAME);
      if (!stage) return filterStatus === 'all';
      if (filterStatus === 'active' && stage.status !== 'pendente' && stage.status !== 'em_andamento') return false;

      if (q) {
        const so = saleOrders.find((s: any) => s.id === order.sale_order_id);
        const text = [
          so?.order_number, so?.client_order_number, order.order_number, so?.client_name,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => {
      const da = (a as any).planned_delivery;
      const db = (b as any).planned_delivery;
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da.localeCompare(db);
    });
  }, [orders, allStages, filterStatus, searchQuery, saleOrders]);

  const toggleOrder = (id: string) => {
    setSelectedOrders(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedOrders.size === costuraOrders.length) setSelectedOrders(new Set());
    else setSelectedOrders(new Set(costuraOrders.map(o => o.id)));
  };

  const handleFinish = async () => {
    if (selectedOrders.size === 0) return;
    setFinalizing(true);
    try {
      const ids = Array.from(selectedOrders);
      const results = (await Promise.all(
        ids.map(id => finalizeSectorTask(id, SECTOR_NAME))
      )) as any[];
      const ok = results.filter(r => r && r.success).length;
      if (ok > 0) {
        toast.success(`${SECTOR_NAME} finalizado para ${ok} OP(s)!`);
        setSelectedOrders(new Set());
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
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            {SECTOR_EMOJI} Setor de {SECTOR_NAME}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Costura palmilha + forração e costura do cabedal.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleFinish}
            disabled={selectedOrders.size === 0 || finalizing}
            className="bg-success hover:bg-success/90 text-success-foreground"
          >
            {finalizing ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
            Finalizar OPs selecionadas {selectedOrders.size > 0 && `(${selectedOrders.size})`}
          </Button>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[140px] h-9 text-xs">
              <Filter className="h-3.5 w-3.5 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">OPs Ativas</SelectItem>
              <SelectItem value="all">Todas</SelectItem>
            </SelectContent>
          </Select>
          <OrderSearchBar value={searchQuery} onChange={setSearchQuery} />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-primary">{costuraOrders.length}</p>
            <p className="text-xs text-muted-foreground">OPs p/ {SECTOR_NAME}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{totalPairs}</p>
            <p className="text-xs text-muted-foreground">Total de Pares</p>
          </CardContent>
        </Card>
      </div>

      {costuraOrders.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          Nenhuma OP com {SECTOR_NAME.toLowerCase()} pendente.
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <Button size="sm" variant={selectedOrders.size === costuraOrders.length ? 'default' : 'outline'} onClick={toggleAll}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
              {selectedOrders.size === costuraOrders.length ? 'Desmarcar Tudo' : 'Selecionar Tudo'}
            </Button>
            {selectedOrders.size > 0 && (
              <span className="text-xs text-muted-foreground">
                {selectedOrders.size} de {costuraOrders.length} selecionadas
              </span>
            )}
          </div>

          {costuraOrders.map(order => {
            const ref = references.find(r => r.id === order.reference_id);
            const so = saleOrders.find((s: any) => s.id === order.sale_order_id);
            const stage = allStages.find(s => s.order_id === order.id && s.stage_name === SECTOR_NAME);
            const stageColor = stage?.status === 'concluido' ? 'border-l-emerald-500'
              : stage?.status === 'em_andamento' ? 'border-l-amber-500'
              : 'border-l-red-500';
            const isSelected = selectedOrders.has(order.id);

            return (
              <Card key={order.id} className={`border-l-4 ${stageColor} ${isSelected ? 'ring-1 ring-success/30' : ''}`}>
                <CardHeader className="py-3 px-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleOrder(order.id)}
                      />
                      <div>
                        <CardTitle className="text-sm">
                          {order.order_number} — {ref?.code} {ref?.name}
                        </CardTitle>
                        {so && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            📦 <span className="font-semibold">{so.order_number}</span>
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
                    <Badge variant="outline" className="text-xs">{(order.status || '').toString()}</Badge>
                  </div>
                </CardHeader>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
