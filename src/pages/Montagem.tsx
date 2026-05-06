import { useMemo, useState } from 'react';
import { SignedImage } from '@/components/ui/signed-image';
import { useNavigate } from 'react-router-dom';
import { usePersistedState } from '@/hooks/usePersistedState';
import { Wrench, Printer, Filter, CheckSquare, Layers } from 'lucide-react';
import { WorkSheetSettingsButton } from '@/components/production/WorkSheetSettingsDialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useOrders } from '@/hooks/useOrders';
import { useTechnicalSheets } from '@/hooks/useTechnicalSheets';
import { useAllOrderStages } from '@/hooks/useOrderStages';
import { useSaleOrders } from '@/hooks/useSaleOrders';
import { useProductionTransitions } from '@/hooks/useProductionTransitions';
import { supabase } from '@/integrations/supabase/client';
import { printHtml } from '@/lib/printOrder';
import { printSectorWorkSheets } from '@/lib/printSectorWorkSheet';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import OrderSearchBar from '@/components/production/OrderSearchBar';
import { useOrderStraps } from '@/hooks/useOrderStraps';

const SIZES = ['17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33','34','35','36','37','38','39','40','41','42','43','44','45'];

const STAGE_NAME = 'Montagem';

export default function Montagem() {
  const navigate = useNavigate();
  const { data: orders = [] } = useOrders();
  const { data: references = [] } = useTechnicalSheets();
  const orderIds = useMemo(() => orders.map(o => o.id), [orders]);
  const { data: allStages = [] } = useAllOrderStages(orderIds.length > 0 ? orderIds : undefined);
  const { data: saleOrders = [] } = useSaleOrders();
  const queryClient = useQueryClient();
  const { getStrapsLabel } = useOrderStraps();
  const [filterStatus, setFilterStatus] = usePersistedState<string>('montagem_filterStatus', 'active');
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [finalizingOrders, setFinalizingOrders] = useState(false);
  const { finalizeSectorTask } = useProductionTransitions();
  const [searchQuery, setSearchQuery] = usePersistedState('montagem_searchQuery', '');


  const toggleOrder = (id: string) => {
    setSelectedOrders(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const montagemOrders = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const filtered = orders.filter(order => {
      const status = (order.status || '').toLowerCase().normalize('NFC');
      if (status === 'finalizado' || status === 'cancelada') return false;
      if (order.sale_order_id) {
        const so = saleOrders.find((s: any) => s.id === order.sale_order_id);
        if (so && (so.status === 'Faturado' || so.status === 'Cancelado')) return false;
      }
      // Status filter - only filter if "active" is selected
      if (filterStatus === 'active' && status !== 'em produção') return false;
      
      const stages = allStages.filter(s => s.order_id === order.id);
      const stage = stages.find(s => s.stage_name === STAGE_NAME);
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

  const toggleAll = () => {
    if (selectedOrders.size === montagemOrders.length) {
      setSelectedOrders(new Set());
    } else {
      setSelectedOrders(new Set(montagemOrders.map(o => o.id)));
    }
  };

  const handleFinishSelectedOrders = async () => {
    if (selectedOrders.size === 0) return;
    setFinalizingOrders(true);
    try {
      const orderIds = Array.from(selectedOrders);
      
      const settled = await Promise.allSettled(
        orderIds.map(orderId => finalizeSectorTask(orderId, 'Montagem'))
      );
      const successCount = settled.filter(
        s => s.status === 'fulfilled' && (s.value as any)?.success
      ).length;
      const failedCount = orderIds.length - successCount;

      if (successCount > 0) {
        if (failedCount === 0) toast.success(`Montagem finalizada para ${successCount} OP(s)!`);
        else toast.warning(`Montagem finalizada para ${successCount} OP(s); ${failedCount} falhou(aram).`);
        setSelectedOrders(new Set());
        queryClient.invalidateQueries({ queryKey: ['order_stages'] });
        queryClient.invalidateQueries({ queryKey: ['orders'] });
        queryClient.invalidateQueries({ queryKey: ['production_orders'] });
      } else if (failedCount > 0) {
        toast.error(`Falha ao finalizar ${failedCount} OP(s).`);
      }
    } catch (err: any) {
      toast.error('Erro ao finalizar: ' + (err.message || 'Erro desconhecido'));
    } finally {
      setFinalizingOrders(false);
    }
  };


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

  const buildPrintContent = (order: any) => {
    const ref = references.find(r => r.id === order.reference_id);
    const grade = order.grade as Record<string, number> | null;
    const activeSizes = SIZES.filter(s => grade && Number(grade[s]) > 0);
    const gradeSum = grade ? Object.values(grade).reduce((s, v) => s + Number(v), 0) : 0;
    const totalPairs = order.quantity || gradeSum || 0;
    const fichas = gradeSum > 0 ? totalPairs / gradeSum : 1;
    const pairsPerFicha = gradeSum || 12;
    const totalFichas = Math.ceil(fichas);

    let imageUrl = '';
    if (ref) {
      const images = ref.images as string[] | null;
      if (images && images.length > 0) imageUrl = images[0];
      else if (ref.image_url) imageUrl = ref.image_url;
    }

    return { ref, grade, activeSizes, gradeSum, totalPairs, pairsPerFicha, totalFichas, fichas, imageUrl };
  };

  const handlePrintOrder = async (order: any) => {
    let { ref, grade, activeSizes, totalPairs, imageUrl } = buildPrintContent(order);

    if (!imageUrl && ref) {
      const { data: prodRef } = await supabase
        .from('product_references')
        .select('image_url')
        .eq('technical_sheet_id', ref.id)
        .maybeSingle();
      if (prodRef?.image_url) imageUrl = prodRef.image_url;
    }

    const imageHtml = imageUrl
      ? `<img src="${imageUrl}" style="width:200px;height:200px;object-fit:contain;border:1px solid #ddd;border-radius:6px;" />`
      : `<div style="width:200px;height:200px;background:#f0f0f0;border:1px solid #ddd;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#999;font-size:10px;">Sem foto</div>`;

    let gradeHtml = '';
    if (grade && activeSizes.length > 0) {
      gradeHtml = `<table style="border-collapse:collapse;margin-top:8px;">
        <tr style="background:#e8e8d0;">
          ${activeSizes.map(s => `<th style="border:1px solid #999;padding:3px 8px;font-size:11px;text-align:center;">${s}</th>`).join('')}
          <th style="border:1px solid #999;padding:3px 8px;font-size:11px;text-align:center;background:#e0e0c8;">Total</th>
        </tr>
        <tr>
          ${activeSizes.map(s => `<td style="border:1px solid #999;padding:3px 8px;font-size:12px;text-align:center;font-family:monospace;font-weight:700;">${Number(grade[s]) || 0}</td>`).join('')}
          <td style="border:1px solid #999;padding:3px 8px;font-size:12px;text-align:center;font-family:monospace;font-weight:700;background:#f5f5f0;">${totalPairs}</td>
        </tr>
      </table>`;
    }

    const so = saleOrders.find((s: any) => s.id === order.sale_order_id);

    const html = `
      <div style="display:flex;gap:16px;align-items:flex-start;margin-bottom:16px;">
        ${imageHtml}
        <div style="flex:1;">
          <h1 style="font-size:16px;margin-bottom:2px;">🔧 Ficha de Montagem</h1>
          <p style="font-size:12px;margin-bottom:8px;"><strong>OP:</strong> ${order.order_number}</p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 16px;font-size:11px;">
            <div><strong>Referência:</strong> ${ref?.code || ''} — ${ref?.name || ''}</div>
            <div><strong>Cor:</strong> ${order.color || '—'}</div>
            <div><strong>Quantidade:</strong> ${totalPairs} pares</div>
            <div><strong>Status:</strong> ${order.status}</div>
            ${so ? `<div><strong>PV:</strong> ${so.order_number || '—'}</div>` : ''}
            ${so ? `<div><strong>Cliente:</strong> ${so.client_name || '—'}</div>` : ''}
          </div>
          ${gradeHtml}
        </div>
      </div>
    `;

    printHtml(`Montagem - ${order.order_number}`, html);
  };

  return (
    <div className="space-y-5 page-enter">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Wrench className="h-6 w-6 text-primary" />
            Setor de Montagem
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gestão e controle das ordens de produção na etapa de montagem
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {selectedOrders.size > 0 && (
            <>
              <Button
                size="sm"
                variant="default"
                className="bg-success hover:bg-success/90 text-success-foreground"
                disabled={finalizingOrders}
                onClick={handleFinishSelectedOrders}
              >
                <CheckSquare className="h-3.5 w-3.5 mr-1" />
                Finalizar OP's selecionadas ({selectedOrders.size})
              </Button>
              <Button size="sm" variant="outline" onClick={() => {
                const ids = montagemOrders.filter(o => selectedOrders.has(o.id)).map(o => o.id).join(',');
                navigate(`/orders/grouped-summary?sector=montagem&ids=${ids}`);
              }}>
                <Layers className="h-3.5 w-3.5 mr-1" /> Agrupar ({selectedOrders.size})
              </Button>
            </>
          )}
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
          <WorkSheetSettingsButton />
          <Button size="sm" variant="outline" disabled={selectedOrders.size === 0} onClick={() => {
            const ordersToPrint = montagemOrders.filter(o => selectedOrders.has(o.id));
            printSectorWorkSheets({
              sectorName: 'Montagem',
              sectorEmoji: '🔧',
              orders: ordersToPrint as any,
              references: references as any,
              saleOrders: saleOrders as any,
              getStrapsLabel,
            });
          }}>
            <Printer className="h-3.5 w-3.5 mr-1" /> Fichas Operador {selectedOrders.size > 0 ? `(${selectedOrders.size})` : ''}
          </Button>
          <OrderSearchBar value={searchQuery} onChange={setSearchQuery} />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-primary">{montagemOrders.length}</p>
            <p className="text-xs text-muted-foreground">OPs p/ Montagem</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">
              {montagemOrders.reduce((s, o) => s + (o.quantity || 0), 0)}
            </p>
            <p className="text-xs text-muted-foreground">Total de Pares</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">
              {new Set(montagemOrders.map(o => {
                const so = saleOrders.find((s: any) => s.id === o.sale_order_id);
                return so?.client_name || '';
              }).filter(Boolean)).size}
            </p>
            <p className="text-xs text-muted-foreground">Clientes</p>
          </CardContent>
        </Card>
      </div>

      {/* Orders list */}
      {montagemOrders.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          Nenhuma OP com montagem pendente.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <Checkbox
              checked={selectedOrders.size === montagemOrders.length && montagemOrders.length > 0}
              onCheckedChange={toggleAll}
            />
            <span className="text-xs text-muted-foreground font-medium">Selecionar todas ({montagemOrders.length})</span>
          </div>
          {montagemOrders.map(order => {
            const { ref, grade, activeSizes, gradeSum, totalPairs, totalFichas, fichas, imageUrl } = buildPrintContent(order);
            const isExpanded = expandedOrderId === order.id;
            const so = saleOrders.find((s: any) => s.id === order.sale_order_id);

            const montagemStage = allStages.find(s => s.order_id === order.id && s.stage_name === STAGE_NAME);
            const stageColor = montagemStage?.status === 'concluido' ? 'border-l-emerald-500' : montagemStage?.status === 'em_andamento' ? 'border-l-amber-500' : 'border-l-red-500';

            return (
              <Card key={order.id} className={`border-l-4 transition-all ${selectedOrders.has(order.id) ? 'ring-2 ring-success' : ''} ${stageColor}`}>
                <CardHeader
                  className="py-3 px-4 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3" onClick={e => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedOrders.has(order.id)}
                        onCheckedChange={() => toggleOrder(order.id)}
                      />
                    </div>
                    <div className="flex-1 ml-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <span className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                        {order.order_number} — {ref?.code} {ref?.name}
                        {(() => {
                          const info = getDeliveryInfo(order);
                          return info.deadline ? (
                            <span className="flex items-center gap-1.5">
                              {info.isAdiantado && <Badge className="bg-amber-500 text-white text-[9px] px-1.5">ADIANTADO</Badge>}
                              <span className="text-[10px] text-muted-foreground font-normal">Fat: {info.deadlineFormatted}</span>
                            </span>
                          ) : null;
                        })()}
                      </CardTitle>
                      {so && (
                        <p className="text-[10px] text-muted-foreground ml-5 mt-0.5">
                          📦 <span className="font-semibold">{so.order_number}</span>
                          {so.client_order_number ? <> | Ped. Cliente: <span className="font-semibold">{so.client_order_number}</span></> : null}
                          {so.client_name ? <> | {so.client_name}</> : null}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground mt-0.5 ml-5">
                        Cor: <span className="font-medium text-foreground">{order.color || '—'}</span>
                        {' | '}
                        <span className="font-bold">{totalPairs} pares</span>
                      </p>
                      {(() => { const sl = getStrapsLabel(order); return sl ? (
                        <p className="text-[10px] ml-5 mt-0.5">
                          🎨 Tiras: <span className="font-bold text-red-600">{sl}</span>
                        </p>
                      ) : null; })()}
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {(order.status || '').toString()}
                    </Badge>
                  </div>
                </CardHeader>

                {isExpanded && (
                  <CardContent className="px-4 pb-4 space-y-4 border-t">
                    {/* Image + info */}
                    <div className="flex items-start gap-4 pt-3">
                      {imageUrl ? (
                        <SignedImage src={imageUrl} alt={ref?.name || ''} className="w-28 h-28 object-cover rounded-md border" />
                      ) : (
                        <div className="w-28 h-28 bg-muted rounded-md border flex items-center justify-center text-xs text-muted-foreground">Sem foto</div>
                      )}
                      <div className="space-y-1.5">
                        <p className="text-sm font-semibold">{ref?.code} — {ref?.name}</p>
                        <p className="text-xs">Cor: <strong>{order.color || '—'}</strong></p>
                        {(() => { const sl = getStrapsLabel(order); return sl ? (
                          <p className="text-xs">Tiras: <strong className="text-red-600">{sl}</strong></p>
                        ) : null; })()}
                        <p className="text-xs">Quantidade: <strong>{totalPairs} pares</strong></p>
                        <p className="text-xs">Status: <Badge variant="secondary" className="text-[10px]">{order.status}</Badge></p>
                        {so && (
                          <>
                            <p className="text-xs">PV: <strong>{so.order_number}</strong></p>
                            <p className="text-xs">Cliente: <strong>{so.client_name || '—'}</strong></p>
                            {so.delivery_deadline && (
                              <p className="text-xs">Prazo: <strong>{new Date(so.delivery_deadline).toLocaleDateString('pt-BR')}</strong></p>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {/* Grade table */}
                    {grade && activeSizes.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold mb-2">📋 Grade Individual</p>
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-xs"></TableHead>
                                {activeSizes.map(s => (
                                  <TableHead key={s} className="text-xs text-center w-14">{s}</TableHead>
                                ))}
                                <TableHead className="text-xs text-center font-bold bg-muted">Total</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              <TableRow>
                                <TableCell className="text-xs font-medium">Por ficha</TableCell>
                                {activeSizes.map(s => (
                                  <TableCell key={s} className="text-xs text-center font-mono">{grade[s] || 0}</TableCell>
                                ))}
                                <TableCell className="text-xs text-center font-mono bg-muted">{gradeSum}</TableCell>
                              </TableRow>
                              <TableRow className="bg-muted/50 font-bold border-t-2">
                                <TableCell className="text-xs font-bold">Total ({totalFichas} fichas)</TableCell>
                                {activeSizes.map(s => (
                                  <TableCell key={s} className="text-sm text-center font-mono font-bold">
                                    {Math.round((Number(grade[s]) || 0) * (fichas || 1))}
                                  </TableCell>
                                ))}
                                <TableCell className="text-sm text-center font-mono font-bold bg-muted">{totalPairs}</TableCell>
                              </TableRow>
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    )}

                    <div className="flex justify-end pt-2">
                      <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); handlePrintOrder(order); }}>
                        <Printer className="h-3.5 w-3.5 mr-1" /> Imprimir Ficha
                      </Button>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
