/**
 * BankHours — Banco de Horas (visão completa)
 *
 * 4 visualizações:
 *   - KPIs gerais (total, crédito, débito, equilibrados)
 *   - Setor a setor (departamento agregado)
 *   - Funcionário a funcionário (lista filtrável + busca)
 *   - Drill-down individual (drawer com movements + cálculo via RPC
 *     que combina lançamentos manuais + derivado de time_records)
 *
 * + Dialog pra criar lançamento manual (crédito/débito/ajuste/compensação).
 *
 * Dados:
 *   - v_bank_hours_summary (KPIs agregados)
 *   - v_bank_hours_per_sector (agregação por departamento)
 *   - bank_hours_balance VIEW (saldo por funcionário, só movements)
 *   - calculate_employee_bank_balance() RPC (saldo completo)
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, TrendUp as TrendingUp, TrendDown as TrendingDown, Scales as Scale, Users, Buildings as Building2, MagnifyingGlass as Search, CircleNotch as Loader2, CaretRight as ChevronRight, Plus, Trash as Trash2 } from '@phosphor-icons/react';
import AppLayout from '@/components/layout/AppLayout';
import { todayISO } from '@/lib/date';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { useEmployees } from '@/hooks/useEmployees';
import {
  useBankHoursMovements,
  useAddBankHoursMovement,
  useDeleteBankHoursMovement,
} from '@/hooks/useRH';
import { PayBankHoursDialog } from '@/components/timesheet/PayBankHoursDialog';
import { Wallet } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

type Summary = {
  total_employees: number;
  employees_with_credit: number;
  employees_with_debit: number;
  employees_balanced: number;
  total_balance_min: number;
  total_credit_min: number;
  total_debit_min: number;
  sector_count: number;
};

type SectorRow = {
  department: string | null;
  employee_count: number;
  total_balance_min: number;
  total_credit_min: number;
  total_debit_min: number;
  movement_count: number;
};

type EmployeeBalance = {
  employee_id: string;
  employee_name: string;
  department: string | null;
  role: string | null;
  initial_min: number;
  movements_min: number;
  balance_min: number;
  movement_count: number;
  last_movement_date: string | null;
};

type EmployeeDetail = {
  employee_id: string;
  employee_name: string;
  department: string | null;
  movements_min: number;
  timesheet_min: number;
  balance_min: number;
  days_worked: number;
  days_partial: number;
  expected_per_day_min: number;
  error?: string;
};

const TYPE_LABELS: Record<string, string> = {
  credit: 'Crédito (HE não paga)',
  debit: 'Débito (folga)',
  adjustment: 'Ajuste manual',
  compensation: 'Compensação',
  manual: 'Manual',
  payment: 'Pagamento de HE',
  timesheet_auto: 'Automático (batidas)',
  timesheet_auto: 'Auto (batidas)',
};

/**
 * Formata minutos em "+5h 30min" ou "−2h 15min".
 * R10 (audit): substitui sinais ASCII por símbolos Unicode mais legíveis e
 * adiciona indicador direcional só quando o sinal é informativo (não em zero).
 */
function formatHours(minutes: number): string {
  const sign = minutes < 0 ? '−' : minutes > 0 ? '+' : '';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0 && m === 0) return '0h';
  if (h === 0) return `${sign}${m}min`;
  return `${sign}${h}h${m > 0 ? ` ${m}min` : ''}`;
}

function balanceClass(min: number): string {
  if (min > 0) return 'text-emerald-600 dark:text-emerald-400';
  if (min < 0) return 'text-primary';
  return 'text-muted-foreground';
}

// ── Hooks ────────────────────────────────────────────────────────────
function useSummary() {
  return useQuery({
    queryKey: ['bank_hours_summary'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('v_bank_hours_summary').select('*').single();
      if (error) throw error;
      return data as Summary;
    },
  });
}

function useSectors() {
  return useQuery({
    queryKey: ['bank_hours_sectors'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('v_bank_hours_per_sector').select('*');
      if (error) throw error;
      return (data || []) as SectorRow[];
    },
  });
}

function useEmployeeBalances() {
  return useQuery({
    queryKey: ['bank_hours_balance_list'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('bank_hours_balance')
        .select('*')
        .order('balance_min', { ascending: false });
      if (error) throw error;
      return (data || []) as EmployeeBalance[];
    },
  });
}

function useEmployeeDetail(employeeId: string | null) {
  return useQuery({
    queryKey: ['bank_hours_detail', employeeId],
    enabled: !!employeeId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('calculate_employee_bank_balance', {
        p_employee_id: employeeId,
        p_from: null,
        p_to: null,
      });
      if (error) throw error;
      return data as EmployeeDetail;
    },
  });
}

// ── Page ────────────────────────────────────────────────────────────
export default function BankHours() {
  const [search, setSearch] = useState('');
  const [sectorFilter, setSectorFilter] = useState<string>('all');
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeBalance | null>(null);
  const [movementDialogOpen, setMovementDialogOpen] = useState(false);
  const [payDialogOpen, setPayDialogOpen] = useState(false);

  const summaryQ = useSummary();
  const sectorsQ = useSectors();
  const employeesQ = useEmployeeBalances();
  const detailQ = useEmployeeDetail(selectedEmployee?.employee_id || null);
  const movementsQ = useBankHoursMovements(selectedEmployee?.employee_id);
  const { data: allEmployees = [] } = useEmployees();

  const addMovement = useAddBankHoursMovement();
  const deleteMovement = useDeleteBankHoursMovement();

  const [form, setForm] = useState({
    employee_id: '',
    movement_date: todayISO(),
    movement_type: 'credit' as 'credit' | 'debit' | 'adjustment' | 'compensation',
    hoursStr: '',
    minutesSign: 1 as 1 | -1,
    reason: '',
  });

  const filteredEmployees = useMemo(() => {
    let list = employeesQ.data || [];
    if (sectorFilter !== 'all') {
      list = list.filter(e => e.department === sectorFilter || (sectorFilter === '__none__' && !e.department));
    }
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(e =>
        e.employee_name.toLowerCase().includes(q) ||
        (e.department || '').toLowerCase().includes(q) ||
        (e.role || '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [employeesQ.data, sectorFilter, search]);

  const handleAddMovement = async () => {
    if (!form.employee_id || !form.hoursStr) return;
    let mins = 0;
    if (form.hoursStr.includes(':')) {
      const [h, m] = form.hoursStr.split(':').map(Number);
      mins = (h || 0) * 60 + (m || 0);
    } else {
      mins = Math.round(Number(form.hoursStr) * 60);
    }
    if (!mins) return;
    const autoSign = form.movement_type === 'debit' ? -1 : 1;
    const finalMins = mins * (form.movement_type === 'adjustment' ? form.minutesSign : autoSign);
    await addMovement.mutateAsync({
      employee_id: form.employee_id,
      movement_date: form.movement_date,
      movement_type: form.movement_type,
      minutes: finalMins,
      reason: form.reason,
    });
    setMovementDialogOpen(false);
    setForm(f => ({ ...f, hoursStr: '', reason: '' }));
  };

  const summary = summaryQ.data;

  return (
    <AppLayout>
      <div className="space-y-5 pb-12">
        {/* Header */}
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="eyebrow">Recursos Humanos</div>
            <h1 className="display text-3xl mt-2">Banco de Horas</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Saldo, lançamentos e relatórios — funcionário a funcionário, setor a setor.
            </p>
          </div>
          <Dialog open={movementDialogOpen} onOpenChange={setMovementDialogOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />Novo lançamento</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Novo lançamento no banco de horas</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Funcionário</Label>
                  <Select value={form.employee_id} onValueChange={v => setForm(f => ({ ...f, employee_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent>
                      {allEmployees.filter(e => e.active).map(e => (
                        <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Data</Label>
                    <Input type="date" value={form.movement_date} onChange={e => setForm(f => ({ ...f, movement_date: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Tipo</Label>
                    <Select value={form.movement_type} onValueChange={(v: any) => setForm(f => ({ ...f, movement_type: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="credit">Crédito (HE não paga)</SelectItem>
                        <SelectItem value="debit">Débito (folga)</SelectItem>
                        <SelectItem value="compensation">Compensação</SelectItem>
                        <SelectItem value="adjustment">Ajuste manual</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Horas (HH:MM ou decimal)</Label>
                    <Input value={form.hoursStr} onChange={e => setForm(f => ({ ...f, hoursStr: e.target.value }))} placeholder="Ex.: 1:30 ou 1.5" />
                    {/* R12 (audit): hint sobre formatos aceitos. Antes: usuário
                        digitava "1h30", "1,5", "90min" e descobria pelo erro
                        que só HH:MM ou decimal funcionam. */}
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Formatos aceitos: <span className="font-mono">1:30</span> (1h30min) ou <span className="font-mono">1.5</span> (1h30min decimal). Vírgula não funciona.
                    </p>
                  </div>
                  {form.movement_type === 'adjustment' && (
                    <div>
                      <Label>Sinal</Label>
                      <Select value={String(form.minutesSign)} onValueChange={v => setForm(f => ({ ...f, minutesSign: Number(v) as 1 | -1 }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">Positivo (+)</SelectItem>
                          <SelectItem value="-1">Negativo (−)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
                <div>
                  <Label>Motivo / observação</Label>
                  <Input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="Opcional" />
                </div>
                <Button onClick={handleAddMovement} disabled={addMovement.isPending || !form.employee_id || !form.hoursStr} className="w-full">
                  {addMovement.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                  Registrar lançamento
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* KPIs */}
        {/* R8 (audit): em telas sm (640-768px) o grid quebrava feio com 2 cards
            por linha em viewport estreito. sm:grid-cols-3 + md:grid-cols-4 dá
            um intermediário (2 → 3 → 4) que respeita a leitura. */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          <Card className="slash-top">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Users className="h-3.5 w-3.5" />
                <span className="eyebrow">Funcionários</span>
              </div>
              <div className="display text-3xl mt-2 tabular-nums">{summary?.total_employees ?? '—'}</div>
              <div className="text-xs text-muted-foreground mt-1">em {summary?.sector_count ?? 0} setores</div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                <TrendingUp className="h-3.5 w-3.5" />
                <span className="eyebrow">Crédito total</span>
              </div>
              <div className="display text-3xl mt-2 tabular-nums text-emerald-600 dark:text-emerald-400">
                {summary ? formatHours(summary.total_credit_min) : '—'}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {summary?.employees_with_credit ?? 0} func. positivo
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-primary">
                <TrendingDown className="h-3.5 w-3.5" />
                <span className="eyebrow">Débito total</span>
              </div>
              <div className="display text-3xl mt-2 tabular-nums text-primary">
                {summary ? formatHours(summary.total_debit_min) : '—'}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {summary?.employees_with_debit ?? 0} func. negativo
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Scale className="h-3.5 w-3.5" />
                <span className="eyebrow">Saldo líquido</span>
              </div>
              <div className={cn('display text-3xl mt-2 tabular-nums', summary && balanceClass(summary.total_balance_min))}>
                {summary ? formatHours(summary.total_balance_min) : '—'}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {summary?.employees_balanced ?? 0} equilibrados
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="employees" className="space-y-4">
          <TabsList>
            <TabsTrigger value="employees">
              <Users className="h-3.5 w-3.5 mr-1.5" /> Funcionários
            </TabsTrigger>
            <TabsTrigger value="sectors">
              <Building2 className="h-3.5 w-3.5 mr-1.5" /> Setores
            </TabsTrigger>
          </TabsList>

          {/* Tab Funcionários */}
          <TabsContent value="employees" className="space-y-3">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <CardTitle className="text-base">Saldo por funcionário</CardTitle>
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      value={sectorFilter}
                      onChange={e => setSectorFilter(e.target.value)}
                      className="h-9 px-3 rounded-md border bg-background text-sm"
                      aria-label="Filtrar por setor"
                    >
                      <option value="all">Todos os setores</option>
                      {(sectorsQ.data || []).map(s => (
                        <option key={s.department || '__none__'} value={s.department || '__none__'}>
                          {s.department || 'Sem setor'} ({s.employee_count})
                        </option>
                      ))}
                    </select>
                    {/* R6 (audit): input de busca em mobile (<400px) extrapolava
                        a largura disponível e quebrava o card. w-full em mobile,
                        w-56 em sm+ — permite encolher sem espremer o select. */}
                    <div className="relative w-full sm:w-auto">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Buscar funcionário..."
                        className="pl-8 h-9 w-full sm:w-56"
                      />
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {employeesQ.isLoading ? (
                  /* R13 (audit): skeleton da lista de funcionários — dá noção
                      visual de qtd antes do query terminar, evita flash de altura. */
                  <div className="divide-y border-t">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="flex items-center justify-between gap-4 px-4 py-3">
                        <div className="flex-1 space-y-1.5">
                          <Skeleton className="h-4 w-40" />
                          <Skeleton className="h-3 w-24" />
                        </div>
                        <Skeleton className="h-6 w-16" />
                      </div>
                    ))}
                  </div>
                ) : filteredEmployees.length === 0 ? (
                  <EmptyState
                    icon={Clock}
                    title="Nenhum funcionário encontrado"
                    description={search ? 'Tente ajustar a busca ou trocar o filtro de setor.' : 'Cadastre funcionários em /rh primeiro.'}
                    size="sm"
                  />
                ) : (
                  <div className="divide-y border-t">
                    {filteredEmployees.map(emp => (
                      <button
                        key={emp.employee_id}
                        onClick={() => setSelectedEmployee(emp)}
                        className="w-full flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted/40 transition-colors text-left"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">{emp.employee_name}</div>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {emp.department && (
                              <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                                {emp.department}
                              </Badge>
                            )}
                            {emp.role && (
                              <span className="text-[11px] text-muted-foreground">{emp.role}</span>
                            )}
                            {emp.movement_count > 0 && (
                              <span className="text-[11px] text-muted-foreground tabular-nums">
                                · {emp.movement_count} lançamento{emp.movement_count !== 1 && 's'}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className={cn('font-mono text-base font-bold tabular-nums', balanceClass(emp.balance_min))}>
                            {formatHours(emp.balance_min)}
                          </div>
                          {emp.last_movement_date && (
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              últ. {new Date(emp.last_movement_date).toLocaleDateString('pt-BR')}
                            </div>
                          )}
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab Setores */}
          <TabsContent value="sectors" className="space-y-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Saldo por setor</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {sectorsQ.isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (sectorsQ.data || []).length === 0 ? (
                  <EmptyState
                    icon={Building2}
                    title="Nenhum setor com dados"
                    description="Adicione lançamentos pra ver agregação por setor."
                    size="sm"
                  />
                ) : (
                  <div className="divide-y border-t">
                    {(sectorsQ.data || []).map(s => (
                      // R1: grid-cols-12 quebra em mobile (<640px). Em sm+ mantém
                      // 12-col tabela; em mobile vira stack vertical com bordas
                      // sutis pra distinguir setor.
                      <div key={s.department || '__none__'} className="px-4 py-3 grid grid-cols-2 sm:grid-cols-12 gap-2 sm:gap-3 items-start sm:items-center">
                        <div className="col-span-2 sm:col-span-4 min-w-0">
                          <div className="font-medium text-sm">{s.department || 'Sem setor'}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {s.employee_count} func.{s.movement_count > 0 && ` · ${s.movement_count} lançamentos`}
                          </div>
                        </div>
                        <div className="col-span-1 sm:col-span-2 text-left sm:text-right">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Crédito</div>
                          <div className="font-mono text-sm text-emerald-600 dark:text-emerald-400 tabular-nums">
                            {formatHours(s.total_credit_min)}
                          </div>
                        </div>
                        <div className="col-span-1 sm:col-span-2 text-left sm:text-right">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Débito</div>
                          <div className="font-mono text-sm text-primary tabular-nums">
                            {formatHours(s.total_debit_min)}
                          </div>
                        </div>
                        <div className="col-span-2 sm:col-span-4 text-left sm:text-right">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Saldo</div>
                          <div className={cn('font-mono text-base font-bold tabular-nums', balanceClass(s.total_balance_min))}>
                            {formatHours(s.total_balance_min)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Drill-down Sheet */}
        <Sheet open={!!selectedEmployee} onOpenChange={open => !open && setSelectedEmployee(null)}>
          <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
            <SheetHeader>
              <SheetTitle>{selectedEmployee?.employee_name}</SheetTitle>
              <SheetDescription>
                {selectedEmployee?.department || 'Sem setor'} · {selectedEmployee?.role || 'Sem função'}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-4">
              {detailQ.isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : detailQ.data?.error ? (
                <p className="text-sm text-destructive">{detailQ.data.error}</p>
              ) : detailQ.data ? (
                <>
                  <Card>
                    <CardContent className="p-5 text-center">
                      <div className="eyebrow">Saldo total (movements + batidas)</div>
                      <div className={cn('display text-5xl mt-3 tabular-nums', balanceClass(detailQ.data.balance_min))}>
                        {formatHours(detailQ.data.balance_min)}
                      </div>
                      {detailQ.data.balance_min > 0 && (
                        <Button
                          className="mt-4 gap-2"
                          onClick={() => setPayDialogOpen(true)}
                        >
                          <Wallet className="h-4 w-4" />
                          Realizar pagamento
                        </Button>
                      )}
                    </CardContent>
                  </Card>

                  <div className="grid grid-cols-2 gap-3">
                    <Card>
                      <CardContent className="p-3">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Lançamentos</div>
                        <div className={cn('font-mono text-lg font-bold mt-1 tabular-nums', balanceClass(detailQ.data.movements_min))}>
                          {formatHours(detailQ.data.movements_min)}
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-3">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Derivado batidas</div>
                        <div className={cn('font-mono text-lg font-bold mt-1 tabular-nums', balanceClass(detailQ.data.timesheet_min))}>
                          {formatHours(detailQ.data.timesheet_min)}
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">Período analisado</CardTitle></CardHeader>
                    <CardContent className="p-4 pt-0 space-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Dias trabalhados</span>
                        <span className="font-mono tabular-nums">{detailQ.data.days_worked}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Dias parciais</span>
                        <span className="font-mono tabular-nums">{detailQ.data.days_partial}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Carga esperada/dia</span>
                        <span className="font-mono tabular-nums">{formatHours(detailQ.data.expected_per_day_min)}</span>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Lançamentos individuais */}
                  <Card>
                    <CardHeader className="pb-2 flex flex-row items-center justify-between">
                      <CardTitle className="text-sm">Lançamentos recentes</CardTitle>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {(movementsQ.data || []).length} total
                      </span>
                    </CardHeader>
                    <CardContent className="p-0">
                      {(movementsQ.data || []).length === 0 ? (
                        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                          Nenhum lançamento manual registrado.
                        </div>
                      ) : (
                        <div className="divide-y border-t">
                          {(movementsQ.data || []).slice(0, 30).map((mov: any) => (
                            <div key={mov.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                                    {TYPE_LABELS[mov.movement_type] || mov.movement_type}
                                  </Badge>
                                  <span className="text-xs text-muted-foreground">
                                    {new Date(mov.movement_date).toLocaleDateString('pt-BR')}
                                  </span>
                                </div>
                                {mov.reason && (
                                  <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{mov.reason}</div>
                                )}
                              </div>
                              <div className={cn('font-mono text-sm font-bold tabular-nums', balanceClass(mov.minutes))}>
                                {formatHours(mov.minutes)}
                              </div>
                              <button
                                onClick={() => deleteMovement.mutate(mov.id)}
                                className="text-muted-foreground hover:text-destructive transition-colors p-1"
                                aria-label="Excluir lançamento"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <p className="text-[10px] text-muted-foreground">
                    Saldo combina lançamentos manuais com derivação automática das batidas
                    de ponto vs jornada esperada (work_schedules). Tolerância e mínimo de
                    overtime aplicados.
                  </p>
                </>
              ) : null}
            </div>
          </SheetContent>
        </Sheet>

        <PayBankHoursDialog
          open={payDialogOpen}
          onOpenChange={setPayDialogOpen}
          employee={selectedEmployee && detailQ.data && !detailQ.data.error ? {
            employee_id: selectedEmployee.employee_id,
            employee_name: selectedEmployee.employee_name,
            balance_min: detailQ.data.balance_min,
            hourly_rate: (() => {
              const emp = allEmployees.find((e: any) => e.id === selectedEmployee.employee_id);
              return emp?.hourly_rate ?? (emp?.salary ? emp.salary / 220 : null);
            })(),
            overtime_multiplier: allEmployees.find((e: any) => e.id === selectedEmployee.employee_id)?.overtime_multiplier ?? 1.2,
          } : null}
        />
      </div>
    </AppLayout>
  );
}
