import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleNotch as Loader2, FileXls, Printer } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  aggregateOs,
  buildLedger,
  filterLedger,
  OS_KIND_LABEL,
  OS_STATUS_LABEL,
  osCsv,
  osSheetRows,
  osTotals,
  periodBounds,
  type OsAggregateRow,
  type OsGroupBy,
  type OsPeriodPreset,
  type OsRawMovement,
  type OsStreetStatus,
} from '@/lib/osPrestadorReport';
import { formatCurrency } from '@/lib/utils';

function saoPauloToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function qty(n: number) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(n);
}

async function loadMovements(): Promise<OsRawMovement[]> {
  const ordersQuery = await (supabase as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        order: (col: string, opts: { ascending: boolean }) => {
          limit: (n: number) => Promise<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }>;
        };
      };
    };
  }).from('service_orders')
    .select('id, order_number, contractor_id, sale_order_id, description, material_name, material_color, unit_price, quoted_deadline, service_date, internal_execution')
    .order('service_date', { ascending: false })
    .limit(800);
  if (ordersQuery.error) throw ordersQuery.error;
  const list = ordersQuery.data ?? [];
  if (list.length === 0) return [];
  const ids = list.map((row) => String(row.id));
  const saleIds = [...new Set(list.map((row) => row.sale_order_id).filter(Boolean).map(String))];
  const [dispatches, returns, contractors, sales, payables] = await Promise.all([
    supabase.from('service_order_dispatches').select('id, service_order_id, dispatched_at, qty_dispatched, contractor_id').in('service_order_id', ids),
    (supabase as unknown as {
      from: (table: string) => {
        select: (cols: string) => {
          in: (col: string, values: string[]) => Promise<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }>;
        };
      };
    }).from('service_order_returns').select('id, service_order_id, returned_at, qty_good, qty_defect, qty_loss, contractor_id, adjustment_kind, reverses_return_id').in('service_order_id', ids),
    supabase.from('contractors').select('id, name'),
    saleIds.length
      ? supabase.from('sale_orders').select('id, order_number').in('id', saleIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('accounts_payable').select('reference_id, amount, amount_paid, reference_type').eq('reference_type', 'service_order_return'),
  ]);
  if (dispatches.error) throw dispatches.error;
  if (returns.error) throw returns.error;
  if (contractors.error) throw contractors.error;
  if (sales.error) throw sales.error;
  if (payables.error) throw payables.error;

  const contractorName = new Map((contractors.data ?? []).map((row) => [row.id, row.name]));
  const saleNumber = new Map((sales.data ?? []).map((row) => [row.id, row.order_number]));
  const payable = new Map((payables.data ?? []).map((row) => [String(row.reference_id), row]));
  const orderById = new Map(list.map((row) => [String(row.id), row]));

  const base = (serviceOrderId: string) => {
    const order = orderById.get(serviceOrderId) ?? {};
    const internal = order.internal_execution === true;
    const contractorId = (order.contractor_id as string | null) ?? null;
    return {
      serviceOrderId,
      osNumber: String(order.order_number ?? serviceOrderId),
      saleOrderNumber: order.sale_order_id ? (saleNumber.get(String(order.sale_order_id)) ?? '—') : '—',
      reference: String(order.material_name || order.description || '—'),
      color: order.material_color ? String(order.material_color) : null,
      gradeLabel: null,
      contractorId,
      contractorName: contractorId ? (contractorName.get(contractorId) ?? 'Prestador') : 'Prestador',
      internal,
      unitPrice: Number(order.unit_price) || 0,
      dueDate: order.quoted_deadline ? String(order.quoted_deadline).slice(0, 10) : (order.service_date ? String(order.service_date).slice(0, 10) : null),
    };
  };

  const movements: OsRawMovement[] = [];
  for (const row of dispatches.data ?? []) {
    movements.push({
      ...base(row.service_order_id),
      id: row.id,
      source: 'dispatch',
      at: String(row.dispatched_at),
      contractorId: row.contractor_id ?? base(row.service_order_id).contractorId,
      qtyDispatched: Number(row.qty_dispatched) || 0,
      qtyGood: 0,
      qtyDefect: 0,
      qtyLoss: 0,
      adjustmentKind: null,
      reversesReturnId: null,
      payableAmount: 0,
      payablePaid: 0,
    });
  }
  for (const row of returns.data ?? []) {
    const id = String(row.id);
    const pay = payable.get(id);
    movements.push({
      ...base(String(row.service_order_id)),
      id,
      source: 'return',
      at: String(row.returned_at),
      contractorId: (row.contractor_id as string | null) ?? base(String(row.service_order_id)).contractorId,
      qtyDispatched: 0,
      qtyGood: Number(row.qty_good) || 0,
      qtyDefect: Number(row.qty_defect) || 0,
      qtyLoss: Number(row.qty_loss) || 0,
      adjustmentKind: row.adjustment_kind ? String(row.adjustment_kind) : null,
      reversesReturnId: row.reverses_return_id ? String(row.reverses_return_id) : null,
      payableAmount: Number(pay?.amount) || 0,
      payablePaid: Number(pay?.amount_paid) || 0,
    });
  }
  return movements;
}

export function OsPrestadorGestao() {
  const today = saoPauloToday();
  const [preset, setPreset] = useState<OsPeriodPreset>('mes');
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const [saleOrder, setSaleOrder] = useState('');
  const [reference, setReference] = useState('');
  const [color, setColor] = useState('');
  const [contractorId, setContractorId] = useState('');
  const [status, setStatus] = useState<'' | OsStreetStatus>('');
  const [groupBy, setGroupBy] = useState<OsGroupBy>('referencia_cor_prestador');
  const bounds = periodBounds(preset, today, { from: customFrom, to: customTo });

  const query = useQuery({
    queryKey: ['os-prestador-gestao'],
    queryFn: loadMovements,
    staleTime: 30_000,
  });

  const ledger = useMemo(
    () => buildLedger(query.data ?? [], today),
    [query.data, today],
  );
  const filtered = useMemo(
    () => filterLedger(ledger, {
      from: bounds.from,
      to: bounds.to,
      saleOrder,
      reference,
      color,
      contractorId,
      status,
    }),
    [ledger, bounds.from, bounds.to, saleOrder, reference, color, contractorId, status],
  );
  const rows = useMemo(() => aggregateOs(filtered, groupBy), [filtered, groupBy]);
  const totals = osTotals(rows);
  const contractors = useMemo(() => {
    const map = new Map<string, string>();
    for (const line of ledger) {
      if (line.internal) map.set('interno', 'Produção interna');
      else if (line.contractorId) map.set(line.contractorId, line.contractorName);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [ledger]);

  const downloadCsv = () => {
    const blob = new Blob([osCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `os-prestadores-${bounds.from}-a-${bounds.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadXlsx = async () => {
    const xlsx = await import('xlsx');
    const book = xlsx.utils.book_new();
    const sheet = xlsx.utils.aoa_to_sheet(osSheetRows(rows));
    xlsx.utils.book_append_sheet(book, sheet, 'OS');
    xlsx.writeFile(book, `os-prestadores-${bounds.from}-a-${bounds.to}.xlsx`);
  };

  const printReport = () => {
    const popup = window.open('', '_blank', 'noopener,noreferrer');
    if (!popup) return;
    const body = rows.map((row) => `<tr>${cells(row)}</tr>`).join('');
    popup.document.write(`<!doctype html><html><head><title>OS prestadores</title>
      <style>body{font-family:sans-serif;font-size:12px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #000;padding:4px;text-align:right}td:first-child,th:first-child{text-align:left}</style>
      </head><body><h1>Gestão de OS</h1><p>${bounds.from} a ${bounds.to}</p><table><thead><tr>${head()}</tr></thead><tbody>${body}</tbody></table></body></html>`);
    popup.document.close();
    popup.focus();
    popup.print();
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Envios, retornos, retrabalho, descarte e estorno. Estorno desconta o saldo. Produção interna continua na lista como exceção. Esta tela não grava nada.
      </p>
      <div className="flex flex-wrap gap-2">
        {([
          ['hoje', 'Hoje'],
          ['semana', 'Semana'],
          ['mes', 'Mês'],
          ['mes_anterior', 'Mês anterior'],
          ['personalizado', 'Personalizado'],
        ] as const).map(([value, label]) => (
          <Button key={value} type="button" size="sm" variant={preset === value ? 'default' : 'outline'} className="h-8" onClick={() => setPreset(value)}>
            {label}
          </Button>
        ))}
        {preset === 'personalizado' && (
          <>
            <Input type="date" className="h-8 w-36" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} aria-label="De" />
            <Input type="date" className="h-8 w-36" value={customTo} onChange={(e) => setCustomTo(e.target.value)} aria-label="Até" />
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Input className="h-9 w-36" placeholder="Pedido" value={saleOrder} onChange={(e) => setSaleOrder(e.target.value)} aria-label="Filtrar pedido" />
        <Input className="h-9 w-36" placeholder="Referência" value={reference} onChange={(e) => setReference(e.target.value)} aria-label="Filtrar referência" />
        <Input className="h-9 w-32" placeholder="Cor" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Filtrar cor" />
        <Select value={contractorId || '__all__'} onValueChange={(value) => setContractorId(value === '__all__' ? '' : value)}>
          <SelectTrigger className="h-9 w-52" aria-label="Filtrar prestador"><SelectValue placeholder="Todos os prestadores" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos os prestadores</SelectItem>
            {contractors.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status || '__all__'} onValueChange={(value) => setStatus(value === '__all__' ? '' : value as OsStreetStatus)}>
          <SelectTrigger className="h-9 w-44" aria-label="Filtrar status"><SelectValue placeholder="Todos os status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos os status</SelectItem>
            <SelectItem value="na_rua">Na rua</SelectItem>
            <SelectItem value="recebido">Recebido</SelectItem>
            <SelectItem value="atrasado">Atrasado</SelectItem>
          </SelectContent>
        </Select>
        <Select value={groupBy} onValueChange={(value) => setGroupBy(value as OsGroupBy)}>
          <SelectTrigger className="h-9 w-64" aria-label="Agrupar relatório"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="referencia_cor_prestador">Referência × cor × prestador</SelectItem>
            <SelectItem value="prestador">Por prestador</SelectItem>
            <SelectItem value="pedido">Por pedido</SelectItem>
            <SelectItem value="referencia">Por referência</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" className="h-8" disabled={rows.length === 0} onClick={downloadCsv}>CSV</Button>
        <Button type="button" size="sm" variant="outline" className="h-8" disabled={rows.length === 0} onClick={() => void downloadXlsx()}>
          <FileXls className="h-3.5 w-3.5" /> XLSX
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8" disabled={rows.length === 0} onClick={printReport}>
          <Printer className="h-3.5 w-3.5" /> Imprimir / PDF
        </Button>
      </div>
      {query.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : query.isError ? (
        <p className="text-sm text-destructive">Não foi possível ler as OS. {query.error instanceof Error ? query.error.message : ''}</p>
      ) : (
        <>
          <ReportTable rows={rows} totals={totals} showContractor={groupBy === 'prestador' || groupBy === 'referencia_cor_prestador'} />
          <h3 className="text-sm font-semibold">Lançamentos</h3>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[960px] text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  {['Data', 'Tipo', 'OS', 'PV', 'Referência', 'Cor', 'Grade', 'Prestador', 'Pares', 'Valor', 'Status', 'Na rua'].map((label) => (
                    <th key={label} className="px-2 py-2 font-medium">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((line) => (
                  <tr key={line.id} className="border-t border-border/70">
                    <td className="px-2 py-1.5">{line.at.split('-').reverse().join('/')}</td>
                    <td className="px-2 py-1.5">{OS_KIND_LABEL[line.kind]}</td>
                    <td className="px-2 py-1.5">{line.osNumber}</td>
                    <td className="px-2 py-1.5">{line.saleOrderNumber}</td>
                    <td className="px-2 py-1.5">{line.reference}</td>
                    <td className="px-2 py-1.5">{line.color}</td>
                    <td className="px-2 py-1.5">{line.gradeLabel}</td>
                    <td className="px-2 py-1.5">{line.contractorName}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{qty(line.pairs)}</td>
                    <td className="px-2 py-1.5 text-right">{formatCurrency(line.value)}</td>
                    <td className="px-2 py-1.5">{OS_STATUS_LABEL[line.status]}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{qty(line.pending)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function ReportTable({
  rows,
  totals,
  showContractor,
}: {
  rows: OsAggregateRow[];
  totals: ReturnType<typeof osTotals>;
  showContractor: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[860px] text-left text-xs">
        <thead className="text-muted-foreground">
          <tr>
            {['Grupo', 'Enviados', 'Recebidos', 'Pendentes', 'Defeito', 'A pagar', 'Pago', ...(showContractor ? ['Prazo médio', 'Atrasos', '% defeito'] : [])].map((label) => (
              <th key={label} className="px-2 py-2 font-medium">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-border/70">
              <td className="px-2 py-1.5">{row.label}</td>
              <td className="px-2 py-1.5 text-right font-mono">{qty(row.sent)}</td>
              <td className="px-2 py-1.5 text-right font-mono">{qty(row.received)}</td>
              <td className="px-2 py-1.5 text-right font-mono">{qty(row.pending)}</td>
              <td className="px-2 py-1.5 text-right font-mono">{qty(row.defect)}</td>
              <td className="px-2 py-1.5 text-right">{formatCurrency(row.payable)}</td>
              <td className="px-2 py-1.5 text-right">{formatCurrency(row.paid)}</td>
              {showContractor && <td className="px-2 py-1.5 text-right font-mono">{row.avgReturnDays == null ? '—' : qty(row.avgReturnDays)}</td>}
              {showContractor && <td className="px-2 py-1.5 text-right font-mono">{row.lateCount}</td>}
              {showContractor && <td className="px-2 py-1.5 text-right font-mono">{row.defectRate == null ? '—' : `${qty(row.defectRate * 100)}%`}</td>}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border font-semibold">
            <td className="px-2 py-2">Total</td>
            <td className="px-2 py-2 text-right font-mono">{qty(totals.sent)}</td>
            <td className="px-2 py-2 text-right font-mono">{qty(totals.received)}</td>
            <td className="px-2 py-2 text-right font-mono">{qty(totals.pending)}</td>
            <td className="px-2 py-2 text-right font-mono">{qty(totals.defect)}</td>
            <td className="px-2 py-2 text-right">{formatCurrency(totals.payable)}</td>
            <td className="px-2 py-2 text-right">{formatCurrency(totals.paid)}</td>
            {showContractor && <td colSpan={3} />}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function head() {
  return ['Grupo', 'Enviados', 'Recebidos', 'Pendentes', 'Defeito', 'A pagar', 'Pago'].map((label) => `<th>${label}</th>`).join('');
}

function cells(row: OsAggregateRow) {
  return [row.label, qty(row.sent), qty(row.received), qty(row.pending), qty(row.defect), formatCurrency(row.payable), formatCurrency(row.paid)]
    .map((value) => `<td>${value}</td>`).join('');
}
