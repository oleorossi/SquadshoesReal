import { parseDateOnly, formatDateBR } from '@/lib/dateOnly';
import { useMemo, useState } from 'react';
import { SignedImage } from '@/components/ui/signed-image';
import { useNavigate } from 'react-router-dom';
import { usePersistedState } from '@/hooks/usePersistedState';
import { Printer, Funnel as Filter, CheckSquare, Stack as Layers, ClipboardText, DotsThreeVertical, CaretRight, Package, Palette, ListBullets, CircleNotch as Loader2 } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { SectorStageActions } from '@/components/production/SectorStageActions';
import { SectorApontamentoShell } from '@/components/production/SectorApontamentoShell';
import { ChamadaHojeChip } from '@/components/ficha-montadores/ChamadaHojeChip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useOrders } from '@/hooks/useOrders';
import { useTechnicalSheets } from '@/hooks/useTechnicalSheets';
import { useAllOrderStages, useRealtimeOrderStages } from '@/hooks/useOrderStages';
import { sameStage } from '@/lib/production/stageFlow';
import { useSaleOrders } from '@/hooks/useSaleOrders';
import { useProductionTransitions } from '@/hooks/useProductionTransitions';
import { supabase } from '@/integrations/supabase/client';
import { printHtml } from '@/lib/printOrder';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { OrderMultiSelectToolbar } from '@/components/orders/OrderMultiSelectToolbar';
import { useMarqueeSelection } from '@/hooks/useMarqueeSelection';
import { MarqueeOverlay } from '@/components/ui/bulk-actions-bar';
import { useOrderStraps } from '@/hooks/useOrderStraps';
import { safeUrlAttr } from '@/lib/htmlUtils';
import { scaleGradeWithLargestRemainder } from '@/lib/scaleGrade';
import {
  findIdsMatchingOrderCodes,
  parseOrderCodeList,
} from '@/lib/orderCodeSearch';
import { confirmIfHiddenSelection } from '@/lib/confirmHiddenSelection';
import {
  filterSectorQueueOrders,
} from '@/lib/production/sectorApontamentoQueue';
import { finalizeSelectedSectorOrders } from '@/lib/production/finalizeSelectedSectorOrders';

const SIZES = ['17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33','34','35','36','37','38','39','40','41','42','43','44','45'];

const STAGE_NAME = 'Montagem';

export default function Montagem() {
  const navigate = useNavigate();
  const { data: orders = [], isLoading: ordersLoading, isError: ordersError, refetch: refetchOrders, isFetching: ordersFetching } = useOrders();
  const { data: references = [] } = useTechnicalSheets();
  const orderIds = useMemo(() => orders.map(o => o.id), [orders]);
  const { data: allStages = [] } = useAllOrderStages(orderIds.length > 0 ? orderIds : undefined);
  // Realtime: OP liberada/apontada em outro terminal reflete aqui em ~1s.
  useRealtimeOrderStages();
  const { data: saleOrders = [] } = useSaleOrders();
  const queryClient = useQueryClient();
  const { getStrapsLabel } = useOrderStraps();
  const [filterStatus, setFilterStatus] = usePersistedState<string>('montagem_filterStatus', 'active');
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [finalizingOrders, setFinalizingOrders] = useState(false);
  const { finalizeSectorTask } = useProductionTransitions();
  // Busca NÃO persiste: reseta ao sair e voltar pra tela (useState remonta limpo).
  const [searchQuery, setSearchQuery] = useState('');
  const [clientFilter, setClientFilter] = useState('all');
  const [weekFilter, setWeekFilter] = useState('all');

  const montagemOrders = useMemo(
    () => filterSectorQueueOrders({
      orders,
      stages: allStages,
      saleOrders,
      references: references as { id: string; name?: string | null; code?: string | null }[],
      stageName: STAGE_NAME,
      filterStatus,
      searchQuery,
      clientFilter,
      weekFilter,
    }),
    [orders, allStages, filterStatus, searchQuery, clientFilter, weekFilter, saleOrders, references],
  );

  const sel = useMarqueeSelection(montagemOrders, (o) => o.id);

  const clientOptions = useMemo(() => {
    const set = new Set<string>();
    for (const order of orders) {
      const so = saleOrders.find((s: any) => s.id === order.sale_order_id);
      const name = (so?.client_name || '').trim();
      if (name) set.add(name);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [orders, saleOrders]);

  const pastedCodes = useMemo(() => parseOrderCodeList(searchQuery), [searchQuery]);
  const matchedCodeIds = useMemo(
    () => findIdsMatchingOrderCodes(orders, pastedCodes, (o) => {
      const so = saleOrders.find((s: any) => s.id === o.sale_order_id);
      return {
        id: o.id,
        orderNumber: o.order_number,
        saleOrderNumber: so?.order_number,
      };
    }),
    [orders, pastedCodes, saleOrders],
  );

  const allVisibleSelected =
    montagemOrders.length > 0 && montagemOrders.every((o) => sel.isSelected(o.id));

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

  const handleFinishSelectedOrders = async () => {
    if (sel.count === 0) return;
    if (!confirmSelection('Finalizar')) return;
    setFinalizingOrders(true);
    try {
      await finalizeSelectedSectorOrders({
        orderIds: Array.from(sel.selectedIds),
        stageName: STAGE_NAME,
        finalizeSectorTask,
        queryClient,
        onCleared: () => sel.clear(),
      });
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
    const deadlineDate = parseDateOnly(deadline);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((deadlineDate.getTime() - today.getTime()) / 86400000);
    return { deadline, isAdiantado: diffDays > 7, deadlineFormatted: formatDateBR(deadline) };
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
      ? `<img src="${safeUrlAttr(imageUrl)}" style="width:200px;height:200px;object-fit:contain;border:1px solid #ddd;border-radius:6px;" />`
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

  // Estado de carga/erro ANTES do EmptyState: sem isto, o "nenhuma OP pendente"
  // mentia durante a carga e virava permanente no erro (auditoria 2026-08-01).
  return (
    <SectorApontamentoShell
      sectionLabel="PRODUÇÃO · MONTAGEM"
      title="Setor de Montagem"
      description="Gestão e controle das ordens de produção na etapa de montagem"
      isLoading={ordersLoading}
      isError={ordersError}
      isFetching={ordersFetching}
      onRetry={() => { void refetchOrders(); }}
      beforeStats={<ChamadaHojeChip setor="montagem" />}
      actions={<>
          {sel.count > 0 && (
            <Button
              size="sm"
              variant="default"
              className="bg-success hover:bg-success/90 text-success-foreground"
              disabled={finalizingOrders}
              onClick={handleFinishSelectedOrders}
            >
              {finalizingOrders ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <CheckSquare className="h-3.5 w-3.5 mr-1" />}
              Finalizar OP's selecionadas ({sel.count}
              {sel.hiddenSelectedCount > 0 ? ` · ${sel.hiddenSelectedCount} fora do filtro` : ''})
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1">
                <DotsThreeVertical className="h-4 w-4" /> Ações
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {sel.count > 0 && (
                <DropdownMenuItem onClick={() => {
                  if (!confirmSelection('Agrupar')) return;
                  const ids = Array.from(sel.selectedIds).join(',');
                  navigate(`/orders/grouped-summary?sector=montagem&ids=${ids}`);
                }}>
                  <Layers className="h-3.5 w-3.5 mr-2" /> Agrupar ({sel.count})
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">Impressão</DropdownMenuLabel>
              <DropdownMenuItem disabled={sel.count === 0} onClick={() => {
            if (!confirmSelection('Imprimir fichas de')) return;
            const ids = Array.from(sel.selectedIds).join(',');
            navigate(`/imprimir-fichas?orderIds=${ids}&sectors=${encodeURIComponent('Montagem')}`);
          }}>
                <Printer className="h-3.5 w-3.5 mr-2" /> Fichas Operador {sel.count > 0 ? `(${sel.count})` : ''}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>}
      afterStats={
        <OrderMultiSelectToolbar
          search={searchQuery}
          onSearchChange={setSearchQuery}
          resultCount={montagemOrders.length}
          totalCount={orders.length}
          clientOptions={clientOptions}
          clientFilter={clientFilter}
          onClientFilterChange={setClientFilter}
          weekFilter={weekFilter}
          onWeekFilterChange={setWeekFilter}
          allVisibleSelected={allVisibleSelected}
          visibleCount={montagemOrders.length}
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
      }
      stats={<>
        <StatCard
          label="OPs p/ Montagem"
          value={montagemOrders.length}
          tone="primary"
        />
        <StatCard
          label="Total de Pares"
          value={montagemOrders.reduce((s, o) => s + (o.quantity || 0), 0)}
        />
        <StatCard
          label="Clientes"
          value={new Set(montagemOrders.map(o => {
            const so = saleOrders.find((s: any) => s.id === o.sale_order_id);
            return so?.client_name || '';
          }).filter(Boolean)).size}
        />
        {sel.count > 0 && (
          <StatCard
            label="Selecionadas"
            value={sel.count}
            hint={sel.hiddenSelectedCount > 0 ? `${sel.hiddenSelectedCount} fora do filtro` : 'visíveis no recorte'}
            tone="primary"
          />
        )}
      </>}
      isEmpty={montagemOrders.length === 0}
      empty={{
        icon: ClipboardText,
        title: 'Nenhuma OP com montagem pendente',
        description: 'Não há ordens de produção aguardando montagem no momento.',
      }}
    >
          <div
            ref={sel.containerRef}
            data-marquee-container
            onMouseDown={sel.onContainerMouseDown}
            className="relative space-y-3"
          >
          {montagemOrders.map(order => {
            const { ref, grade, activeSizes, gradeSum, totalPairs, totalFichas, fichas, imageUrl } = buildPrintContent(order);
            const scaledTotal = gradeSum > 0
              ? scaleGradeWithLargestRemainder(grade || {}, fichas || 1, totalPairs)
              : {};
            const isExpanded = expandedOrderId === order.id;
            const so = saleOrders.find((s: any) => s.id === order.sale_order_id);

            const montagemStage = allStages.find(s => s.order_id === order.id && sameStage(s.stage_name, STAGE_NAME));
            const stageColor = montagemStage?.status === 'concluido' ? 'border-l-emerald-500' : montagemStage?.status === 'em_andamento' ? 'border-l-amber-500' : 'border-l-red-500';
            const isSelected = sel.isSelected(order.id);

            return (
              <Card
                key={order.id}
                data-marquee-item
                data-marquee-id={order.id}
                className={`border-l-4 transition-all ${isSelected ? 'ring-2 ring-success' : ''} ${stageColor}`}
              >
                <CardHeader
                  className="py-3 px-4 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3" onClick={e => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => sel.toggle(order.id)}
                      />
                    </div>
                    <div className="flex-1 ml-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <CaretRight className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                        {order.order_number} — {ref?.code} {ref?.name}
                        {(() => {
                          const info = getDeliveryInfo(order);
                          return info.deadline ? (
                            <span className="flex items-center gap-1.5">
                              {info.isAdiantado && <Badge className="bg-amber-500 text-white text-xs px-1.5">ADIANTADO</Badge>}
                              <span className="text-xs text-muted-foreground font-normal">Fat: {info.deadlineFormatted}</span>
                            </span>
                          ) : null;
                        })()}
                      </CardTitle>
                      {so && (
                        <p className="text-xs text-muted-foreground ml-5 mt-0.5 flex items-center gap-1">
                          <Package className="h-3.5 w-3.5 shrink-0" /> <span className="font-semibold">{so.order_number}</span>
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
                        <p className="text-xs ml-5 mt-0.5 flex items-center gap-1">
                          <Palette className="h-3.5 w-3.5 shrink-0" /> Tiras: <span className="font-bold text-red-600">{sl}</span>
                        </p>
                      ) : null; })()}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <SectorStageActions stage={montagemStage} orderNumber={order.order_number} />
                      <Badge variant="outline" className="text-xs">
                        {(order.status || '').toString()}
                      </Badge>
                    </div>
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
                        <p className="text-xs">Status: <Badge variant="secondary" className="text-xs">{order.status}</Badge></p>
                        {so && (
                          <>
                            <p className="text-xs">PV: <strong>{so.order_number}</strong></p>
                            <p className="text-xs">Cliente: <strong>{so.client_name || '—'}</strong></p>
                            {so.delivery_deadline && (
                              <p className="text-xs">Prazo: <strong>{formatDateBR(so.delivery_deadline)}</strong></p>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {/* Grade table */}
                    {grade && activeSizes.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold mb-2 flex items-center gap-1">
                          <ListBullets className="h-3.5 w-3.5 shrink-0" /> Grade Individual
                        </p>
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow className="bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                                <TableHead></TableHead>
                                {activeSizes.map(s => (
                                  <TableHead key={s} className="text-center w-14">{s}</TableHead>
                                ))}
                                <TableHead className="text-center bg-muted">Total</TableHead>
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
                                    {scaledTotal[s] || 0}
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
          <MarqueeOverlay rect={sel.marqueeRect} />
          </div>
    </SectorApontamentoShell>
  );
}
