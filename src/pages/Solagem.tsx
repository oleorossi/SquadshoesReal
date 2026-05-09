
import { useMemo, useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, endOfMonth, startOfWeek, endOfWeek, isWithinInterval, parseISO, startOfMonth } from 'date-fns';
import { usePersistedState } from '@/hooks/usePersistedState';
import { Footprints, Printer, Filter, Layers, ListChecks, CheckCircle2, Loader2 } from 'lucide-react';
import { WorkSheetSettingsButton } from '@/components/production/WorkSheetSettingsDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useOrders } from '@/hooks/useOrders';
import { useTechnicalSheets } from '@/hooks/useTechnicalSheets';
import { useAllOrderStages, useRealtimeOrderStages } from '@/hooks/useOrderStages';
import { useSaleOrders } from '@/hooks/useSaleOrders';
import { printHtml } from '@/lib/printOrder';
import { printSectorWorkSheets } from '@/lib/printSectorWorkSheet';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import OrderSearchBar from '@/components/production/OrderSearchBar';
import { useOrderStraps } from '@/hooks/useOrderStraps';
import { useProductionTransitions } from '@/hooks/useProductionTransitions';
import { supabase } from '@/integrations/supabase/client';




const SIZES = ['17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33','34','35','36','37','38','39','40','41','42','43','44','45'];
const DEFAULT_SOLE_COLORS = ['Preto', 'Caramelo'];
type GradeMap = Record<string, number>;

/**
 * Regra de cor do solado:
 * Cor preta do cabedal → solado Preto; todas as demais → Caramelo.
 */
function getSoleColorForSize(orderColor: string | null | undefined): string {
  const c = (orderColor || '').toLowerCase().trim();
  if (c.includes('pret') || c.includes('black') || c === 'pb') return 'Preto';
  return 'Caramelo';
}

function getPositiveGrade(grade: unknown): GradeMap {
  if (!grade || typeof grade !== 'object' || Array.isArray(grade)) return {};

  return Object.fromEntries(
    Object.entries(grade)
      .map(([size, qty]) => [size, Number(qty) || 0] as const)
      .filter(([, qty]) => qty > 0)
  );
}

function getGradeSum(grade: GradeMap): number {
  return Object.values(grade).reduce((sum, qty) => sum + qty, 0);
}

function getGradeForOrder(order: { grade?: unknown; quantity?: number | null }): GradeMap {
  return getPositiveGrade(order.grade);
}

export default function Solagem() {
  const navigate = useNavigate();
  const { data: orders = [], refetch: refetchOrders, isFetching: isFetchingOrders } = useOrders();
  const { data: references = [] } = useTechnicalSheets();
  const orderIds = useMemo(() => orders.map(o => o.id), [orders]);
  const { data: allStages = [] } = useAllOrderStages(orderIds.length > 0 ? orderIds : undefined);
  const { data: saleOrders = [] } = useSaleOrders();
  const { getStrapsLabel } = useOrderStraps();
  useRealtimeOrderStages();

  // Fetch sole reference names from technical_sheet_sole_colors + products
  const referenceIds = useMemo(() => [...new Set(orders.map(o => o.reference_id).filter(Boolean))], [orders]);
   const { data: soleRefMappings = [] } = useQuery({
     queryKey: ['sole_ref_mappings', referenceIds],
     enabled: referenceIds.length > 0,
     queryFn: async () => {
       const { data, error } = await (supabase as any)
         .from('technical_sheet_sole_colors')
         .select('sheet_id, product_color, sole_product_id, products:sole_product_id(name)')
         .in('sheet_id', referenceIds);
       if (error) throw error;
       return (data || []) as Array<{ sheet_id: string; product_color: string; sole_product_id: string | null; products: { name: string } | null }>;
     },
   });
 
   const { data: silkRegistrations = [] } = useQuery({
     queryKey: ['sole_silk_registrations'],
     queryFn: async () => {
       const { data, error } = await supabase.from('sole_silk_registrations').select('*');
       if (error) throw error;
       return data;
     }
   });

  const getSoleReferenceName = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of soleRefMappings) {
      const prodName = m.products?.name;
      if (prodName) {
        map.set(`${m.sheet_id}__${(m.product_color || '').toLowerCase().trim()}`, prodName);
      }
    }
    return (order: { reference_id: string; color?: string | null }) => {
      const key = `${order.reference_id}__${(order.color || '').toLowerCase().trim()}`;
      return map.get(key);
    };
  }, [soleRefMappings]);

  const [filterStatus, setFilterStatus] = usePersistedState<string>('filterStatus', 'active');
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = usePersistedState('searchQuery', '');
  const [filterPeriod, setFilterPeriod] = usePersistedState<string>('solagemFilterPeriod', 'all');
  const [filterCategoria, setFilterCategoria] = usePersistedState<string>('solagemFilterCategoria', 'all');
  const [showDetail, setShowDetail] = useState(false);
  const [finalizingOrders, setFinalizingOrders] = useState(false);
  const { finalizeSectorTask } = useProductionTransitions();
  const [soleColorOverrides, setSoleColorOverrides] = useState<Record<string, string>>({});
  const didAutoResetFilters = useRef(false);
  const didForceOrderSync = useRef(false);
  const queryClient = useQueryClient();

  const handleFinishSelectedOrders = async () => {
    if (selectedOrders.size === 0) return;
    setFinalizingOrders(true);
    try {
      const orderIds = Array.from(selectedOrders);
      const settled = await Promise.allSettled(
        orderIds.map(orderId => finalizeSectorTask(orderId, 'Solagem'))
      );
      const successCount = settled.filter(
        s => s.status === 'fulfilled' && (s.value as any)?.success
      ).length;
      const failedCount = orderIds.length - successCount;

      if (successCount > 0) {
        if (failedCount === 0) toast.success(`Solagem finalizada para ${successCount} OP(s)!`);
        else toast.warning(`Solagem finalizada para ${successCount} OP(s); ${failedCount} falhou(aram).`);
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

  const solagemStagesByOrderId = useMemo(() => {
    return new Map(allStages.filter(stage => stage.stage_name === 'Solagem').map(stage => [stage.order_id, stage]));
  }, [allStages]);

  const hasPendingSolagemStages = useMemo(() => {
    return allStages.some(stage => stage.stage_name === 'Solagem' && (stage.status === 'pendente' || stage.status === 'em_andamento'));
  }, [allStages]);

  const hasProductionOrdersInCache = useMemo(() => {
    return orders.some(order => (order.status || '').toLowerCase() === 'em produção');
  }, [orders]);

  useEffect(() => {
    if (!didForceOrderSync.current && hasPendingSolagemStages && !hasProductionOrdersInCache && !isFetchingOrders) {
      didForceOrderSync.current = true;
      void refetchOrders();
    }

    if (hasProductionOrdersInCache) {
      didForceOrderSync.current = false;
    }
  }, [hasPendingSolagemStages, hasProductionOrdersInCache, isFetchingOrders, refetchOrders]);

  const getSoleColorForOrder = (orderId: string, orderColor: string | null | undefined) => {
    if (soleColorOverrides[orderId]) return soleColorOverrides[orderId];
    return getSoleColorForSize(orderColor);
  };

  const toggleSoleColor = (orderId: string, currentColor: string) => {
    const currentIdx = DEFAULT_SOLE_COLORS.findIndex(c => c === currentColor);
    const newColor = DEFAULT_SOLE_COLORS[(currentIdx + 1) % DEFAULT_SOLE_COLORS.length];
    setSoleColorOverrides(prev => ({ ...prev, [orderId]: newColor }));
  };

  const toggleOrderSelection = (orderId: string) => {
    setSelectedOrders(prev => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const baseSolagemOrders = useMemo(() => {
    const filtered = orders.filter(order => {
      const status = (order.status || '').toLowerCase().normalize('NFC');
      if (status === 'finalizado' || status === 'cancelada') return false;
      if (order.sale_order_id) {
        const so = saleOrders.find((s: any) => s.id === order.sale_order_id);
        if (so && (so.status === 'Faturado' || so.status === 'Cancelado')) return false;
      }
      // Status filter - only filter if "active" is selected
      if (filterStatus === 'active' && status !== 'em produção') return false;

      const solagemStage = solagemStagesByOrderId.get(order.id);
      if (filterStatus === 'active' && solagemStage?.status === 'concluido') return false;
      if (!solagemStage) return filterStatus === 'all';
      if (filterStatus === 'all') return true;

      return solagemStage.status === 'pendente' || solagemStage.status === 'em_andamento';
    });
    return filtered.sort((a, b) => {
      const da = (a as any).planned_delivery;
      const db = (b as any).planned_delivery;
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da.localeCompare(db);
    });
  }, [orders, solagemStagesByOrderId, filterStatus]);

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

  // Orders at Solagem stage after UI filters
  const solagemOrders = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const now = new Date();

    return baseSolagemOrders.filter(order => {
      if (filterPeriod !== 'all') {
        const deliveryStr = (order as any).planned_delivery;
        if (deliveryStr) {
          const delivery = parseISO(deliveryStr);
          if (filterPeriod === 'week') {
            const weekStart = startOfWeek(now, { weekStartsOn: 1 });
            const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
            if (!isWithinInterval(delivery, { start: weekStart, end: weekEnd })) return false;
          } else if (filterPeriod === '15days') {
            if (!isWithinInterval(delivery, { start: now, end: addDays(now, 15) })) return false;
          } else if (filterPeriod === 'month') {
            const monthStart = startOfMonth(now);
            const monthEnd = endOfMonth(now);
            if (!isWithinInterval(delivery, { start: monthStart, end: monthEnd })) return false;
          }
        }
      }

      if (q) {
        const so = saleOrders.find((s: any) => s.id === order.sale_order_id);
        const pvNumber = (so?.order_number || '').toLowerCase();
        const clientOrderNum = (so?.client_order_number || '').toLowerCase();
        const opNumber = (order.order_number || '').toLowerCase();
        const clientName = (so?.client_name || '').toLowerCase();
        if (!pvNumber.includes(q) && !clientOrderNum.includes(q) && !opNumber.includes(q) && !clientName.includes(q)) return false;
      }

      if (filterCategoria !== 'all') {
        const grade = getPositiveGrade(order.grade as Record<string, number> | null);
        const sizes = Object.keys(grade).map(Number).filter(n => !isNaN(n));
        const hasInfantil = sizes.some(s => s < 34);
        const hasAdulto = sizes.some(s => s >= 34);
        if (filterCategoria === 'infantil' && !hasInfantil) return false;
        if (filterCategoria === 'adulto' && !hasAdulto) return false;
      }

      return true;
    });
  }, [baseSolagemOrders, filterPeriod, filterCategoria, searchQuery, saleOrders]);

  useEffect(() => {
    const hasUserFilters = !!searchQuery.trim() || filterPeriod !== 'all' || filterCategoria !== 'all';
    const hasHiddenOrders = baseSolagemOrders.length > 0 && solagemOrders.length === 0;

    if (!didAutoResetFilters.current && hasUserFilters && hasHiddenOrders) {
      didAutoResetFilters.current = true;
      setSearchQuery('');
      setFilterPeriod('all');
      setFilterCategoria('all');
    }
  }, [baseSolagemOrders.length, solagemOrders.length, searchQuery, filterPeriod, filterCategoria, setSearchQuery, setFilterPeriod, setFilterCategoria]);

   // Aggregate sole demand by color and size
   const soleData = useMemo(() => {
     const map = new Map<string, { color: string; sizes: Record<string, number>; total: number; silk?: any }>();

    for (const order of solagemOrders) {
      const scaledGrade = getGradeForOrder(order);

      for (const [size, qty] of Object.entries(scaledGrade)) {
        const q = Number(qty) || 0;
        if (q <= 0) continue;
        const sizeNum = Number(size);
        if (isNaN(sizeNum)) continue;
         const soleColor = getSoleColorForOrder(order.id, order.color);
         
         const mapping = soleRefMappings.find(m => m.sheet_id === order.reference_id && m.product_color === order.color);
         const soleProductId = mapping?.sole_product_id;
         const so = saleOrders.find((s: any) => s.id === order.sale_order_id);
         const clientId = so?.client_id;
         const economicGroupId = so?.economic_group_id;
 
         let effectiveSilk: any = null;
         if (soleProductId) {
           effectiveSilk = silkRegistrations.find(s => s.sole_product_id === soleProductId && s.client_id === clientId);
           if (!effectiveSilk && economicGroupId) {
             effectiveSilk = silkRegistrations.find(s => s.sole_product_id === soleProductId && s.economic_group_id === economicGroupId);
           }
           if (!effectiveSilk) {
             effectiveSilk = silkRegistrations.find(s => s.sole_product_id === soleProductId && !s.client_id && !s.economic_group_id);
           }
         }
 
         const groupKey = `${soleColor}_${effectiveSilk?.silk_name || 'no_silk'}`;
 
         if (!map.has(groupKey)) {
           map.set(groupKey, { color: soleColor, sizes: {}, total: 0, silk: effectiveSilk });
         }
         const row = map.get(groupKey)!;
        row.sizes[size] = (row.sizes[size] || 0) + q;
        row.total += q;
      }
    }

    return Array.from(map.values()).filter(r => r.total > 0);
    // soleRefMappings/saleOrders/silkRegistrations are read inside the loop body
    // — must be in deps so soleData re-computes when they change.
  }, [solagemOrders, soleColorOverrides, soleRefMappings, saleOrders, silkRegistrations]);

  const activeSizes = SIZES.filter(s => soleData.some(r => (r.sizes[s] || 0) > 0));
  const grandTotal = soleData.reduce((s, r) => s + r.total, 0);

  const printSoleList = () => {
    const sizeTotals: Record<string, number> = {};
    activeSizes.forEach(s => { sizeTotals[s] = 0; });

     let rowsHtml = '';
     soleData.forEach(row => {
       rowsHtml += '<tr>';
       rowsHtml += `<td style="border:1px solid #999;padding:4px 8px;font-weight:600;font-size:11px;">
         ${row.color}
         ${row.silk ? `<br/><span style="font-size:9px;color:#666;font-weight:400;">Silk: ${row.silk.silk_name}</span>` : ''}
       </td>`;
       activeSizes.forEach(s => {
        const qty = row.sizes[s] || 0;
        sizeTotals[s] += qty;
        rowsHtml += `<td style="border:1px solid #999;padding:4px 8px;text-align:center;font-family:monospace;font-size:12px;font-weight:${qty > 0 ? '700' : '400'}">${qty || ''}</td>`;
      });
      rowsHtml += `<td style="border:1px solid #999;padding:4px 8px;text-align:center;font-family:monospace;font-weight:700;font-size:12px;background:#f5f5f0;">${row.total}</td>`;
      rowsHtml += '</tr>';
    });

    rowsHtml += '<tr style="background:#e8e8d0;font-weight:700;border-top:2px solid #333;">';
    rowsHtml += '<td style="border:1px solid #999;padding:4px 8px;text-align:right;font-size:11px;">TOTAL</td>';
    activeSizes.forEach(s => {
      rowsHtml += `<td style="border:1px solid #999;padding:4px 8px;text-align:center;font-family:monospace;font-size:12px;">${sizeTotals[s] || ''}</td>`;
    });
    rowsHtml += `<td style="border:1px solid #999;padding:4px 8px;text-align:center;font-family:monospace;font-size:13px;">${grandTotal}</td>`;
    rowsHtml += '</tr>';

    // Detail per OP
    let detailHtml = '<h2 style="font-size:13px;margin:20px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px;">Detalhamento por OP</h2>';
    solagemOrders.forEach(order => {
      const ref = references.find(r => r.id === order.reference_id);
      const scaledGrade = getGradeForOrder(order);
      const totalPairs = getGradeSum(scaledGrade);
      const gradeStr = activeSizes.map(s => `${s}:${scaledGrade[s] || 0}`).join(' | ');
      detailHtml += `<p style="font-size:10px;margin:2px 0;"><strong>${order.order_number}</strong> — ${ref?.code || ''} ${ref?.name || ''} — Cor: ${order.color || '—'} — ${gradeStr} = <strong>${totalPairs} pares</strong></p>`;
    });

     // Silk Artworks Section
     let silkArtworksHtml = '';
     const uniqueSilks = Array.from(new Set(soleData.map(d => d.silk).filter(Boolean)));
     if (uniqueSilks.length > 0) {
       silkArtworksHtml = '<h2 style="font-size:13px;margin:20px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px;">Artes de Silk</h2>';
       silkArtworksHtml += '<div style="display:flex;flex-wrap:wrap;gap:12px;">';
       uniqueSilks.forEach((silk: any) => {
         silkArtworksHtml += `
           <div style="border:1px solid #ddd;padding:6px;border-radius:4px;text-align:center;width:120px;">
             <p style="font-size:10px;font-weight:700;margin-bottom:4px;">${silk.silk_name}</p>
             ${silk.silk_url ? `<img src="${silk.silk_url}" style="width:100%;height:100px;object-contain:fit;background:#fff;border:1px solid #eee;"/>` : '<div style="height:100px;display:flex;align-items:center;justify-content:center;font-size:10px;color:#999;background:#f9f9f9;">Sem imagem</div>'}
           </div>
         `;
       });
       silkArtworksHtml += '</div>';
     }
 
     const html = `
       <h1 style="font-size:16px;margin-bottom:4px;">🦶 Demanda de Solados</h1>
       <p style="font-size:10px;color:#666;margin-bottom:12px;">Gerado em ${new Date().toLocaleString('pt-BR')} | ${solagemOrders.length} OP(s)</p>
       <table style="width:100%;border-collapse:collapse;">
         <thead>
           <tr style="background:#e8e8d0;">
             <th style="border:1px solid #999;padding:4px 8px;text-align:left;font-size:11px;">Cor Solado</th>
             ${activeSizes.map(s => `<th style="border:1px solid #999;padding:4px 8px;text-align:center;font-size:11px;">${s}</th>`).join('')}
             <th style="border:1px solid #999;padding:4px 8px;text-align:center;font-size:11px;background:#e0e0c8;">Total</th>
           </tr>
         </thead>
         <tbody>${rowsHtml}</tbody>
       </table>
       ${silkArtworksHtml}
       ${detailHtml}
     `;
    printHtml('Demanda de Solados', html);
  };

  return (
    
      <div className="space-y-5 page-enter">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h1 className="display text-xl tracking-tight flex items-center gap-2">
              <Footprints className="h-6 w-6 text-primary" />
              Setor de Solagem
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Grade de solados por cor e numeração
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {selectedOrders.size > 0 && (
              <Button 
                size="sm" 
                className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 shadow-sm"
                onClick={handleFinishSelectedOrders}
                disabled={finalizingOrders}
              >
                {finalizingOrders ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Finalizar {selectedOrders.size} OP(s)
              </Button>
            )}
            <OrderSearchBar value={searchQuery} onChange={setSearchQuery} />
            <div className="flex items-center gap-2">
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
            <Select value={filterPeriod} onValueChange={setFilterPeriod}>
              <SelectTrigger className="w-[160px] h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os Prazos</SelectItem>
                <SelectItem value="week">Esta Semana</SelectItem>
                <SelectItem value="15days">Próximos 15 dias</SelectItem>
                <SelectItem value="month">Este Mês</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterCategoria} onValueChange={setFilterCategoria}>
              <SelectTrigger className="w-[140px] h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas Linhas</SelectItem>
                <SelectItem value="infantil">Infantil</SelectItem>
                <SelectItem value="adulto">Adulto</SelectItem>
              </SelectContent>
            </Select>
            {selectedOrders.size > 0 && (
              <Button size="sm" variant="outline" onClick={() => {
                const ids = solagemOrders.filter(o => selectedOrders.has(o.id)).map(o => o.id).join(',');
                navigate(`/orders/grouped-summary?sector=solagem&ids=${ids}`);
              }}>
                <Layers className="h-3.5 w-3.5 mr-1" /> Agrupar ({selectedOrders.size})
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setShowDetail(v => !v)}>
              <ListChecks className="h-3.5 w-3.5 mr-1" /> {showDetail ? 'Ocultar Detalhes' : 'Resumo Detalhado'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => {
              const sizeTotals: Record<string, number> = {};
              activeSizes.forEach(s => { sizeTotals[s] = 0; });
               let rowsHtml = '';
               soleData.forEach(row => {
                 rowsHtml += `<tr><td style="border:1px solid #999;padding:4px 8px;font-weight:600;font-size:11px;">
                   ${row.color}
                   ${row.silk ? `<br/><span style="font-size:9px;color:#666;font-weight:400;">Silk: ${row.silk.silk_name}</span>` : ''}
                 </td>`;
                 activeSizes.forEach(s => { const qty = row.sizes[s] || 0; sizeTotals[s] += qty; rowsHtml += `<td style="border:1px solid #999;padding:4px 8px;text-align:center;font-family:monospace;font-size:12px;font-weight:${qty > 0 ? '700' : '400'}">${qty || ''}</td>`; });
                 rowsHtml += `<td style="border:1px solid #999;padding:4px 8px;text-align:center;font-family:monospace;font-weight:700;font-size:12px;background:#f5f5f0;">${row.total}</td></tr>`;
               });
              rowsHtml += `<tr style="background:#e8e8d0;font-weight:700;border-top:2px solid #333;"><td style="border:1px solid #999;padding:4px 8px;text-align:right;font-size:11px;">TOTAL</td>`;
              activeSizes.forEach(s => { rowsHtml += `<td style="border:1px solid #999;padding:4px 8px;text-align:center;font-family:monospace;font-size:12px;">${sizeTotals[s] || ''}</td>`; });
              rowsHtml += `<td style="border:1px solid #999;padding:4px 8px;text-align:center;font-family:monospace;font-size:13px;">${grandTotal}</td></tr>`;

              // Collect unique client order numbers
              const clientOrderNumbers = new Set<string>();
              solagemOrders.forEach(order => {
                const so = saleOrders.find((s: any) => s.id === order.sale_order_id);
                if (so?.order_number) clientOrderNumbers.add(so.order_number);
                if (so?.client_order_number) clientOrderNumbers.add(`Ped. ${so.client_order_number}`);
              });

               let silkArtworksHtml = '';
               const uniqueSilks = Array.from(new Set(soleData.map(d => d.silk).filter(Boolean)));
               if (uniqueSilks.length > 0) {
                 silkArtworksHtml = '<h2 style="font-size:13px;margin:16px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px;">Artes de Silk</h2>';
                 silkArtworksHtml += '<div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:16px;">';
                 uniqueSilks.forEach((silk: any) => {
                   silkArtworksHtml += `
                     <div style="border:1px solid #ddd;padding:6px;border-radius:4px;text-align:center;width:120px;">
                       <p style="font-size:10px;font-weight:700;margin-bottom:4px;">${silk.silk_name}</p>
                       ${silk.silk_url ? `<img src="${silk.silk_url}" style="width:100%;height:100px;object-fit:contain;background:#fff;border:1px solid #eee;"/>` : '<div style="height:100px;display:flex;align-items:center;justify-content:center;font-size:10px;color:#999;background:#f9f9f9;">Sem imagem</div>'}
                     </div>
                   `;
                 });
                 silkArtworksHtml += '</div>';
               }
 
               const html = `
                 <h1 style="font-size:18px;margin-bottom:4px;">🦶 Relatório do Setor de Solagem</h1>
                 <p style="font-size:10px;color:#666;margin-bottom:12px;">Gerado em ${new Date().toLocaleString('pt-BR')}</p>
                 <div style="display:flex;gap:24px;margin-bottom:16px;">
                   <div style="text-align:center;padding:8px 16px;background:#f5f5f0;border:1px solid #ddd;border-radius:6px;"><p style="font-size:20px;font-weight:700;color:#333;">${solagemOrders.length}</p><p style="font-size:10px;color:#666;">OPs</p></div>
                   ${soleData.map(d => `<div style="text-align:center;padding:8px 16px;background:#f5f5f0;border:1px solid #ddd;border-radius:6px;"><p style="font-size:20px;font-weight:700;color:#333;">${d.total}</p><p style="font-size:10px;color:#666;">${d.color} (pares)</p></div>`).join('')}
                   <div style="text-align:center;padding:8px 16px;background:#f5f5f0;border:1px solid #ddd;border-radius:6px;"><p style="font-size:20px;font-weight:700;color:#333;">${grandTotal}</p><p style="font-size:10px;color:#666;">Total Geral</p></div>
                 </div>
                 <h2 style="font-size:13px;margin:8px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px;">Grade Consolidada por Cor de Solado</h2>
                 <table style="width:100%;border-collapse:collapse;margin-bottom:16px;"><thead><tr style="background:#e8e8d0;">
                   <th style="border:1px solid #999;padding:4px 8px;text-align:left;font-size:11px;">Cor Solado</th>
                   ${activeSizes.map(s => `<th style="border:1px solid #999;padding:4px 8px;text-align:center;font-size:11px;">${s}</th>`).join('')}
                   <th style="border:1px solid #999;padding:4px 8px;text-align:center;font-size:11px;background:#e0e0c8;">Total</th>
                 </tr></thead><tbody>${rowsHtml}</tbody></table>
                 ${silkArtworksHtml}
                 ${clientOrderNumbers.size > 0 ? `
                 <h2 style="font-size:13px;margin:16px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px;">Pedidos Englobados</h2>
                 <p style="font-size:11px;line-height:1.6;">${Array.from(clientOrderNumbers).join(' &nbsp;•&nbsp; ')}</p>
                 ` : ''}`;
              printHtml('Relatório Solagem', html);
            }} disabled={soleData.length === 0}>
              <Printer className="h-3.5 w-3.5 mr-1" /> Relatório PDF
            </Button>
            <Button size="sm" onClick={printSoleList} disabled={soleData.length === 0}>
              <Printer className="h-4 w-4 mr-1" /> Imprimir
            </Button>
            <WorkSheetSettingsButton />
            <Button size="sm" variant="outline" disabled={selectedOrders.size === 0} onClick={() => {
              const ordersToPrint = solagemOrders.filter(o => selectedOrders.has(o.id));
              printSectorWorkSheets({
                sectorName: 'Solagem',
                sectorEmoji: '🦶',
                orders: ordersToPrint as any,
                references: references as any,
                saleOrders: saleOrders as any,
                getStrapsLabel,
                getSoleColor: getSoleColorForSize,
                getSoleReference: (order: any) => getSoleReferenceName(order),
              });
            }}>
              <Printer className="h-3.5 w-3.5 mr-1" /> Fichas Operador {selectedOrders.size > 0 ? `(${selectedOrders.size})` : ''}
            </Button>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-4 text-center">
              <p className="display text-2xl tabular-nums text-primary">{solagemOrders.length}</p>
              <p className="text-xs text-muted-foreground">OPs p/ Solagem</p>
            </CardContent>
          </Card>
          {soleData.map(row => (
              <Card key={row.color}>
                <CardContent className="p-4 text-center">
                  <p className="display text-2xl tabular-nums text-foreground">{row.total}</p>
                  <p className="text-xs text-muted-foreground">{row.color} (pares)</p>
                </CardContent>
              </Card>
          ))}
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-4">
            {soleData.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                Nenhuma demanda de solado no momento.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs font-bold">Cor Solado</TableHead>
                      {activeSizes.map(s => (
                        <TableHead key={s} className="text-xs text-center w-16">{s}</TableHead>
                      ))}
                      <TableHead className="text-xs text-center font-bold bg-muted">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {soleData.map(row => (
                      <TableRow key={row.color}>
                        <TableCell className="text-sm font-semibold">{row.color}</TableCell>
                        {activeSizes.map(s => (
                          <TableCell key={s} className="text-sm text-center font-mono font-semibold">
                            {row.sizes[s] || ''}
                          </TableCell>
                        ))}
                        <TableCell className="text-sm text-center font-mono font-bold bg-muted">{row.total}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/50 font-bold border-t-2">
                      <TableCell className="text-xs text-right font-bold">TOTAL</TableCell>
                      {activeSizes.map(s => (
                        <TableCell key={s} className="text-sm text-center font-mono font-bold">
                          {soleData.reduce((sum, r) => sum + (r.sizes[s] || 0), 0)}
                        </TableCell>
                      ))}
                      <TableCell className="text-sm text-center font-mono font-bold bg-muted">{grandTotal}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Per-OP sole color breakdown */}
        {showDetail && solagemOrders.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <h3 className="text-sm font-bold mb-3">Grade de Solado por OP</h3>
              <div className="space-y-4">
                {solagemOrders.map(order => {
                  const ref = references.find(r => r.id === order.reference_id);
                  const baseGrade = getPositiveGrade(order.grade);
                  const scaledGrade = getGradeForOrder(order);
                  const gradeSum = getGradeSum(baseGrade);
                  const totalPairs = getGradeSum(scaledGrade);
                  const multiplier = gradeSum > 0 ? totalPairs / gradeSum : 0;
                  const orderActiveSizes = SIZES.filter(s => Number(scaledGrade[s]) > 0);
                  const soleColorLabel = getSoleColorForSize(order.color);

                  const solagemStage = solagemStagesByOrderId.get(order.id);
                  const stageColor = solagemStage?.status === 'concluido' ? 'border-l-emerald-500' : solagemStage?.status === 'em_andamento' ? 'border-l-amber-500' : 'border-l-red-500';

                  return (
                    <div key={order.id} className={`border rounded-lg p-3 space-y-2 border-l-4 ${stageColor} ${selectedOrders.has(order.id) ? 'ring-2 ring-success' : ''}`}>
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Checkbox
                              checked={selectedOrders.has(order.id)}
                              onCheckedChange={() => toggleOrderSelection(order.id)}
                            />
                            <Badge variant="outline" className="text-[10px] shrink-0">{order.order_number}</Badge>
                            <span className="text-xs font-semibold">{ref?.code} {ref?.name}</span>
                            <span className="text-xs text-muted-foreground">Cor: <strong className="text-foreground">{order.color || '—'}</strong></span>
                            {(() => { const sl = getStrapsLabel(order); return sl ? (
                              <span className="text-[10px] font-bold text-destructive">🎨 {sl}</span>
                            ) : null; })()}
                            <Badge
                              className="text-[10px]"
                              variant="secondary"
                            >
                              Solado: {soleColorLabel}
                            </Badge>
                            {(() => {
                              const soleRef = getSoleReferenceName(order);
                              return soleRef ? (
                                <Badge className="text-[10px]" variant="outline">
                                  Ref. Solo: {soleRef}
                                </Badge>
                              ) : null;
                            })()}
                            {(() => {
                              const info = getDeliveryInfo(order);
                              return info.deadline ? (
                                <span className="flex items-center gap-1">
                                  {info.isAdiantado && <Badge className="bg-amber-500 text-white text-[9px] px-1.5">ADIANTADO</Badge>}
                                  <span className="text-[10px] text-muted-foreground">Fat: {info.deadlineFormatted}</span>
                                </span>
                              ) : null;
                            })()}
                          </div>
                          <span className="text-xs font-bold">{totalPairs} pares</span>
                        </div>
                        {(() => {
                          const so = saleOrders.find((s: any) => s.id === order.sale_order_id);
                          return so ? (
                            <p className="text-[10px] text-muted-foreground ml-7">
                              📦 <span className="font-semibold">{so.order_number}</span>
                              {so.client_order_number ? <> | Ped. Cliente: <span className="font-semibold">{so.client_order_number}</span></> : null}
                              {so.client_name ? <> | {so.client_name}</> : null}
                            </p>
                          ) : null;
                        })()}
                      </div>
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-[10px]">Tipo</TableHead>
                              {orderActiveSizes.map(s => (
                                <TableHead key={s} className="text-[10px] text-center w-14">{s}</TableHead>
                              ))}
                              <TableHead className="text-[10px] text-center font-bold bg-muted">Total</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            <TableRow>
                              <TableCell className="text-[10px] font-medium">Por ficha</TableCell>
                              {orderActiveSizes.map(s => (
                                <TableCell key={s} className="text-xs text-center font-mono">{baseGrade[s] || 0}</TableCell>
                              ))}
                              <TableCell className="text-xs text-center font-mono bg-muted">{gradeSum}</TableCell>
                            </TableRow>
                            <TableRow className="bg-muted/50 font-bold">
                              <TableCell className="text-[10px] font-bold">Total ({Math.ceil(multiplier)} fichas)</TableCell>
                              {orderActiveSizes.map(s => (
                                <TableCell key={s} className="text-xs text-center font-mono font-bold">
                                  {scaledGrade[s] || 0}
                                </TableCell>
                              ))}
                              <TableCell className="text-xs text-center font-mono font-bold bg-muted">{totalPairs}</TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    
  );
}
