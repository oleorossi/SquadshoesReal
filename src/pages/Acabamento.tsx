
import { useMemo, useState } from 'react';
import { SignedImage } from '@/components/ui/signed-image';
import { useNavigate } from 'react-router-dom';
import { usePersistedState } from '@/hooks/usePersistedState';
import { Sparkles, Printer, Filter, CheckSquare, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useOrders } from '@/hooks/useOrders';
import { useTechnicalSheets } from '@/hooks/useTechnicalSheets';
import { useAllOrderStages } from '@/hooks/useOrderStages';
import { useSaleOrders, PACKAGING_MODE_LABELS, type PackagingMode } from '@/hooks/useSaleOrders';
import { useClients } from '@/hooks/useClients';
import { supabase } from '@/integrations/supabase/client';
import { printHtml, openPrintWindow, writePrintWindow } from '@/lib/printOrder';
import { getClientLogoUrl } from '@/lib/getClientLogo';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useProductionTransitions } from '@/hooks/useProductionTransitions';
import OrderSearchBar from '@/components/production/OrderSearchBar';

import { useOrderStraps } from '@/hooks/useOrderStraps';

const SIZES = ['17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33','34','35','36','37','38','39','40','41','42','43','44','45'];

export default function Acabamento() {
  const navigate = useNavigate();
  const { data: orders = [] } = useOrders();
  const { data: references = [] } = useTechnicalSheets();
  const orderIds = useMemo(() => orders.map(o => o.id), [orders]);
  const { data: allStages = [] } = useAllOrderStages(orderIds.length > 0 ? orderIds : undefined);
  const { data: saleOrders = [] } = useSaleOrders();
  const { data: clients = [] } = useClients();
  const queryClient = useQueryClient();
  const { getStrapsLabel } = useOrderStraps();
  const [filterStatus, setFilterStatus] = usePersistedState<string>('filterStatus', 'active');
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [finalizingOrders, setFinalizingOrders] = useState(false);
  const { finalizeSectorTask } = useProductionTransitions();
  const [searchQuery, setSearchQuery] = usePersistedState('searchQuery', '');

  const toggleOrder = (id: string) => {
    setSelectedOrders(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedOrders.size === acabamentoOrders.length) {
      setSelectedOrders(new Set());
    } else {
      setSelectedOrders(new Set(acabamentoOrders.map(o => o.id)));
    }
  };

  const handleFinishSelectedOrders = async () => {
    if (selectedOrders.size === 0) return;
    setFinalizingOrders(true);
    try {
      const orderIds = Array.from(selectedOrders);
      
      // allSettled — partial successes are real outcomes; one failure shouldn't drop them.
      const settled = await Promise.allSettled(
        orderIds.map(orderId => finalizeSectorTask(orderId, 'Acabamento'))
      );
      const successCount = settled.filter(
        s => s.status === 'fulfilled' && (s.value as any)?.success
      ).length;
      const failedCount = orderIds.length - successCount;

      if (successCount > 0) {
        if (failedCount === 0) {
          toast.success(`Acabamento finalizado para ${successCount} OP(s)!`);
        } else {
          toast.warning(`Acabamento finalizado para ${successCount} OP(s); ${failedCount} falhou(aram).`);
        }
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

  const acabamentoOrders = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const filtered = orders.filter(order => {
      const status = (order.status || '').toLowerCase().normalize('NFC');
      // Status filter - only filter if "active" is selected
      if (filterStatus === 'active' && status !== 'em produção') return false;
      
      const stages = allStages.filter(s => s.order_id === order.id);
      const stage = stages.find(s => s.stage_name === 'Acabamento');
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

    // Async fallback for image
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
          <h1 style="font-size:16px;margin-bottom:2px;">✨ Ficha de Acabamento</h1>
          <p style="font-size:12px;margin-bottom:8px;"><strong>OP:</strong> ${order.order_number}</p>
           <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 16px;font-size:11px;">
            <div><strong>Referência:</strong> ${ref?.code || ''} — ${ref?.name || ''}</div>
            <div><strong>Cor:</strong> ${order.color || '—'}</div>
            <div><strong>Quantidade:</strong> ${totalPairs} pares</div>
            <div><strong>Embalagem:</strong> ${(() => {
              const so = saleOrders.find((s: any) => s.id === order.sale_order_id);
              const mode = (so as any)?.packaging_mode || 'individual_amarrado';
              return PACKAGING_MODE_LABELS[mode as PackagingMode] || mode;
            })()}</div>
          </div>
          ${gradeHtml}
        </div>
        <div style="text-align:center;">
          <p style="font-size:8px;color:#999;margin-bottom:2px;">SILK</p>
          ${silkHtml}
        </div>
      </div>
      <h2 style="font-size:13px;margin:16px 0 8px;border-bottom:1px solid #ccc;padding-bottom:3px;">
        Controle de Acabamento — ${totalFichas} fichas (${totalPairs} pares | ${pairsPerFicha} pares/ficha)
      </h2>
      <p style="font-size:9px;color:#666;margin-bottom:8px;">Marque cada quadrado conforme concluir a ficha de ${pairsPerFicha} pares.</p>
      <div style="display:flex;flex-wrap:wrap;gap:0;">
        ${squaresHtml}
      </div>
    `;

    printHtml(`Acabamento - ${order.order_number}`, html);
  };

  const handlePrintByClient = () => {
    const ordersToReport = acabamentoOrders.filter(o => selectedOrders.has(o.id));
    if (ordersToReport.length === 0) { toast.info('Selecione ao menos uma OP para gerar o relatório.'); return; }
    const printWin = openPrintWindow('Relatório por Cliente - Acabamento');

    // Group orders by client (from sale order)
    type ClientGroup = {
      clientName: string;
      clientCity: string;
      clientCnpj: string;
      clientNumber: string;
      saleOrderNumbers: string[];
      clientOrderNumbers: string[];
      packagingMode: string;
      items: Array<{
        opNumber: string;
        refCode: string;
        refName: string;
        color: string;
        grade: Record<string, number> | null;
        totalPairs: number;
        strapsLabel: string;
        imageUrl: string;
      }>;
    };
    const clientMap = new Map<string, ClientGroup>();

    for (const order of ordersToReport) {
      const so = saleOrders.find((s: any) => s.id === order.sale_order_id);
      const clientName = (so as any)?.client_name || 'Sem Cliente';
      const clientCnpj = (so as any)?.client_cnpj || '';
      const clientNumber = (so as any)?.client_number || '';
      const matchedClient = clients.find(c => c.razao_social === clientName || (clientCnpj && c.cnpj === clientCnpj));
      const clientCity = matchedClient ? [matchedClient.cidade, matchedClient.estado].filter(Boolean).join('/') : '';
      const clientCnpjDisplay = matchedClient?.cnpj || clientCnpj || '';
      const clientNumberDisplay = clientNumber || matchedClient?.client_number || '';
      const clientKey = clientName.toLowerCase().trim();
      const ref = references.find(r => r.id === order.reference_id);
      const grade = order.grade as Record<string, number> | null;
      const gradeSum = grade ? Object.values(grade).reduce((s, v) => s + Number(v || 0), 0) : 0;
      const totalPairs = Number(order.quantity) || gradeSum || 0;

      let imageUrl = '';
      if (ref) {
        const images = ref.images as string[] | null;
        if (images && images.length > 0) imageUrl = images[0];
        else if (ref.image_url) imageUrl = ref.image_url;
      }

      if (!clientMap.has(clientKey)) {
        clientMap.set(clientKey, {
          clientName,
          clientCity,
          clientCnpj: clientCnpjDisplay,
          clientNumber: clientNumberDisplay,
          saleOrderNumbers: [],
          clientOrderNumbers: [],
          packagingMode: (so as any)?.packaging_mode || 'individual_amarrado',
          items: [],
        });
      }
      const group = clientMap.get(clientKey)!;
      const pvNum = (so as any)?.order_number || '';
      const clientOrdNum = (so as any)?.client_order_number || '';
      if (pvNum && !group.saleOrderNumbers.includes(pvNum)) group.saleOrderNumbers.push(pvNum);
      if (clientOrdNum && !group.clientOrderNumbers.includes(clientOrdNum)) group.clientOrderNumbers.push(clientOrdNum);

      group.items.push({
        opNumber: order.order_number || '',
        refCode: ref?.code || '',
        refName: ref?.name || '',
        color: order.color || '—',
        grade,
        totalPairs,
        strapsLabel: getStrapsLabel(order),
        imageUrl,
      });
    }

    // Build HTML per client
    const allActiveSizes = SIZES.filter(s => ordersToReport.some(o => {
      const g = o.grade as Record<string, number> | null;
      return g && Number(g[s]) > 0;
    }));

    let clientSections = '';
    const sortedClients = Array.from(clientMap.values()).sort((a, b) => a.clientName.localeCompare(b.clientName, 'pt-BR'));
    const grandTotal = ordersToReport.reduce((s, o) => s + (Number(o.quantity) || 0), 0);

    for (const client of sortedClients) {
      const clientTotalPairs = client.items.reduce((s, i) => s + i.totalPairs, 0);

      // Consolidate by ref+color
      type ConsolidatedItem = { refCode: string; refName: string; color: string; sizes: Record<string, number>; totalPairs: number; opNumbers: string[]; strapsLabel: string; imageUrl: string };
      const consolidatedMap = new Map<string, ConsolidatedItem>();
      for (const item of client.items) {
        const key = `${item.refCode}|${item.color}`;
        if (!consolidatedMap.has(key)) {
          consolidatedMap.set(key, { refCode: item.refCode, refName: item.refName, color: item.color, sizes: {}, totalPairs: 0, opNumbers: [], strapsLabel: item.strapsLabel, imageUrl: item.imageUrl });
        }
        const c = consolidatedMap.get(key)!;
        c.opNumbers.push(item.opNumber);
        c.totalPairs += item.totalPairs;
        if (item.grade) {
          for (const s of allActiveSizes) {
            c.sizes[s] = (c.sizes[s] || 0) + (Number(item.grade[s]) || 0);
          }
        }
      }

      const consolidated = Array.from(consolidatedMap.values()).sort((a, b) => `${a.refCode} ${a.refName}`.localeCompare(`${b.refCode} ${b.refName}`, 'pt-BR'));

      // Compute client size totals
      const clientSizeTotals: Record<string, number> = {};
      allActiveSizes.forEach(s => { clientSizeTotals[s] = 0; });
      consolidated.forEach(c => { allActiveSizes.forEach(s => { clientSizeTotals[s] += (c.sizes[s] || 0); }); });

      let rows = '';
      for (const c of consolidated) {
        const imgTag = c.imageUrl
          ? `<img src="${c.imageUrl}" style="width:50px;height:50px;object-fit:contain;border:1px solid #ddd;border-radius:3px;" />`
          : `<div style="width:50px;height:50px;background:#f0f0f0;border:1px solid #ddd;border-radius:3px;display:flex;align-items:center;justify-content:center;color:#aaa;font-size:7px;">—</div>`;
        rows += `<tr>`;
        rows += `<td style="border:1px solid #999;padding:3px 6px;text-align:center;">${imgTag}</td>`;
        rows += `<td style="border:1px solid #999;padding:3px 6px;font-size:10px;">${c.refCode}</td>`;
        rows += `<td style="border:1px solid #999;padding:3px 6px;font-size:10px;">${c.refName}</td>`;
        rows += `<td style="border:1px solid #999;padding:3px 6px;font-size:10px;">${c.color}</td>`;
        if (c.strapsLabel) rows += `<td style="border:1px solid #999;padding:3px 6px;font-size:9px;">${c.strapsLabel}</td>`;
        else rows += `<td style="border:1px solid #999;padding:3px 6px;font-size:9px;">—</td>`;
        for (const s of allActiveSizes) {
          const qty = c.sizes[s] || 0;
          rows += `<td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-size:11px;font-weight:${qty > 0 ? '700' : '400'}">${qty || ''}</td>`;
        }
        rows += `<td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-weight:700;font-size:11px;background:#f5f5f0;">${c.totalPairs}</td>`;
        rows += `<td style="border:1px solid #999;padding:3px 6px;font-size:9px;color:#666;">${c.opNumbers.join(', ')}</td>`;
        rows += `</tr>`;
      }
      // Totals row
      rows += `<tr style="background:#e8e8d0;font-weight:700;border-top:2px solid #333;">`;
      rows += `<td colspan="5" style="border:1px solid #999;padding:3px 6px;text-align:right;font-size:10px;">TOTAL</td>`;
      for (const s of allActiveSizes) {
        rows += `<td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-size:11px;">${clientSizeTotals[s] || ''}</td>`;
      }
      rows += `<td style="border:1px solid #999;padding:3px 6px;text-align:center;font-family:monospace;font-size:12px;font-weight:700;">${clientTotalPairs}</td>`;
      rows += `<td style="border:1px solid #999;padding:3px 6px;"></td>`;
      rows += `</tr>`;

      clientSections += `
        <div style="page-break-inside:avoid;margin-bottom:20px;">
          <div style="background:#e8e8d0;padding:6px 10px;border-radius:4px;margin-bottom:6px;">
            <h2 style="font-size:14px;font-weight:700;margin:0;">🏪 ${client.clientNumber ? `<span style="color:#1a56db;">${client.clientNumber}</span> — ` : ''}${client.clientName}</h2>
            <p style="font-size:9px;color:#555;margin:2px 0 0;">
              ${client.clientCity ? `📍 ${client.clientCity}` : ''}${client.clientCnpj ? ` | CNPJ: ${client.clientCnpj}` : ''}
            </p>
            <p style="font-size:9px;color:#555;margin:2px 0 0;">
              PV: ${client.saleOrderNumbers.join(', ') || '—'}
              ${client.clientOrderNumbers.length > 0 ? ` | Ped. Cliente: ${client.clientOrderNumbers.join(', ')}` : ''}
              | ${client.items.length} OP(s) | ${clientTotalPairs} pares
              | 📦 ${PACKAGING_MODE_LABELS[client.packagingMode as PackagingMode] || client.packagingMode}
            </p>
          </div>
          <table style="width:100%;border-collapse:collapse;">
            <thead><tr style="background:#f5f5f0;">
              <th style="border:1px solid #999;padding:3px 6px;text-align:center;font-size:9px;">Foto</th>
              <th style="border:1px solid #999;padding:3px 6px;text-align:left;font-size:9px;">Ref</th>
              <th style="border:1px solid #999;padding:3px 6px;text-align:left;font-size:9px;">Nome</th>
              <th style="border:1px solid #999;padding:3px 6px;text-align:left;font-size:9px;">Cor</th>
              <th style="border:1px solid #999;padding:3px 6px;text-align:left;font-size:9px;">Tiras</th>
              ${allActiveSizes.map(s => `<th style="border:1px solid #999;padding:3px 6px;text-align:center;font-size:9px;">${s}</th>`).join('')}
              <th style="border:1px solid #999;padding:3px 6px;text-align:center;font-size:9px;background:#e0e0c8;">Total</th>
              <th style="border:1px solid #999;padding:3px 6px;text-align:left;font-size:9px;">OPs</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }

    const html = `
      <h1 style="font-size:18px;margin-bottom:4px;">📦 Relatório de Acabamento por Cliente</h1>
      <p style="font-size:10px;color:#666;margin-bottom:12px;">Gerado em ${new Date().toLocaleString('pt-BR')} | ${sortedClients.length} cliente(s) | ${ordersToReport.length} OP(s) | ${grandTotal} pares</p>
      <div style="display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap;">
        <div style="text-align:center;padding:6px 14px;background:#f5f5f0;border:1px solid #ddd;border-radius:6px;"><p style="font-size:18px;font-weight:700;">${sortedClients.length}</p><p style="font-size:9px;color:#666;">Clientes</p></div>
        <div style="text-align:center;padding:6px 14px;background:#f5f5f0;border:1px solid #ddd;border-radius:6px;"><p style="font-size:18px;font-weight:700;">${ordersToReport.length}</p><p style="font-size:9px;color:#666;">OPs</p></div>
        <div style="text-align:center;padding:6px 14px;background:#f5f5f0;border:1px solid #ddd;border-radius:6px;"><p style="font-size:18px;font-weight:700;">${grandTotal}</p><p style="font-size:9px;color:#666;">Total Pares</p></div>
      </div>
      ${clientSections}
    `;
    writePrintWindow(printWin, 'Relatório por Cliente - Acabamento', html);
  };

  return (
    
      <div className="space-y-5 page-enter">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-primary" />
              Setor de Acabamento
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Fichas de controle com checklist de pares para acabamento
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
                  const ids = acabamentoOrders.filter(o => selectedOrders.has(o.id)).map(o => o.id).join(',');
                  navigate(`/orders/grouped-summary?sector=acabamento&ids=${ids}`);
                }}>
                  <Layers className="h-3.5 w-3.5 mr-1" /> Imprimir Relatório ({selectedOrders.size})
                </Button>
              </>
            )}
            <Button size="sm" variant="secondary" onClick={() => handlePrintByClient()} disabled={selectedOrders.size === 0}>
              <Printer className="h-3.5 w-3.5 mr-1" /> Relatório por Cliente ({selectedOrders.size})
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

        {/* Stats - dynamic based on selection */}
        {(() => {
          const hasSelection = selectedOrders.size > 0;
          const statsOrders = hasSelection ? acabamentoOrders.filter(o => selectedOrders.has(o.id)) : acabamentoOrders;
          const totalPares = statsOrders.reduce((s, o) => s + (o.quantity || 0), 0);
          const clientSet = new Set(statsOrders.map(o => {
            const so = saleOrders.find((s: any) => s.id === o.sale_order_id);
            return (so as any)?.client_name || 'Sem Cliente';
          }));
          return (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card className={hasSelection ? 'ring-2 ring-primary/30' : ''}>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold text-primary">{statsOrders.length}</p>
                  <p className="text-xs text-muted-foreground">{hasSelection ? 'OPs Selecionadas' : 'OPs p/ Acabamento'}</p>
                </CardContent>
              </Card>
              <Card className={hasSelection ? 'ring-2 ring-primary/30' : ''}>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold text-foreground">{totalPares}</p>
                  <p className="text-xs text-muted-foreground">Total de Pares</p>
                </CardContent>
              </Card>
              <Card className={hasSelection ? 'ring-2 ring-primary/30' : ''}>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold text-foreground">{clientSet.size}</p>
                  <p className="text-xs text-muted-foreground">Clientes</p>
                </CardContent>
              </Card>
              {hasSelection && (
                <Card className="ring-2 ring-primary/30">
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-muted-foreground">{acabamentoOrders.length - statsOrders.length}</p>
                    <p className="text-xs text-muted-foreground">Não selecionadas</p>
                  </CardContent>
                </Card>
              )}
            </div>
          );
        })()}

        {/* Orders list */}
        {acabamentoOrders.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            Nenhuma OP com acabamento pendente.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 px-1">
              <Checkbox
                checked={selectedOrders.size === acabamentoOrders.length && acabamentoOrders.length > 0}
                onCheckedChange={toggleAll}
              />
              <span className="text-xs text-muted-foreground font-medium">Selecionar todas ({acabamentoOrders.length})</span>
            </div>
            {acabamentoOrders.map(order => {
              const { ref, grade, activeSizes, gradeSum, totalPairs, totalFichas, fichas, imageUrl } = buildPrintContent(order);
              const isExpanded = expandedOrderId === order.id;

              const acabamentoStage = allStages.find(s => s.order_id === order.id && s.stage_name === 'Acabamento');
              const stageColor = acabamentoStage?.status === 'concluido' ? 'border-l-emerald-500' : acabamentoStage?.status === 'em_andamento' ? 'border-l-amber-500' : 'border-l-red-500';

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
                        {(() => {
                          const so = saleOrders.find((s: any) => s.id === order.sale_order_id);
                          return so ? (
                            <p className="text-[10px] text-muted-foreground ml-5 mt-0.5">
                              📦 <span className="font-semibold">{so.order_number}</span>
                              {so.client_order_number ? <> | Ped. Cliente: <span className="font-semibold">{so.client_order_number}</span></> : null}
                              {so.client_name ? <> | {(so as any).client_number ? <span className="font-bold text-primary">{(so as any).client_number}</span> : null}{(so as any).client_number ? ' — ' : ''}{so.client_name}</> : null}
                              {' | '}<Badge variant="outline" className="text-[8px] h-4 px-1">{PACKAGING_MODE_LABELS[(so as any).packaging_mode as PackagingMode] || 'Cx Individual + Amarrado'}</Badge>
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
                          <p className="text-xs">Fichas: <strong>{totalFichas}</strong> (12 pares/ficha)</p>
                          <p className="text-xs">Status: <Badge variant="secondary" className="text-[10px]">{order.status}</Badge></p>
                        </div>
                      </div>

                      {/* Grade table */}
                      {grade && activeSizes.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold mb-2">📋 Grade</p>
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

                      {/* Checklist preview */}
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
            })}
          </div>
        )}
      </div>
    
  );
}
