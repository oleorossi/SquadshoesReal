import { useState, useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Printer, UserCheck, Funnel as Filter } from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useRepresentatives } from '@/hooks/useRepresentatives';
import { useSaleOrders } from '@/hooks/useSaleOrders';
import { useSaleOrderAllItems } from '@/hooks/useSaleOrders';
import { useFactoringConfigs } from '@/components/finance/FactoringTab';
import { calculateFactoringDiscount } from '@/lib/factoringCalc';
import { printHtml } from '@/lib/printOrder';
import { useCommissionTiers, calcTieredCommission, triggerLabel, type CommissionTier } from '@/hooks/useCommissionTiers';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function getMonthOptions() {
  const options: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = -2; i <= 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    options.push({
      value: format(d, 'yyyy-MM'),
      label: format(d, 'MMMM yyyy', { locale: ptBR }),
    });
  }
  return options;
}

export default function ComissoesTab() {
  const { data: representatives = [] } = useRepresentatives();
  const { data: saleOrders = [] } = useSaleOrders();
  const { data: allItems = [] } = useSaleOrderAllItems();
  const { data: factoringConfigs = [] } = useFactoringConfigs();
  const { data: allTiers = [] } = useCommissionTiers();
  const [filterMonth, setFilterMonth] = useState<string>('all');
  const [filterRep, setFilterRep] = useState<string>('all');

  const monthOptions = useMemo(() => getMonthOptions(), []);

  const commissionData = useMemo(() => {
    // Build commission breakdown per representative
    const repMap = new Map<string, {
      rep: typeof representatives[0];
      orders: {
        orderId: string;
        orderNumber: string;
        clientName: string;
        date: string;
        totalValue: number;
        commissionBase: number;
        commissionPct: number;
        commissionValue: number;
        hasFactoring: boolean;
        status: string;
      }[];
      totalSales: number;          // soma do valor BRUTO dos pedidos
      totalCommissionBase: number; // soma da BASE da comissão (líquida quando há factoring)
      totalCommission: number;
      tiered?: boolean;            // true quando comissão escalonada (faixas) foi aplicada
      effPct?: number;             // alíquota efetiva resultante das faixas
      tierEvent?: string;          // evento gatilho das faixas aplicadas
    }>();

    // Initialize all reps
    representatives.forEach(rep => {
      repMap.set(rep.name, { rep, orders: [], totalSales: 0, totalCommissionBase: 0, totalCommission: 0 });
    });

    // Pré-indexa itens por sale_order_id pra lookup O(1) — antes era
    // allItems.filter() por PV DENTRO do loop = O(PVs×itens) quadrático,
    // travando o recálculo do useMemo em datasets grandes. (auditoria perf)
    const itemsByOrder = new Map<string, any[]>();
    (allItems as any[]).forEach((item: any) => {
      const arr = itemsByOrder.get(item.sale_order_id);
      if (arr) arr.push(item); else itemsByOrder.set(item.sale_order_id, [item]);
    });

    // Match sale orders to representatives.
    // Prefer representative_id (FK) — sobrevive a renames; fallback pro nome
    // text em PVs legacy criados antes do campo FK ser populado.
    saleOrders.forEach((so: any) => {
      if (!so.representative_id && !so.representative) return;
      if (['Cancelado', 'Cancelada', 'Rascunho'].includes(so.status)) return;

      // Filter by month if set
      if (filterMonth !== 'all') {
        const orderDate = so.delivery_deadline || so.created_at;
        if (orderDate) {
          const orderMonth = orderDate.substring(0, 7);
          if (orderMonth !== filterMonth) return;
        }
      }

      const rep = (so.representative_id
        ? representatives.find(r => r.id === so.representative_id)
        : null
      ) || (so.representative
        ? representatives.find(r => r.name.toLowerCase() === so.representative.toLowerCase())
        : null
      );
      if (!rep) return;

      // Calculate order total from items
      const orderItems = itemsByOrder.get(so.id) || [];
      const orderTotal = orderItems.reduce((sum: number, item: any) => {
        const qty = item.quantity || 0;
        const price = item.unit_price || 0;
        return sum + (qty * price);
      }, 0);

      // Comissão sobre valor LÍQUIDO quando há factoring (a empresa só recebe o líquido).
      let commissionBase = orderTotal;
      if (so.is_factoring && so.factoring_config_id) {
        const cfg = factoringConfigs.find((c: any) => c.id === so.factoring_config_id);
        if (cfg) {
          commissionBase = calculateFactoringDiscount({
            total: orderTotal,
            monthlyInterestRate: cfg.monthly_interest_rate,
            paymentCondition: so.payment_condition,
            deliveryMonth: so.delivery_month,
            deliveryWeek: so.delivery_week,
            fallbackReceivingDays: cfg.receiving_days,
          }).pv;
        }
      }
      const commissionValue = commissionBase * ((rep.commission_pct || 0) / 100);

      let entry = repMap.get(rep.name);
      if (!entry) {
        entry = { rep, orders: [], totalSales: 0, totalCommissionBase: 0, totalCommission: 0 };
        repMap.set(rep.name, entry);
      }

      entry.orders.push({
        orderId: so.id,
        orderNumber: so.order_number || so.id.substring(0, 8),
        clientName: so.client_name || '—',
        date: so.delivery_deadline || so.created_at || '',
        totalValue: orderTotal,
        commissionBase,
        commissionPct: rep.commission_pct,
        commissionValue,
        hasFactoring: !!so.is_factoring && commissionBase !== orderTotal,
        status: so.status || 'pendente',
      });
      entry.totalSales += orderTotal;
      entry.totalCommissionBase += commissionBase;
      entry.totalCommission += commissionValue;
    });

    // Segundo passo: comissão ESCALONADA (faixas progressivas).
    // Quando o rep tem faixas ativas, a comissão do período é progressiva sobre a
    // base acumulada (espelho da RPC calculate_tiered_commission). Redistribuímos a
    // alíquota efetiva por pedido pra as linhas continuarem somando o total.
    // Preferência de evento quando há faixas de mais de um tipo: faturamento > pedido > liquidez.
    const EVENT_PREF = ['faturamento', 'pedido', 'liquidez'];
    repMap.forEach((entry) => {
      const repTiers = allTiers.filter((t: CommissionTier) => t.representative_id === entry.rep.id && t.active);
      if (!repTiers.length || entry.totalCommissionBase <= 0) return;
      const chosenEvent = EVENT_PREF.find((ev) => repTiers.some((t) => t.trigger_event === ev));
      if (!chosenEvent) return;
      const tiersForEvent = repTiers.filter((t) => t.trigger_event === chosenEvent);
      const tieredTotal = calcTieredCommission(entry.totalCommissionBase, tiersForEvent);
      const effPct = (tieredTotal / entry.totalCommissionBase) * 100;
      entry.totalCommission = tieredTotal;
      entry.tiered = true;
      entry.effPct = effPct;
      entry.tierEvent = chosenEvent;
      entry.orders.forEach((o) => {
        o.commissionValue = o.commissionBase * (effPct / 100);
        o.commissionPct = Math.round(effPct * 100) / 100;
      });
    });

    let result = Array.from(repMap.values()).filter(e => e.orders.length > 0 || filterRep !== 'all');
    if (filterRep !== 'all') {
      result = result.filter(e => e.rep.id === filterRep);
    }
    return result.sort((a, b) => b.totalCommission - a.totalCommission);
  }, [representatives, saleOrders, allItems, filterMonth, filterRep, factoringConfigs, allTiers]);

  const grandTotal = commissionData.reduce((s, d) => s + d.totalCommission, 0);
  const grandSales = commissionData.reduce((s, d) => s + d.totalSales, 0);
  const grandCommissionBase = commissionData.reduce((s, d) => s + d.totalCommissionBase, 0);
  // Quando algum pedido teve factoring, a base da comissão (líquida) difere
  // do total bruto de vendas. Mostramos os dois valores para evitar a
  // confusão de "vendi R$10k mas comissão é só sobre R$9.7k" parecer um bug.
  const hasFactoringInPeriod = commissionData.some(d => d.orders.some(o => o.hasFactoring));

  const handlePrintReport = () => {
    const selectedRep = filterRep !== 'all' ? representatives.find(r => r.id === filterRep) : null;
    const monthLabel = filterMonth !== 'all'
      ? monthOptions.find(m => m.value === filterMonth)?.label || filterMonth
      : 'Todos os meses';

    const rows = commissionData.flatMap(d =>
      d.orders.map(o => `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;">${d.rep.name}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;">${o.orderNumber}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;">${o.clientName}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;">${o.date ? format(parseISO(o.date), 'dd/MM/yyyy') : '—'}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">${fmt(o.totalValue)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;">${o.commissionPct}%</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-weight:600;">${fmt(o.commissionValue)}</td>
        </tr>
      `)
    );

    const summaryRows = commissionData.map(d => `
      <tr style="background:#f8f8f8;">
        <td colspan="4" style="padding:8px 10px;font-weight:700;">${d.rep.name}</td>
        <td style="padding:8px 10px;text-align:right;font-weight:600;">${fmt(d.totalSales)}</td>
        <td style="padding:8px 10px;text-align:center;">${d.rep.commission_pct}%</td>
        <td style="padding:8px 10px;text-align:right;font-weight:700;color:#16a34a;">${fmt(d.totalCommission)}</td>
      </tr>
    `);

    const bodyHtml = `
    <style>
    table{width:100%;border-collapse:collapse;margin-top:16px;}
    th{background:#1a1a2e;color:#fff;padding:8px 10px;text-align:left;font-size:12px;}
    td{font-size:12px;}
    h1{font-size:18px;margin-bottom:4px;}
    .meta{font-size:12px;color:#666;margin-bottom:16px;}
    .total-row td{background:#1a1a2e;color:#fff;padding:10px;font-weight:700;font-size:13px;}
    </style>
    <h1>Relatório de Comissões</h1>
    <div class="meta">
      ${selectedRep ? `Representante: <strong>${selectedRep.name}</strong> · ` : ''}
      Período: <strong>${monthLabel}</strong> · 
      Gerado em: ${format(new Date(), 'dd/MM/yyyy HH:mm')}
    </div>

    <h3 style="font-size:14px;margin-top:24px;">Detalhamento por Pedido</h3>
    <table>
      <thead><tr>
        <th>Representante</th><th>Pedido</th><th>Cliente</th><th>Data</th>
        <th style="text-align:right;">Valor Total</th><th style="text-align:center;">% Comissão</th><th style="text-align:right;">Comissão</th>
      </tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>

    <h3 style="font-size:14px;margin-top:24px;">Resumo por Representante</h3>
    <table>
      <thead><tr>
        <th colspan="4">Representante</th><th style="text-align:right;">Total Vendas</th>
        <th style="text-align:center;">%</th><th style="text-align:right;">Total Comissão</th>
      </tr></thead>
      <tbody>
        ${summaryRows.join('')}
        <tr class="total-row">
          <td colspan="4">TOTAL GERAL</td>
          <td style="text-align:right;">${fmt(grandSales)}</td>
          <td></td>
          <td style="text-align:right;">${fmt(grandTotal)}</td>
        </tr>
      </tbody>
    </table>`;

    printHtml('Relatório de Comissões', bodyHtml, { landscape: true });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <UserCheck className="h-4 w-4" /> Comissões de Representantes
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              <Select value={filterRep} onValueChange={setFilterRep}>
                <SelectTrigger className="w-[180px] h-8 text-xs">
                  <SelectValue placeholder="Representante" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {representatives.filter(r => r.active).map(r => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Select value={filterMonth} onValueChange={setFilterMonth}>
              <SelectTrigger className="w-[170px] h-8 text-xs">
                <SelectValue placeholder="Mês de vencimento" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os meses</SelectItem>
                {monthOptions.map(m => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={handlePrintReport}>
              <Printer className="h-3.5 w-3.5" /> Relatório
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className={`grid grid-cols-1 gap-3 mb-4 ${hasFactoringInPeriod ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Total Vendas (bruto)</p>
                <p className="text-lg font-bold">{fmt(grandSales)}</p>
              </CardContent>
            </Card>
            {hasFactoringInPeriod && (
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground">Base p/ Comissão (líquido)</p>
                  <p className="text-lg font-bold">{fmt(grandCommissionBase)}</p>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Total Comissões</p>
                <p className="text-lg font-bold text-primary">{fmt(grandTotal)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Representantes c/ vendas</p>
                <p className="text-lg font-bold">{commissionData.filter(d => d.orders.length > 0).length}</p>
              </CardContent>
            </Card>
          </div>

          {commissionData.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <UserCheck className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p>Nenhuma comissão encontrada para o período selecionado</p>
            </div>
          ) : (
            <div className="space-y-4">
              {commissionData.map(d => (
                <div key={d.rep.id} className="rounded-lg border overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-muted/30">
                    <div className="flex items-center gap-2">
                      <UserCheck className="h-4 w-4 text-primary" />
                      <span className="font-semibold text-sm">{d.rep.name}</span>
                      {d.tiered ? (
                        <Badge variant="default" className="text-xs" title={`Faixas escalonadas · ${triggerLabel(d.tierEvent || '')}`}>
                          escalonada · {d.effPct!.toFixed(2)}% efetiva
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">{d.rep.commission_pct}%</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span>Vendas: <strong>{fmt(d.totalSales)}</strong></span>
                      <span className="text-primary font-bold">Comissão: {fmt(d.totalCommission)}</span>
                    </div>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/20 hover:bg-muted/20">
                        <TableHead className="text-xs">Pedido</TableHead>
                        <TableHead className="text-xs">Cliente</TableHead>
                        <TableHead className="text-xs">Data</TableHead>
                        <TableHead className="text-xs text-right">Valor</TableHead>
                        <TableHead className="text-xs text-center">%</TableHead>
                        <TableHead className="text-xs text-right">Comissão</TableHead>
                        <TableHead className="text-xs text-center">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.orders.map(o => (
                        <TableRow key={o.orderId}>
                          <TableCell className="text-xs font-mono">{o.orderNumber}</TableCell>
                          <TableCell className="text-xs">{o.clientName}</TableCell>
                          <TableCell className="text-xs">{o.date ? format(parseISO(o.date), 'dd/MM/yyyy') : '—'}</TableCell>
                          <TableCell className="text-xs text-right font-mono">{fmt(o.totalValue)}</TableCell>
                          <TableCell className="text-xs text-center">{o.commissionPct}%</TableCell>
                          <TableCell className="text-xs text-right font-mono font-semibold text-primary">{fmt(o.commissionValue)}</TableCell>
                          <TableCell className="text-center">
                            <Badge variant={o.status === 'finalizado' ? 'default' : 'outline'} className="text-xs">
                              {o.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
