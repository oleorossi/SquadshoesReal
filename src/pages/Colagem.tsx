
import { useMemo, useState } from 'react';
import { SignedImage } from '@/components/ui/signed-image';
import { useNavigate } from 'react-router-dom';
import { usePersistedState } from '@/hooks/usePersistedState';
import { Scissors, Printer, Funnel as Filter, CheckCircle as CheckCircle2, CaretDown as ChevronDown, CaretRight as ChevronRight, Storefront as Store, Buildings as Building2, Stack as Layers } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/empty-state';
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
import { normalizeForSearch } from '@/lib/searchUtils';
import { useOrderStraps } from '@/hooks/useOrderStraps';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';

const SIZES = ['17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33','34','35','36','37','38','39','40','41','42','43','44','45'];

const SECTOR_NAME = 'Colagem';
const SECTOR_EMOJI = '💨';

export default function Colagem() {
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
  const [filterStatus, setFilterStatus] = usePersistedState<string>('filterStatus', 'active');
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [finalizingOrders, setFinalizingOrders] = useState(false);
  const { finalizeSectorTask } = useProductionTransitions();

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [collapsedSaleOrders, setCollapsedSaleOrders] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = usePersistedState('searchQuery', '');

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
    if (selectedOrders.size === aviamentoOrders.length) {
      setSelectedOrders(new Set());
    } else {
      setSelectedOrders(new Set(aviamentoOrders.map(o => o.id)));
    }
  };

  const handleFinishSelectedOrders = async () => {
    if (selectedOrders.size === 0) return;
    setFinalizingOrders(true);
    try {
      const orderIds = Array.from(selectedOrders);
      
      const results = (await Promise.all(
        orderIds.map(orderId => finalizeSectorTask(orderId, 'Aviamento'))
      )) as any[];

      const successCount = results.filter(r => r && r.success).length;

      if (successCount > 0) {
        toast.success(`Aviamento finalizado para ${successCount} OP(s)!`);
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


  const aviamentoOrders = useMemo(() => {
    const q = normalizeForSearch(searchQuery);
    const filtered = orders.filter(order => {
      const status = (order.status || '').toLowerCase();
      if (filterStatus === 'active' && status !== 'em produção') return false;

      const stages = allStages.filter(s => s.order_id === order.id);
      const stage = stages.find(s => s.stage_name === 'Aviamento');
      if (!stage) return filterStatus === 'all';
      if (filterStatus === 'active' && stage.status !== 'pendente' && stage.status !== 'em_andamento') return false;

      if (q) {
        const so = saleOrders.find((s: any) => s.id === order.sale_order_id);
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
    let { ref, grade, activeSizes, gradeSum, totalPairs, pairsPerFicha, totalFichas, imageUrl } = buildPrintContent(order);

    if (!imageUrl && ref) {
      const { data: prodRef } = await supabase
        .from('product_references')
        .select('image_url')
        .eq('technical_sheet_id', ref.id)
        .maybeSingle();
      if (prodRef?.image_url) imageUrl = prodRef.image_url;
    }

    // Fetch client SILK logo
    const silkLogoUrl = await getClientLogoUrl(order);

    const imageHtml = imageUrl
      ? `<img src="${imageUrl}" style="width:200px;height:200px;object-fit:contain;border:1px solid #ddd;border-radius:6px;" />`
      : `<div style="width:200px;height:200px;background:#f0f0f0;border:1px solid #ddd;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#999;font-size:10px;">Sem foto</div>`;

    const silkHtml = `<img src="${silkLogoUrl}" style="width:100px;height:100px;object-fit:contain;" />`;

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
          <h1 style="font-size:16px;margin-bottom:2px;">🧷 Ficha de Aviamento</h1>
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
        Controle de Aviamento — ${totalFichas} fichas (${totalPairs} pares | ${pairsPerFicha} pares/ficha)
      </h2>
      <p style="font-size:9px;color:#666;margin-bottom:8px;">Marque cada quadrado conforme concluir a ficha de ${pairsPerFicha} pares.</p>
      <div style="display:flex;flex-wrap:wrap;gap:0;">
        ${squaresHtml}
      </div>
    `;

    printHtml(`Aviamento - ${order.order_number}`, html);
  };

  return (
    
      <div className="space-y-5 page-enter">
        <EditorialPageHeader
          sectionLabel="PRODUÇÃO · COLAGEM"
          title="Setor de Aviamento"
          description="Fichas de controle com checklist de pares para aviamento"
          actions={<>
            {selectedOrders.size > 0 && (
              <Button size="sm" variant="outline" onClick={() => {
                const ids = aviamentoOrders.filter(o => selectedOrders.has(o.id)).map(o => o.id).join(',');
                navigate(`/orders/grouped-summary?sector=colagem&ids=${ids}`);
              }}>
                <Layers className="h-3.5 w-3.5 mr-1" /> Agrupar ({selectedOrders.size})
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={async () => {
              // Use only selected orders, or all if none selected
              const ordersToprint = selectedOrders.size > 0
                ? aviamentoOrders.filter(o => selectedOrders.has(o.id))
                : aviamentoOrders;

              if (ordersToprint.length === 0) {
                toast.info('Nenhuma OP selecionada para o relatório.');
                return;
              }

              const printWin = openPrintWindow('Relatório Aviamento');

              const pairsPerFicha = 12;

              // --- GROUP BY REFERENCE + COLOR ---
              const groupMap = new Map<string, {
                refId: string;
                refCode: string;
                refName: string;
                color: string;
                imageUrl: string;
                sizes: Record<string, number>;
                baseGrade: Record<string, number>;
                baseGradeSum: number;
                totalPairs: number;
                opNumbers: string[];
                strapsLabel?: string;
              }>();

              for (const order of ordersToprint) {
                const r = references.find(x => x.id === order.reference_id);
                const g = order.grade as Record<string, number> | null;
                const gSum = g ? Object.values(g).reduce((a, v) => a + Number(v), 0) : 0;
                const tp = order.quantity || gSum || 0;
                const multiplier = gSum > 0 ? tp / gSum : 0;
                const color = order.color || '—';
                const colorKey = (color).trim().toUpperCase().normalize('NFC');
                const strapsLabel = getStrapsLabel(order) || '';
                const strapsKey = (strapsLabel || '__NO_STRAPS__').trim().toUpperCase().normalize('NFC');
                const key = `${order.reference_id}|${colorKey}|${strapsKey}`;

                if (!groupMap.has(key)) {
                  const imageUrl = ((r as any)?.images as string[] | undefined)?.[0] || r?.image_url || '';
                  const baseGrade: Record<string, number> = {};
                  if (g) {
                    for (const s of SIZES) {
                      const qty = Number(g[s]) || 0;
                      if (qty > 0) baseGrade[s] = qty;
                    }
                  }
                  const baseGradeSum = Object.values(baseGrade).reduce((sum, value) => sum + value, 0);

                  groupMap.set(key, {
                    refId: order.reference_id,
                    refCode: r?.code || '',
                    refName: r?.name || '',
                    color,
                    imageUrl,
                    sizes: {},
                    baseGrade,
                    baseGradeSum,
                    totalPairs: 0,
                    opNumbers: [],
                    strapsLabel: strapsLabel || undefined,
                  });
                }
                const group = groupMap.get(key)!;
                group.opNumbers.push(order.order_number);
                group.totalPairs += tp;
                if (!group.strapsLabel && strapsLabel) group.strapsLabel = strapsLabel;
                if (g) {
                  for (const s of SIZES) {
                    const qty = Number(g[s]) || 0;
                    if (qty > 0) group.sizes[s] = (group.sizes[s] || 0) + Math.round(qty * multiplier);
                  }
                }
              }

              const groups = Array.from(groupMap.values());
              const totalPairs = groups.reduce((s, g) => s + g.totalPairs, 0);

              // Active sizes across all groups
              const allActiveSizes = SIZES.filter(s => groups.some(g => (g.sizes[s] || 0) > 0));
              const sizeTotals: Record<string, number> = {};
              allActiveSizes.forEach(s => { sizeTotals[s] = 0; });

              // --- SUMMARY TABLE grouped by ref+color ---
              let summaryRows = '';
              groups.forEach(group => {
                summaryRows += `<tr>`;
                summaryRows += `<td style="border:1px solid #999;padding:3px 6px;font-size:10px;font-weight:600;">${group.refCode} ${group.refName}</td>`;
                summaryRows += `<td style="border:1px solid #999;padding:3px 6px;font-size:10px;">${group.color}</td>`;
                summaryRows += `<td style="border:1px solid #999;padding:3px 6px;font-size:9px;">${group.opNumbers.join(', ')}</td>`;
                allActiveSizes.forEach(s => {
                  const qty = group.sizes[s] || 0;
                  sizeTotals[s] += qty;
                  summaryRows += `<td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-size:11px;font-weight:${qty > 0 ? '700' : '400'}">${qty || ''}</td>`;
                });
                summaryRows += `<td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-weight:700;font-size:11px;background:#f5f5f0;">${group.totalPairs}</td>`;
                summaryRows += `</tr>`;
              });
              summaryRows += `<tr style="background:#e8e8d0;font-weight:700;border-top:2px solid #333;">`;
              summaryRows += `<td colspan="3" style="border:1px solid #999;padding:3px 6px;text-align:right;font-size:10px;">TOTAL</td>`;
              allActiveSizes.forEach(s => {
                summaryRows += `<td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-size:11px;">${sizeTotals[s] || ''}</td>`;
              });
              summaryRows += `<td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-size:12px;font-weight:700;">${totalPairs}</td>`;
              summaryRows += `</tr>`;

              // --- CHECKLIST CARDS grouped by ref+color ---
              let opChecklistHtml = '';
              for (const group of groups) {
                const totalFichas = Math.ceil(group.totalPairs / pairsPerFicha);
                const oSizes = SIZES.filter(s => (group.sizes[s] || 0) > 0);

                const imgTag = group.imageUrl
                  ? `<img src="${group.imageUrl}" style="width:100px;height:100px;object-fit:contain;border:1px solid #ddd;border-radius:4px;" />`
                  : `<div style="width:100px;height:100px;background:#f0f0f0;border:1px solid #ddd;border-radius:4px;display:flex;align-items:center;justify-content:center;color:#aaa;font-size:7px;">—</div>`;

                let gradeInline = '';
                if (oSizes.length > 0) {
                  const baseActiveSizes = oSizes.filter(s => (group.baseGrade[s] || 0) > 0 || (group.sizes[s] || 0) > 0);
                  const headerCells = baseActiveSizes.map(s =>
                    `<th style="border:1px solid #bbb;padding:1px 4px;text-align:center;font-size:8px;background:#e8e8d0;">${s}</th>`
                  ).join('');
                  const baseGradeCells = baseActiveSizes.map(s =>
                    `<td style="border:1px solid #bbb;padding:1px 4px;text-align:center;font-family:monospace;font-size:9px;font-weight:600;color:#666;background:#f9f9f0;">${group.baseGrade[s] || ''}</td>`
                  ).join('');
                  const gradeCells = baseActiveSizes.map(s =>
                    `<td style="border:1px solid #bbb;padding:1px 4px;text-align:center;font-family:monospace;font-size:9px;font-weight:700;">${group.sizes[s] || 0}</td>`
                  ).join('');
                  gradeInline = `<table style="border-collapse:collapse;margin-top:3px;display:inline-table;">
                    <tr><th style="border:1px solid #bbb;padding:1px 4px;text-align:left;font-size:8px;background:#e8e8d0;">Tipo</th>${headerCells}<th style="border:1px solid #bbb;padding:1px 4px;text-align:center;font-size:8px;background:#e0e0c8;">Tot</th></tr>
                    ${group.baseGradeSum > 0 ? `<tr style="background:#f9f9f0;"><td style="border:1px solid #bbb;padding:1px 4px;text-align:left;font-size:8px;font-weight:700;color:#666;">1 FICHA</td>${baseGradeCells}<td style="border:1px solid #bbb;padding:1px 4px;text-align:center;font-family:monospace;font-size:9px;font-weight:700;color:#666;background:#f5f5e8;">${group.baseGradeSum}</td></tr>` : ''}
                    <tr><td style="border:1px solid #bbb;padding:1px 4px;text-align:left;font-size:8px;font-weight:700;">TOTAL</td>${gradeCells}<td style="border:1px solid #bbb;padding:1px 4px;text-align:center;font-family:monospace;font-size:9px;font-weight:700;background:#f5f5f0;">${group.totalPairs}</td></tr>
                  </table>`;
                }

                const squaresHtml = Array.from({ length: totalFichas }, (_, i) =>
                  `<div style="width:30px;height:30px;border:2px solid #333;border-radius:2px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;color:#cc0000;margin:1px;font-weight:700;font-family:'JetBrains Mono',monospace;">${i + 1}</div>`
                ).join('');

                opChecklistHtml += `
                  <div style="border:1px solid #ddd;border-radius:6px;padding:8px;margin-bottom:8px;border-left:3px solid #8B7355;page-break-inside:avoid;">
                    <div style="display:flex;gap:8px;align-items:flex-start;">
                      ${imgTag}
                      <div style="flex:1;min-width:0;">
                        <div style="display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;">
                          <span style="font-size:12px;font-weight:700;">🧷 ${group.refCode} — ${group.refName}</span>
                          <span style="font-size:9px;">Cor: <strong>${group.color}</strong></span>
                          <span style="font-size:9px;"><strong>${group.totalPairs}</strong> pares · <strong>${totalFichas}</strong> fichas</span>
                        </div>
                        <p style="font-size:8px;color:#888;margin:2px 0;">OPs: ${group.opNumbers.join(', ')}</p>
                        ${gradeInline}
                        <div style="margin-top:4px;">
                          <p style="font-size:8px;color:#888;margin-bottom:2px;">Corrugado 12 pares — marque ✕ a cada ficha concluída:</p>
                          <div style="display:flex;flex-wrap:wrap;gap:0;">${squaresHtml}</div>
                        </div>
                      </div>
                    </div>
                  </div>`;
              }

              // --- INDIVIDUAL OP DETAIL PAGES ---
              let opsHtml = '';
              for (const order of ordersToprint) {
                let { ref, grade, activeSizes, gradeSum, totalPairs: tp, totalFichas, imageUrl } = buildPrintContent(order);

                if (!imageUrl && ref) {
                  const { data: prodRef } = await supabase
                    .from('product_references')
                    .select('image_url')
                    .eq('technical_sheet_id', ref.id)
                    .maybeSingle();
                  if (prodRef?.image_url) imageUrl = prodRef.image_url;
                }

                const silkLogoUrl = await getClientLogoUrl(order);

                const imageHtml = imageUrl
                  ? `<img src="${imageUrl}" style="width:200px;height:200px;object-fit:contain;border:1px solid #ddd;border-radius:6px;" />`
                  : `<div style="width:200px;height:200px;background:#f0f0f0;border:1px solid #ddd;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#999;font-size:10px;">Sem foto</div>`;

                let gradeHtml = '';
                if (grade && activeSizes.length > 0) {
                  gradeHtml = `<table style="border-collapse:collapse;margin-top:4px;"><tr style="background:#e8e8d0;">${activeSizes.map(s => `<th style="border:1px solid #999;padding:2px 6px;font-size:10px;text-align:center;">${s}</th>`).join('')}<th style="border:1px solid #999;padding:2px 6px;font-size:10px;background:#e0e0c8;">Total</th></tr><tr>${activeSizes.map(s => `<td style="border:1px solid #999;padding:2px 6px;font-size:10px;text-align:center;font-family:monospace;font-weight:700;">${Number(grade[s]) || 0}</td>`).join('')}<td style="border:1px solid #999;padding:2px 6px;font-size:10px;text-align:center;font-family:monospace;font-weight:700;background:#f5f5f0;">${tp}</td></tr></table>`;
                }

                const squaresHtml = Array.from({ length: totalFichas }, (_, i) =>
                  `<div style="width:40px;height:40px;border:2px solid #333;border-radius:3px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;color:#555;margin:2px;font-weight:600;">${i + 1}</div>`
                ).join('');

                opsHtml += `
                  <div style="page-break-before:always;padding-top:8px;">
                    <div style="display:flex;gap:16px;align-items:flex-start;margin-bottom:16px;">
                      ${imageHtml}
                      <div style="flex:1;">
                        <h1 style="font-size:16px;margin-bottom:2px;">🧷 Ficha de Aviamento</h1>
                        <p style="font-size:12px;margin-bottom:8px;"><strong>OP:</strong> ${order.order_number}</p>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 16px;font-size:11px;">
                          <div><strong>Referência:</strong> ${ref?.code || ''} — ${ref?.name || ''}</div>
                          <div><strong>Cor:</strong> ${order.color || '—'}</div>
                          <div><strong>Quantidade:</strong> ${tp} pares</div>
                          <div><strong>Status:</strong> ${order.status}</div>
                        </div>
                        ${gradeHtml}
                      </div>
                      <div style="text-align:center;">
                        <p style="font-size:8px;color:#999;margin-bottom:2px;">SILK</p>
                        <img src="${silkLogoUrl}" style="width:100px;height:100px;object-fit:contain;" />
                      </div>
                    </div>
                    <h2 style="font-size:13px;margin:16px 0 8px;border-bottom:1px solid #ccc;padding-bottom:3px;">
                      Controle de Aviamento — ${totalFichas} fichas (${tp} pares | ${pairsPerFicha} pares/ficha)
                    </h2>
                    <p style="font-size:9px;color:#666;margin-bottom:8px;">Marque cada quadrado conforme concluir a ficha de ${pairsPerFicha} pares.</p>
                    <div style="display:flex;flex-wrap:wrap;gap:0;">${squaresHtml}</div>
                  </div>`;
              }

              // Fetch client SILK logo for report header (use first order)
              const reportSilkLogoUrl = await getClientLogoUrl(ordersToprint[0]);

              const html = `
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
                  <div>
                    <h1 style="font-size:18px;margin-bottom:4px;">🧷 Relatório do Setor de Aviamento</h1>
                    <p style="font-size:10px;color:#666;margin-bottom:12px;">Gerado em ${new Date().toLocaleString('pt-BR')} | ${ordersToprint.length} ${ordersToprint.length === 1 ? 'OP' : 'OPs'} | ${totalPairs} pares | ${groups.length} ${groups.length === 1 ? 'grupo' : 'grupos'} ref+cor</p>
                    <div style="display:flex;gap:16px;flex-wrap:wrap;">
                      <div style="text-align:center;padding:6px 14px;background:#f5f5f0;border:1px solid #ddd;border-radius:6px;"><p style="font-size:18px;font-weight:700;">${ordersToprint.length}</p><p style="font-size:9px;color:#666;">OPs</p></div>
                      <div style="text-align:center;padding:6px 14px;background:#f5f5f0;border:1px solid #ddd;border-radius:6px;"><p style="font-size:18px;font-weight:700;">${totalPairs}</p><p style="font-size:9px;color:#666;">Total Pares</p></div>
                      <div style="text-align:center;padding:6px 14px;background:#f5f5f0;border:1px solid #ddd;border-radius:6px;"><p style="font-size:18px;font-weight:700;">${Math.ceil(totalPairs / pairsPerFicha)}</p><p style="font-size:9px;color:#666;">Total Fichas</p></div>
                    </div>
                  </div>
                  <div style="text-align:center;flex-shrink:0;">
                    <p style="font-size:8px;color:#999;margin-bottom:2px;">SILK</p>
                    <img src="${reportSilkLogoUrl}" style="width:100px;height:100px;object-fit:contain;" />
                  </div>
                </div>
                <h2 style="font-size:13px;margin:8px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px;">Resumo Agrupado por Referência + Cor</h2>
                <table style="width:100%;border-collapse:collapse;margin-bottom:12px;">
                  <thead><tr style="background:#e8e8d0;">
                    <th style="border:1px solid #999;padding:4px 6px;text-align:left;font-size:10px;">Referência</th>
                    <th style="border:1px solid #999;padding:4px 6px;text-align:left;font-size:10px;">Cor</th>
                    <th style="border:1px solid #999;padding:4px 6px;text-align:left;font-size:10px;">OPs</th>
                    ${allActiveSizes.map(s => `<th style="border:1px solid #999;padding:4px 6px;text-align:center;font-size:10px;">${s}</th>`).join('')}
                    <th style="border:1px solid #999;padding:4px 6px;text-align:center;font-size:10px;background:#e0e0c8;">Total</th>
                  </tr></thead>
                  <tbody>${summaryRows}</tbody>
                </table>
                <h2 style="font-size:13px;margin:12px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px;">📋 Checklist Agrupado — Corrugado 12 pares</h2>
                ${opChecklistHtml}
                ${opsHtml}`;
              writePrintWindow(printWin, 'Relatório Aviamento', html);
            }} disabled={aviamentoOrders.length === 0}>
              <Printer className="h-3.5 w-3.5 mr-1" /> Relatório PDF
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
          </>}
        />

        {/* Stats */}
        <StatGrid>
          <StatCard
            label="OPs p/ Aviamento"
            value={aviamentoOrders.length}
            tone="primary"
          />
          <StatCard
            label="Total de Pares"
            value={aviamentoOrders.reduce((s, o) => s + (o.quantity || 0), 0)}
          />
        </StatGrid>

        {/* Orders list */}
        {aviamentoOrders.length === 0 ? (
          <EmptyState
            icon={Scissors}
            title="Nenhuma OP com aviamento pendente"
            description="Não há ordens de produção aguardando aviamento no momento."
          />
        ) : (
          <div className="space-y-3">
            {/* Select all button */}
            <div className="flex items-center gap-2 px-1">
              <Button
                size="sm"
                variant={selectedOrders.size === aviamentoOrders.length ? 'default' : 'outline'}
                onClick={toggleAllOrders}
                className="text-xs"
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                {selectedOrders.size === aviamentoOrders.length ? 'Desmarcar Tudo' : 'Selecionar Tudo'}
              </Button>
              {selectedOrders.size > 0 && (
                <span className="text-xs text-muted-foreground">
                  {selectedOrders.size} de {aviamentoOrders.length} selecionadas
                </span>
              )}
            </div>

            {/* Grouped by Economic Group > Sale Order > OPs */}
            {(() => {
              // Build hierarchy: economic_group -> sale_order -> orders
              type SaleOrderGroup = { saleOrderId: string; saleOrder: any; orders: typeof aviamentoOrders };
              type EconGroup = { econGroupId: string; econGroupName: string; saleOrderGroups: SaleOrderGroup[] };

              const getSaleOrderForOP = (op: any) => saleOrders.find((so: any) => so.id === op.sale_order_id);
              const getClientForSO = (so: any) => clients.find((c: any) => c.id === so.client_id || c.cnpj === so.client_cnpj);
              const getEconGroupForClient = (client: any) => client?.economic_group_id ? economicGroups.find((eg: any) => eg.id === client.economic_group_id) : null;

              const econMap = new Map<string, EconGroup>();

              aviamentoOrders.forEach(op => {
                const so = getSaleOrderForOP(op);
                const client = so ? getClientForSO(so) : null;
                const eg = getEconGroupForClient(client);
                const egKey = eg?.id || 'no_group';
                const egName = eg?.name || '';
                const soKey = op.sale_order_id || `solo_${op.id}`;

                if (!econMap.has(egKey)) {
                  econMap.set(egKey, { econGroupId: egKey, econGroupName: egName, saleOrderGroups: [] });
                }
                const econEntry = econMap.get(egKey)!;
                let soGroup = econEntry.saleOrderGroups.find(g => g.saleOrderId === soKey);
                if (!soGroup) {
                  soGroup = { saleOrderId: soKey, saleOrder: so, orders: [] };
                  econEntry.saleOrderGroups.push(soGroup);
                }
                soGroup.orders.push(op);
              });

              // Sort: named groups first, then ungrouped
              const sortedGroups = Array.from(econMap.values()).sort((a, b) => {
                if (a.econGroupId === 'no_group') return 1;
                if (b.econGroupId === 'no_group') return -1;
                return a.econGroupName.localeCompare(b.econGroupName);
              });

              const renderOPCard = (order: any) => {
                const { ref, grade, activeSizes, gradeSum, totalPairs, totalFichas, fichas, imageUrl } = buildPrintContent(order);
                const isExpanded = expandedOrderId === order.id;
                const isSelected = selectedOrders.has(order.id);

                  const aviamentoStage = allStages.find(s => s.order_id === order.id && s.stage_name === 'Aviamento');
                  const stageColor = aviamentoStage?.status === 'concluido' ? 'border-l-emerald-500' : aviamentoStage?.status === 'em_andamento' ? 'border-l-amber-500' : 'border-l-red-500';

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
                            {(() => {
                              const so = saleOrders.find((s: any) => s.id === order.sale_order_id);
                              return so ? (
                                <p className="text-[10px] text-muted-foreground ml-5 mt-0.5">
                                  📦 <span className="font-semibold">{so.order_number}</span>
                                  {so.client_order_number ? <> | Ped. Cliente: <span className="font-semibold">{so.client_order_number}</span></> : null}
                                  {so.client_name ? <> | {so.client_name}</> : null}
                                </p>
                              ) : null;
                            })()}
                            <p className="text-xs text-muted-foreground mt-0.5 ml-5">
                              Cor: <span className="font-medium text-foreground">{order.color || '—'}</span>
                              {' | '}
                              <span className="font-bold">{totalPairs} pares</span>
                              {' | '}
                              <span className="text-primary">{totalFichas} fichas</span>
                            </p>
                            {(() => { const sl = getStrapsLabel(order); return sl ? (
                              <p className="text-[10px] ml-5 mt-0.5">
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
                            <p className="text-xs">Fichas: <strong>{totalFichas}</strong> (12 pares/ficha)</p>
                            <p className="text-xs">Status: <Badge variant="secondary" className="text-[10px]">{order.status}</Badge></p>
                          </div>
                        </div>

                        {grade && activeSizes.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold mb-2">📋 Grade</p>
                            <div className="overflow-x-auto">
                              <Table>
                                <TableHeader>
                                  <TableRow className="bg-muted/40 [&_th]:text-[10px] [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
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

                        <div>
                          <p className="text-xs font-semibold mb-2">✅ Checklist de Fichas ({totalFichas})</p>
                          <div className="flex flex-wrap gap-1">
                            {Array.from({ length: Math.min(totalFichas, 60) }, (_, i) => (
                              <div key={i} className="w-11 h-11 border-2 border-foreground/30 rounded flex items-center justify-center text-sm font-bold text-destructive font-mono">
                                {i + 1}
                              </div>
                            ))}
                            {totalFichas > 60 && (
                              <div className="flex items-center text-xs text-muted-foreground ml-2">+{totalFichas - 60} mais</div>
                            )}
                          </div>
                        </div>

                        <div className="flex justify-end pt-2">
                          <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); handlePrintOrder(order); }}>
                            <Printer className="h-3.5 w-3.5 mr-1" /> Imprimir Ficha
                          </Button>
                        </div>
                      </CardContent>
                    )}
                  </Card>
                );
              };

              return sortedGroups.map(econGroup => {
                const hasEconGroup = econGroup.econGroupId !== 'no_group';
                const allEconOPs = econGroup.saleOrderGroups.flatMap(sg => sg.orders);
                const econTotalPairs = allEconOPs.reduce((s, o) => s + (o.quantity || 0), 0);
                const allEconSelected = allEconOPs.every(o => selectedOrders.has(o.id));
                const isEconCollapsed = collapsedGroups.has(econGroup.econGroupId);

                const toggleEconSelection = () => {
                  setSelectedOrders(prev => {
                    const next = new Set(prev);
                    if (allEconSelected) allEconOPs.forEach(o => next.delete(o.id));
                    else allEconOPs.forEach(o => next.add(o.id));
                    return next;
                  });
                };

                const renderSaleOrderGroups = () => econGroup.saleOrderGroups.map(soGroup => {
                  const isSaleOrderGroup = !soGroup.saleOrderId.startsWith('solo_') && soGroup.orders.length > 0;
                  const hasMultipleOPs = soGroup.orders.length > 1;
                  const soTotalPairs = soGroup.orders.reduce((s, o) => s + (o.quantity || 0), 0);
                  const allSOSelected = soGroup.orders.every(o => selectedOrders.has(o.id));
                  const someSOSelected = soGroup.orders.some(o => selectedOrders.has(o.id));
                  const isSOCollapsed = collapsedSaleOrders.has(soGroup.saleOrderId);

                  const toggleSOSelection = () => {
                    setSelectedOrders(prev => {
                      const next = new Set(prev);
                      if (allSOSelected) soGroup.orders.forEach(o => next.delete(o.id));
                      else soGroup.orders.forEach(o => next.add(o.id));
                      return next;
                    });
                  };

                  const clientName = soGroup.saleOrder?.client_name || '';

                  return (
                    <div key={soGroup.saleOrderId}>
                      {isSaleOrderGroup && hasMultipleOPs && (
                        <div
                          className="flex items-center gap-3 mb-2 px-2 py-2 bg-muted/50 rounded-lg border cursor-pointer hover:bg-muted/70 transition-colors"
                          onClick={() => toggleCollapse(soGroup.saleOrderId, setCollapsedSaleOrders)}
                        >
                          <Checkbox
                            checked={allSOSelected}
                            onCheckedChange={toggleSOSelection}
                            onClick={e => e.stopPropagation()}
                            className={someSOSelected && !allSOSelected ? 'opacity-60' : ''}
                          />
                          {isSOCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                          <div className="flex items-center gap-2 flex-1 flex-wrap">
                            <Badge variant="secondary" className="text-xs">
                              📦 Pedido {soGroup.saleOrder?.order_number || ''} — {soGroup.orders.length} OPs
                            </Badge>
                            {clientName && (
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Store className="h-3 w-3" /> {clientName}
                              </span>
                            )}
                            <span className="text-xs font-bold text-foreground">
                              {soTotalPairs} pares
                            </span>
                          </div>
                        </div>
                      )}
                      {!isSOCollapsed && (
                        <div className={isSaleOrderGroup && hasMultipleOPs ? 'ml-6 space-y-2 border-l-2 border-muted pl-3 mb-3' : 'space-y-2'}>
                          {soGroup.orders.map(renderOPCard)}
                        </div>
                      )}
                    </div>
                  );
                });

                if (!hasEconGroup) {
                  return <div key={econGroup.econGroupId} className="space-y-3">{renderSaleOrderGroups()}</div>;
                }

                return (
                  <div key={econGroup.econGroupId} className="space-y-2">
                    <div
                      className="flex items-center gap-3 px-3 py-2.5 bg-accent/30 rounded-lg border-2 border-accent/50 cursor-pointer hover:bg-accent/40 transition-colors"
                      onClick={() => toggleCollapse(econGroup.econGroupId, setCollapsedGroups)}
                    >
                      <Checkbox
                        checked={allEconSelected}
                        onCheckedChange={toggleEconSelection}
                        onClick={e => e.stopPropagation()}
                      />
                      {isEconCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      <Building2 className="h-4 w-4 text-primary" />
                      <div className="flex items-center gap-2 flex-1 flex-wrap">
                        <span className="text-sm font-bold">{econGroup.econGroupName}</span>
                        <Badge variant="outline" className="text-xs">
                          {allEconOPs.length} OPs · {econGroup.saleOrderGroups.length} pedidos
                        </Badge>
                        <span className="text-xs font-bold text-primary">
                          {econTotalPairs} pares total
                        </span>
                      </div>
                    </div>
                    {!isEconCollapsed && (
                      <div className="ml-5 space-y-2 border-l-2 border-accent/40 pl-3">
                        {renderSaleOrderGroups()}
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </div>
        )}
      </div>
    
  );
}
