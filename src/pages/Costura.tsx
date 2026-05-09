
import { useMemo, useState } from 'react';
import { SignedImage } from '@/components/ui/signed-image';
import { useNavigate } from 'react-router-dom';
import { usePersistedState } from '@/hooks/usePersistedState';
import { Printer, Filter, CheckCircle2, ChevronDown, ChevronRight, Store, Building2, Layers, Scissors } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useQueryClient } from '@tanstack/react-query';
import { useOrders } from '@/hooks/useOrders';
import { useTechnicalSheets } from '@/hooks/useTechnicalSheets';
import { useAllOrderStages } from '@/hooks/useOrderStages';
import { useSaleOrders } from '@/hooks/useSaleOrders';
import { useClients, useEconomicGroups } from '@/hooks/useClients';
import { useProductionTransitions } from '@/hooks/useProductionTransitions';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { printHtml, openPrintWindow, writePrintWindow } from '@/lib/printOrder';
import { getClientLogoUrl } from '@/lib/getClientLogo';
import OrderSearchBar from '@/components/production/OrderSearchBar';
import { useOrderStraps } from '@/hooks/useOrderStraps';

const SIZES = ['17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33','34','35','36','37','38','39','40','41','42','43','44','45'];

const SECTOR_NAME = 'Corte Forração';
const SECTOR_EMOJI = '🧵';

export default function Costura() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: orders = [] } = useOrders();
  const { data: references = [] } = useTechnicalSheets();
  const orderIds = useMemo(() => orders.map(o => o.id), [orders]);
  const { data: allStages = [] } = useAllOrderStages(orderIds.length > 0 ? orderIds : undefined);
  const { data: saleOrders = [] } = useSaleOrders();
  const { data: clients = [] } = useClients();
  const { data: economicGroups = [] } = useEconomicGroups();
  const { getStrapsLabel } = useOrderStraps();
  const [filterStatus, setFilterStatus] = usePersistedState<string>('costura-filterStatus', 'active');
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [finalizingOrders, setFinalizingOrders] = useState(false);
  const { finalizeSectorTask } = useProductionTransitions();

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [collapsedSaleOrders, setCollapsedSaleOrders] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = usePersistedState('costura-searchQuery', '');

  const toggleCollapse = (key: string, setter: React.Dispatch<React.SetStateAction<Set<string>>>) => {
    setter(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleOrderSelection = (orderId: string) => {
    setSelectedOrders(prev => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const toggleAllOrders = () => {
    if (selectedOrders.size === costuraOrders.length) {
      setSelectedOrders(new Set());
    } else {
      setSelectedOrders(new Set(costuraOrders.map(o => o.id)));
    }
  };

  const handleFinishSelectedOrders = async () => {
    if (selectedOrders.size === 0) return;
    setFinalizingOrders(true);
    try {
      const orderIds = Array.from(selectedOrders);
      const settled = await Promise.allSettled(
        orderIds.map(orderId => finalizeSectorTask(orderId, SECTOR_NAME))
      );
      const successCount = settled.filter(
        s => s.status === 'fulfilled' && (s.value as any)?.success
      ).length;
      const failedCount = orderIds.length - successCount;
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

  const costuraOrders = useMemo(() => {
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

  const getDeliveryInfo = (order: any) => {
    const so = saleOrders.find((s: any) => s.id === order.sale_order_id);
    const deadline = so?.delivery_deadline;
    if (!deadline) return { deadline: null, isAdiantado: false };
    const deadlineDate = new Date(deadline);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((deadlineDate.getTime() - today.getTime()) / 86400000);
    return { deadline, isAdiantado: diffDays > 7, deadlineFormatted: new Date(deadline).toLocaleDateString('pt-BR') };
  };

  // Group by sale order → economic group
  const groupedBySaleOrder = useMemo(() => {
    const map = new Map<string, { so: any; orders: typeof costuraOrders; client: any; economicGroup: any }>();
    for (const order of costuraOrders) {
      const soId = order.sale_order_id || '__orphan__';
      if (!map.has(soId)) {
        const so = saleOrders.find((s: any) => s.id === soId);
        const client = clients.find((c: any) => c.id === so?.client_id);
        const economicGroup = client?.economic_group_id
          ? economicGroups.find((eg: any) => eg.id === client.economic_group_id)
          : null;
        map.set(soId, { so, orders: [], client, economicGroup });
      }
      map.get(soId)!.orders.push(order);
    }
    return Array.from(map.entries()).sort(([, a], [, b]) => {
      const nameA = a.economicGroup?.name || a.client?.razao_social || '';
      const nameB = b.economicGroup?.name || b.client?.razao_social || '';
      return nameA.localeCompare(nameB, 'pt-BR');
    });
  }, [costuraOrders, saleOrders, clients, economicGroups]);

  // Group by economic group
  const groupedByEconomicGroup = useMemo(() => {
    const map = new Map<string, { name: string; entries: typeof groupedBySaleOrder }>();
    for (const entry of groupedBySaleOrder) {
      const egName = entry[1].economicGroup?.name || entry[1].client?.razao_social || 'Sem Grupo';
      if (!map.has(egName)) map.set(egName, { name: egName, entries: [] });
      map.get(egName)!.entries.push(entry);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [groupedBySaleOrder]);

  const handlePrintOrder = async (order: any) => {
    const ref = references.find(r => r.id === order.reference_id);
    const grade = order.grade as Record<string, number> | null;
    const activeSizes = SIZES.filter(s => grade && Number(grade[s]) > 0);
    const gradeSum = grade ? Object.values(grade).reduce((s, v) => s + Number(v), 0) : 0;
    const totalPairs = order.quantity || gradeSum || 0;
    const pairsPerFicha = gradeSum || 12;
    const totalFichas = Math.ceil(totalPairs / pairsPerFicha);

    let imageUrl = '';
    if (ref) {
      const images = ref.images as string[] | null;
      if (images && images.length > 0) imageUrl = images[0];
      else if (ref.image_url) imageUrl = ref.image_url;
    }

    const silkLogoUrl = await getClientLogoUrl(order);

    const imageHtml = imageUrl
      ? `<img src="${imageUrl}" style="width:200px;height:200px;object-fit:contain;border:1px solid #ddd;border-radius:6px;" />`
      : `<div style="width:200px;height:200px;background:#f0f0f0;border:1px solid #ddd;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#999;font-size:10px;">Sem foto</div>`;

    const silkHtml = silkLogoUrl
      ? `<img src="${silkLogoUrl}" style="width:100px;height:100px;object-fit:contain;" />`
      : '';

    const showScaledRow = totalPairs !== gradeSum;
    let gradeHtml = '';
    if (grade && activeSizes.length > 0) {
      gradeHtml = `<table style="border-collapse:collapse;margin-top:8px;width:100%;">
        <tr style="background:#1a1a1a;color:#fff;">
          <th style="border:1px solid #555;padding:3px 6px;font-size:9px;text-align:center;">Nº</th>
          ${activeSizes.map(s => `<th style="border:1px solid #555;padding:3px 8px;font-size:11px;text-align:center;">${s}</th>`).join('')}
          <th style="border:1px solid #555;padding:3px 8px;font-size:11px;text-align:center;background:#333;">TOTAL</th>
        </tr>
        <tr style="background:#f9f9f0;">
          <td style="border:1px solid #999;padding:3px 6px;font-size:8px;font-weight:700;text-align:center;color:#666;">Grade (${gradeSum}p)</td>
          ${activeSizes.map(s => `<td style="border:1px solid #999;padding:3px 8px;font-size:12px;text-align:center;font-family:monospace;font-weight:700;">${Number(grade[s]) || 0}</td>`).join('')}
          <td style="border:1px solid #999;padding:3px 8px;font-size:12px;text-align:center;font-family:monospace;font-weight:700;background:#f0f0e8;">${gradeSum}</td>
        </tr>
        ${showScaledRow ? `<tr>
          <td style="border:1px solid #999;padding:3px 6px;font-size:8px;font-weight:700;text-align:center;color:#333;background:#e8e8d8;">Total (${totalPairs}p)</td>
          ${activeSizes.map(s => {
            const scaled = Math.round((Number(grade[s]) || 0) * (totalPairs / gradeSum));
            return `<td style="border:1px solid #999;padding:4px 8px;font-size:14px;text-align:center;font-family:monospace;font-weight:900;">${scaled}</td>`;
          }).join('')}
          <td style="border:1px solid #999;padding:4px 8px;font-size:16px;text-align:center;font-family:monospace;font-weight:900;background:#f0f0e8;">${totalPairs}</td>
        </tr>` : ''}
      </table>`;
    }

    const squaresHtml = Array.from({ length: totalFichas }, (_, i) =>
      `<div style="width:44px;height:44px;border:2px solid #333;border-radius:3px;display:inline-flex;align-items:center;justify-content:center;font-size:14px;color:#cc0000;margin:2px;font-weight:700;font-family:'JetBrains Mono',monospace;">${i + 1}</div>`
    ).join('');

    const html = `
      <div style="display:flex;gap:16px;align-items:flex-start;margin-bottom:16px;">
        ${imageHtml}
        <div style="flex:1;">
          <h1 style="font-size:16px;margin-bottom:2px;">${SECTOR_EMOJI} Ficha de ${SECTOR_NAME}</h1>
          <p style="font-size:12px;margin-bottom:8px;"><strong>OP:</strong> ${order.order_number}</p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 16px;font-size:11px;">
            <div><strong>Referência:</strong> ${ref?.code || ''} — ${ref?.name || ''}</div>
            <div><strong>Cor:</strong> ${order.color || '—'}</div>
            <div><strong>Quantidade:</strong> ${totalPairs} pares</div>
            <div><strong>Status:</strong> ${order.status}</div>
          </div>
          ${gradeHtml}
        </div>
        <div style="text-align:center;">
          <p style="font-size:8px;color:#999;margin-bottom:2px;">SILK</p>
          ${silkHtml}
        </div>
      </div>
      <h2 style="font-size:13px;margin:16px 0 8px;border-bottom:1px solid #ccc;padding-bottom:3px;">
        Controle de ${SECTOR_NAME} — ${totalFichas} fichas (${totalPairs} pares | ${pairsPerFicha} pares/ficha)
      </h2>
      <p style="font-size:9px;color:#666;margin-bottom:8px;">Marque cada quadrado conforme concluir a ficha de ${pairsPerFicha} pares.</p>
      <div style="display:flex;flex-wrap:wrap;gap:0;">
        ${squaresHtml}
      </div>
    `;

    printHtml(`${SECTOR_NAME} - ${order.order_number}`, html);
  };

  return (
    <div className="space-y-5 page-enter">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="display text-xl tracking-tight flex items-center gap-2">
            {SECTOR_EMOJI}
            Setor de {SECTOR_NAME}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Fichas de controle com checklist de pares para costura
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedOrders.size > 0 && (
            <Button size="sm" variant="outline" onClick={() => {
              const ids = costuraOrders.filter(o => selectedOrders.has(o.id)).map(o => o.id).join(',');
              navigate(`/orders/grouped-summary?sector=costura&ids=${ids}`);
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
        <Badge variant="outline">{costuraOrders.length} OPs</Badge>
        <Badge variant="outline">{costuraOrders.reduce((s, o) => s + (o.quantity || 0), 0)} pares</Badge>
        {selectedOrders.size > 0 && (
          <Badge variant="secondary">{selectedOrders.size} selecionadas</Badge>
        )}
      </div>

      {groupedByEconomicGroup.map((eg) => {
        const isGroupCollapsed = collapsedGroups.has(eg.name);
        const groupTotalPairs = eg.entries.reduce((s, [, g]) => s + g.orders.reduce((s2, o) => s2 + (o.quantity || 0), 0), 0);
        const groupTotalOps = eg.entries.reduce((s, [, g]) => s + g.orders.length, 0);

        return (
          <div key={eg.name} className="space-y-2">
            <button
              onClick={() => toggleCollapse(eg.name, setCollapsedGroups)}
              className="flex items-center gap-2 w-full text-left py-1.5 px-2 rounded-lg hover:bg-muted/50 transition-colors"
            >
              {isGroupCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <span className="font-semibold text-sm">{eg.name}</span>
              <Badge variant="outline" className="ml-auto text-[10px]">{groupTotalOps} OPs — {groupTotalPairs} pares</Badge>
            </button>

            {!isGroupCollapsed && eg.entries.map(([soId, group]) => {
              const isSoCollapsed = collapsedSaleOrders.has(soId);
              const soTotalPairs = group.orders.reduce((s, o) => s + (o.quantity || 0), 0);
              const pvLabel = group.so?.order_number || 'Sem PV';
              const clientLabel = group.client?.razao_social || '';

              return (
                <div key={soId} className="ml-4 space-y-1">
                  <button
                    onClick={() => toggleCollapse(soId, setCollapsedSaleOrders)}
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
                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handlePrintOrder(order)} aria-label={`Imprimir OP ${order.order_number}`}>
                                    <Printer className="h-3.5 w-3.5" />
                                  </Button>
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
          </div>
        );
      })}

      {costuraOrders.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Scissors className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="text-lg font-medium">Nenhuma OP pendente de {SECTOR_NAME}</p>
            <p className="text-sm">As OPs aparecerão aqui quando tiverem o setor de {SECTOR_NAME} configurado na ficha técnica.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
