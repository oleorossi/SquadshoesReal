import AppLayout from "@/components/layout/AppLayout";
import { useMemo } from 'react';
import { getSignedUrl } from '@/lib/getSignedUrl';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Printer, Package, Stack as Layers, Calendar, FloppyDisk as Save, Warning as AlertTriangle } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useOrders } from '@/hooks/useOrders';
import { useTechnicalSheets } from '@/hooks/useTechnicalSheets';
import { useAllOrderStages } from '@/hooks/useOrderStages';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, parseISO, isWithinInterval } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { printHtml } from '@/lib/printOrder';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { StatGridSkeleton, TableSkeleton } from '@/components/layout/PageSkeleton';
import { searchMatchesAllTerms } from '@/lib/searchUtils';

const SIZES_ALL = ['17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33','34','35','36','37','38','39','40','41','42','43','44','45'];

const STATUS_COLORS: Record<string, string> = {
  'Rascunho': 'bg-muted text-muted-foreground',
  'Reservado': 'bg-primary/15 text-primary',
  'Em Produção': 'bg-warning/15 text-warning',
  'Concluída': 'bg-success/15 text-success',
  'Cancelada': 'bg-destructive/15 text-destructive',
};

export default function OrdersSummary() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: orders = [], isLoading, isError } = useOrders();
  const { data: references = [] } = useTechnicalSheets();
  const orderIds = useMemo(() => orders.map(o => o.id), [orders]);
  const { data: allStages = [] } = useAllOrderStages(orderIds.length > 0 ? orderIds : undefined);
  const { data: saleOrders = [] } = useQuery({
    queryKey: ['sale_orders_for_ops'],
    queryFn: async () => {
      const { data, error } = await supabase.from('sale_orders').select('id, order_number, client_name, total');
      if (error) throw error;
      return data;
    },
  });

  const searchTerm = searchParams.get('search') || '';
  const statusFilter = searchParams.get('status') || 'all';
  const referenceFilter = searchParams.get('reference') || 'all';
  const colorFilter = searchParams.get('color') || 'all';
  const weekFilter = searchParams.get('week') || 'all';

  const filteredOrders = useMemo(() => {
    // Use statusFilter directly - if 'all', don't filter by status
    const effectiveStatus = statusFilter;
    return orders.filter(order => {
      if (searchTerm) {
        // "/" = refinamento AND (ex.: "stx / alcineu" = ref STX E cliente Alcineu)
        if (!searchMatchesAllTerms(searchTerm, (order as any).order_number, (order as any).technical_sheets?.name, (order as any).color)) return false;
      }
      if (effectiveStatus !== 'all' && order.status !== effectiveStatus) return false;
      if (referenceFilter !== 'all' && order.reference_id !== referenceFilter) return false;
      if (colorFilter !== 'all' && (order as any).color !== colorFilter) return false;
      if (weekFilter !== 'all') {
        const [startStr, endStr] = weekFilter.split('|');
        const deliveryDate = (order as any).planned_delivery;
        if (!deliveryDate) return false;
        const delivery = parseISO(deliveryDate);
        if (!isWithinInterval(delivery, { start: parseISO(startStr), end: parseISO(endStr) })) return false;
      }
      return true;
    });
  }, [orders, searchTerm, statusFilter, referenceFilter, colorFilter, weekFilter]);

  // Summary stats
  const totalPairs = filteredOrders.reduce((s, o) => s + o.quantity, 0);
  const totalOPs = filteredOrders.length;
  const statusBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    filteredOrders.forEach(o => { map[o.status] = (map[o.status] || 0) + 1; });
    return Object.entries(map).sort(([, a], [, b]) => b - a);
  }, [filteredOrders]);

  // Group by reference + color
  const refColorGroups = useMemo(() => {
    const groups: Record<string, { refName: string; refCode: string; color: string; imageUrl: string; orders: typeof filteredOrders; totalQty: number; grade: Record<string, number> }> = {};
    filteredOrders.forEach(order => {
      const ref = references.find(r => r.id === order.reference_id);
      const refName = ref?.name || 'Sem referência';
      const refCode = ref?.code || '';
      const imageUrl = (ref as any)?.image_url || '';
      const color = (order as any).color || 'Sem cor';
      const key = `${refName}|||${color}`;
      if (!groups[key]) groups[key] = { refName, refCode, color, imageUrl, orders: [], totalQty: 0, grade: {} };
      groups[key].orders.push(order);
      groups[key].totalQty += order.quantity;
      // Merge grades — grade already represents actual quantities per size
      const g = order.grade as Record<string, number> | null;
      if (g) {
        Object.entries(g).forEach(([size, qty]) => {
          groups[key].grade[size] = (groups[key].grade[size] || 0) + Number(qty);
        });
      }
    });
    return Object.values(groups).sort((a, b) => b.totalQty - a.totalQty);
  }, [filteredOrders, references]);

  // Group by sale order
  const saleOrderGroups = useMemo(() => {
    const map: Record<string, { saleOrder: any; orders: typeof filteredOrders; totalQty: number }> = {};
    filteredOrders.forEach(order => {
      const soId = (order as any).sale_order_id || '__avulso__';
      if (!map[soId]) {
        const so = saleOrders.find(s => s.id === soId);
        map[soId] = { saleOrder: so || null, orders: [], totalQty: 0 };
      }
      map[soId].orders.push(order);
      map[soId].totalQty += order.quantity;
    });
    return Object.values(map).sort((a, b) => (a.saleOrder ? 0 : 1) - (b.saleOrder ? 0 : 1));
  }, [filteredOrders, saleOrders]);

  // Active sizes across all filtered orders
  const activeSizes = useMemo(() => {
    return SIZES_ALL.filter(s =>
      filteredOrders.some(o => {
        const g = o.grade as Record<string, number> | null;
        return g && Number(g[s]) > 0;
      })
    );
  }, [filteredOrders]);

  // Summary: qty per color, total value, unique stores
  const colorSummary = useMemo(() => {
    const map: Record<string, number> = {};
    filteredOrders.forEach(o => {
      const color = (o as any).color || 'Sem cor';
      map[color] = (map[color] || 0) + o.quantity;
    });
    return Object.entries(map).sort(([, a], [, b]) => b - a);
  }, [filteredOrders]);

  const storesSummary = useMemo(() => {
    const storeSet = new Map<string, string>(); // id -> client_name
    filteredOrders.forEach(order => {
      const soId = (order as any).sale_order_id;
      if (soId) {
        const so = saleOrders.find(s => s.id === soId);
        if (so && !storeSet.has(so.client_name)) {
          storeSet.set(so.client_name, so.client_name);
        }
      }
    });
    return Array.from(storeSet.values()).sort();
  }, [filteredOrders, saleOrders]);

  const totalValue = useMemo(() => {
    // Total quantity of OPs per sale order across the FULL order set so we can
    // weight each filtered OP's share of the sale order total. Without this,
    // selecting one OP from a 3-OP sale order added the entire SO total to the
    // "Valor Total" — a 3× overstatement in the worst case.
    const totalQtyBySo = new Map<string, number>();
    orders.forEach(o => {
      const soId = (o as any).sale_order_id;
      if (!soId) return;
      totalQtyBySo.set(soId, (totalQtyBySo.get(soId) || 0) + (Number(o.quantity) || 0));
    });
    const filteredQtyBySo = new Map<string, number>();
    filteredOrders.forEach(o => {
      const soId = (o as any).sale_order_id;
      if (!soId) return;
      filteredQtyBySo.set(soId, (filteredQtyBySo.get(soId) || 0) + (Number(o.quantity) || 0));
    });
    let sum = 0;
    filteredQtyBySo.forEach((filteredQty, soId) => {
      const so = saleOrders.find(s => s.id === soId);
      if (!so) return;
      const totalQty = totalQtyBySo.get(soId) || filteredQty;
      const ratio = totalQty > 0 ? filteredQty / totalQty : 1;
      sum += (so.total || 0) * ratio;
    });
    return sum;
  }, [orders, filteredOrders, saleOrders]);

  const handlePrint = async () => {
    // Resolve signed URLs for all reference images
    const imageUrlMap = new Map<string, string>();
    await Promise.all(
      refColorGroups
        .filter(g => g.imageUrl)
        .map(async (g) => {
          const signed = await getSignedUrl(g.imageUrl);
          imageUrlMap.set(g.imageUrl, signed);
        })
    );

    // Build color summary rows
    const colorRows = colorSummary.map(([color, qty]) =>
      `<tr><td>${color}</td><td class="text-center mono" style="font-weight:600">${qty}</td></tr>`
    ).join('');

    // Build stores list
    const storesHtml = storesSummary.length > 0
      ? `<div style="margin-top:8px">
          <strong>Lojas (${storesSummary.length}):</strong>
          <ol style="margin:4px 0 0 20px;font-size:11px;line-height:1.6">${storesSummary.map(s => `<li>${s}</li>`).join('')}</ol>
        </div>`
      : '';

    // Build grade table
    let gradeRows = '';
    refColorGroups.forEach(group => {
      const imgSrc = imageUrlMap.get(group.imageUrl) || '';
      const imgHtml = imgSrc
        ? `<img src="${imgSrc}" style="width:40px;height:40px;object-fit:contain;border-radius:4px;" crossorigin="anonymous" />`
        : '';
      gradeRows += `<tr>
        <td style="width:50px;text-align:center;padding:2px">${imgHtml}</td>
        <td style="font-weight:600">${group.refCode ? `<span style="color:#666">${group.refCode}</span> ` : ''}${group.refName}</td>
        <td>${group.color}</td>
        <td class="text-center">${group.orders.length}</td>
        ${activeSizes.map(s => `<td class="text-center mono">${group.grade[s] ? Math.round(group.grade[s]) : ''}</td>`).join('')}
        <td class="text-center" style="font-weight:700;background:#f0f0f0">${group.totalQty}</td>
      </tr>`;
    });
    const totalRow = `<tr style="border-top:2px solid #333;font-weight:700">
      <td colspan="4" class="text-right">TOTAL</td>
      ${activeSizes.map(s => {
        const total = refColorGroups.reduce((sum, g) => sum + (g.grade[s] ? Math.round(g.grade[s]) : 0), 0);
        return `<td class="text-center mono">${total || ''}</td>`;
      }).join('')}
      <td class="text-center mono" style="background:#f0f0f0">${totalPairs}</td>
    </tr>`;

    // Build sale order details
    let detailHtml = '';
    saleOrderGroups.forEach(group => {
      const title = group.saleOrder
        ? `Pedido ${group.saleOrder.order_number} — ${group.saleOrder.client_name}`
        : 'OPs Avulsas';
      let rows = '';
      group.orders.forEach(order => {
        const ref = references.find(r => r.id === order.reference_id);
        const delivery = (order as any).planned_delivery;
        rows += `<tr>
          <td class="mono" style="font-weight:600">${(order as any).order_number}</td>
          <td>${ref?.code || ''} — ${ref?.name || '—'}</td>
          <td>${(order as any).color || '—'}</td>
          <td class="text-center mono">${order.quantity}</td>
          <td>${order.status}</td>
          <td>${delivery ? format(parseISO(delivery), 'dd/MM/yyyy', { locale: ptBR }) : '—'}</td>
        </tr>`;
      });
      detailHtml += `
        <h2>${title} <span style="font-weight:400;font-size:11px">(${group.totalQty} pares)</span></h2>
        <table><thead><tr><th>OP</th><th>Referência</th><th>Cor</th><th class="text-center">Qtd</th><th>Status</th><th>Entrega</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
    });

    const html = `
      <h1>Resumo de Produção</h1>
      <p class="subtitle">Gerado em ${new Date().toLocaleString('pt-BR')} • ${totalOPs} OPs • ${totalPairs} pares</p>
      
      <div style="display:flex;gap:16px;margin:12px 0;">
        <div style="border:1px solid #ccc;border-radius:6px;padding:8px 16px;text-align:center;flex:1">
          <div style="font-size:10px;color:#666">Total de OPs</div><div style="font-size:20px;font-weight:700">${totalOPs}</div>
        </div>
        <div style="border:1px solid #ccc;border-radius:6px;padding:8px 16px;text-align:center;flex:1">
          <div style="font-size:10px;color:#666">Total de Pares</div><div style="font-size:20px;font-weight:700">${totalPairs.toLocaleString('pt-BR')}</div>
        </div>
        <div style="border:1px solid #ccc;border-radius:6px;padding:8px 16px;text-align:center;flex:1">
          <div style="font-size:10px;color:#666">Referências</div><div style="font-size:20px;font-weight:700">${refColorGroups.length}</div>
        </div>
        <div style="border:1px solid #ccc;border-radius:6px;padding:8px 16px;text-align:center;flex:1">
          <div style="font-size:10px;color:#666">Lojas</div><div style="font-size:20px;font-weight:700">${storesSummary.length}</div>
        </div>
        <div style="border:1px solid #ccc;border-radius:6px;padding:8px 16px;text-align:center;flex:1">
          <div style="font-size:10px;color:#666">Valor Total</div><div style="font-size:20px;font-weight:700">R$ ${totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
        </div>
      </div>

      <h2>Resumo por Cor</h2>
      <table>
        <thead><tr><th>Cor</th><th class="text-center">Quantidade</th></tr></thead>
        <tbody>${colorRows}
        <tr style="border-top:2px solid #333;font-weight:700"><td>TOTAL</td><td class="text-center mono">${totalPairs}</td></tr>
        </tbody>
      </table>

      ${storesHtml}

      <h2>Grade Consolidada por Referência / Cor</h2>
      <table>
        <thead><tr><th style="width:50px">Foto</th><th>Referência</th><th>Cor</th><th class="text-center">OPs</th>
        ${activeSizes.map(s => `<th class="text-center mono" style="font-size:9px">${s}</th>`).join('')}
        <th class="text-center" style="background:#f0f0f0">Total</th></tr></thead>
        <tbody>${gradeRows}${totalRow}</tbody>
      </table>

      ${detailHtml}
    `;

    printHtml('Resumo de Produção', html);
  };

  if (isLoading) {
    return (
      <div className="space-y-5 page-enter print:space-y-4">
        <EditorialPageHeader
          sectionLabel="PEDIDOS · RESUMO"
          title="Resumo de Produção"
          description="Resumo consolidado das ordens de produção"
        />
        <StatGridSkeleton count={5} />
        <TableSkeleton rows={8} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
        <AlertTriangle className="h-10 w-10 text-destructive" />
        <p className="font-semibold text-foreground">Falha ao carregar dados</p>
        <p className="text-sm text-muted-foreground">Verifique sua conexão e recarregue a página.</p>
      </div>
    );
  }

  return (
    
      <div className="space-y-5 page-enter print:space-y-4">
        {/* Header */}
        <EditorialPageHeader
          className="print:hidden"
          sectionLabel="PEDIDOS · RESUMO"
          title="Resumo de Produção"
          description={`${totalOPs} OPs • ${totalPairs} pares no filtro atual`}
          actions={
            <>
              <Button variant="ghost" size="icon" onClick={() => navigate('/orders')} aria-label="Voltar para Ordens de Produção">
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <Button onClick={handlePrint} className="gap-2">
                <Save className="h-4 w-4" />
                Salvar PDF
              </Button>
            </>
          }
        />

        {/* Print header */}
        <div className="hidden print:block">
          <h1 className="display text-xl">Resumo de Produção</h1>
          <p className="text-sm text-muted-foreground">Gerado em {new Date().toLocaleString('pt-BR')} • {totalOPs} OPs • {totalPairs} pares</p>
        </div>

        {/* KPI Cards — kit editorial (StatCard) derivado de dados reais */}
        <StatGrid>
          <StatCard label="Total de OPs" value={totalOPs} tone="primary" />
          <StatCard label="Total de Pares" value={totalPairs.toLocaleString('pt-BR')} tone="primary" />
          <StatCard label="Referências" value={refColorGroups.length} tone="primary" />
          <StatCard label="Lojas" value={storesSummary.length} tone="primary" />
          <StatCard label="Valor Total" value={`R$ ${totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} tone="primary" />
        </StatGrid>

        {/* Resumo por Cor + Lojas */}
        <div className="grid md:grid-cols-2 gap-4">
          <Panel
            eyebrow="PEDIDOS · RESUMO"
            title={<span className="flex items-center gap-2"><Layers className="h-4 w-4" /> Quantidade por Cor</span>}
            flush
          >
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                    <TableHead>Cor</TableHead>
                    <TableHead className="text-right">Quantidade</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {colorSummary.map(([color, qty]) => (
                    <TableRow key={color}>
                      <TableCell>{color}</TableCell>
                      <TableCell className="text-right font-mono font-semibold">{qty}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 font-bold">
                    <TableCell>TOTAL</TableCell>
                    <TableCell className="text-right font-mono">{totalPairs}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
          </Panel>
          <Panel
            eyebrow="PEDIDOS · RESUMO"
            title={<span className="flex items-center gap-2"><Package className="h-4 w-4" /> Lojas ({storesSummary.length})</span>}
          >
              {storesSummary.length > 0 ? (
                <ol className="list-decimal list-inside space-y-1 text-sm">
                  {storesSummary.map((name, i) => (
                    <li key={i}>{name}</li>
                  ))}
                </ol>
              ) : (
                <EmptyState icon={Package} title="Nenhuma loja vinculada" size="sm" />
              )}
          </Panel>
        </div>

        {/* Status breakdown */}
        <Panel
          eyebrow="PEDIDOS · RESUMO"
          title={<span className="flex items-center gap-2"><Package className="h-4 w-4" /> Status das OPs</span>}
        >
            <div className="flex flex-wrap gap-3">
              {statusBreakdown.map(([status, count]) => (
                <Badge key={status} variant="outline" className={`${STATUS_COLORS[status] || ''} text-sm px-3 py-1`}>
                  {status}: {count}
                </Badge>
              ))}
            </div>
        </Panel>

        {/* Grade consolidada por referência + cor */}
        <Panel
          eyebrow="PEDIDOS · RESUMO"
          title={<span className="flex items-center gap-2"><Layers className="h-4 w-4" /> Grade Consolidada por Referência / Cor</span>}
          flush
          bodyClassName="overflow-x-auto"
        >
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                  <TableHead className="min-w-[140px]">Referência</TableHead>
                  <TableHead className="min-w-[100px]">Cor</TableHead>
                  <TableHead className="text-center">OPs</TableHead>
                  {activeSizes.map(s => (
                    <TableHead key={s} className="text-center min-w-[40px] font-mono text-xs">{s}</TableHead>
                  ))}
                  <TableHead className="text-center font-bold bg-muted">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {refColorGroups.map((group, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="font-medium">
                      {group.refCode && <span className="text-muted-foreground mr-1">{group.refCode}</span>}
                      {group.refName}
                    </TableCell>
                    <TableCell>{group.color}</TableCell>
                    <TableCell className="text-center">{group.orders.length}</TableCell>
                    {activeSizes.map(s => (
                      <TableCell key={s} className="text-center font-mono text-sm">
                        {group.grade[s] ? Math.round(group.grade[s]) : ''}
                      </TableCell>
                    ))}
                    <TableCell className="text-center font-bold bg-muted font-mono">{group.totalQty}</TableCell>
                  </TableRow>
                ))}
                {/* Totals row */}
                <TableRow className="border-t-2 font-bold">
                  <TableCell colSpan={3} className="text-right">TOTAL</TableCell>
                  {activeSizes.map(s => {
                    const total = refColorGroups.reduce((sum, g) => sum + (g.grade[s] ? Math.round(g.grade[s]) : 0), 0);
                    return <TableCell key={s} className="text-center font-mono">{total || ''}</TableCell>;
                  })}
                  <TableCell className="text-center font-mono bg-muted">{totalPairs}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
        </Panel>

        {/* Lista por pedido de venda */}
        <Panel
          eyebrow="PEDIDOS · RESUMO"
          title={<span className="flex items-center gap-2"><Calendar className="h-4 w-4" /> Detalhamento por Pedido de Venda</span>}
          bodyClassName="space-y-4"
        >
            {saleOrderGroups.map((group, gIdx) => (
              <div key={gIdx} className="border rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold">
                    {group.saleOrder
                      ? `Pedido ${group.saleOrder.order_number} — ${group.saleOrder.client_name}`
                      : 'OPs Avulsas'}
                  </h4>
                  <Badge variant="secondary">{group.totalQty} pares</Badge>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                      <TableHead>OP</TableHead>
                      <TableHead>Referência</TableHead>
                      <TableHead>Cor</TableHead>
                      <TableHead className="text-center">Qtd</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Entrega</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.orders.map(order => {
                      const ref = references.find(r => r.id === order.reference_id);
                      const delivery = (order as any).planned_delivery;
                      return (
                        <TableRow key={order.id}>
                          <TableCell className="font-mono font-semibold">{(order as any).order_number}</TableCell>
                          <TableCell>{ref?.code} — {ref?.name || '—'}</TableCell>
                          <TableCell>{(order as any).color || '—'}</TableCell>
                          <TableCell className="text-center font-mono">{order.quantity}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`${STATUS_COLORS[order.status] || ''} text-xs`}>
                              {order.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {delivery ? format(parseISO(delivery), 'dd/MM/yyyy', { locale: ptBR }) : '—'}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ))}
        </Panel>
      </div>

  );
}
