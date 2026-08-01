import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Panel } from '@/components/ui/panel';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { MagnifyingGlass, Receipt, Printer, FileArrowDown, Trash, X } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/utils';
import { formatDateBR } from '@/lib/dateOnly';
import { useEmployees } from '@/hooks/useEmployees';
import {
  usePayrollPaymentsHistory, useDeletePayrollPayment, getReceiptSignedUrl,
  paymentMethodLabel, formatPayrollPeriod, type PayrollPaymentWithRefs,
} from '@/hooks/usePayrollPayments';
import { printPayrollReceipt } from '@/lib/printPayrollReceipt';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function PayrollPaymentsHistory() {
  const { data: employees = [] } = useEmployees();
  const [employeeId, setEmployeeId] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<PayrollPaymentWithRefs | null>(null);

  const { data: payments = [], isLoading } = usePayrollPaymentsHistory({
    employeeId: employeeId === 'all' ? null : employeeId,
    from: from || null,
    to: to || null,
  });
  const del = useDeletePayrollPayment();

  const filtered = useMemo(() => {
    if (!q.trim()) return payments;
    const t = norm(q);
    return payments.filter(p =>
      norm(p.employee?.name || '').includes(t) ||
      norm(formatPayrollPeriod(p.run?.period || '')).includes(t) ||
      norm(paymentMethodLabel(p.method)).includes(t) ||
      norm(p.reference || '').includes(t));
  }, [payments, q]);

  const kpis = useMemo(() => {
    const total = filtered.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const withReceipt = filtered.filter(p => p.receipt_path).length;
    return { total, count: filtered.length, withReceipt };
  }, [filtered]);

  const empOptions = useMemo(
    () => [{ value: 'all', label: 'Todos os funcionários' },
      ...employees.map(e => ({ value: e.id, label: e.name }))],
    [employees],
  );

  const openReceipt = async (path: string) => {
    try { window.open(await getReceiptSignedUrl(path), '_blank'); }
    catch { toast.error('Falha ao abrir o recibo.'); }
  };

  const printFor = (p: PayrollPaymentWithRefs) =>
    printPayrollReceipt({
      employeeName: p.employee?.name || '—',
      cpf: p.employee?.cpf,
      role: p.employee?.role,
      period: p.run?.period || '',
      amount: p.amount,
      paidOn: p.paid_on,
      method: p.method,
      reference: p.reference,
      liquido: p.run?.total_liquido,
    });

  const hasFilters = employeeId !== 'all' || !!from || !!to || !!q;
  const clearFilters = () => { setEmployeeId('all'); setFrom(''); setTo(''); setQ(''); };

  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard label="Pagamentos" value={kpis.count} hint="no filtro atual" />
        <StatCard label="Total pago" value={formatCurrency(kpis.total)} tone="primary" />
        <StatCard label="Com recibo anexado" value={`${kpis.withReceipt}/${kpis.count}`} hint="recibo assinado" tone={kpis.count > 0 && kpis.withReceipt === kpis.count ? 'success' : 'default'} />
      </StatGrid>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-full sm:w-56 space-y-1">
          <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Funcionário</label>
          <SearchableSelect value={employeeId} onChange={setEmployeeId} options={empOptions} placeholder="Funcionário" />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">De</label>
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-10 w-40" />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Até</label>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-10 w-40" />
        </div>
        <div className="relative flex-1 min-w-[180px] space-y-1">
          <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Buscar</label>
          <div className="relative">
            <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Nome, período, método…" className="h-10 pl-9" />
          </div>
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" className="h-10 gap-1.5" onClick={clearFilters}>
            <X className="h-4 w-4" /> Limpar
          </Button>
        )}
      </div>

      <Panel title="Histórico de pagamentos" flush>
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Carregando…</div>
        ) : filtered.length === 0 ? (
          <div className="p-2">
            <EmptyState
              icon={Receipt}
              title="Nenhum pagamento encontrado"
              description={hasFilters
                ? 'Ajuste os filtros ou registre pagamentos na aba Folha.'
                : 'Os pagamentos registrados na folha aparecem aqui, com o recibo assinado pra baixar depois.'}
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Funcionário</TableHead>
                <TableHead>Folha</TableHead>
                <TableHead>Forma</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Recibo</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(p => (
                <TableRow key={p.id} className="hover:bg-muted/30">
                  <TableCell className="font-mono tabular-nums text-sm whitespace-nowrap">{formatDateBR(p.paid_on)}</TableCell>
                  <TableCell className="font-medium">
                    {p.employee?.name || '—'}
                    {p.employee?.department && <span className="ml-1.5 text-[11px] text-muted-foreground">· {p.employee.department}</span>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{formatPayrollPeriod(p.run?.period || '')}</TableCell>
                  <TableCell><Badge variant="secondary" className="font-normal">{paymentMethodLabel(p.method)}</Badge></TableCell>
                  <TableCell className="text-right font-mono tabular-nums font-semibold">{formatCurrency(p.amount)}</TableCell>
                  <TableCell>
                    {p.receipt_path
                      ? <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-emerald-600" onClick={() => openReceipt(p.receipt_path)}><FileArrowDown className="h-4 w-4" /> Baixar</Button>
                      : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Imprimir recibo" onClick={() => printFor(p)}><Printer className="h-4 w-4" /></Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-600 hover:text-red-700" title="Remover pagamento" aria-label="Remover pagamento"
                        disabled={del.isPending}
                        onClick={() => setDeleteTarget(p)}>
                        <Trash className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      <AlertDialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover pagamento?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `${deleteTarget.employee?.name || '—'} — ${formatCurrency(deleteTarget.amount)} em ${formatDateBR(deleteTarget.paid_on)}. `
                : ''}
              O recibo anexado também será excluído e a folha pode voltar a "aprovado".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={del.isPending}
              onClick={() => { if (deleteTarget) del.mutate({ id: deleteTarget.id }); setDeleteTarget(null); }}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
