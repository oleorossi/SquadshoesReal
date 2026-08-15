import { useState, useMemo, useEffect, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import { useCan } from '@/hooks/useAccessControl';
import { CurrencyDollar as DollarSign, TrendUp as TrendingUp, TrendDown as TrendingDown, Warning as AlertTriangle, Plus, PencilSimple as Pencil, Trash as Trash2, CheckCircle, ArrowCounterClockwise as Undo2, Clock, CircleNotch as Loader2, FileText, Buildings as Building2, ChartBar as BarChart3, Calculator, Bank as Landmark, FileArrowUp as FileUp, FileArrowDown as FileDown, UserCheck, MagnifyingGlass, Percent } from '@phosphor-icons/react';
import { Checkbox } from '@/components/ui/checkbox';
import { format, parseISO, isAfter, isBefore, addDays, startOfMonth, endOfMonth, eachDayOfInterval, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { todayISO, safeFormatBR } from '@/lib/date';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { HubTabsList } from '@/components/layout/HubTabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SortableTableHead, useTableSort } from '@/components/ui/sortable-table-head';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import { EmptyState } from '@/components/ui/empty-state';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import { isSettled, openBalanceOf, sumOpenBalance, type LedgerKind, type LedgerRow } from '@/lib/ledgerBalance';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Textarea } from '@/components/ui/textarea';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useAccountsPayable, useAccountsReceivable,
  useCreateAccountPayable, useCreateAccountReceivable,
  useUpdateAccountPayable, useUpdateAccountReceivable,
  useDeleteAccountPayable, useDeleteAccountReceivable,
  useReverseAccountPayable, useReverseAccountReceivable,
  type AccountPayable, type AccountReceivable,
} from '@/hooks/useFinance';
import {
  useChartOfAccounts, useCreateChartAccount, useUpdateChartAccount, useDeleteChartAccount,
  useCostCenters, useCreateCostCenter, useUpdateCostCenter, useDeleteCostCenter,
  useBankAccounts, useCreateBankAccount, useUpdateBankAccount,
  useFinancialEntries, useCreateFinancialEntry, useDeleteFinancialEntry,
  useLaborCosts, useCreateLaborCost, useUpdateLaborCost, useDeleteLaborCost,
  useOverheadAllocations, useCreateOverhead, useDeleteOverhead,
  useBudgets, useCreateBudget,
  useProductionCosts,
} from '@/hooks/useFinanceAdvanced';
import { useSuppliers } from '@/hooks/useSuppliers';
import { toast } from 'sonner';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from 'recharts';
import UnifiedInvoicesTab from '@/components/finance/UnifiedInvoicesTab';
import UnifiedFinanceTab from '@/components/finance/UnifiedFinanceTab';
import ComissoesTab from '@/components/finance/ComissoesTab';
import FactoringTab from '@/components/finance/FactoringTab';
import BankReconciliationTab from '@/components/finance/BankReconciliationTab';
import BoletoUploadDialog from '@/components/finance/BoletoUploadDialog';
import FinanceAttachments from '@/components/finance/FinanceAttachments';
import { FinanceReportsTab } from '@/components/finance/FinanceReportsTab';
import { SmartDashboard } from '@/components/finance/SmartDashboard';
import { NetMarginChart } from '@/components/finance/NetMarginChart';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { getSecondaryRoutesForGroup } from '@/data/navigation';
import { Panel } from '@/components/ui/panel';

const fmt = (v: number | null | undefined) => {
  const n = Number(v);
  if (!isFinite(n)) return 'R$ —';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};
const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: 'À Vencer', variant: 'outline' },
  paid: { label: 'Pago', variant: 'default' },
  received: { label: 'Recebido', variant: 'default' },
  overdue: { label: 'Vencido', variant: 'destructive' },
  cancelled: { label: 'Cancelado', variant: 'secondary' },
};

// Lê "hoje" no momento da chamada — não captura na carga do módulo (senão fica
// fixo no dia em que o app foi aberto e quebra ao virar a meia-noite).
function todayMidnight(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function currentMonthPeriod(): string {
  return format(todayMidnight(), 'yyyy-MM');
}

function getEffectiveStatus(status: string, dueDate: string | null | undefined) {
  if (status === 'paid' || status === 'received' || status === 'cancelled') return status;
  if (dueDate && isBefore(parseISO(dueDate), todayMidnight())) return 'overdue';
  return status;
}

/**
 * Subtotais do subtítulo de um painel, sobre a lista JÁ FILTRADA.
 * `open` casa com o card do topo quando não há filtro ativo — é o contrato que
 * mantém as duas leituras alinhadas. `settledCount` existe para explicar a
 * diferença entre "N conta(s)" e o valor em aberto: sem ele o usuário vê 72
 * linhas listadas e um total que só cobre 32, sem nenhuma pista do porquê.
 */
function panelSums(rows: LedgerRow[], kind: LedgerKind) {
  return rows.reduce(
    (acc, row) => {
      if (isSettled(row, kind)) {
        acc.settledCount++;
        return acc;
      }
      const remaining = openBalanceOf(row, kind);
      acc.open += remaining;
      if (getEffectiveStatus(row.status, row.due_date) === 'overdue') acc.overdue += remaining;
      else acc.upcoming += remaining;
      return acc;
    },
    { open: 0, overdue: 0, upcoming: 0, settledCount: 0 },
  );
}

/**
 * Motivo da primeira rejeição de um `Promise.allSettled`, para o toast de lote.
 * Os handlers em massa reportavam só "N falha(s)" e descartavam o `Error.message`
 * do hook — o usuário via a contagem e nenhuma causa. A causa é justamente o
 * único texto acionável ("Conta já paga não pode ser excluída..."), que só
 * aparecia num segundo toast do `onError`, empilhado atrás do genérico.
 */
function firstRejectionReason(results: PromiseSettledResult<unknown>[]): string {
  const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (!rejected) return '';
  const reason = rejected.reason;
  return (reason instanceof Error ? reason.message : String(reason ?? '')).trim();
}

/**
 * F11 (audit): retorna nº de dias até vencimento (negativo se vencido).
 * Usado pra colorir linhas com vencimento próximo (5-10d) em âmbar,
 * complementando o destrutivo já aplicado em overdue.
 */
function daysUntilDue(dueDate: string | null | undefined): number | null {
  if (!dueDate) return null;
  const due = parseISO(dueDate);
  const today = todayMidnight();
  return Math.floor((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function isDueSoon(dueDate: string | null | undefined, status: string): boolean {
  if (status === 'paid' || status === 'received' || status === 'cancelled') return false;
  const days = daysUntilDue(dueDate);
  return days !== null && days >= 0 && days <= 5;
}

/**
 * Cálculo SUGERIDO de juros + multa pra contas atrasadas.
 * Convenção brasileira padrão pra B2B (contratos não financeiros):
 *   - Multa fixa de 2% sobre o valor original (cobrada uma vez)
 *   - Juros de mora 1% ao mês (pro-rata por dia: 1/30 ao dia)
 * Total = principal × (1 + 0.02 + 0.01 × (diasAtraso / 30))
 *
 * Apenas SUGESTÃO visual — não persiste em DB. Usuário ajusta manualmente
 * na hora de marcar pago. Pode virar feature configurável em v2.
 */
function calculateOverdueAccruals(amount: number, dueDate: string | null | undefined): { fine: number; interest: number; total: number; daysOverdue: number } {
  if (!dueDate) return { fine: 0, interest: 0, total: 0, daysOverdue: 0 };
  const due = parseISO(dueDate);
  const today = todayMidnight();
  if (!isBefore(due, today)) return { fine: 0, interest: 0, total: 0, daysOverdue: 0 };
  const daysOverdue = Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  const fine = amount * 0.02;
  const interest = amount * 0.01 * (daysOverdue / 30);
  return { fine, interest, total: fine + interest, daysOverdue };
}

const CHART_COLORS = ['hsl(var(--primary))', 'hsl(var(--destructive))', 'hsl(142, 76%, 36%)', 'hsl(38, 92%, 50%)', 'hsl(262, 83%, 58%)', 'hsl(199, 89%, 48%)'];

// FinanceDashboard removed — substituído por SmartDashboard (módulo de inteligência financeira).

// ─── Payable Form Dialog (reused from original) ───
function PayableFormDialog({ open, onOpenChange, editing, suppliers, onSave }: {
  open: boolean; onOpenChange: (o: boolean) => void; editing: AccountPayable | null;
  suppliers: { id: string; name: string }[]; onSave: (data: any) => void;
}) {
  const [form, setForm] = useState<any>({});
  const [overdueWarning, setOverdueWarning] = useState(false);
  useEffect(() => {
    if (open) {
      setForm({
        description: editing?.description || '', supplier_id: editing?.supplier_id || '', category: editing?.category || 'material',
        due_date: editing?.due_date || '', amount: editing?.amount || 0, boleto_number: editing?.boleto_number || '',
        barcode: editing?.barcode || '', bank_name: editing?.bank_name || '', installment_number: editing?.installment_number || 1,
        total_installments: editing?.total_installments || 1, notes: editing?.notes || '', payment_method: editing?.payment_method || '',
        is_recurring: (editing as any)?.is_recurring || false, recurring_months: 12,
      });
      setOverdueWarning(false);
    }
  }, [open, editing]);

  const handleSave = () => {
    if (form.due_date && isBefore(parseISO(form.due_date), todayMidnight()) && !overdueWarning) {
      setOverdueWarning(true);
      return;
    }
    onSave(form);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Editar' : 'Nova'} Conta a Pagar</DialogTitle>
          <DialogDescription>Preencha os dados da conta; vencimento e valor são obrigatórios.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2"><Label>Descrição</Label><Input value={form.description || ''} onChange={e => setForm((f: any) => ({ ...f, description: e.target.value }))} /></div>
          <div>
            <Label>Fornecedor</Label>
            <SearchableSelect
              value={form.supplier_id || ''}
              onChange={v => setForm((f: any) => ({ ...f, supplier_id: v }))}
              options={suppliers.map(s => ({ value: s.id, label: s.name }))}
              placeholder="Selecione"
              searchPlaceholder="Buscar fornecedor..."
            />
          </div>
          <div>
            <Label>Categoria</Label>
            <Select value={form.category || 'material'} onValueChange={v => setForm((f: any) => ({ ...f, category: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="material">Material</SelectItem><SelectItem value="servico">Serviço</SelectItem>
                <SelectItem value="frete">Frete</SelectItem><SelectItem value="imposto">Imposto</SelectItem>
                <SelectItem value="mao_de_obra">Mão de Obra</SelectItem><SelectItem value="overhead">Overhead</SelectItem>
                <SelectItem value="outro">Outro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Vencimento</Label><Input type="date" value={form.due_date || ''} onChange={e => { setForm((f: any) => ({ ...f, due_date: e.target.value })); setOverdueWarning(false); }} /></div>
          <div><Label>Valor</Label><CurrencyInput value={form.amount || 0} onChange={v => setForm((f: any) => ({ ...f, amount: v }))} /></div>
          <div><Label>Nº Boleto</Label><Input value={form.boleto_number || ''} onChange={e => setForm((f: any) => ({ ...f, boleto_number: e.target.value }))} /></div>
          <div><Label>Forma Pagamento</Label><Input value={form.payment_method || ''} onChange={e => setForm((f: any) => ({ ...f, payment_method: e.target.value }))} /></div>
          <div className="sm:col-span-2"><Label>Código de Barras / Linha Digitável</Label><Input value={form.barcode || ''} onChange={e => setForm((f: any) => ({ ...f, barcode: e.target.value }))} placeholder="Cole aqui o código de barras do boleto" className="font-mono text-xs" /></div>
          <div><Label>Banco</Label><Input value={form.bank_name || ''} onChange={e => setForm((f: any) => ({ ...f, bank_name: e.target.value }))} /></div>
          <div>
            <Label>Parcela</Label>
            <div className="flex gap-1 items-center">
              <Input type="number" min={1} className="w-16" value={form.installment_number || 1} onChange={e => setForm((f: any) => ({ ...f, installment_number: +e.target.value }))} />
              <span className="text-muted-foreground">/</span>
              <Input type="number" min={1} className="w-16" value={form.total_installments || 1} onChange={e => setForm((f: any) => ({ ...f, total_installments: +e.target.value }))} />
            </div>
          </div>
          <div className="sm:col-span-2"><Label>Observações</Label><Textarea value={form.notes || ''} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} rows={2} /></div>
          {editing && (
            <div className="sm:col-span-2">
              <FinanceAttachments accountType="payable" accountId={editing.id} />
            </div>
          )}
          {!editing && (
            <div className="sm:col-span-2 flex items-center gap-4 rounded-md border p-3 bg-muted/30">
              <div className="flex items-center gap-2">
                <Checkbox id="is_recurring" checked={form.is_recurring || false} onCheckedChange={v => setForm((f: any) => ({ ...f, is_recurring: !!v }))} />
                <Label htmlFor="is_recurring" className="cursor-pointer font-medium">Conta Fixa (Recorrente)</Label>
              </div>
              {form.is_recurring && (
                <div className="flex items-center gap-2">
                  <Label className="text-sm whitespace-nowrap">Repetir por</Label>
                  <Input type="number" min={2} max={60} className="w-20" value={form.recurring_months || 12} onChange={e => setForm((f: any) => ({ ...f, recurring_months: Math.max(2, Math.min(60, +e.target.value)) }))} />
                  <span className="text-sm text-muted-foreground">meses</span>
                </div>
              )}
            </div>
          )}
          {overdueWarning && (
            <div className="sm:col-span-2 p-3 rounded-lg border border-warning bg-warning/10 space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" />
                <p className="text-sm font-semibold text-warning">Esta conta já está vencida!</p>
              </div>
              <p className="text-xs text-muted-foreground">
                A data de vencimento ({form.due_date ? format(parseISO(form.due_date), 'dd/MM/yyyy') : ''}) já passou. Deseja realmente cadastrar?
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setOverdueWarning(false)}>Cancelar</Button>
                <Button size="sm" variant="default" onClick={() => { onSave(form); onOpenChange(false); }}>
                  Sim, cadastrar mesmo assim
                </Button>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Receivable Form Dialog ───
function ReceivableFormDialog({ open, onOpenChange, editing, onSave }: {
  open: boolean; onOpenChange: (o: boolean) => void; editing: AccountReceivable | null; onSave: (data: any) => void;
}) {
  const [form, setForm] = useState<any>({});
  useEffect(() => {
    if (open) {
      setForm({
        description: editing?.description || '', client_name: editing?.client_name || '', client_cnpj: editing?.client_cnpj || '',
        category: editing?.category || 'venda', due_date: editing?.due_date || '', amount: editing?.amount || 0,
        installment_number: editing?.installment_number || 1, total_installments: editing?.total_installments || 1,
        notes: editing?.notes || '', payment_method: editing?.payment_method || '',
      });
    }
  }, [open, editing]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Editar' : 'Nova'} Conta a Receber</DialogTitle>
          <DialogDescription>Preencha os dados da conta; vencimento e valor são obrigatórios.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2"><Label>Descrição</Label><Input value={form.description || ''} onChange={e => setForm((f: any) => ({ ...f, description: e.target.value }))} /></div>
          <div><Label>Cliente</Label><Input value={form.client_name || ''} onChange={e => setForm((f: any) => ({ ...f, client_name: e.target.value }))} /></div>
          <div><Label>CNPJ</Label><Input value={form.client_cnpj || ''} onChange={e => setForm((f: any) => ({ ...f, client_cnpj: e.target.value }))} /></div>
          <div>
            <Label>Categoria</Label>
            <Select value={form.category || 'venda'} onValueChange={v => setForm((f: any) => ({ ...f, category: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="venda">Venda</SelectItem><SelectItem value="servico">Serviço</SelectItem><SelectItem value="outro">Outro</SelectItem></SelectContent>
            </Select>
          </div>
          <div><Label>Vencimento</Label><Input type="date" value={form.due_date || ''} onChange={e => setForm((f: any) => ({ ...f, due_date: e.target.value }))} /></div>
          <div><Label>Valor</Label><CurrencyInput value={form.amount || 0} onChange={v => setForm((f: any) => ({ ...f, amount: v }))} /></div>
          <div><Label>Forma Pagamento</Label><Input value={form.payment_method || ''} onChange={e => setForm((f: any) => ({ ...f, payment_method: e.target.value }))} /></div>
          <div>
            <Label>Parcela</Label>
            <div className="flex gap-1 items-center">
              <Input type="number" min={1} className="w-16" value={form.installment_number || 1} onChange={e => setForm((f: any) => ({ ...f, installment_number: +e.target.value }))} />
              <span className="text-muted-foreground">/</span>
              <Input type="number" min={1} className="w-16" value={form.total_installments || 1} onChange={e => setForm((f: any) => ({ ...f, total_installments: +e.target.value }))} />
            </div>
          </div>
          <div className="sm:col-span-2"><Label>Observações</Label><Textarea value={form.notes || ''} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} rows={2} /></div>
          {editing && (
            <div className="sm:col-span-2">
              <FinanceAttachments accountType="receivable" accountId={editing.id} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => { onSave(form); onOpenChange(false); }}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ChartOfAccountsTab e CostCentersTab removidos — agora gerenciados em Configurações → FinanceConfigPanel.

// ─── Financial Entries Tab ───
function FinancialEntriesTab() {
  const [filters, setFilters] = useState({ period: currentMonthPeriod(), type: 'all', costCenterId: '' });
  const { data: entries = [], isLoading } = useFinancialEntries(filters);
  const { data: accounts = [] } = useChartOfAccounts();
  const { data: centers = [] } = useCostCenters();
  const { data: banks = [] } = useBankAccounts();
  const createEntry = useCreateFinancialEntry();
  const deleteEntry = useDeleteFinancialEntry();
  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState<any>({ entry_date: format(todayMidnight(), 'yyyy-MM-dd'), type: 'despesa', description: '', amount: 0, account_id: '', cost_center_id: '', bank_account_id: '', reference_type: 'manual', reference_id: '', collection: '', sku: '', notes: '' });

  const totals = useMemo(() => {
    // FIX M3: filtrar status cancelado/estornado antes de somar. Antes os
    // cards mostravam totais que não batiam com DRE (que filtra por status).
    const CANCELLED = new Set(['cancelado', 'cancelled', 'estornado']);
    const active = entries.filter((e: any) => !CANCELLED.has(String(e.status || '').toLowerCase()));
    const rec = active.filter((e: any) => e.type === 'receita').reduce((s: number, e: any) => s + e.amount, 0);
    const desp = active.filter((e: any) => e.type === 'despesa').reduce((s: number, e: any) => s + e.amount, 0);
    return { receitas: rec, despesas: desp, resultado: rec - desp };
  }, [entries]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div><Label className="text-xs">Período</Label><Input type="month" value={filters.period} onChange={e => setFilters(f => ({ ...f, period: e.target.value }))} className="w-40" /></div>
        <div>
          <Label className="text-xs">Tipo</Label>
          <Select value={filters.type} onValueChange={v => setFilters(f => ({ ...f, type: v }))}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todos</SelectItem><SelectItem value="receita">Receita</SelectItem><SelectItem value="despesa">Despesa</SelectItem><SelectItem value="transferencia">Transferência</SelectItem></SelectContent>
          </Select>
        </div>
        <Button size="sm" onClick={() => { setForm({ entry_date: format(todayMidnight(), 'yyyy-MM-dd'), type: 'despesa', description: '', amount: 0, account_id: '', cost_center_id: '', bank_account_id: '', reference_type: 'manual', reference_id: '', collection: '', sku: '', notes: '' }); setDialog(true); }}><Plus className="h-4 w-4 mr-1" /> Novo Lançamento</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Receitas</p><p className="text-lg font-bold text-green-600">{fmt(totals.receitas)}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Despesas</p><p className="text-lg font-bold text-destructive">{fmt(totals.despesas)}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Resultado</p><p className={`text-lg font-bold ${totals.resultado >= 0 ? 'text-green-600' : 'text-destructive'}`}>{fmt(totals.resultado)}</p></CardContent></Card>
      </div>

      <Card>
        <CardContent className="pt-4">
          {isLoading ? <Loader2 className="h-6 w-6 animate-spin mx-auto" /> : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Data</TableHead><TableHead>Tipo</TableHead><TableHead>Descrição</TableHead><TableHead>Conta</TableHead><TableHead>Centro Custo</TableHead><TableHead>Coleção</TableHead><TableHead className="text-right">Valor</TableHead><TableHead className="text-right">Ações</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {entries.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Nenhum lançamento</TableCell></TableRow>
                ) : entries.map((e: any) => (
                  <TableRow key={e.id}>
                    <TableCell>{format(parseISO(e.entry_date), 'dd/MM/yy')}</TableCell>
                    <TableCell><Badge variant={e.type === 'receita' ? 'default' : e.type === 'despesa' ? 'destructive' : 'secondary'}>{e.type === 'receita' ? 'Receita' : e.type === 'despesa' ? 'Despesa' : 'Transf.'}</Badge></TableCell>
                    <TableCell className="font-medium max-w-[200px] truncate">{e.description}</TableCell>
                    <TableCell className="text-xs">{e.chart_of_accounts?.name || '—'}</TableCell>
                    <TableCell className="text-xs">{e.cost_centers?.name || '—'}</TableCell>
                    <TableCell className="text-xs">{e.collection || '—'}</TableCell>
                    <TableCell className={`text-right font-mono ${e.type === 'receita' ? 'text-green-600' : 'text-destructive'}`}>{fmt(e.amount)}</TableCell>
                    <TableCell className="text-right">
                      <AlertDialog>
                        <AlertDialogTrigger asChild><Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" aria-label="Excluir lançamento"><Trash2 className="h-3.5 w-3.5" /></Button></AlertDialogTrigger>
                        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Excluir lançamento?</AlertDialogTitle><AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription></AlertDialogHeader>
                          <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => deleteEntry.mutate(e.id)}>Excluir</AlertDialogAction></AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Novo Lançamento</DialogTitle>
            <DialogDescription>Registre uma receita, despesa ou transferência manual no período.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label>Data</Label><Input type="date" value={form.entry_date} onChange={e => setForm((f: any) => ({ ...f, entry_date: e.target.value }))} /></div>
            <div>
              <Label>Tipo</Label>
              <Select value={form.type} onValueChange={v => setForm((f: any) => ({ ...f, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="receita">Receita</SelectItem><SelectItem value="despesa">Despesa</SelectItem><SelectItem value="transferencia">Transferência</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2"><Label>Descrição</Label><Input value={form.description} onChange={e => setForm((f: any) => ({ ...f, description: e.target.value }))} /></div>
            <div><Label>Valor</Label><CurrencyInput value={form.amount} onChange={v => setForm((f: any) => ({ ...f, amount: v }))} /></div>
            <div>
              <Label>Conta Contábil</Label>
              <SearchableSelect
                value={form.account_id || ''}
                onChange={v => setForm((f: any) => ({ ...f, account_id: v }))}
                options={accounts.map((a: any) => ({ value: a.id, label: `${a.code} - ${a.name}` }))}
                placeholder="Selecione"
                searchPlaceholder="Buscar conta..."
              />
            </div>
            <div>
              <Label>Centro de Custo</Label>
              <SearchableSelect
                value={form.cost_center_id || ''}
                onChange={v => setForm((f: any) => ({ ...f, cost_center_id: v }))}
                options={centers.map((c: any) => ({ value: c.id, label: `${c.code} - ${c.name}` }))}
                placeholder="Selecione"
                searchPlaceholder="Buscar centro de custo..."
              />
            </div>
            <div>
              <Label>Conta Bancária</Label>
              <Select value={form.bank_account_id || ''} onValueChange={v => setForm((f: any) => ({ ...f, bank_account_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{banks.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Coleção</Label><Input value={form.collection || ''} onChange={e => setForm((f: any) => ({ ...f, collection: e.target.value }))} placeholder="ex: Verão 2026" /></div>
            <div><Label>SKU</Label><Input value={form.sku || ''} onChange={e => setForm((f: any) => ({ ...f, sku: e.target.value }))} /></div>
            <div>
              <Label>Referência</Label>
              <Select value={form.reference_type || 'manual'} onValueChange={v => setForm((f: any) => ({ ...f, reference_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="manual">Manual</SelectItem><SelectItem value="nf">NF</SelectItem><SelectItem value="pedido">Pedido</SelectItem><SelectItem value="op">OP</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2"><Label>Observações</Label><Textarea value={form.notes || ''} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>Cancelar</Button>
            <Button onClick={() => {
              const { account_id, cost_center_id, bank_account_id, ...rest } = form;
              createEntry.mutate({ ...rest, account_id: account_id || null, cost_center_id: cost_center_id || null, bank_account_id: bank_account_id || null });
              setDialog(false);
            }}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Production Cost Tab ───
function ProductionCostTab() {
  const { data: laborCosts = [], isLoading: loadingLabor } = useLaborCosts();
  const { data: overheads = [] } = useOverheadAllocations();
  const { data: centers = [] } = useCostCenters();
  const createLabor = useCreateLaborCost();
  const deleteLabor = useDeleteLaborCost();
  const createOverhead = useCreateOverhead();
  const deleteOverhead = useDeleteOverhead();
  const [laborDialog, setLaborDialog] = useState(false);
  const [overheadDialog, setOverheadDialog] = useState(false);
  const [laborForm, setLaborForm] = useState({ operation_name: '', hour_cost: 0, time_per_unit_minutes: 0, cost_center_id: '', notes: '' });
  const [ohForm, setOhForm] = useState({ period: currentMonthPeriod(), cost_type: '', total_amount: 0, allocation_base: 'hora_maquina', cost_center_id: '', notes: '' });

  return (
    <div className="space-y-6">
      {/* Labor Costs */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Custos de Mão de Obra</CardTitle>
          <Button size="sm" onClick={() => { setLaborForm({ operation_name: '', hour_cost: 0, time_per_unit_minutes: 0, cost_center_id: '', notes: '' }); setLaborDialog(true); }}><Plus className="h-4 w-4 mr-1" /> Nova Operação</Button>
        </CardHeader>
        <CardContent>
          {loadingLabor ? <Loader2 className="h-6 w-6 animate-spin mx-auto" /> : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Operação</TableHead><TableHead>Custo/Hora</TableHead><TableHead>Tempo/Unid (min)</TableHead><TableHead>Custo/Unid</TableHead><TableHead>Centro Custo</TableHead><TableHead className="text-right">Ações</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {laborCosts.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nenhuma operação cadastrada</TableCell></TableRow>
                ) : laborCosts.map((l: any) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.operation_name}</TableCell>
                    <TableCell className="font-mono">{fmt(l.hour_cost)}</TableCell>
                    <TableCell>{l.time_per_unit_minutes} min</TableCell>
                    <TableCell className="font-mono font-bold">{fmt((l.time_per_unit_minutes / 60) * l.hour_cost)}</TableCell>
                    <TableCell className="text-xs">{l.cost_centers?.name || '—'}</TableCell>
                    <TableCell className="text-right">
                      <AlertDialog>
                        <AlertDialogTrigger asChild><Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" aria-label="Excluir operação"><Trash2 className="h-3.5 w-3.5" /></Button></AlertDialogTrigger>
                        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Excluir operação?</AlertDialogTitle></AlertDialogHeader>
                          <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => deleteLabor.mutate(l.id)}>Excluir</AlertDialogAction></AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Overhead */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Rateio de Custos Indiretos (Overhead)</CardTitle>
          <Button size="sm" onClick={() => { setOhForm({ period: currentMonthPeriod(), cost_type: '', total_amount: 0, allocation_base: 'hora_maquina', cost_center_id: '', notes: '' }); setOverheadDialog(true); }}><Plus className="h-4 w-4 mr-1" /> Novo Rateio</Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Período</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Valor Total</TableHead><TableHead>Base Rateio</TableHead><TableHead>Centro Custo</TableHead><TableHead className="text-right">Ações</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {overheads.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nenhum rateio cadastrado</TableCell></TableRow>
              ) : overheads.map((o: any) => (
                <TableRow key={o.id}>
                  <TableCell>{o.period}</TableCell>
                  <TableCell className="font-medium">{o.cost_type}</TableCell>
                  <TableCell className="text-right font-mono">{fmt(o.total_amount)}</TableCell>
                  <TableCell><Badge variant="outline">{o.allocation_base === 'hora_maquina' ? 'Hora Máquina' : o.allocation_base === 'area' ? 'Área' : 'Qty Produzida'}</Badge></TableCell>
                  <TableCell className="text-xs">{o.cost_centers?.name || '—'}</TableCell>
                  <TableCell className="text-right">
                    <AlertDialog>
                      <AlertDialogTrigger asChild><Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" aria-label="Excluir rateio"><Trash2 className="h-3.5 w-3.5" /></Button></AlertDialogTrigger>
                      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Excluir rateio?</AlertDialogTitle></AlertDialogHeader>
                        <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => deleteOverhead.mutate(o.id)}>Excluir</AlertDialogAction></AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Labor Dialog */}
      <Dialog open={laborDialog} onOpenChange={setLaborDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nova Operação de Mão de Obra</DialogTitle>
            <DialogDescription>Cadastre a operação com custo por hora e tempo por unidade.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2"><Label>Operação</Label><Input value={laborForm.operation_name} onChange={e => setLaborForm(f => ({ ...f, operation_name: e.target.value }))} placeholder="ex: Costura, Montagem" /></div>
            <div><Label>Custo/Hora (R$)</Label><CurrencyInput value={laborForm.hour_cost} onChange={v => setLaborForm(f => ({ ...f, hour_cost: v }))} /></div>
            <div><Label>Tempo/Unid (min)</Label><Input type="number" min={0} step={0.5} value={laborForm.time_per_unit_minutes} onChange={e => setLaborForm(f => ({ ...f, time_per_unit_minutes: +e.target.value }))} /></div>
            <div className="sm:col-span-2">
              <Label>Centro de Custo</Label>
              <Select value={laborForm.cost_center_id || ''} onValueChange={v => setLaborForm(f => ({ ...f, cost_center_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{centers.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLaborDialog(false)}>Cancelar</Button>
            <Button onClick={() => { createLabor.mutate({ ...laborForm, cost_center_id: laborForm.cost_center_id || null }); setLaborDialog(false); }}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Overhead Dialog */}
      <Dialog open={overheadDialog} onOpenChange={setOverheadDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo Rateio de Overhead</DialogTitle>
            <DialogDescription>Defina o custo indireto do período e a base de rateio.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label>Período</Label><Input type="month" value={ohForm.period} onChange={e => setOhForm(f => ({ ...f, period: e.target.value }))} /></div>
            <div><Label>Tipo</Label><Input value={ohForm.cost_type} onChange={e => setOhForm(f => ({ ...f, cost_type: e.target.value }))} placeholder="ex: Energia, Aluguel" /></div>
            <div><Label>Valor Total</Label><CurrencyInput value={ohForm.total_amount} onChange={v => setOhForm(f => ({ ...f, total_amount: v }))} /></div>
            <div>
              <Label>Base de Rateio</Label>
              <Select value={ohForm.allocation_base} onValueChange={v => setOhForm(f => ({ ...f, allocation_base: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="hora_maquina">Hora Máquina</SelectItem><SelectItem value="area">Área (m²)</SelectItem><SelectItem value="qty_produzida">Qty Produzida</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label>Centro de Custo</Label>
              <Select value={ohForm.cost_center_id || ''} onValueChange={v => setOhForm(f => ({ ...f, cost_center_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{centers.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverheadDialog(false)}>Cancelar</Button>
            <Button onClick={() => { createOverhead.mutate({ ...ohForm, cost_center_id: ohForm.cost_center_id || null }); setOverheadDialog(false); }}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Budget Tab ───
function BudgetTab() {
  const [period, setPeriod] = useState(currentMonthPeriod());
  const { data: budgets = [] } = useBudgets(period);
  const { data: accounts = [] } = useChartOfAccounts();
  const { data: centers = [] } = useCostCenters();
  const createBudget = useCreateBudget();
  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState({ period: currentMonthPeriod(), cost_center_id: '', account_id: '', planned_amount: 0, actual_amount: 0, notes: '' });

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-end">
        <div><Label className="text-xs">Período</Label><Input type="month" value={period} onChange={e => setPeriod(e.target.value)} className="w-40" /></div>
        <Button size="sm" onClick={() => { setForm({ period, cost_center_id: '', account_id: '', planned_amount: 0, actual_amount: 0, notes: '' }); setDialog(true); }}><Plus className="h-4 w-4 mr-1" /> Novo Orçamento</Button>
      </div>
      <Card>
        <CardContent className="pt-4">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Conta</TableHead><TableHead>Centro Custo</TableHead><TableHead className="text-right">Orçado</TableHead><TableHead className="text-right">Realizado</TableHead><TableHead className="text-right">Variação</TableHead><TableHead>%</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {budgets.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nenhum orçamento para este período</TableCell></TableRow>
              ) : budgets.map((b: any) => {
                const variance = b.actual_amount - b.planned_amount;
                const pct = b.planned_amount > 0 ? ((variance / b.planned_amount) * 100).toFixed(1) : '—';
                return (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.chart_of_accounts?.name || '—'}</TableCell>
                    <TableCell>{b.cost_centers?.name || '—'}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(b.planned_amount)}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(b.actual_amount)}</TableCell>
                    <TableCell className={`text-right font-mono ${variance > 0 ? 'text-destructive' : 'text-green-600'}`}>{fmt(Math.abs(variance))}</TableCell>
                    <TableCell><Badge variant={variance > 0 ? 'destructive' : 'default'}>{pct}%</Badge></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo Orçamento</DialogTitle>
            <DialogDescription>Defina os valores orçado e realizado da conta no período.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label>Período</Label><Input type="month" value={form.period} onChange={e => setForm(f => ({ ...f, period: e.target.value }))} /></div>
            <div>
              <Label>Conta</Label>
              <Select value={form.account_id || ''} onValueChange={v => setForm(f => ({ ...f, account_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{accounts.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.code} - {a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Centro Custo</Label>
              <Select value={form.cost_center_id || ''} onValueChange={v => setForm(f => ({ ...f, cost_center_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{centers.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Valor Orçado</Label><CurrencyInput value={form.planned_amount} onChange={v => setForm(f => ({ ...f, planned_amount: v }))} /></div>
            <div><Label>Valor Realizado</Label><CurrencyInput value={form.actual_amount} onChange={v => setForm(f => ({ ...f, actual_amount: v }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>Cancelar</Button>
            <Button onClick={() => { createBudget.mutate({ ...form, cost_center_id: form.cost_center_id || null, account_id: form.account_id || null }); setDialog(false); }}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Main Page ───
/**
 * Abas do Financeiro. As 19 chaves antigas continuam aceitas como ENTRADA —
 * SmartDashboard, alertas e atalhos externos apontam pra elas — e são
 * normalizadas pro canônico assim que a tela abre.
 */
const FINANCE_TABS = ['dashboard', 'accounts', 'invoices', 'comissoes-factoring', 'reports'] as const;
type FinanceTab = typeof FINANCE_TABS[number];

const FINANCE_TAB_ALIASES: Record<string, FinanceTab> = {
  visao: 'dashboard',
  contas: 'accounts',
  payable: 'accounts',
  receivable: 'accounts',
  notas: 'invoices',
  operational: 'comissoes-factoring',   // nome anterior da aba
  comissoes: 'comissoes-factoring',
  factoring: 'comissoes-factoring',
  relatorios: 'reports',
  dre: 'reports',
  cashflow: 'reports',
  aging: 'reports',
};

/** Aliases que também determinam a SUBABA de Contas. */
const FINANCE_LEGACY_SUBTAB: Record<string, 'payable' | 'receivable'> = {
  payable: 'payable',
  receivable: 'receivable',
};

export default function Finance() {
  const { data: payables = [], isLoading: loadingP } = useAccountsPayable();
  const { data: receivables = [], isLoading: loadingR } = useAccountsReceivable();
  const { data: entries = [] } = useFinancialEntries();
  const { data: suppliers = [] } = useSuppliers();
  const qc = useQueryClient();
  const createPayable = useCreateAccountPayable();
  const createReceivable = useCreateAccountReceivable();
  const updatePayable = useUpdateAccountPayable();
  const updateReceivable = useUpdateAccountReceivable();
  const deletePayable = useDeleteAccountPayable();
  const deleteReceivable = useDeleteAccountReceivable();
  const reversePayable = useReverseAccountPayable();
  const reverseReceivable = useReverseAccountReceivable();
  // Gates de ação por área (referência de adoção do controle CRUD). Admin e
  // usuários sem permissão granular sempre passam — não restringe quem já podia.
  // ⚠ Usa o path do ITEM DE MENU ('/financeiro'), não a rota-redirect '/finance':
  // os grants granulares são gravados por path de menu, e resolveMenuOwner casa
  // por esse path. Usar '/finance' (sem item de menu) zeraria os gates.
  const finPerm = useCan('/financeiro');

  const [payableDialog, setPayableDialog] = useState(false);
  const [boletoUploadDialog, setBoletoUploadDialog] = useState(false);
  const [receivableDialog, setReceivableDialog] = useState(false);
  const [editingPayable, setEditingPayable] = useState<AccountPayable | null>(null);
  const [editingReceivable, setEditingReceivable] = useState<AccountReceivable | null>(null);
  // A aba mora na URL desde 29/07/2026. Antes vivia em `usePersistedState`
  // ('financeTab'), que GANHAVA do deep-link: quem abrisse /financeiro?tab=reports
  // caía na aba salva da última visita. E trocar de aba não escrevia nada, então
  // F5 e o botão Voltar perdiam o lugar. `migrateFrom` lê o valor salvo uma única
  // vez e o converte em URL canônica; depois disso o storage é ignorado.
  const { value: financeTab, setValue: setFinanceTab } = useUrlTabState<FinanceTab>({
    values: FINANCE_TABS,
    defaultValue: 'accounts',
    aliases: FINANCE_TAB_ALIASES,
    clearOnChange: ['subtab'],
    migrateFrom: 'financeTab',
  });
  const [accountsSubTab, setAccountsSubTab] = useState<'payable' | 'receivable'>('payable');
  const [searchParams] = useSearchParams();

  // Alguns aliases legados carregam a SUBABA junto (?tab=payable quer dizer
  // "Contas → A Pagar"). O helper normaliza a aba-pai; a filha é sedimentada
  // aqui, uma vez, a partir do parâmetro cru — antes que a normalização o apague.
  const rawTabParam = searchParams.get('tab');
  const semeouSubtab = useRef(false);
  useEffect(() => {
    if (semeouSubtab.current || !rawTabParam) return;
    semeouSubtab.current = true;
    const sub = FINANCE_LEGACY_SUBTAB[rawTabParam];
    if (sub) setAccountsSubTab(sub);
  }, [rawTabParam]);
  const [selectedReceivables, setSelectedReceivables] = useState<Set<string>>(new Set());
  const [selectedPayables, setSelectedPayables] = useState<Set<string>>(new Set());
  const financeQuery = searchParams.get('q') || '';
  const [payableSearch, setPayableSearch] = useState(financeQuery);
  useEffect(() => {
    if (!financeQuery) return;
    setAccountsSubTab('payable');
    setPayableSearch(financeQuery);
  }, [financeQuery]);
  const [payableStatusFilter, setPayableStatusFilter] = useState<string[]>([]);
  const [payableDateFrom, setPayableDateFrom] = useState('');
  const [payableDateTo, setPayableDateTo] = useState('');
  const payableSort = useTableSort<AccountPayable & { supplier_name: string }>('due_date', 'asc');
  const receivableSort = useTableSort<AccountReceivable>('due_date', 'asc');
  const [receivableSearch, setReceivableSearch] = useState('');
  // Espelham os filtros da AP. Sem eles não havia como tirar da lista as 40
  // linhas canceladas por PV cancelado, que apareciam misturadas às vivas.
  const [receivableStatusFilter, setReceivableStatusFilter] = useState<string[]>([]);
  const [receivableDateFrom, setReceivableDateFrom] = useState('');
  const [receivableDateTo, setReceivableDateTo] = useState('');

  const toggleReceivable = (id: string) => setSelectedReceivables(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const togglePayable = (id: string) => setSelectedPayables(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAllReceivables = () => {
    if (selectedReceivables.size === receivables.length) setSelectedReceivables(new Set());
    else setSelectedReceivables(new Set(receivables.map(r => r.id)));
  };
  const handleBulkDeleteReceivables = async () => {
    const ids = Array.from(selectedReceivables);
    setSelectedReceivables(new Set());
    const results = await Promise.allSettled(ids.map(id => deleteReceivable.mutateAsync(id)));
    const failed = results.filter(r => r.status === 'rejected').length;
    const ok = ids.length - failed;
    if (failed > 0) {
      const reason = firstRejectionReason(results);
      toast.error(`${ok} excluída(s), ${failed} falha(s)${reason ? ` — ${reason}` : ''}`);
    } else toast.success(`${ok} conta(s) excluída(s)`);
  };
  const handleBulkMarkReceived = async () => {
    const todayStr = format(todayMidnight(), 'yyyy-MM-dd');
    const candidates = Array.from(selectedReceivables)
      .map(id => receivables.find(x => x.id === id))
      .filter((r): r is AccountReceivable => !!r && r.status !== 'received' && r.status !== 'cancelled');
    setSelectedReceivables(new Set());
    if (candidates.length === 0) return;
    // Use direct Supabase call with atomic-claim predicate to prevent
    // concurrent bulk/single receives from overwriting already-processed rows.
    const results = await Promise.allSettled(
      candidates.map(async r => {
        const { data, error } = await supabase
          .from('accounts_receivable')
          .update({ status: 'received', amount_received: r.amount, payment_date: todayStr, updated_at: new Date().toISOString() })
          .eq('id', r.id)
          .not('status', 'in', '(received,cancelled)')
          .select('id');
        if (error) throw error;
        if (!data || data.length === 0) throw new Error('Already processed');
      })
    );
    qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
    const failed = results.filter(r => r.status === 'rejected').length;
    const ok = results.filter(r => r.status === 'fulfilled').length;
    if (failed > 0) toast.error(`${ok} marcada(s), ${failed} falha(s) — verifique e tente novamente.`);
    else if (ok > 0) toast.success(`${ok} conta(s) marcada(s) como recebida(s)`);
  };
  const handleBulkDeletePayables = async () => {
    const ids = Array.from(selectedPayables);
    setSelectedPayables(new Set());
    const results = await Promise.allSettled(ids.map(id => deletePayable.mutateAsync(id)));
    const failed = results.filter(r => r.status === 'rejected').length;
    const ok = ids.length - failed;
    if (failed > 0) {
      const reason = firstRejectionReason(results);
      toast.error(`${ok} excluída(s), ${failed} falha(s)${reason ? ` — ${reason}` : ''}`);
    } else toast.success(`${ok} conta(s) excluída(s)`);
  };
  const handleBulkMarkPaid = async () => {
    const todayStr = format(todayMidnight(), 'yyyy-MM-dd');
    const candidates = Array.from(selectedPayables)
      .map(id => payables.find(x => x.id === id))
      .filter((p): p is AccountPayable => !!p && p.status !== 'paid' && p.status !== 'cancelled');
    setSelectedPayables(new Set());
    if (candidates.length === 0) return;
    // Atomic-claim predicate (mesmo padrão do markPaid unário) evita que um bulk
    // e um pagamento individual concorrentes sobrescrevam linha já processada.
    const results = await Promise.allSettled(
      candidates.map(async p => {
        const { data, error } = await supabase
          .from('accounts_payable')
          .update({ status: 'paid', amount_paid: p.amount, payment_date: todayStr })
          .eq('id', p.id)
          .not('status', 'in', '(paid,cancelled)')
          .select('id');
        if (error) throw error;
        if (!data || data.length === 0) throw new Error('Already processed');
      })
    );
    qc.invalidateQueries({ queryKey: ['accounts_payable'] });
    const failed = results.filter(r => r.status === 'rejected').length;
    const ok = results.filter(r => r.status === 'fulfilled').length;
    if (failed > 0) toast.error(`${ok} marcada(s), ${failed} falha(s) — verifique e tente novamente.`);
    else if (ok > 0) toast.success(`${ok} conta(s) marcada(s) como paga(s)`);
  };

  const loading = loadingP || loadingR;

  const exportPayablesBatch = (items: AccountPayable[]) => {
    const pending = items.filter(p => p.status !== 'paid' && p.status !== 'cancelled');
    if (pending.length === 0) { toast('Nenhuma conta pendente para exportar'); return; }
    const csvField = (v: unknown) => {
      const s = String(v ?? '');
      if (s.includes(';') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const header = 'Descrição;Fornecedor;CNPJ;Vencimento;Valor;Código de Barras;Nº Boleto;Forma Pagamento;Banco;Parcela;Status';
    const rows = pending.map(p => [
      csvField(p.description), csvField(p.suppliers?.name || ''), csvField(p.suppliers?.cnpj || ''),
      safeFormatBR(p.due_date),
      p.amount.toFixed(2).replace('.', ','), csvField(p.barcode || ''), csvField(p.boleto_number || ''),
      csvField(p.payment_method || ''), csvField(p.bank_name || ''),
      `${p.installment_number}/${p.total_installments}`, p.status,
    ].join(';'));
    const csv = [header, ...rows].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `contas_a_pagar_lote_${format(todayMidnight(), 'yyyy-MM-dd')}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success(`${pending.length} conta(s) exportada(s) com sucesso`);
  };

  const handleSavePayable = async (data: any) => {
    const amt = Number(data.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('Valor deve ser maior que zero.');
      return;
    }
    if (!data.due_date) {
      toast.error('Data de vencimento é obrigatória.');
      return;
    }
    // Always strip recurring_months before sending to DB (client-only field)
    const { recurring_months, ...dbData } = data;

    if (editingPayable) {
      updatePayable.mutate({ id: editingPayable.id, ...dbData });
    } else if (data.is_recurring && recurring_months > 1 && data.due_date) {
      // Gera N lançamentos mensais com mesma data do mês — em sequência, capturando falhas.
      const baseDate = new Date(data.due_date + 'T12:00:00');
      const day = baseDate.getDate();
      const months = recurring_months || 12;
      const payloads: any[] = [];
      for (let i = 0; i < months; i++) {
        const d = new Date(baseDate);
        d.setMonth(d.getMonth() + i);
        if (d.getDate() !== day) d.setDate(0);
        const dueStr = d.toISOString().split('T')[0];
        payloads.push({
          ...dbData,
          due_date: dueStr,
          installment_number: i + 1,
          total_installments: months,
          status: 'pending',
          amount_paid: 0,
          is_recurring: true,
        });
      }
      const results = await Promise.allSettled(payloads.map(p => createPayable.mutateAsync(p)));
      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed === 0) {
        toast.success(`${months} lançamentos recorrentes criados!`);
      } else {
        toast.error(`${months - failed} criado(s), ${failed} falhou(aram). Verifique e tente novamente as faltantes.`);
      }
    } else {
      createPayable.mutate({ ...dbData, status: 'pending', amount_paid: 0 });
    }
    setEditingPayable(null);
  };

  const handleSaveReceivable = (data: any) => {
    const amt = Number(data.amount);
    if (!Number.isFinite(amt) || amt <= 0) { toast.error('Valor deve ser maior que zero.'); return; }
    if (!data.due_date) { toast.error('Data de vencimento é obrigatória.'); return; }
    if (editingReceivable) updateReceivable.mutate({ id: editingReceivable.id, ...data });
    else createReceivable.mutate({ ...data, status: 'pending', amount_received: 0 });
    setEditingReceivable(null);
  };

  const markPaid = async (p: AccountPayable) => {
    if (p.status === 'paid' || p.status === 'cancelled') return;
    const { data: claimed, error } = await supabase
      .from('accounts_payable')
      .update({ status: 'paid', amount_paid: p.amount, payment_date: format(todayMidnight(), 'yyyy-MM-dd') })
      .eq('id', p.id)
      .not('status', 'in', '(paid,cancelled)')
      .select('id');
    if (error) { toast.error(error.message); return; }
    if (!claimed?.length) { toast.info('Conta já paga ou cancelada — reabra-a antes de marcar como paga.'); return; }
    qc.invalidateQueries({ queryKey: ['accounts_payable'] });
    toast.success('Conta marcada como paga.');
  };
  const markReceived = async (r: AccountReceivable) => {
    if (r.status === 'received' || r.status === 'cancelled') return;
    const { data: claimed, error } = await supabase
      .from('accounts_receivable')
      .update({ status: 'received', amount_received: r.amount, payment_date: format(todayMidnight(), 'yyyy-MM-dd') })
      .eq('id', r.id)
      .not('status', 'in', '(received,cancelled)')
      .select('id');
    if (error) { toast.error(error.message); return; }
    if (!claimed?.length) { toast.info('Conta já estava recebida.'); return; }
    qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
    toast.success('Conta marcada como recebida.');
  };

  return (
    <>
      <div className="space-y-5 page-enter editorial-stagger">
        <EditorialPageHeader
          sectionLabel="FINANCEIRO · CENTRAL"
          title="Financeiro"
          description={
            // F15 (audit): breadcrumb mostra qual aba está ativa.
            financeTab === 'dashboard' ? 'Visão Geral'
              : financeTab === 'accounts' ? 'Contas a Pagar / Receber'
              : financeTab === 'invoices' ? 'Notas Fiscais'
              // 'operational' saiu: virou alias de 'comissoes-factoring'. O
              // typecheck só acusou agora que a aba deixou de ser `string`.
              : financeTab === 'comissoes-factoring' ? 'Comissões & Factoring'
              : financeTab === 'reports' ? 'Relatórios analíticos'
              : 'Visão Geral'
          }
        />
        {/* Atalhos pra rotas financeiras não-sidebar (Markup/CT-e/MDF-e/CNAB) */}
        {getSecondaryRoutesForGroup('Financeiro').length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 -mt-2 mb-1 text-xs text-muted-foreground">
            <span className="font-medium uppercase tracking-wider text-xs text-muted-foreground/70">Atalhos</span>
            {getSecondaryRoutesForGroup('Financeiro').map((r) => (
              <Link
                key={r.path}
                to={r.path}
                className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-0.5 hover:bg-muted/50 hover:text-foreground transition-colors"
              >
                <r.icon className="h-3 w-3" />
                <span>{r.label}</span>
              </Link>
            ))}
          </div>
        )}

        {loading ? (
          /* F14 (audit): skeleton em vez de spinner — usuário vê o esqueleto
              da página enquanto contas/recebíveis carregam, mantendo layout
              estável e percepção de carregamento mais rápida. */
          <div className="space-y-4">
            <div className="flex gap-2">
              <Skeleton className="h-9 w-32" />
              <Skeleton className="h-9 w-32" />
              <Skeleton className="h-9 w-32" />
              <Skeleton className="h-9 w-32" />
              <Skeleton className="h-9 w-32" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
            <Skeleton className="h-80" />
          </div>
        ) : (
          <Tabs defaultValue="accounts" value={financeTab} onValueChange={setFinanceTab}>
            <HubTabsList tabs={[
              { value: 'accounts',             label: 'Contas',              icon: DollarSign },
              { value: 'dashboard',            label: 'Visão Geral',         icon: BarChart3 },
              { value: 'invoices',             label: 'Notas Fiscais',       icon: FileText },
              { value: 'comissoes-factoring',  label: 'Comissões & Factoring', icon: UserCheck },
              { value: 'reports',              label: 'Relatórios',          icon: BarChart3 },
            ]} />

            <TabsContent value="dashboard">
              <SmartDashboard onNavigate={tab => {
                // cashflow e dre ficam dentro de Relatórios
                if (tab === 'cashflow' || tab === 'dre' || tab === 'aging') setFinanceTab('reports');
                // payable/receivable abrem Contas e selecionam o sub-tab correspondente
                else if (tab === 'payable' || tab === 'receivable') {
                  setAccountsSubTab(tab);
                  setFinanceTab('accounts');
                }
                // O SmartDashboard emite chaves legadas; traduz pelo mesmo mapa
                // de aliases da URL em vez de manter uma segunda tradução.
                else setFinanceTab(FINANCE_TAB_ALIASES[tab] ?? (tab as FinanceTab));
              }} />
              <div className="mt-5">
                <NetMarginChart />
              </div>
            </TabsContent>

            <TabsContent value="accounts">
              {(() => {
                // ── Payable filtering ──────────────────────────────────────────
                let filteredP = payables.filter(p => searchMatchesAllTerms(
                  payableSearch,
                  p.description, p.suppliers?.name, p.suppliers?.cnpj,
                  p.category, p.notes, p.boleto_number, p.barcode, p.bank_name,
                ));
                if (payableStatusFilter.length > 0) filteredP = filteredP.filter(p =>
                  payableStatusFilter.includes(getEffectiveStatus(p.status, p.due_date))
                );
                if (payableDateFrom) filteredP = filteredP.filter(p => p.due_date >= payableDateFrom);
                if (payableDateTo) filteredP = filteredP.filter(p => p.due_date <= payableDateTo);
                const filteredPWithSupplier = filteredP.map(p => ({
                  ...p,
                  supplier_name: p.suppliers?.name ?? '',
                }));
                const sortedP = payableSort.sortData(filteredPWithSupplier);

                // ── Receivable filtering (espelha a AP) ────────────────────────
                let filteredR = receivables.filter(r => searchMatchesAllTerms(
                  receivableSearch,
                  r.client_name, r.description, r.client_cnpj, r.category, r.notes,
                ));
                if (receivableStatusFilter.length > 0) filteredR = filteredR.filter(r =>
                  receivableStatusFilter.includes(getEffectiveStatus(r.status, r.due_date))
                );
                if (receivableDateFrom) filteredR = filteredR.filter(r => r.due_date >= receivableDateFrom);
                if (receivableDateTo) filteredR = filteredR.filter(r => r.due_date <= receivableDateTo);

                // ── Totals: saldo em aberto real ───────────────────────────────
                // Mesma função do subtítulo dos painéis — ver sumOpenBalance.
                const pendingPayable = sumOpenBalance(payables, 'payable');
                const pendingReceivable = sumOpenBalance(receivables, 'receivable');

                /* F7 + F9 (audit): subtotais por status no header dos painéis.
                   Usuário vê de cara quanto está em aberto e vencido sem somar
                   mentalmente nas linhas — e `open` bate com o card do topo. */
                const filteredPSums = panelSums(filteredP, 'payable');
                const filteredRSums = panelSums(filteredR, 'receivable');

                /* Empty state honesto: "Nenhuma conta" só é verdade quando a
                   tabela está de fato vazia. Com filtro ativo a lista zera tendo
                   dezenas de linhas no banco — e o texto antigo ainda convidava a
                   "Adicionar primeira conta", ou seja, a criar uma duplicata de
                   algo que existe e está só escondido pelo filtro. */
                const payableFiltersActive = !!(payableSearch.trim() || payableStatusFilter.length || payableDateFrom || payableDateTo);
                const receivableFiltersActive = !!(receivableSearch.trim() || receivableStatusFilter.length || receivableDateFrom || receivableDateTo);
                const clearPayableFilters = () => { setPayableSearch(''); setPayableStatusFilter([]); setPayableDateFrom(''); setPayableDateTo(''); };
                const clearReceivableFilters = () => { setReceivableSearch(''); setReceivableStatusFilter([]); setReceivableDateFrom(''); setReceivableDateTo(''); };

                const payableContent = (
                  <Panel
                    eyebrow="FINANCEIRO · CONTAS A PAGAR"
                    title="Contas a Pagar"
                    subtitle={
                      <span className="flex flex-wrap items-center gap-x-3">
                        <span>{filteredP.length} conta(s)</span>
                        {filteredPSums.overdue > 0 && (
                          <span className="text-destructive">Vencido: {fmt(filteredPSums.overdue)}</span>
                        )}
                        {filteredPSums.upcoming > 0 && (
                          <span>À vencer: {fmt(filteredPSums.upcoming)}</span>
                        )}
                        {/* "Em aberto" e não "Total": o card do topo mostra saldo em
                            aberto, então um "Total" bruto ao lado gerava dois números
                            para o mesmo conceito. O contador de liquidadas explica a
                            diferença entre a contagem de linhas e o valor. */}
                        <span>Em aberto: {fmt(filteredPSums.open)}</span>
                        {filteredPSums.settledCount > 0 && (
                          <span className="text-muted-foreground">
                            {filteredPSums.settledCount} paga(s)/cancelada(s)
                          </span>
                        )}
                      </span>
                    }
                    actions={
                      <>
                        {selectedPayables.size > 0 && (<>
                          {finPerm.canEdit && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="sm" variant="default" className="bg-green-600 hover:bg-green-700 text-white"><CheckCircle className="h-4 w-4 mr-1" /> Pago ({selectedPayables.size})</Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Marcar {selectedPayables.size} conta(s) como paga(s)?</AlertDialogTitle><AlertDialogDescription>O valor total será considerado pago na data de hoje. Contas já pagas ou canceladas são ignoradas.</AlertDialogDescription></AlertDialogHeader>
                              <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={handleBulkMarkPaid}>Confirmar</AlertDialogAction></AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                          )}
                          {finPerm.canDelete && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="sm" variant="destructive"><Trash2 className="h-4 w-4 mr-1" /> Excluir ({selectedPayables.size})</Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Excluir {selectedPayables.size} conta(s)?</AlertDialogTitle><AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription></AlertDialogHeader>
                              <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={handleBulkDeletePayables}>Excluir</AlertDialogAction></AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                          )}
                        </>)}
                        <Button size="sm" variant="outline" onClick={() => exportPayablesBatch(filteredP)}><FileDown className="h-4 w-4 mr-1" /> CSV</Button>
                        {finPerm.canCreate && <Button size="sm" variant="outline" onClick={() => setBoletoUploadDialog(true)}><FileUp className="h-4 w-4 mr-1" /> Importar Boletos</Button>}
                        {finPerm.canCreate && <Button size="sm" onClick={() => { setEditingPayable(null); setPayableDialog(true); }}><Plus className="h-4 w-4 mr-1" /> Nova Conta</Button>}
                      </>
                    }
                  >
                      <div className="flex flex-wrap gap-2 mb-3">
                        <SearchInput
                          value={payableSearch}
                          onChange={setPayableSearch}
                          placeholder="Buscar por descrição, fornecedor, categoria, boleto…"
                          resultCount={filteredP.length}
                          totalCount={payables.length}
                          className="w-72"
                          inputClassName="h-9 text-xs"
                        />
                        <Input type="date" value={payableDateFrom} onChange={e => setPayableDateFrom(e.target.value)} className="w-36 h-9 text-xs" title="Vencimento de" />
                        <Input type="date" value={payableDateTo} onChange={e => setPayableDateTo(e.target.value)} className="w-36 h-9 text-xs" title="Vencimento até" />
                        {/* Audit visual #57: Radix Select.Item rejeita value=""
                            (string vazia é reservado pra clear). Usar sentinel "all"
                            e mapear pra array vazio no handler. Antes a aba inteira
                            de Contas crashava com ErrorBoundary ao montar. */}
                        <Select
                          value={payableStatusFilter[0] || 'all'}
                          onValueChange={v => setPayableStatusFilter(v === 'all' ? [] : [v])}
                        >
                          <SelectTrigger className="w-36 h-9 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Todos</SelectItem>
                            <SelectItem value="pending">À Vencer</SelectItem>
                            <SelectItem value="overdue">Vencido</SelectItem>
                            <SelectItem value="paid">Pago</SelectItem>
                            <SelectItem value="cancelled">Cancelado</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="overflow-x-auto max-h-[70vh]">
                      <Table>
                        {/* F10: sticky header — usuário não perde contexto da
                            coluna ao rolar tabelas longas */}
                        <TableHeader className="sticky top-0 z-10 bg-background"><TableRow className="bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                          <TableHead className="w-10">
                            <Checkbox
                              checked={sortedP.length > 0 && sortedP.every(p => selectedPayables.has(p.id))}
                              onCheckedChange={checked => {
                                if (checked) setSelectedPayables(prev => { const n = new Set(prev); sortedP.forEach(p => n.add(p.id)); return n; });
                                else setSelectedPayables(prev => { const n = new Set(prev); sortedP.forEach(p => n.delete(p.id)); return n; });
                              }}
                            />
                          </TableHead>
                          <SortableTableHead sortKey="description" currentSortKey={payableSort.sortKey} currentDirection={payableSort.sortDirection} onSort={payableSort.handleSort}>Descrição</SortableTableHead>
                          <TableHead className="hidden md:table-cell">Fornecedor</TableHead>
                          <TableHead className="hidden lg:table-cell">Categ.</TableHead>
                          <SortableTableHead sortKey="due_date" currentSortKey={payableSort.sortKey} currentDirection={payableSort.sortDirection} onSort={payableSort.handleSort}>Vencimento</SortableTableHead>
                          <SortableTableHead sortKey="amount" currentSortKey={payableSort.sortKey} currentDirection={payableSort.sortDirection} onSort={payableSort.handleSort} className="text-right">Valor</SortableTableHead>
                          <TableHead className="text-right hidden sm:table-cell">Saldo</TableHead>
                          <TableHead className="hidden lg:table-cell">Parc.</TableHead>
                          <SortableTableHead sortKey="status" currentSortKey={payableSort.sortKey} currentDirection={payableSort.sortDirection} onSort={payableSort.handleSort}>Status</SortableTableHead>
                          <TableHead className="text-right">Ações</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                          {sortedP.length === 0 ? (
                            payableFiltersActive ? (
                              <TableRow>
                                <TableCell colSpan={10} className="p-0">
                                  <EmptyState
                                    size="sm"
                                    icon={MagnifyingGlass}
                                    title={payableSearch.trim()
                                      ? `Nenhum resultado para "${payableSearch}"`
                                      : 'Nenhuma conta com os filtros atuais'}
                                    description={`${payables.length} conta(s) a pagar no total.`}
                                    action={<Button variant="outline" size="sm" onClick={clearPayableFilters}>Limpar filtros</Button>}
                                  />
                                </TableCell>
                              </TableRow>
                            ) : (
                              <TableRow>
                                <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                                  <p className="mb-2">Nenhuma conta a pagar</p>
                                  <Button size="sm" variant="outline" onClick={() => { setEditingPayable(null); setPayableDialog(true); }}>
                                    <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar primeira conta
                                  </Button>
                                </TableCell>
                              </TableRow>
                            )
                          ) : sortedP.map(p => {
                            const eff = getEffectiveStatus(p.status, p.due_date);
                            const cfg = statusConfig[eff] || statusConfig.pending;
                            const remaining = Math.max(0, p.amount - p.amount_paid);
                            const accruals = calculateOverdueAccruals(p.amount, p.due_date);
                            return (
                              <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50 transition-colors" data-state={selectedPayables.has(p.id) ? 'selected' : undefined}
                                onClick={e => { if ((e.target as HTMLElement).closest('button, [role="checkbox"]')) return; setEditingPayable(p); setPayableDialog(true); }}>
                                <TableCell><Checkbox checked={selectedPayables.has(p.id)} onCheckedChange={() => togglePayable(p.id)} /></TableCell>
                                <TableCell className="font-medium max-w-[180px] truncate">{p.description}</TableCell>
                                <TableCell className="text-sm text-muted-foreground hidden md:table-cell">{p.suppliers?.name || '—'}</TableCell>
                                <TableCell className="text-xs capitalize hidden lg:table-cell">{p.category}</TableCell>
                                <TableCell className={
                                  eff === 'overdue' ? 'text-destructive font-medium'
                                  : isDueSoon(p.due_date, p.status) ? 'text-amber-600 dark:text-amber-400 font-medium'
                                  : ''
                                }>
                                  {format(parseISO(p.due_date), 'dd/MM/yy')}
                                  {accruals.daysOverdue > 0 ? (
                                    <div className="text-xs text-destructive/80 font-normal">
                                      {accruals.daysOverdue}d atraso
                                    </div>
                                  ) : isDueSoon(p.due_date, p.status) && (
                                    <div className="text-xs text-amber-600 dark:text-amber-400 font-normal">
                                      vence em {daysUntilDue(p.due_date)}d
                                    </div>
                                  )}
                                </TableCell>
                                <TableCell className="text-right font-mono text-sm">
                                  {fmt(p.amount)}
                                  {accruals.total > 0 && (
                                    <div className="text-xs text-amber-600 dark:text-amber-400 font-normal" title={`Multa 2%: ${fmt(accruals.fine)} · Juros 1%/mês pro-rata: ${fmt(accruals.interest)}`}>
                                      + {fmt(accruals.total)} juros/multa
                                    </div>
                                  )}
                                </TableCell>
                                <TableCell className={`text-right font-mono font-bold text-sm hidden sm:table-cell ${remaining > 0 ? (eff === 'overdue' ? 'text-destructive' : '') : 'text-muted-foreground'}`}>
                                  {remaining > 0 ? fmt(remaining) : '—'}
                                </TableCell>
                                <TableCell
                                  className="text-xs hidden lg:table-cell"
                                  title={
                                    /* F4 (audit): tooltip explica parcelamento e mostra
                                       restantes pra parcelas em aberto. */
                                    p.total_installments > 1
                                      ? `Parcela ${p.installment_number} de ${p.total_installments}${
                                          p.status !== 'paid' && p.status !== 'cancelled'
                                            ? ` · ${Math.max(0, p.total_installments - p.installment_number)} restante(s)`
                                            : ''
                                        }`
                                      : 'Pagamento à vista'
                                  }
                                >
                                  {p.installment_number}/{p.total_installments}
                                </TableCell>
                                <TableCell><Badge variant={cfg.variant}>{cfg.label}</Badge></TableCell>
                                <TableCell className="text-right">
                                  <div className="flex gap-1 justify-end">
                                    {eff !== 'paid' && eff !== 'cancelled' && (
                                      <AlertDialog>
                                        <AlertDialogTrigger asChild><Button size="icon" variant="ghost" className="h-7 w-7" title="Marcar Pago"><CheckCircle className="h-3.5 w-3.5 text-green-600" /></Button></AlertDialogTrigger>
                                        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Marcar como Pago?</AlertDialogTitle><AlertDialogDescription>Registrar pagamento de {fmt(p.amount)} na data de hoje?</AlertDialogDescription></AlertDialogHeader>
                                          <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => markPaid(p)}>Confirmar</AlertDialogAction></AlertDialogFooter>
                                        </AlertDialogContent>
                                      </AlertDialog>
                                    )}
                                    {/* Estorno: única saída de uma AP paga. Sem ele a linha fica
                                        congelada — não exclui, não edita valor/status. */}
                                    {p.status === 'paid' && (
                                      <AlertDialog>
                                        <AlertDialogTrigger asChild><Button size="icon" variant="ghost" className="h-7 w-7" title="Estornar pagamento" aria-label="Estornar pagamento"><Undo2 className="h-3.5 w-3.5 text-amber-600" /></Button></AlertDialogTrigger>
                                        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Estornar pagamento?</AlertDialogTitle><AlertDialogDescription>A conta de {fmt(p.amount)} volta para "À Vencer", com o valor pago zerado e a data de pagamento apagada. Depois disso ela pode ser editada, excluída ou paga de novo.</AlertDialogDescription></AlertDialogHeader>
                                          <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => reversePayable.mutate(p.id)}>Estornar</AlertDialogAction></AlertDialogFooter>
                                        </AlertDialogContent>
                                      </AlertDialog>
                                    )}
                                    <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Editar conta" onClick={() => { setEditingPayable(p); setPayableDialog(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
                                    <AlertDialog>
                                      <AlertDialogTrigger asChild><Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" aria-label="Excluir conta"><Trash2 className="h-3.5 w-3.5" /></Button></AlertDialogTrigger>
                                      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Excluir conta?</AlertDialogTitle><AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription></AlertDialogHeader>
                                        <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => deletePayable.mutate(p.id)}>Excluir</AlertDialogAction></AlertDialogFooter>
                                      </AlertDialogContent>
                                    </AlertDialog>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                      </div>
                  </Panel>
                );

                const receivableContent = (
                  <Panel
                    eyebrow="FINANCEIRO · CONTAS A RECEBER"
                    title="Contas a Receber"
                    subtitle={
                      <span className="flex flex-wrap items-center gap-x-3">
                        <span>{filteredR.length} conta(s)</span>
                        {filteredRSums.overdue > 0 && (
                          <span className="text-destructive">Vencido: {fmt(filteredRSums.overdue)}</span>
                        )}
                        {filteredRSums.upcoming > 0 && (
                          <span>A vencer: {fmt(filteredRSums.upcoming)}</span>
                        )}
                        <span>Em aberto: {fmt(filteredRSums.open)}</span>
                        {filteredRSums.settledCount > 0 && (
                          <span className="text-muted-foreground">
                            {filteredRSums.settledCount} recebida(s)/cancelada(s)
                          </span>
                        )}
                      </span>
                    }
                    actions={
                      <>
                        {selectedReceivables.size > 0 && (<>
                          {finPerm.canEdit && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="sm" variant="default" className="bg-green-600 hover:bg-green-700 text-white"><CheckCircle className="h-4 w-4 mr-1" /> Recebido ({selectedReceivables.size})</Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Marcar {selectedReceivables.size} conta(s) como recebida(s)?</AlertDialogTitle><AlertDialogDescription>O valor total será considerado recebido na data de hoje.</AlertDialogDescription></AlertDialogHeader>
                              <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={handleBulkMarkReceived}>Confirmar</AlertDialogAction></AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                          )}
                          {finPerm.canDelete && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="sm" variant="destructive"><Trash2 className="h-4 w-4 mr-1" /> Excluir ({selectedReceivables.size})</Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Excluir {selectedReceivables.size} conta(s)?</AlertDialogTitle><AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription></AlertDialogHeader>
                              <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={handleBulkDeleteReceivables}>Excluir</AlertDialogAction></AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                          )}
                        </>)}
                        {finPerm.canCreate && <Button size="sm" onClick={() => { setEditingReceivable(null); setReceivableDialog(true); }}><Plus className="h-4 w-4 mr-1" /> Nova Conta</Button>}
                      </>
                    }
                  >
                      <div className="flex flex-wrap gap-2 mb-3">
                        <SearchInput
                          value={receivableSearch}
                          onChange={setReceivableSearch}
                          placeholder="Buscar por cliente, descrição, CNPJ…"
                          resultCount={filteredR.length}
                          totalCount={receivables.length}
                          className="w-72"
                          inputClassName="h-9 text-xs"
                        />
                        <Input type="date" value={receivableDateFrom} onChange={e => setReceivableDateFrom(e.target.value)} className="w-36 h-9 text-xs" title="Vencimento de" />
                        <Input type="date" value={receivableDateTo} onChange={e => setReceivableDateTo(e.target.value)} className="w-36 h-9 text-xs" title="Vencimento até" />
                        {/* Sentinel "all" — Radix Select.Item rejeita value="" (ver
                            comentário equivalente na barra da AP). */}
                        <Select
                          value={receivableStatusFilter[0] || 'all'}
                          onValueChange={v => setReceivableStatusFilter(v === 'all' ? [] : [v])}
                        >
                          <SelectTrigger className="w-36 h-9 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Todos</SelectItem>
                            <SelectItem value="pending">A Vencer</SelectItem>
                            <SelectItem value="overdue">Vencido</SelectItem>
                            <SelectItem value="received">Recebido</SelectItem>
                            <SelectItem value="cancelled">Cancelado</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Table>
                        <TableHeader><TableRow className="bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                          <TableHead className="w-10">
                            <Checkbox
                              checked={filteredR.length > 0 && filteredR.every(r => selectedReceivables.has(r.id))}
                              onCheckedChange={checked => {
                                if (checked) setSelectedReceivables(prev => { const n = new Set(prev); filteredR.forEach(r => n.add(r.id)); return n; });
                                else setSelectedReceivables(prev => { const n = new Set(prev); filteredR.forEach(r => n.delete(r.id)); return n; });
                              }}
                            />
                          </TableHead>
                          <SortableTableHead sortKey="description" currentSortKey={receivableSort.sortKey} currentDirection={receivableSort.sortDirection} onSort={receivableSort.handleSort}>Descrição</SortableTableHead>
                          <SortableTableHead sortKey="client_name" currentSortKey={receivableSort.sortKey} currentDirection={receivableSort.sortDirection} onSort={receivableSort.handleSort}>Cliente</SortableTableHead>
                          <SortableTableHead sortKey="due_date" currentSortKey={receivableSort.sortKey} currentDirection={receivableSort.sortDirection} onSort={receivableSort.handleSort}>Vencimento</SortableTableHead>
                          <SortableTableHead sortKey="amount" currentSortKey={receivableSort.sortKey} currentDirection={receivableSort.sortDirection} onSort={receivableSort.handleSort} className="text-right">Valor</SortableTableHead>
                          <TableHead>Parc.</TableHead>
                          <SortableTableHead sortKey="status" currentSortKey={receivableSort.sortKey} currentDirection={receivableSort.sortDirection} onSort={receivableSort.handleSort}>Status</SortableTableHead>
                          <TableHead className="text-right">Ações</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                          {filteredR.length === 0 ? (
                            receivableFiltersActive ? (
                              <TableRow>
                                <TableCell colSpan={8} className="p-0">
                                  <EmptyState
                                    size="sm"
                                    icon={MagnifyingGlass}
                                    title={receivableSearch.trim()
                                      ? `Nenhum resultado para "${receivableSearch}"`
                                      : 'Nenhuma conta com os filtros atuais'}
                                    description={`${receivables.length} conta(s) a receber no total.`}
                                    action={<Button variant="outline" size="sm" onClick={clearReceivableFilters}>Limpar filtros</Button>}
                                  />
                                </TableCell>
                              </TableRow>
                            ) : (
                              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Nenhuma conta a receber</TableCell></TableRow>
                            )
                          ) : receivableSort.sortData(filteredR).map(r => {
                            const eff = getEffectiveStatus(r.status, r.due_date);
                            const cfg = statusConfig[eff] || statusConfig.pending;
                            return (
                              <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50 transition-colors" data-state={selectedReceivables.has(r.id) ? 'selected' : undefined}
                                onClick={e => { if ((e.target as HTMLElement).closest('button, [role="checkbox"]')) return; setEditingReceivable(r); setReceivableDialog(true); }}>
                                <TableCell><Checkbox checked={selectedReceivables.has(r.id)} onCheckedChange={() => toggleReceivable(r.id)} /></TableCell>
                                <TableCell className="font-medium">{r.description}</TableCell>
                                <TableCell>{r.client_name}</TableCell>
                                <TableCell className={
                                  /* F11 (audit): paridade c/ Contas a Pagar — destaque
                                     vencimentos próximos (≤5d) em âmbar, vencidos em destrutivo. */
                                  eff === 'overdue' ? 'text-destructive font-medium'
                                  : isDueSoon(r.due_date, r.status) ? 'text-amber-600 dark:text-amber-400 font-medium'
                                  : ''
                                }>
                                  {format(parseISO(r.due_date), 'dd/MM/yyyy')}
                                  {isDueSoon(r.due_date, r.status) && (
                                    <div className="text-xs text-amber-600 dark:text-amber-400 font-normal">
                                      vence em {daysUntilDue(r.due_date)}d
                                    </div>
                                  )}
                                </TableCell>
                                <TableCell className="text-right font-mono">{fmt(r.amount)}</TableCell>
                                <TableCell
                                  title={
                                    r.total_installments > 1
                                      ? `Parcela ${r.installment_number} de ${r.total_installments}${
                                          r.status !== 'received' && r.status !== 'cancelled'
                                            ? ` · ${Math.max(0, r.total_installments - r.installment_number)} restante(s)`
                                            : ''
                                        }`
                                      : 'Pagamento à vista'
                                  }
                                >
                                  {r.installment_number}/{r.total_installments}
                                </TableCell>
                                <TableCell><Badge variant={cfg.variant}>{cfg.label}</Badge></TableCell>
                                <TableCell className="text-right">
                                  <div className="flex gap-1 justify-end">
                                    {eff !== 'received' && eff !== 'cancelled' && (
                                      <AlertDialog>
                                        <AlertDialogTrigger asChild><Button size="icon" variant="ghost" className="h-7 w-7" title="Marcar Recebido"><CheckCircle className="h-3.5 w-3.5 text-green-600" /></Button></AlertDialogTrigger>
                                        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Marcar como Recebido?</AlertDialogTitle><AlertDialogDescription>Registrar recebimento de {fmt(r.amount)} na data de hoje?</AlertDialogDescription></AlertDialogHeader>
                                          <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => markReceived(r)}>Confirmar</AlertDialogAction></AlertDialogFooter>
                                        </AlertDialogContent>
                                      </AlertDialog>
                                    )}
                                    {/* Espelho do estorno da AP — mesmo beco sem saída do lado a receber. */}
                                    {r.status === 'received' && (
                                      <AlertDialog>
                                        <AlertDialogTrigger asChild><Button size="icon" variant="ghost" className="h-7 w-7" title="Estornar recebimento" aria-label="Estornar recebimento"><Undo2 className="h-3.5 w-3.5 text-amber-600" /></Button></AlertDialogTrigger>
                                        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Estornar recebimento?</AlertDialogTitle><AlertDialogDescription>A conta de {fmt(r.amount)} volta para "À Vencer", com o valor recebido zerado e a data de pagamento apagada. O reconhecimento de CMV do PV vinculado é recalculado.</AlertDialogDescription></AlertDialogHeader>
                                          <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => reverseReceivable.mutate(r.id)}>Estornar</AlertDialogAction></AlertDialogFooter>
                                        </AlertDialogContent>
                                      </AlertDialog>
                                    )}
                                    <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Editar conta" onClick={() => { setEditingReceivable(r); setReceivableDialog(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
                                    <AlertDialog>
                                      <AlertDialogTrigger asChild><Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" aria-label="Excluir conta"><Trash2 className="h-3.5 w-3.5" /></Button></AlertDialogTrigger>
                                      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Excluir conta?</AlertDialogTitle><AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription></AlertDialogHeader>
                                        <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => deleteReceivable.mutate(r.id)}>Excluir</AlertDialogAction></AlertDialogFooter>
                                      </AlertDialogContent>
                                    </AlertDialog>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                  </Panel>
                );

                return (
                  <UnifiedFinanceTab
                    totals={{ payable: pendingPayable, receivable: pendingReceivable, balance: pendingReceivable - pendingPayable }}
                    payableContent={payableContent}
                    receivableContent={receivableContent}
                    initialSubTab={accountsSubTab}
                    onSubTabChange={setAccountsSubTab}
                  />
                );
              })()}
            </TabsContent>

            <TabsContent value="invoices"><UnifiedInvoicesTab /></TabsContent>

            <TabsContent value="comissoes-factoring">
              <Tabs defaultValue="comissoes">
                <TabsList className="h-8 gap-1 mb-4">
                  <TabsTrigger value="comissoes" className="gap-1 text-xs h-7">
                    <UserCheck className="h-3.5 w-3.5" /> Comissões
                  </TabsTrigger>
                  <TabsTrigger value="factoring" className="gap-1 text-xs h-7">
                    <Percent className="h-3.5 w-3.5" /> Factoring
                  </TabsTrigger>
                  {/* F3 (audit): aba nova de conciliação bancária. */}
                  <TabsTrigger value="conciliacao" className="gap-1 text-xs h-7">
                    <Landmark className="h-3.5 w-3.5" /> Conciliação
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="comissoes"><ComissoesTab /></TabsContent>
                <TabsContent value="factoring"><FactoringTab /></TabsContent>
                <TabsContent value="conciliacao"><BankReconciliationTab /></TabsContent>
              </Tabs>
            </TabsContent>

            <TabsContent value="reports"><FinanceReportsTab /></TabsContent>
          </Tabs>
        )}
      </div>

      <PayableFormDialog open={payableDialog} onOpenChange={setPayableDialog} editing={editingPayable} suppliers={suppliers.map(s => ({ id: s.id, name: s.name }))} onSave={handleSavePayable} />
      <BoletoUploadDialog open={boletoUploadDialog} onOpenChange={setBoletoUploadDialog} suppliers={suppliers.map(s => ({ id: s.id, name: s.name }))} />
      <ReceivableFormDialog open={receivableDialog} onOpenChange={setReceivableDialog} editing={editingReceivable} onSave={handleSaveReceivable} />
    </>
  );
}
