
import { useMemo, useState, useEffect, useCallback } from 'react';
import { SignedImage } from '@/components/ui/signed-image';
import { usePersistedState } from '@/hooks/usePersistedState';
import { Printer, Funnel as Filter, CheckCircle as CheckCircle2, Stack as Layers } from '@phosphor-icons/react';
import { WorkSheetSettingsButton } from '@/components/production/WorkSheetSettingsDialog';
import { Checkbox } from '@/components/ui/checkbox';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useOrders } from '@/hooks/useOrders';
import { useTechnicalSheets } from '@/hooks/useTechnicalSheets';
import { useAllOrderStages } from '@/hooks/useOrderStages';
import { useProductionTransitions } from '@/hooks/useProductionTransitions';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { printHtml, openPrintWindow, writePrintWindow } from '@/lib/printOrder';
import { printSectorWorkSheets } from '@/lib/printSectorWorkSheet';
import { getClientLogoUrl } from '@/lib/getClientLogo';
import { printGroupedReport } from '@/lib/printGroupedReport';
import { printCuttingGroupedReport } from '@/lib/printCuttingGroupedReport';
import OrderSearchBar from '@/components/production/OrderSearchBar';
import { useOrderStraps } from '@/hooks/useOrderStraps';
import { getGradeTotal, getOrderTotalPairs } from '@/lib/cuttingCounts';
import { scaleGradeWithLargestRemainder } from '@/lib/scaleGrade';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { RefChip } from '@/components/ui/ref-chip';
import { normalizeForSearch } from '@/lib/searchUtils';
import { normalizeSector } from '@/lib/sectors';

// Stage da OP correspondente a este setor. O stage_name no banco é
// 'Corte Palmilha' desde o rename de 2026-05-06 — o match literal por 'Corte'
// nunca achava nada (página listava 0 OPs no filtro padrão e TODAS no 'all').
// normalizeSector cobre o canônico E o alias legado 'Corte'.
const isCorteStage = (stageName: string | null | undefined): boolean =>
  normalizeSector(String(stageName ?? '')) === 'corte_palmilha';

const SIZES = ['17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33','34','35','36','37','38','39','40','41','42','43','44','45'];

// Maps actual product group/category to cutting sections
const CABEDAL_KEYWORDS = ['napa', 'velvet', 'tira', 'trança', 'glow', 'couro', 'metalic'];
const PALMILHA_KEYWORDS = ['palmilha', 'placa'];
const FORRO_KEYWORDS = ['forro', 'forração', 'forracao'];
const EXCLUDED_KEYWORDS = ['cola', 'embalagem', 'solado', 'linhanyl', 'componente', 'caixa'];

function classifyCuttingCategory(groupName: string, isBomColorSource: boolean): string | null {
  const lower = (groupName || '').toLowerCase();
  if (EXCLUDED_KEYWORDS.some(k => lower.includes(k))) return null;
  if (isBomColorSource || CABEDAL_KEYWORDS.some(k => lower.includes(k))) return 'Cabedal';
  if (PALMILHA_KEYWORDS.some(k => lower.includes(k))) return 'Palmilha';
  if (FORRO_KEYWORDS.some(k => lower.includes(k))) return 'Forração';
  return null; // skip non-cutting materials
}

type CuttingRow = {
  refCode: string;
  refName: string;
  color: string;
  materialName: string;
  materialCategory: string;
  sizes: Record<string, number>;
  totalPairs: number;
  orderNumber: string;
  orderId: string;
};


export default function Corte() {
  const queryClient = useQueryClient();
  const { data: orders = [] } = useOrders();
  const { data: references = [] } = useTechnicalSheets();
  const orderIds = useMemo(() => orders.map(o => o.id), [orders]);
  const { data: allStages = [] } = useAllOrderStages(orderIds.length > 0 ? orderIds : undefined);
  const { data: saleOrders = [] } = useQuery({
    queryKey: ['sale_orders_for_corte'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sale_orders')
        .select('id, order_number, client_name, client_order_number, delivery_deadline, status');
      if (error) throw error;
      return data;
    },
  });
  const { getStrapsLabel } = useOrderStraps();
  const [filterStatus, setFilterStatus] = usePersistedState<string>('corte-filterStatus', 'active');
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [finalizingOrders, setFinalizingOrders] = useState(false);
  const { finalizeSectorTask } = useProductionTransitions();

  const [searchQuery, setSearchQuery] = usePersistedState('corte-searchQuery', '');

  const toggleOrderSelection = (orderId: string) => {
    setSelectedOrders(prev => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const toggleAllOrders = () => {
    if (selectedOrders.size === cuttingOrders.length) {
      setSelectedOrders(new Set());
    } else {
      setSelectedOrders(new Set(cuttingOrders.map(o => o.id)));
    }
  };

  const handleFinishSelectedOrders = async () => {
    if (selectedOrders.size === 0) return;
    setFinalizingOrders(true);
    try {
      const orderIds = Array.from(selectedOrders);
      
      // Use the new transition logic for each order
      const results = (await Promise.all(
        orderIds.map(orderId => finalizeSectorTask(orderId, 'Corte Palmilha'))
      )) as any[];

      const successCount = results.filter(r => r && r.success).length;

      
      if (successCount > 0) {
        toast.success(`Corte Palmilha finalizado para ${successCount} ${successCount === 1 ? 'OP' : 'OPs'}!`);
        setSelectedOrders(new Set());
        queryClient.invalidateQueries({ queryKey: ['order_stages'] });
        queryClient.invalidateQueries({ queryKey: ['orders'] });
        queryClient.invalidateQueries({ queryKey: ['production_orders'] });
      }
    } catch (err: any) {
      toast.error(`Erro ao finalizar: ${err.message}`);
    } finally {
      setFinalizingOrders(false);
    }
  };


  // Get orders that are in cutting stage (Corte pendente or em_andamento)
  const cuttingOrders = useMemo(() => {
    const q = normalizeForSearch(searchQuery);
    const filtered = orders.filter(order => {
      const status = (order.status || '').toLowerCase();
      // Exclude finalized/cancelled OPs
      if (status === 'finalizado' || status === 'cancelada') return false;
      // Exclude OPs whose sale order is already faturado or cancelled
      if (order.sale_order_id) {
        const so = saleOrders?.find((s: any) => s.id === order.sale_order_id);
        if (so && (so.status === 'Faturado' || so.status === 'Finalizado s/ NF' || so.status === 'Cancelado')) return false;
      }
      // Status filter - only filter if "active" is selected
      if (filterStatus === 'active' && status !== 'em produção') return false;

      const stages = allStages.filter(s => s.order_id === order.id);
      const corteStage = stages.find(s => isCorteStage(s.stage_name));
      if (!corteStage) return filterStatus === 'all';
      if (filterStatus === 'active' && corteStage.status !== 'pendente' && corteStage.status !== 'em_andamento') return false;

      if (q) {
        const so = saleOrders?.find((s: any) => s.id === order.sale_order_id);
        const ref = (references as any[])?.find((r: any) => r.id === (order as any).reference_id);
        if (!normalizeForSearch(so?.order_number).includes(q)
          && !normalizeForSearch(so?.client_order_number).includes(q)
          && !normalizeForSearch(order.order_number).includes(q)
          && !normalizeForSearch(so?.client_name).includes(q)
          && !normalizeForSearch(ref?.name).includes(q)
          && !normalizeForSearch(ref?.code).includes(q)
        ) return false;
      }

      return true;
    });
    // Sort by planned_delivery ASC (closest first, nulls last)
    return filtered.sort((a, b) => {
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
  }, [orders, allStages, filterStatus, searchQuery, saleOrders]);

  // Helper: get delivery deadline from sale order and check if ADIANTADO
  const getDeliveryInfo = (order: any) => {
    const so = saleOrders?.find((s: any) => s.id === order.sale_order_id);
    const deadline = so?.delivery_deadline;
    if (!deadline) return { deadline: null, isAdiantado: false };
    const deadlineDate = new Date(deadline);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((deadlineDate.getTime() - today.getTime()) / 86400000);
    return { deadline, isAdiantado: diffDays > 7, deadlineFormatted: new Date(deadline).toLocaleDateString('pt-BR') };
  };

  // Build cutting demand data from orders + reference_materials
  const [cuttingData, setCuttingData] = useState<CuttingRow[]>([]);
  const [loading, setLoading] = useState(false);

  const loadCuttingData = useCallback(async (ordersToProcess: typeof cuttingOrders) => {
    setLoading(true);
    try {
      const rows: CuttingRow[] = [];

      // Batch: fetch all materials for all unique reference_ids in ONE query
      const refIds = [...new Set(ordersToProcess.map(o => o.reference_id).filter(Boolean))];
      if (refIds.length === 0) { setCuttingData([]); return; }

      const { data: allMaterials } = await supabase
        .from('sheet_materials')
        .select('*, products(name, category, unit, color, product_groups!products_group_id_fkey(name, is_bom_color_source))')
        .in('sheet_id', refIds);

      const materialsByRef = new Map<string, typeof allMaterials>();
      for (const mat of allMaterials || []) {
        const list = materialsByRef.get(mat.sheet_id) || [];
        list.push(mat);
        materialsByRef.set(mat.sheet_id, list);
      }

      for (const order of ordersToProcess) {
        const ref = references.find(r => r.id === order.reference_id);
        if (!ref) continue;
        const grade = order.grade as Record<string, number> | null;
        if (!grade) continue;

        const gradeSum = getGradeTotal(grade);
        const orderQty = Number(order.quantity) || 0;
        const realTotal = Math.max(gradeSum, orderQty);
        const multiplier = gradeSum > 0 ? realTotal / gradeSum : 0;

        const materials = materialsByRef.get(order.reference_id) || [];
        for (const mat of materials) {
          const groupInfo = (mat.products as any)?.product_groups;
          const groupName = groupInfo?.name || mat.products?.category || '';
          const isBomColor = groupInfo?.is_bom_color_source || false;
          const cuttingCategory = classifyCuttingCategory(groupName, isBomColor);
          if (!cuttingCategory) continue;

          const sizeMap: Record<string, number> = {};
          let total = 0;
          for (const [size, qty] of Object.entries(grade)) {
            const q = Math.round((Number(qty) || 0) * multiplier);
            if (q > 0) { sizeMap[size] = (sizeMap[size] || 0) + q; total += q; }
          }

          rows.push({
            refCode: ref.code || '', refName: ref.name || '',
            color: order.color || mat.color || '—',
            materialName: mat.products?.name || '—', materialCategory: cuttingCategory,
            sizes: sizeMap, totalPairs: total,
            orderNumber: order.order_number || '', orderId: order.id,
          });
        }

        // Auditoria visual 11/06/2026: KPIs de demanda zeravam (com 4.380
        // pares no setor) — os materiais de cabedal/forro/palmilha em geral
        // NÃO estão em sheet_materials (BOM, que só tinha Componente/
        // Embalagem/Linhanyl), e sim nos campos upper/lining/insole_material
        // da ficha técnica. Se o BOM não gerou linha pra categoria, deriva a
        // demanda (pares por numeração) direto da ficha. Palmilha "pronta na
        // cor" (insole_ready_made) não gera demanda de corte.
        const categoriesCovered = new Set(
          rows.filter(r => r.orderId === order.id).map(r => r.materialCategory)
        );
        const fichaFallbacks: Array<{ category: string; name: string | null }> = [
          { category: 'Cabedal',  name: (ref as any).upper_material || null },
          { category: 'Forração', name: (ref as any).lining_material || null },
          { category: 'Palmilha', name: (ref as any).insole_ready_made ? null : ((ref as any).insole_material || null) },
        ];
        for (const fb of fichaFallbacks) {
          if (!fb.name || categoriesCovered.has(fb.category)) continue;
          const sizeMap: Record<string, number> = {};
          let total = 0;
          for (const [size, qty] of Object.entries(grade)) {
            const q = Math.round((Number(qty) || 0) * multiplier);
            if (q > 0) { sizeMap[size] = (sizeMap[size] || 0) + q; total += q; }
          }
          if (total === 0) continue;
          rows.push({
            refCode: ref.code || '', refName: ref.name || '',
            color: order.color || '—',
            materialName: fb.name, materialCategory: fb.category,
            sizes: sizeMap, totalPairs: total,
            orderNumber: order.order_number || '', orderId: order.id,
          });
        }
      }
      // Debug: log palmilha vs total counts
      const palmRows = rows.filter(r => r.materialCategory === 'Palmilha');
      const totalPairsAll = ordersToProcess.reduce((s, o) => s + getOrderTotalPairs(o), 0);
      const palmTotal = palmRows.reduce((s, r) => s + r.totalPairs, 0);
if (totalPairsAll !== palmTotal) {
        console.warn('[Corte] MISMATCH! Total pares:', totalPairsAll, 'vs Palmilha:', palmTotal);
        // Log orders without palmilha
        const orderIdsWithPalm = new Set(palmRows.map(r => r.orderId));
        const missing = ordersToProcess.filter(o => !orderIdsWithPalm.has(o.id));
        if (missing.length > 0) console.warn('[Corte] Orders sem palmilha:', missing.map(o => o.order_number));
      }
      setCuttingData(rows);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [references]);

  // Auto-load when cuttingOrders change
  const cuttingOrderIds = useMemo(() => cuttingOrders.map(o => o.id).join(','), [cuttingOrders]);
  
  useEffect(() => {
    if (cuttingOrders.length > 0) {
      loadCuttingData(cuttingOrders);
    } else {
      setCuttingData([]);
    }
  }, [cuttingOrderIds, loadCuttingData]);

  // Aggregate by category
  const palmilhaRows = cuttingData.filter(r => r.materialCategory === 'Palmilha');
  const cabedalRows = cuttingData.filter(r => r.materialCategory === 'Cabedal');
  const forroRows = cuttingData.filter(r => r.materialCategory === 'Forração');

  // Aggregate consolidated view (group by color across all orders)
  const aggregateByCategory = (rows: CuttingRow[]) => {
    const map = new Map<string, { color: string; materialName: string; sizes: Record<string, number>; total: number }>();
    for (const r of rows) {
      const key = `${r.color}|${r.materialName}`;
      const existing = map.get(key) || { color: r.color, materialName: r.materialName, sizes: {}, total: 0 };
      for (const [size, qty] of Object.entries(r.sizes)) {
        existing.sizes[size] = (existing.sizes[size] || 0) + qty;
        existing.total += qty;
      }
      map.set(key, existing);
    }
    return Array.from(map.values());
  };

  const consolidatedPalmilha = aggregateByCategory(palmilhaRows);
  const consolidatedCabedal = aggregateByCategory(cabedalRows);
   const consolidatedForro = aggregateByCategory(forroRows);
 
   // Additional data for Silk integration
   const { data: silkRegistrations = [] } = useQuery({
     queryKey: ['sole_silk_registrations'],
     queryFn: async () => {
       const { data, error } = await (supabase as any).from('sole_silk_registrations').select('*');
       if (error) throw error;
       return data;
     }
   });
 
   const referenceIdsForSole = useMemo(() => [...new Set(orders.map(o => o.reference_id).filter(Boolean))], [orders]);
   const { data: soleMappings = [] } = useQuery({
     queryKey: ['sole_ref_mappings', referenceIdsForSole],
     enabled: referenceIdsForSole.length > 0,
     queryFn: async () => {
        const { data, error } = await (supabase as any)
          .from('technical_sheet_sole_colors')
          .select('sheet_id, product_color, sole_product_id, products:sole_product_id(name)')
          .in('sheet_id', referenceIdsForSole);
       if (error) throw error;
       return data;
     },
   });
 
   const printCuttingList = (title: string, data: { color: string; materialName: string; sizes: Record<string, number>; total: number }[]) => {
    const activeSizes = SIZES.filter(s => data.some(r => (r.sizes[s] || 0) > 0));
    const sizeTotals: Record<string, number> = {};
    activeSizes.forEach(s => { sizeTotals[s] = 0; });
    let grandTotal = 0;

    let rowsHtml = '';
    data.forEach(row => {
      rowsHtml += '<tr>';
      rowsHtml += `<td style="font-weight:600;font-size:10px;">${row.materialName}</td>`;
      rowsHtml += `<td style="text-align:center;font-size:10px;">${row.color}</td>`;
      activeSizes.forEach(s => {
        const qty = row.sizes[s] || 0;
        sizeTotals[s] += qty;
        grandTotal += qty;
        rowsHtml += `<td style="text-align:center;font-family:monospace;font-size:11px;font-weight:${qty > 0 ? '600' : '400'}">${qty || ''}</td>`;
      });
      rowsHtml += `<td style="text-align:center;font-family:monospace;font-weight:700;font-size:11px;background:#f5f5f0;">${row.total}</td>`;
      rowsHtml += '</tr>';
    });

    // Totals row
    rowsHtml += '<tr style="background:#e8e8d0;font-weight:700;border-top:2px solid #333;">';
    rowsHtml += '<td colspan="2" style="text-align:right;font-size:10px;">TOTAL</td>';
    activeSizes.forEach(s => {
      rowsHtml += `<td style="text-align:center;font-family:monospace;font-size:11px;">${sizeTotals[s] || ''}</td>`;
    });
    rowsHtml += `<td style="text-align:center;font-family:monospace;font-size:12px;">${grandTotal}</td>`;
    rowsHtml += '</tr>';

    const html = `
      <h1 style="font-size:16px;margin-bottom:4px;">✂️ Lista de Corte — ${title}</h1>
      <p style="font-size:10px;color:#666;margin-bottom:12px;">Gerado em ${new Date().toLocaleString('pt-BR')} | ${cuttingOrders.length} ${cuttingOrders.length === 1 ? 'OP ativa' : 'OPs ativas'}</p>
      <table style="width:100%;border-collapse:collapse;font-size:11px;">
        <thead>
          <tr style="background:#e8e8d0;">
            <th style="border:1px solid #999;padding:4px 6px;text-align:left;font-size:10px;">Material</th>
            <th style="border:1px solid #999;padding:4px 6px;text-align:center;font-size:10px;">Cor</th>
            ${activeSizes.map(s => `<th style="border:1px solid #999;padding:4px 6px;text-align:center;font-size:10px;">${s}</th>`).join('')}
            <th style="border:1px solid #999;padding:4px 6px;text-align:center;font-size:10px;background:#e0e0c8;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    `;
    printHtml(`Lista de Corte - ${title}`, html);
  };

  const renderTable = (
    data: { color: string; materialName: string; sizes: Record<string, number>; total: number }[],
    title: string,
    emoji: string
  ) => {
    const activeSizes = SIZES.filter(s => data.some(r => (r.sizes[s] || 0) > 0));
    if (activeSizes.length === 0 && data.length === 0) {
      return (
        <div className="text-center py-8 text-muted-foreground text-sm">
          Nenhuma demanda de {title.toLowerCase()} no momento.
        </div>
      );
    }

    return (
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <span>{emoji}</span> {title}
            <Badge variant="secondary" className="text-xs">{data.length} itens</Badge>
          </h3>
          <Button size="sm" variant="outline" onClick={() => printCuttingList(title, data)}>
            <Printer className="h-3.5 w-3.5 mr-1" /> Imprimir
          </Button>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                <TableHead>Material</TableHead>
                <TableHead className="text-center">Cor</TableHead>
                {activeSizes.map(s => (
                  <TableHead key={s} className="text-center w-14">{s}</TableHead>
                ))}
                <TableHead className="text-center bg-muted">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row, idx) => (
                <TableRow key={idx}>
                  <TableCell className="text-xs font-medium">{row.materialName}</TableCell>
                  <TableCell className="text-xs text-center">{row.color}</TableCell>
                  {activeSizes.map(s => (
                    <TableCell key={s} className="text-xs text-center font-mono">
                      {row.sizes[s] || ''}
                    </TableCell>
                  ))}
                  <TableCell className="text-xs text-center font-mono font-bold bg-muted">{row.total}</TableCell>
                </TableRow>
              ))}
              {/* Totals */}
              <TableRow className="bg-muted/50 font-bold border-t-2">
                <TableCell colSpan={2} className="text-xs text-right">TOTAL</TableCell>
                {activeSizes.map(s => (
                  <TableCell key={s} className="text-xs text-center font-mono">
                    {data.reduce((sum, r) => sum + (r.sizes[s] || 0), 0) || ''}
                  </TableCell>
                ))}
                <TableCell className="text-xs text-center font-mono font-bold bg-muted">
                  {data.reduce((sum, r) => sum + r.total, 0)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>
    );
  };

  // Per-order detail view
  const renderOrderDetail = () => {
    if (cuttingOrders.length === 0) {
      return (
        <EmptyState
          icon={Layers}
          title="Nenhuma OP com corte pendente"
          description="Não há ordens de produção aguardando corte no momento."
        />
      );
    }

    // Group orders by sale_order_id
    const grouped = new Map<string, typeof cuttingOrders>();
    for (const order of cuttingOrders) {
      const key = order.sale_order_id || '__sem_pedido__';
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(order);
    }

    // Sort groups: orders with sale_order first, then "sem pedido"
    const sortedGroups = Array.from(grouped.entries()).sort(([a], [b]) => {
      if (a === '__sem_pedido__') return 1;
      if (b === '__sem_pedido__') return -1;
      return 0;
    });

    return (
      <div className="space-y-5 page-enter">
        {sortedGroups.map(([groupKey, groupOrders]) => {
          const saleOrderInfo = groupKey !== '__sem_pedido__' ? saleOrders.find(so => so.id === groupKey) : null;
          const groupLabel = saleOrderInfo
            ? `Pedido ${saleOrderInfo.order_number} — ${saleOrderInfo.client_name}`
            : 'Sem Pedido Vinculado';

          // Check if all orders in group are selected
          const allGroupSelected = groupOrders.every(o => selectedOrders.has(o.id));
          const toggleGroupSelection = () => {
            setSelectedOrders(prev => {
              const next = new Set(prev);
              if (allGroupSelected) {
                groupOrders.forEach(o => next.delete(o.id));
              } else {
                groupOrders.forEach(o => next.add(o.id));
              }
              return next;
            });
          };

          const groupTotalPairs = groupOrders.reduce((sum, o) => sum + getOrderTotalPairs(o), 0);

          return (
            <div key={groupKey} className="space-y-3">
              <div className="flex items-center gap-3 px-1 border-b pb-2">
                <Checkbox
                  checked={allGroupSelected}
                  onCheckedChange={toggleGroupSelection}
                />
                <h3 className="text-sm font-bold text-foreground">{groupLabel}</h3>
                <Badge variant="secondary" className="text-xs">{groupOrders.length} OPs</Badge>
                <Badge variant="outline" className="text-xs">{groupTotalPairs} pares no pedido</Badge>
              </div>
              {groupOrders.map(order => {
          const ref = references.find(r => r.id === order.reference_id);
          const orderRows = cuttingData.filter(r => r.orderId === order.id);
          const palmilha = orderRows.filter(r => r.materialCategory === 'Palmilha');
          const cabedal = orderRows.filter(r => r.materialCategory === 'Cabedal');
          const forro = orderRows.filter(r => r.materialCategory === 'Forração');
          const grade = order.grade as Record<string, number> | null;
          const activeSizes = SIZES.filter(s => grade && Number(grade[s]) > 0);
          const isExpanded = expandedOrderId === order.id;
          const gradeSum = getGradeTotal(grade);
          const totalPairs = getOrderTotalPairs(order);
          const fichas = gradeSum > 0 ? totalPairs / gradeSum : 0;
          const isSelected = selectedOrders.has(order.id);

          const corteStage = allStages.find(s => s.order_id === order.id && isCorteStage(s.stage_name));
          const stageColor = corteStage?.status === 'concluido' ? 'border-l-emerald-500' : corteStage?.status === 'em_andamento' ? 'border-l-amber-500' : 'border-l-red-500';

          return (
            <Card key={order.id} className={`border-l-4 ${isSelected ? 'ring-1 ring-success/30' : ''} ${stageColor}`}>
              <CardHeader 
                className="py-3 px-4 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleOrderSelection(order.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div>
                      <CardTitle className="text-sm flex items-center gap-2">
                        <span className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                        <span>{order.order_number}</span>
                        {ref?.code && <RefChip code={ref.code} />}
                        <span className="font-normal text-muted-foreground">{ref?.name}</span>
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
                      {(() => {
                        const so = saleOrders?.find((s: any) => s.id === order.sale_order_id);
                        return so ? (
                          <p className="text-xs text-muted-foreground ml-5 mt-0.5">
                            📦 <span className="font-semibold">{so.order_number}</span>
                            {so.client_order_number ? <> | Ped. Cliente: <span className="font-semibold">{so.client_order_number}</span></> : null}
                            {so.client_name ? <> | {so.client_name}</> : null}
                          </p>
                        ) : null;
                      })()}
                      <p className="text-xs text-muted-foreground mt-0.5 ml-5">
                        Cor: <span className="font-medium text-foreground">{order.color || '—'}</span>
                        {' | '}Qtd: <span className="font-medium text-foreground">{totalPairs} pares</span>
                        {' | '}<span className="text-primary">{Math.ceil(fichas)} fichas</span>
                      </p>
                      {(() => { const sl = getStrapsLabel(order); return sl ? (
                        <p className="text-xs ml-5 mt-0.5">
                          🎨 Tiras: <span className="font-bold text-red-600">{sl}</span>
                        </p>
                      ) : null; })()}
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {(order.status || '').toString()}
                  </Badge>
                </div>
              </CardHeader>
              {isExpanded && (
                <CardContent className="px-4 pb-4 space-y-4 border-t">
                  <div className="flex items-start gap-4 pt-2">
                    {(() => {
                      const imageUrl = (ref?.images as string[] | undefined)?.[0] || ref?.image_url || '';
                      return imageUrl ? (
                        <SignedImage src={imageUrl} alt={ref?.name || ''} className="w-24 h-24 object-cover rounded-md border" />
                      ) : null;
                    })()}
                    <div className="space-y-1">
                      <p className="text-sm font-semibold">{ref?.code} — {ref?.name}</p>
                      <p className="text-xs">Cor: <strong>{order.color || '—'}</strong></p>
                      {(() => { const sl = getStrapsLabel(order); return sl ? (
                        <p className="text-xs">Tiras: <strong className="text-red-600">{sl}</strong></p>
                      ) : null; })()}
                      {palmilha.length > 0 && (
                        <p className="text-xs">Palmilha: <strong>{palmilha.map(p => `${p.materialName} (${p.color})`).join(', ')}</strong></p>
                      )}
                      <p className="text-xs">{totalPairs} pares — {Math.ceil(fichas)} fichas</p>
                    </div>
                  </div>

                  {grade && activeSizes.length > 0 && (
                    <div className="space-y-3">
                      <p className="text-xs font-semibold">📋 Grade por ficha ({gradeSum} pares/ficha)</p>
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
                              <TableCell className="text-xs font-bold">Total ({Math.ceil(fichas)} fichas)</TableCell>
                              {activeSizes.map(s => (
                                <TableCell key={s} className="text-sm text-center font-mono font-bold">
                                  {Math.round((grade[s] || 0) * fichas)}
                                </TableCell>
                              ))}
                              <TableCell className="text-sm text-center font-mono font-bold bg-muted">
                                {totalPairs}
                              </TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}

                  {cabedal.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold mb-1">👞 Cabedal</p>
                      {cabedal.map((r, i) => (
                        <p key={i} className="text-xs text-muted-foreground">
                          {r.materialName} ({r.color}) — {activeSizes.map(s => `${s}:${(r.sizes[s] || 0)}`).join(' | ')} = <strong>{r.totalPairs}</strong>
                        </p>
                      ))}
                    </div>
                  )}
                  {palmilha.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold mb-1">🦶 Palmilha</p>
                      {palmilha.map((r, i) => (
                        <p key={i} className="text-xs text-muted-foreground">
                          {r.materialName} ({r.color}) — {activeSizes.map(s => `${s}:${(r.sizes[s] || 0)}`).join(' | ')} = <strong>{r.totalPairs}</strong>
                        </p>
                      ))}
                    </div>
                  )}
                  {forro.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold mb-1">🧵 Forração</p>
                      {forro.map((r, i) => (
                        <p key={i} className="text-xs text-muted-foreground">
                          {r.materialName} ({r.color}) — {activeSizes.map(s => `${s}:${(r.sizes[s] || 0)}`).join(' | ')} = <strong>{r.totalPairs}</strong>
                        </p>
                      ))}
                    </div>
                  )}

                  <div className="flex justify-end pt-2">
                    <Button size="sm" variant="outline" onClick={async (e) => {
                      e.stopPropagation();
                      const imageUrl = (ref?.images as string[] | undefined)?.[0] || ref?.image_url || '';
                      const scaledMaterials = [...cabedal, ...palmilha, ...forro].map(r => ({
                        color: r.color,
                        materialName: r.materialName,
                        category: r.materialCategory,
                        sizes: Object.fromEntries(Object.entries(r.sizes).map(([s, q]) => [s, Number(q) || 0])),
                        total: r.totalPairs,
                      }));

                      const silkLogoUrl = await getClientLogoUrl(order);
                      const silkHtml = `<div style="text-align:center;"><p style="font-size:8px;color:#999;margin-bottom:2px;">SILK</p><img src="${silkLogoUrl}" style="width:100px;height:100px;object-fit:contain;" /></div>`;

                      let isStrap = false;
                      if (ref) {
                        isStrap = !!(ref as any).has_straps;
                        if (!isStrap) {
                          const { data: prodRef } = await supabase
                            .from('product_references')
                            .select('has_straps')
                            .eq('technical_sheet_id', ref.id)
                            .maybeSingle();
                          if (prodRef?.has_straps) isStrap = true;
                        }
                      }

                      const buildGradeHtml = () => {
                        if (!grade || activeSizes.length === 0) return '';
                        return `
                        <table style="width:100%;border-collapse:collapse;margin-bottom:12px;">
                          <thead><tr style="background:#e8e8d0;">
                            <th style="border:1px solid #999;padding:3px 6px;font-size:10px;text-align:left;">Tipo</th>
                            ${activeSizes.map(s => `<th style="border:1px solid #999;padding:3px 6px;text-align:center;font-size:10px;">${s}</th>`).join('')}
                            <th style="border:1px solid #999;padding:3px 6px;text-align:center;font-size:10px;background:#e0e0c8;">Total</th>
                          </tr></thead>
                          <tbody>
                            <tr>
                              <td style="border:1px solid #999;padding:3px 6px;font-size:10px;font-weight:600;">Por ficha</td>
                              ${activeSizes.map(s => `<td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-size:11px;">${grade[s] || 0}</td>`).join('')}
                              <td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-weight:700;font-size:11px;background:#f5f5f0;">${gradeSum}</td>
                            </tr>
                            <tr style="background:#f5f5f0;font-weight:700;">
                              <td style="border:1px solid #999;padding:3px 6px;font-size:10px;">Total (${Math.ceil(fichas)} fichas)</td>
                              ${activeSizes.map(s => `<td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-size:11px;">${Math.round((grade[s] || 0) * fichas)}</td>`).join('')}
                              <td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-weight:700;font-size:12px;background:#e0e0c8;">${totalPairs}</td>
                            </tr>
                          </tbody>
                        </table>`;
                      };

                      const buildMatsHtml = (categories: { label: string; category: string }[]) => {
                        let html = '';
                        categories.forEach(({ label, category }) => {
                          const items = scaledMaterials.filter(m => m.category === category);
                          if (items.length === 0) return;
                          html += `<h3 style="font-size:11px;margin:8px 0 4px;">${label}</h3>`;
                          html += `<table style="width:100%;border-collapse:collapse;margin-bottom:8px;">
                            <thead><tr style="background:#e8e8d0;">
                              <th style="border:1px solid #999;padding:3px 6px;text-align:left;font-size:10px;">Material</th>
                              <th style="border:1px solid #999;padding:3px 6px;text-align:center;font-size:10px;">Cor</th>
                              ${activeSizes.map(s => `<th style="border:1px solid #999;padding:3px 6px;text-align:center;font-size:10px;">${s}</th>`).join('')}
                              <th style="border:1px solid #999;padding:3px 6px;text-align:center;font-size:10px;background:#e0e0c8;">Total</th>
                            </tr></thead><tbody>`;
                          items.forEach(m => {
                            html += `<tr>
                              <td style="border:1px solid #999;padding:3px 6px;font-size:10px;font-weight:600;">${m.materialName}</td>
                              <td style="border:1px solid #999;padding:3px 6px;text-align:center;font-size:10px;">${m.color}</td>
                              ${activeSizes.map(s => `<td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-size:11px;">${m.sizes[s] || ''}</td>`).join('')}
                              <td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-weight:700;font-size:11px;background:#f5f5f0;">${m.total}</td>
                            </tr>`;
                          });
                          html += '</tbody></table>';
                        });
                        return html;
                      };

                      const buildHeader = (subtitle: string) => `
                        <div style="display:flex;align-items:flex-start;gap:16px;margin-bottom:16px;">
                          ${imageUrl ? `<img src="${imageUrl}" style="width:200px;height:200px;object-fit:cover;border:1px solid #ccc;border-radius:6px;" />` : ''}
                          <div style="flex:1;">
                            <h1 style="font-size:16px;margin-bottom:4px;">✂️ Ficha de Corte${subtitle ? ` — ${subtitle}` : ''}</h1>
                            <p style="font-size:12px;font-weight:600;margin-bottom:2px;">${order.order_number} — ${ref?.code || ''} ${ref?.name || ''}</p>
                            <p style="font-size:11px;color:#333;">Cor: <strong>${order.color || '—'}</strong></p>
                            <p style="font-size:11px;color:#333;">Quantidade: <strong>${totalPairs} pares</strong> (${Math.ceil(fichas)} fichas)</p>
                            <p style="font-size:10px;color:#666;margin-top:4px;">Gerado em ${new Date().toLocaleString('pt-BR')}</p>
                          </div>
                          ${silkHtml}
                        </div>
                        <h2 style="font-size:12px;margin-bottom:6px;border-bottom:1px solid #ccc;padding-bottom:3px;">📋 Grade</h2>
                        ${buildGradeHtml()}`;

                      if (isStrap) {
                        const allMats = buildMatsHtml([
                          { label: '👞 Cabedal (Tira)', category: 'Cabedal' },
                          { label: '🦶 Palmilha', category: 'Palmilha' },
                          { label: '🧵 Forração', category: 'Forração' },
                        ]);
                        printHtml(`Corte - ${order.order_number}`, `${buildHeader('')}${allMats}`);
                      } else {
                        const page1Mats = buildMatsHtml([
                          { label: '🦶 Palmilha', category: 'Palmilha' },
                          { label: '🧵 Forração', category: 'Forração' },
                        ]);
                        const page2Mats = buildMatsHtml([
                          { label: '👞 Cabedal', category: 'Cabedal' },
                        ]);

                        const html = `
                          ${buildHeader('Palmilha & Forração')}
                          ${page1Mats}
                          <div style="page-break-after:always;"></div>
                          ${buildHeader('Cabedal')}
                          ${page2Mats}
                        `;
                        printHtml(`Corte - ${order.order_number}`, html);
                      }
                    }}>
                      <Printer className="h-3.5 w-3.5 mr-1" /> Imprimir OP
                    </Button>
                  </div>
                </CardContent>
              )}
            </Card>
          );
              })}
            </div>
          );
        })}
      </div>
    );
  };

  const printAll = () => {
    const allData = [
      { title: 'Cabedal', data: consolidatedCabedal },
      { title: 'Palmilha', data: consolidatedPalmilha },
      { title: 'Forração', data: consolidatedForro },
    ].filter(d => d.data.length > 0);

    const activeSizes = SIZES.filter(s => cuttingData.some(r => (r.sizes[s] || 0) > 0));

    let fullHtml = `<h1 style="font-size:16px;margin-bottom:4px;">✂️ Lista de Corte Completa</h1>
      <p style="font-size:10px;color:#666;margin-bottom:12px;">Gerado em ${new Date().toLocaleString('pt-BR')} | ${cuttingOrders.length} ${cuttingOrders.length === 1 ? 'OP' : 'OPs'}</p>
      <p style="font-size:10px;margin-bottom:16px;">OPs: ${cuttingOrders.map(o => o.order_number).join(', ')}</p>`;

    allData.forEach(({ title, data }) => {
      const sizeTotals: Record<string, number> = {};
      activeSizes.forEach(s => { sizeTotals[s] = 0; });
      let grandTotal = 0;

      let rowsHtml = '';
      data.forEach(row => {
        rowsHtml += '<tr>';
        rowsHtml += `<td style="border:1px solid #999;padding:3px 6px;font-weight:600;font-size:10px;">${row.materialName}</td>`;
        rowsHtml += `<td style="border:1px solid #999;padding:3px 6px;text-align:center;font-size:10px;">${row.color}</td>`;
        activeSizes.forEach(s => {
          const qty = row.sizes[s] || 0;
          sizeTotals[s] += qty;
          grandTotal += qty;
          rowsHtml += `<td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-size:11px;">${qty || ''}</td>`;
        });
        rowsHtml += `<td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-weight:700;font-size:11px;background:#f5f5f0;">${row.total}</td>`;
        rowsHtml += '</tr>';
      });

      rowsHtml += '<tr style="background:#e8e8d0;font-weight:700;border-top:2px solid #333;">';
      rowsHtml += '<td colspan="2" style="border:1px solid #999;padding:3px 6px;text-align:right;font-size:10px;">TOTAL</td>';
      activeSizes.forEach(s => {
        rowsHtml += `<td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-size:11px;">${sizeTotals[s] || ''}</td>`;
      });
      rowsHtml += `<td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-size:12px;">${grandTotal}</td>`;
      rowsHtml += '</tr>';

      fullHtml += `
        <h2 style="font-size:13px;margin:16px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px;">${title}</h2>
        <table style="width:100%;border-collapse:collapse;margin-bottom:12px;">
          <thead>
            <tr style="background:#e8e8d0;">
              <th style="border:1px solid #999;padding:4px 6px;text-align:left;font-size:10px;">Material</th>
              <th style="border:1px solid #999;padding:4px 6px;text-align:center;font-size:10px;">Cor</th>
              ${activeSizes.map(s => `<th style="border:1px solid #999;padding:4px 6px;text-align:center;font-size:10px;">${s}</th>`).join('')}
              <th style="border:1px solid #999;padding:4px 6px;text-align:center;font-size:10px;background:#e0e0c8;">Total</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>`;
    });

    printHtml('Lista de Corte Completa', fullHtml);
  };

  return (
    
      <div className="space-y-6">
        {/* Header */}
        <EditorialPageHeader
          sectionLabel="PRODUÇÃO · CORTE PALMILHA"
          title="Setor de Corte Palmilha"
          description="Demanda de corte por material, cor e numeração"
          actions={<>
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
            <Button
              size="sm"
              variant={selectedOrders.size === cuttingOrders.length && cuttingOrders.length > 0 ? "default" : "outline"}
              onClick={toggleAllOrders}
              disabled={cuttingOrders.length === 0}
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
              {selectedOrders.size === cuttingOrders.length && cuttingOrders.length > 0 ? 'Desmarcar Tudo' : `Selecionar Tudo (${cuttingOrders.length})`}
            </Button>
             <Button size="sm" variant="outline" disabled={cuttingOrders.length === 0} onClick={() => {
                 printCuttingGroupedReport(
                   cuttingOrders as any, 
                   references as any, 
                   getStrapsLabel, 
                   saleOrders as any,
                   { silkRegistrations, soleMappings }
                 );
               }}>
                <Layers className="h-3.5 w-3.5 mr-1" /> Agrupar Tudo ({cuttingOrders.length})
              </Button>
            <WorkSheetSettingsButton />
            <Button size="sm" variant="outline" disabled={selectedOrders.size === 0} onClick={() => {
                const ordersToprint = cuttingOrders.filter(o => selectedOrders.has(o.id));
                printSectorWorkSheets({
                  sectorName: 'Corte',
                  sectorEmoji: '✂️',
                  orders: ordersToprint as any,
                  references: references as any,
                  saleOrders: saleOrders as any,
                  getStrapsLabel,
                });
              }}>
                <Printer className="h-3.5 w-3.5 mr-1" /> Fichas Operador {selectedOrders.size > 0 ? `(${selectedOrders.size})` : ''}
              </Button>
            <Button size="sm" variant="outline" onClick={async () => {
              // Open window synchronously (before async) to avoid popup blocker
              const printWin = openPrintWindow('Relatório Corte');

              // Use all orders (any status except cancelled)
              const ordersForReport = orders.filter(order => {
                const status = (order.status || '').toLowerCase();
                return status !== 'cancelada' && status !== 'concluída';
              });

              if (ordersForReport.length === 0) {
                return;
              }

              // Load fresh materials for report
              const rows: CuttingRow[] = [];
              const orderMaterialsMap = new Map<string, CuttingRow[]>();
              // Batch fetch all materials
              const reportRefIds = [...new Set(ordersForReport.map(o => o.reference_id).filter(Boolean))];
              const { data: allReportMats } = await supabase
                .from('sheet_materials')
                .select('*, products(name, category, unit, color, product_groups!products_group_id_fkey(name, is_bom_color_source))')
                .in('sheet_id', reportRefIds);
              const reportMatsByRef = new Map<string, typeof allReportMats>();
              for (const mat of allReportMats || []) {
                const list = reportMatsByRef.get(mat.sheet_id) || [];
                list.push(mat);
                reportMatsByRef.set(mat.sheet_id, list);
              }
              for (const order of ordersForReport) {
                const ref = references.find(r => r.id === order.reference_id);
                if (!ref) continue;
                const grade = order.grade as Record<string, number> | null;
                if (!grade) continue;
                const gradeSum = getGradeTotal(grade);
                const orderQty = Number(order.quantity) || 0;
                const realTotal = Math.max(gradeSum, orderQty);
                const multiplier = gradeSum > 0 ? realTotal / gradeSum : 0;
                const materials = reportMatsByRef.get(order.reference_id) || [];
                const orderRows: CuttingRow[] = [];
                for (const mat of materials) {
                  const groupInfo = (mat.products as any)?.product_groups;
                  const groupName = groupInfo?.name || mat.products?.category || '';
                  const isBomColor = groupInfo?.is_bom_color_source || false;
                  const cuttingCategory = classifyCuttingCategory(groupName, isBomColor);
                  if (!cuttingCategory) continue;
                  const sizeMap: Record<string, number> = {};
                  let total = 0;
                  for (const [size, qty] of Object.entries(grade)) {
                    const q = Math.round((Number(qty) || 0) * multiplier);
                    if (q > 0) { sizeMap[size] = (sizeMap[size] || 0) + q; total += q; }
                  }
                  const row: CuttingRow = { refCode: ref.code || '', refName: ref.name || '', color: order.color || mat.color || '—', materialName: mat.products?.name || '—', materialCategory: cuttingCategory, sizes: sizeMap, totalPairs: total, orderNumber: order.order_number || '', orderId: order.id };
                  rows.push(row);
                  orderRows.push(row);
                }
                orderMaterialsMap.set(order.id, orderRows);
              }

              const repCabedal = aggregateByCategory(rows.filter(r => r.materialCategory === 'Cabedal'));
              const repPalmilha = aggregateByCategory(rows.filter(r => r.materialCategory === 'Palmilha'));
              const repForro = aggregateByCategory(rows.filter(r => r.materialCategory === 'Forração'));

              const totalCabedal = repCabedal.reduce((s, r) => s + r.total, 0);
              const totalPalmilha = repPalmilha.reduce((s, r) => s + r.total, 0);
              const totalForro = repForro.reduce((s, r) => s + r.total, 0);
              const activeSizes = SIZES.filter(s => rows.some(r => (r.sizes[s] || 0) > 0));

              const buildTable = (title: string, data: typeof consolidatedCabedal) => {
                if (data.length === 0) return '';
                const sizeTotals: Record<string, number> = {};
                activeSizes.forEach(s => { sizeTotals[s] = 0; });
                let gt = 0;
                let tRows = '';
                data.forEach(row => {
                  tRows += `<tr><td style="border:1px solid #999;padding:3px 6px;font-size:10px;font-weight:600;">${row.materialName}</td><td style="border:1px solid #999;padding:3px 6px;text-align:center;font-size:10px;">${row.color}</td>`;
                  activeSizes.forEach(s => { const q = row.sizes[s] || 0; sizeTotals[s] += q; gt += q; tRows += `<td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-size:11px;">${q || ''}</td>`; });
                  tRows += `<td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-weight:700;font-size:11px;background:#f5f5f0;">${row.total}</td></tr>`;
                });
                tRows += `<tr style="background:#e8e8d0;font-weight:700;border-top:2px solid #333;"><td colspan="2" style="border:1px solid #999;padding:3px 6px;text-align:right;font-size:10px;">TOTAL</td>`;
                activeSizes.forEach(s => { tRows += `<td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-size:11px;">${sizeTotals[s] || ''}</td>`; });
                tRows += `<td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-size:12px;">${gt}</td></tr>`;
                return `<h2 style="font-size:13px;margin:16px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px;">${title}</h2><table style="width:100%;border-collapse:collapse;"><thead><tr style="background:#e8e8d0;"><th style="border:1px solid #999;padding:4px 6px;text-align:left;font-size:10px;">Material</th><th style="border:1px solid #999;padding:4px 6px;text-align:center;font-size:10px;">Cor</th>${activeSizes.map(s => `<th style="border:1px solid #999;padding:4px 6px;text-align:center;font-size:10px;">${s}</th>`).join('')}<th style="border:1px solid #999;padding:4px 6px;text-align:center;font-size:10px;background:#e0e0c8;">Total</th></tr></thead><tbody>${tRows}</tbody></table>`;
              };

              // Build per-OP summary table
              const allActiveSizesReport = SIZES.filter(s => ordersForReport.some(o => {
                const g = o.grade as Record<string, number> | null;
                return g && Number(g[s]) > 0;
              }));
              const opSizeTotals: Record<string, number> = {};
              allActiveSizesReport.forEach(s => { opSizeTotals[s] = 0; });
              let totalPairsAll = 0;

              let opSummaryRows = '';
              ordersForReport.forEach(o => {
                const ref = references.find(r => r.id === o.reference_id);
                const grade = o.grade as Record<string, number> | null;
                const gradeSum = getGradeTotal(grade);
                const tp = getOrderTotalPairs(o);
                // FIX 2026-06-11: escala a grade BASE pro total REAL (Hamilton).
                // Antes mult=1 mostrava a grade base crua (somando ~12) ao lado
                // de um Total de centenas — o cortador não sabia quantos pares
                // cortar por numeração. Σ(células)=tp por construção.
                const scaled = gradeSum > 0
                  ? scaleGradeWithLargestRemainder(grade || {}, tp / gradeSum, tp)
                  : {};
                totalPairsAll += tp;
                opSummaryRows += `<tr>`;
                opSummaryRows += `<td style="border:1px solid #999;padding:3px 6px;font-size:10px;font-weight:600;">${o.order_number}</td>`;
                opSummaryRows += `<td style="border:1px solid #999;padding:3px 6px;font-size:10px;">${ref?.code || ''} ${ref?.name || ''}</td>`;
                opSummaryRows += `<td style="border:1px solid #999;padding:3px 6px;font-size:10px;">${o.color || '—'}</td>`;
                allActiveSizesReport.forEach(s => {
                  const qty = Number(scaled[s]) || 0;
                  opSizeTotals[s] += qty;
                  opSummaryRows += `<td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-size:11px;font-weight:${qty > 0 ? '700' : '400'}">${qty || ''}</td>`;
                });
                opSummaryRows += `<td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-weight:700;font-size:11px;background:#f5f5f0;">${tp}</td>`;
                opSummaryRows += `</tr>`;
              });
              opSummaryRows += `<tr style="background:#e8e8d0;font-weight:700;border-top:2px solid #333;">`;
              opSummaryRows += `<td colspan="3" style="border:1px solid #999;padding:3px 6px;text-align:right;font-size:10px;">TOTAL</td>`;
              allActiveSizesReport.forEach(s => {
                opSummaryRows += `<td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-size:11px;">${opSizeTotals[s] || ''}</td>`;
              });
              opSummaryRows += `<td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-size:12px;font-weight:700;">${totalPairsAll}</td>`;
              opSummaryRows += `</tr>`;

              const detailHtml = `
                <h2 style="font-size:13px;margin:20px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px;">Resumo por OP</h2>
                <table style="width:100%;border-collapse:collapse;">
                  <thead><tr style="background:#e8e8d0;">
                    <th style="border:1px solid #999;padding:4px 6px;text-align:left;font-size:10px;">OP</th>
                    <th style="border:1px solid #999;padding:4px 6px;text-align:left;font-size:10px;">Referência</th>
                    <th style="border:1px solid #999;padding:4px 6px;text-align:left;font-size:10px;">Cor</th>
                    ${allActiveSizesReport.map(s => `<th style="border:1px solid #999;padding:4px 6px;text-align:center;font-size:10px;">${s}</th>`).join('')}
                    <th style="border:1px solid #999;padding:4px 6px;text-align:center;font-size:10px;background:#e0e0c8;">Total</th>
                  </tr></thead>
                  <tbody>${opSummaryRows}</tbody>
                </table>`;

              // Build product photo gallery below summary
              const uniqueRefs = new Map<string, { code: string; name: string; imageUrl: string }>();
              ordersForReport.forEach(o => {
                const ref = references.find(r => r.id === o.reference_id);
                if (!ref || uniqueRefs.has(ref.id)) return;
                const imgUrl = ((ref as any).images as string[] | undefined)?.[0] || ref.image_url || '';
                uniqueRefs.set(ref.id, { code: ref.code || '', name: ref.name || '', imageUrl: imgUrl });
              });
              let photoGalleryHtml = '<h2 style="font-size:13px;margin:20px 0 8px;border-bottom:1px solid #ccc;padding-bottom:3px;">📷 Referências</h2>';
              photoGalleryHtml += '<div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:16px;">';
              uniqueRefs.forEach(r => {
                const imgTag = r.imageUrl
                  ? `<img src="${r.imageUrl}" style="width:120px;height:120px;object-fit:contain;border:1px solid #ddd;border-radius:4px;" />`
                  : `<div style="width:120px;height:120px;background:#f0f0f0;border:1px solid #ddd;border-radius:4px;display:flex;align-items:center;justify-content:center;color:#aaa;font-size:8px;">Sem foto</div>`;
                photoGalleryHtml += `<div style="text-align:center;width:130px;">
                  ${imgTag}
                  <p style="font-size:8px;font-weight:700;margin-top:3px;line-height:1.2;">${r.code}</p>
                  <p style="font-size:7px;color:#666;line-height:1.2;">${r.name}</p>
                </div>`;
              });
              photoGalleryHtml += '</div>';

              // Build compact per-OP detail (all on minimal space, no page-break per OP)
              let opDetailCardsHtml = '<div style="page-break-before:always;"></div><h2 style="font-size:14px;margin-bottom:8px;border-bottom:2px solid #333;padding-bottom:3px;">📋 Detalhamento por OP</h2>';

              for (let i = 0; i < ordersForReport.length; i++) {
                const o = ordersForReport[i];
                const ref = references.find(r => r.id === o.reference_id);
                if (!ref) continue;
                const grade = o.grade as Record<string, number> | null;
                const gradeSum = getGradeTotal(grade);
                const tp = getOrderTotalPairs(o);
                // FIX 2026-06-11: escala a grade BASE pro total REAL (Hamilton);
                // mult=1 antes mostrava a grade base crua sob o Total real.
                const scaled = gradeSum > 0
                  ? scaleGradeWithLargestRemainder(grade || {}, tp / gradeSum, tp)
                  : {};
                const opActiveSizes = SIZES.filter(s => grade && Number(grade[s]) > 0);
                // fichas = total / grade base (não /12, que erra quando a base ≠ 12).
                const fichas = gradeSum > 0 ? Math.round(tp / gradeSum) : Math.ceil(tp / 12);

                const imageUrl = ((ref as any).images as string[] | undefined)?.[0] || ref.image_url || '';
                const imgTag = imageUrl
                  ? `<img src="${imageUrl}" style="width:100px;height:100px;object-fit:contain;border:1px solid #ddd;border-radius:4px;" />`
                  : `<div style="width:100px;height:100px;background:#f0f0f0;border:1px solid #ddd;border-radius:4px;display:flex;align-items:center;justify-content:center;color:#aaa;font-size:7px;">Sem foto</div>`;

                // Compact grade inline
                let gradeInline = '';
                if (grade && opActiveSizes.length > 0) {
                  gradeInline = opActiveSizes.map(s => `<span style="display:inline-block;text-align:center;margin:0 2px;"><span style="font-size:7px;color:#888;display:block;">${s}</span><span style="font-size:9px;font-weight:700;font-family:monospace;">${Number(scaled[s]) || 0}</span></span>`).join('');
                  gradeInline = `<div style="margin-top:3px;background:#f9f9f5;border:1px solid #ddd;border-radius:3px;padding:2px 4px;display:inline-flex;align-items:center;gap:1px;">${gradeInline}<span style="display:inline-block;text-align:center;margin:0 2px;border-left:1px solid #ccc;padding-left:4px;"><span style="font-size:7px;color:#888;display:block;">Tot</span><span style="font-size:9px;font-weight:700;font-family:monospace;">${tp}</span></span></div>`;
                }

                // Materials compact
                const opMats = orderMaterialsMap.get(o.id) || [];
                const matsLine = (cat: string, emoji: string) => {
                  const items = opMats.filter(m => m.materialCategory === cat);
                  if (items.length === 0) return '';
                  return `<span style="font-size:8px;color:#555;">${emoji} ${items.map(m => `${m.materialName} (${m.color})`).join(', ')}</span>`;
                };
                const matsHtml = [matsLine('Cabedal', '👞'), matsLine('Palmilha', '🦶'), matsLine('Forração', '🧵')].filter(Boolean).join(' &nbsp;|&nbsp; ');

                opDetailCardsHtml += `
                  <div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid #eee;${i === 0 ? '' : ''}">
                    ${imgTag}
                    <div style="flex:1;min-width:0;">
                      <div style="display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;">
                        <span style="font-size:11px;font-weight:700;">${o.order_number}</span>
                        <span style="font-size:9px;color:#555;">${ref?.code || ''} — ${ref?.name || ''}</span>
                        <span style="font-size:9px;">Cor: <strong>${o.color || '—'}</strong></span>
                        <span style="font-size:9px;">${tp} pares (${fichas} fichas)</span>
                      </div>
                      ${gradeInline}
                      <div style="margin-top:2px;">${matsHtml}</div>
                    </div>
                  </div>`;
              }

              const html = `
                <h1 style="font-size:18px;margin-bottom:4px;">✂️ Relatório do Setor de Corte</h1>
                <p style="font-size:10px;color:#666;margin-bottom:12px;">Gerado em ${new Date().toLocaleString('pt-BR')}</p>
                <div style="display:flex;gap:16px;margin-bottom:12px;flex-wrap:wrap;">
                  <div style="text-align:center;padding:6px 14px;background:#f5f5f0;border:1px solid #ddd;border-radius:6px;"><p style="font-size:18px;font-weight:700;color:#333;">${ordersForReport.length}</p><p style="font-size:9px;color:#666;">OPs</p></div>
                  <div style="text-align:center;padding:6px 14px;background:#f5f5f0;border:1px solid #ddd;border-radius:6px;"><p style="font-size:18px;font-weight:700;color:#333;">${totalPairsAll}</p><p style="font-size:9px;color:#666;">Total Pares</p></div>
                  <div style="text-align:center;padding:6px 14px;background:#f5f5f0;border:1px solid #ddd;border-radius:6px;"><p style="font-size:18px;font-weight:700;color:#333;">${totalCabedal}</p><p style="font-size:9px;color:#666;">Cabedal</p></div>
                  <div style="text-align:center;padding:6px 14px;background:#f5f5f0;border:1px solid #ddd;border-radius:6px;"><p style="font-size:18px;font-weight:700;color:#333;">${totalPalmilha}</p><p style="font-size:9px;color:#666;">Palmilha</p></div>
                  <div style="text-align:center;padding:6px 14px;background:#f5f5f0;border:1px solid #ddd;border-radius:6px;"><p style="font-size:18px;font-weight:700;color:#333;">${totalForro}</p><p style="font-size:9px;color:#666;">Forração</p></div>
                </div>
                ${detailHtml}
                ${photoGalleryHtml}
                ${buildTable('👞 Cabedal', repCabedal)}
                ${buildTable('🦶 Palmilha', repPalmilha)}
                ${buildTable('🧵 Forração', repForro)}
                ${opDetailCardsHtml}`;
              writePrintWindow(printWin, 'Relatório Corte', html);
            }}>
              <Printer className="h-3.5 w-3.5 mr-1" /> Relatório PDF
            </Button>
            <Button size="sm" variant="outline" disabled={selectedOrders.size === 0} onClick={async () => {
              const selected = cuttingOrders.filter(o => selectedOrders.has(o.id));
              if (selected.length === 0) return;
              const printWin = openPrintWindow('Fichas de Corte Selecionadas');
              let fullHtml = '';
              for (let idx = 0; idx < selected.length; idx++) {
                const order = selected[idx];
                const ref = references.find(r => r.id === order.reference_id);
                if (!ref) continue;
                const grade = order.grade as Record<string, number> | null;
                if (!grade) continue;
                const gradeSum = getGradeTotal(grade);
                const totalPairs = getOrderTotalPairs(order);
                const multiplier = gradeSum > 0 ? totalPairs / gradeSum : 0;
                const fichas = multiplier;
                // FIX 2026-06-11: linha "Total" escala a base por Hamilton —
                // Math.round(grade[s]*fichas) por número somava ±N vs o Total.
                const scaledTotal = gradeSum > 0
                  ? scaleGradeWithLargestRemainder(grade, multiplier, totalPairs)
                  : {};
                const activeSizes = SIZES.filter(s => Number(grade[s]) > 0);
                const imageUrl = ((ref as any).images as string[] | undefined)?.[0] || ref.image_url || '';

                const { data: materials } = await supabase
                  .from('sheet_materials')
                  .select('*, products(name, category, unit, color, product_groups!products_group_id_fkey(name, is_bom_color_source))')
                  .eq('sheet_id', order.reference_id);
                if (!materials) continue;

                const scaledMaterials = materials
                  .filter(mat => {
                    const gi = (mat.products as any)?.product_groups;
                    return !!classifyCuttingCategory(gi?.name || mat.products?.category || '', gi?.is_bom_color_source || false);
                  })
                  .map(mat => {
                    const gi = (mat.products as any)?.product_groups;
                    const cat = classifyCuttingCategory(gi?.name || mat.products?.category || '', gi?.is_bom_color_source || false) || '';
                    const sizeMap: Record<string, number> = {};
                    let total = 0;
                    for (const [size, qty] of Object.entries(grade)) {
                      const q = Math.round((Number(qty) || 0) * multiplier);
                      if (q > 0) { sizeMap[size] = q; total += q; }
                    }
                    return { color: order.color || mat.color || '—', materialName: mat.products?.name || '—', category: cat, sizes: sizeMap, total };
                  });

                const silkLogoUrl = await getClientLogoUrl(order);
                const silkHtml = `<div style="text-align:center;"><p style="font-size:8px;color:#999;margin-bottom:2px;">SILK</p><img src="${silkLogoUrl}" style="width:100px;height:100px;object-fit:contain;" /></div>`;

                let isStrap = !!(ref as any).has_straps;
                if (!isStrap) {
                  const { data: prodRef } = await supabase.from('product_references').select('has_straps').eq('technical_sheet_id', ref.id).maybeSingle();
                  if (prodRef?.has_straps) isStrap = true;
                }

                const buildGradeHtml = () => {
                  if (!grade || activeSizes.length === 0) return '';
                  return `<table style="width:100%;border-collapse:collapse;margin-bottom:12px;">
                    <thead><tr style="background:#e8e8d0;">
                      <th style="border:1px solid #999;padding:3px 6px;font-size:10px;text-align:left;">Tipo</th>
                      ${activeSizes.map(s => `<th style="border:1px solid #999;padding:3px 6px;text-align:center;font-size:10px;">${s}</th>`).join('')}
                      <th style="border:1px solid #999;padding:3px 6px;text-align:center;font-size:10px;background:#e0e0c8;">Total</th>
                    </tr></thead><tbody>
                    <tr><td style="border:1px solid #999;padding:3px 6px;font-size:10px;font-weight:600;">Por ficha</td>
                      ${activeSizes.map(s => `<td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-size:11px;">${grade[s] || 0}</td>`).join('')}
                      <td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-weight:700;font-size:11px;background:#f5f5f0;">${gradeSum}</td>
                    </tr>
                    <tr style="background:#f5f5f0;font-weight:700;"><td style="border:1px solid #999;padding:3px 6px;font-size:10px;">Total (${Math.ceil(fichas)} fichas)</td>
                      ${activeSizes.map(s => `<td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-size:11px;">${Number(scaledTotal[s]) || 0}</td>`).join('')}
                      <td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-weight:700;font-size:12px;background:#e0e0c8;">${totalPairs}</td>
                    </tr></tbody></table>`;
                };

                const buildMatsHtml = (categories: { label: string; category: string }[]) => {
                  let html = '';
                  categories.forEach(({ label, category }) => {
                    const items = scaledMaterials.filter(m => m.category === category);
                    if (items.length === 0) return;
                    html += `<h3 style="font-size:11px;margin:8px 0 4px;">${label}</h3>`;
                    html += `<table style="width:100%;border-collapse:collapse;margin-bottom:8px;"><thead><tr style="background:#e8e8d0;"><th style="border:1px solid #999;padding:3px 6px;text-align:left;font-size:10px;">Material</th><th style="border:1px solid #999;padding:3px 6px;text-align:center;font-size:10px;">Cor</th>${activeSizes.map(s => `<th style="border:1px solid #999;padding:3px 6px;text-align:center;font-size:10px;">${s}</th>`).join('')}<th style="border:1px solid #999;padding:3px 6px;text-align:center;font-size:10px;background:#e0e0c8;">Total</th></tr></thead><tbody>`;
                    items.forEach(m => {
                      html += `<tr><td style="border:1px solid #999;padding:3px 6px;font-size:10px;font-weight:600;">${m.materialName}</td><td style="border:1px solid #999;padding:3px 6px;text-align:center;font-size:10px;">${m.color}</td>${activeSizes.map(s => `<td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-size:11px;">${m.sizes[s] || ''}</td>`).join('')}<td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-weight:700;font-size:11px;background:#f5f5f0;">${m.total}</td></tr>`;
                    });
                    html += '</tbody></table>';
                  });
                  return html;
                };

                const buildHeader = (subtitle: string) => `
                  <div style="display:flex;align-items:flex-start;gap:16px;margin-bottom:16px;">
                    ${imageUrl ? `<img src="${imageUrl}" style="width:200px;height:200px;object-fit:cover;border:1px solid #ccc;border-radius:6px;" />` : ''}
                    <div style="flex:1;">
                      <h1 style="font-size:16px;margin-bottom:4px;">✂️ Ficha de Corte${subtitle ? ` — ${subtitle}` : ''}</h1>
                      <p style="font-size:12px;font-weight:600;margin-bottom:2px;">${order.order_number} — ${ref?.code || ''} ${ref?.name || ''}</p>
                      <p style="font-size:11px;color:#333;">Cor: <strong>${order.color || '—'}</strong></p>
                      <p style="font-size:11px;color:#333;">Quantidade: <strong>${totalPairs} pares</strong> (${Math.ceil(fichas)} fichas)</p>
                      <p style="font-size:10px;color:#666;margin-top:4px;">Gerado em ${new Date().toLocaleString('pt-BR')}</p>
                    </div>
                    ${silkHtml}
                  </div>
                  <h2 style="font-size:12px;margin-bottom:6px;border-bottom:1px solid #ccc;padding-bottom:3px;">📋 Grade</h2>
                  ${buildGradeHtml()}`;

                if (idx > 0) fullHtml += '<div style="page-break-before:always;"></div>';

                if (isStrap) {
                  fullHtml += buildHeader('') + buildMatsHtml([
                    { label: '👞 Cabedal (Tira)', category: 'Cabedal' },
                    { label: '🦶 Palmilha', category: 'Palmilha' },
                    { label: '🧵 Forração', category: 'Forração' },
                  ]);
                } else {
                  fullHtml += buildHeader('Palmilha & Forração') + buildMatsHtml([
                    { label: '🦶 Palmilha', category: 'Palmilha' },
                    { label: '🧵 Forração', category: 'Forração' },
                  ]);
                  fullHtml += '<div style="page-break-before:always;"></div>';
                  fullHtml += buildHeader('Cabedal') + buildMatsHtml([
                    { label: '👞 Cabedal', category: 'Cabedal' },
                  ]);
                }
              }
              writePrintWindow(printWin, 'Fichas de Corte Selecionadas', fullHtml);
            }}>
              <Printer className="h-3.5 w-3.5 mr-1" /> Imprimir Selecionados {selectedOrders.size > 0 && `(${selectedOrders.size})`}
            </Button>
            <Button size="sm" onClick={printAll} disabled={cuttingData.length === 0}>
              <Printer className="h-4 w-4 mr-1" /> Imprimir Tudo
            </Button>
            <Button 
              size="sm" 
              onClick={handleFinishSelectedOrders} 
              disabled={selectedOrders.size === 0 || finalizingOrders}
              className="bg-success hover:bg-success/90 text-success-foreground"
            >
              <CheckCircle2 className="h-4 w-4 mr-1" /> 
              Finalizar OP's selecionadas {selectedOrders.size > 0 && `(${selectedOrders.size})`}
            </Button>
            <OrderSearchBar value={searchQuery} onChange={setSearchQuery} />
          </>}
        />

        {/* Stats */}
        <StatGrid>
          <StatCard
            label="OPs p/ Corte Palmilha"
            value={cuttingOrders.length}
            tone="primary"
          />
          <StatCard
            label="Total do setor (pares)"
            value={cuttingOrders.reduce((sum, order) => sum + getOrderTotalPairs(order), 0)}
            tone="primary"
          />
          <StatCard
            label="Cabedal (demanda)"
            value={consolidatedCabedal.reduce((s, r) => s + r.total, 0)}
            tone="warning"
          />
          <StatCard
            label="Palmilha (demanda)"
            value={consolidatedPalmilha.reduce((s, r) => s + r.total, 0)}
          />
          <StatCard
            label="Forração (demanda)"
            value={consolidatedForro.reduce((s, r) => s + r.total, 0)}
            tone="success"
          />
        </StatGrid>

        {/* Order list */}
        {loading ? (
          <div className="text-center py-8 text-muted-foreground text-sm">Carregando materiais...</div>
        ) : (
          renderOrderDetail()
        )}
      </div>
    
  );
}
