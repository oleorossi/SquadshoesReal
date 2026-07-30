import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { CircleNotch as Loader2, Plus, Wallet, MagnifyingGlass as Search, Warning as AlertTriangle, Check, ArrowCounterClockwise } from '@phosphor-icons/react';
import { CurrencyInput } from '@/components/ui/currency-input';
import {
  useEmployees, useEmployeeAdvances, useAddAdvance, useDeleteAdvance,
  useSetAdvanceStatus, useSettleEmployeeAdvances,
} from '@/hooks/useEmployees';
import { EmployeeCombobox } from '@/components/hr/EmployeeCombobox';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { SearchInput } from '@/components/ui/search-input';
import { EmptyState } from '@/components/ui/empty-state';
import { todayISO } from '@/lib/date';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import { cn } from '@/lib/utils';

const DESC_PRESETS = ['Vale farmácia', 'Adiantamento mensal', 'Vale alimentação', 'Vale transporte', 'Empréstimo'];

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function AdvancesPanel() {
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'paid'>('all');
  const [filterPeriod, setFilterPeriod] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  // `period` fica congelado no clique: se o usuário trocar o filtro com o diálogo
  // aberto, o número exibido e o que será baixado continuam sendo do mesmo mês.
  const [settleTarget, setSettleTarget] = useState<{ id: string; name: string; pending: number; pendingCount: number; period: string } | null>(null);
  const [form, setForm] = useState({
    employee_id: '',
    amount: 0,
    advance_date: todayISO(),
    time: new Date().toTimeString().split(' ')[0],
    description: '',
    receipt_url: '',
    status: 'pending',
  });

  const { data: employees = [] } = useEmployees();
  const { data: allAdvances = [], isLoading } = useEmployeeAdvances(null);
  const addAdvance = useAddAdvance();
  const deleteAdvance = useDeleteAdvance();
  const setAdvanceStatus = useSetAdvanceStatus();
  const settleEmployee = useSettleEmployeeAdvances();

  const empMap = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);

  const periodAdvances = useMemo(() => {
    return allAdvances.filter(a => a.advance_date.startsWith(filterPeriod));
  }, [allAdvances, filterPeriod]);

  const statusFiltered = useMemo(() => {
    return periodAdvances.filter(a => filterStatus === 'all' || a.status === filterStatus);
  }, [periodAdvances, filterStatus]);

  const filtered = useMemo(() => {
    return statusFiltered.filter(a => searchMatchesAllTerms(search, empMap.get(a.employee_id)?.name, a.description));
  }, [statusFiltered, search, empMap]);

  // Saldo aberto por funcionário (todos os adiantamentos pendentes) — fonte única
  // reaproveitada pela tabela de saldos, pelo combobox e pelo card de contexto do modal.
  const balanceMap = useMemo(() => {
    const map = new Map<string, {
      pending: number; pendingCount: number; thisMonth: number;
      /** Pendentes SÓ do mês filtrado — é exatamente o que "Dar baixa" vai quitar (D15). */
      pendingInPeriod: number; pendingCountInPeriod: number;
    }>();
    for (const a of allAdvances) {
      const cur = map.get(a.employee_id)
        || { pending: 0, pendingCount: 0, thisMonth: 0, pendingInPeriod: 0, pendingCountInPeriod: 0 };
      const noPeriodo = a.advance_date.startsWith(filterPeriod);
      if (a.status === 'pending') {
        cur.pending += Number(a.amount) || 0;
        cur.pendingCount++;
        if (noPeriodo) {
          cur.pendingInPeriod += Number(a.amount) || 0;
          cur.pendingCountInPeriod++;
        }
      }
      if (noPeriodo) {
        cur.thisMonth += Number(a.amount) || 0;
      }
      map.set(a.employee_id, cur);
    }
    return map;
  }, [allAdvances, filterPeriod]);

  // Saldo de vales pendentes por funcionário (pra badge do combobox).
  const pendingByEmployee = useMemo(() => {
    const m = new Map<string, number>();
    for (const [id, v] of balanceMap) if (v.pending > 0) m.set(id, v.pending);
    return m;
  }, [balanceMap]);

  const balancesByEmp = useMemo(() => {
    return Array.from(balanceMap.entries())
      .filter(([id]) => empMap.has(id))
      .map(([id, v]) => ({ id, name: empMap.get(id)!.name, ...v }))
      .filter(b => b.pending > 0 || b.thisMonth > 0)
      .sort((a, b) => b.pending - a.pending);
  }, [balanceMap, empMap]);

  const selectedBalance = form.employee_id ? balanceMap.get(form.employee_id) : undefined;

  const stats = useMemo(() => {
    const total = periodAdvances.reduce((s, a) => s + (Number(a.amount) || 0), 0);
    const pending = periodAdvances.filter(a => a.status === 'pending');
    const pendingValue = pending.reduce((s, a) => s + (Number(a.amount) || 0), 0);
    const allPendingValue = allAdvances.filter(a => a.status === 'pending').reduce((s, a) => s + (Number(a.amount) || 0), 0);
    return { total, pendingCount: pending.length, pendingValue, allPendingValue, count: periodAdvances.length };
  }, [periodAdvances, allAdvances]);

  const handleSave = () => {
    if (!form.employee_id || !form.amount) return;
    addAdvance.mutate(form, {
      onSuccess: () => {
        setDialogOpen(false);
        setForm(f => ({ ...f, amount: 0, description: '', receipt_url: '' }));
      },
    });
  };

  // Abre o modal limpo (opcionalmente já com o funcionário pré-selecionado pela
  // tabela de saldos), evitando carregar resíduo de um lançamento anterior.
  const openNew = (employeeId = '') => {
    setForm({
      employee_id: employeeId,
      amount: 0,
      advance_date: todayISO(),
      time: new Date().toTimeString().split(' ')[0],
      description: '',
      receipt_url: '',
      status: 'pending',
    });
    setDialogOpen(true);
  };

  if (isLoading) return <Loader2 className="h-6 w-6 animate-spin mx-auto my-12 text-muted-foreground" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-base font-bold tracking-tight flex items-center gap-2">
            <Wallet className="h-4 w-4 text-primary" /> Adiantamentos / Vales
          </h3>
          <p className="text-xs text-muted-foreground">
            Vales pagos no período, saldo a abater na próxima folha.
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => openNew()}><Plus className="h-4 w-4" /> Novo vale</Button>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Registrar vale</DialogTitle>
              <DialogDescription>Lance o adiantamento com valor e data; o saldo pendente é abatido na folha.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Funcionário</Label>
                <div className="mt-1">
                  <EmployeeCombobox
                    value={form.employee_id}
                    onChange={v => setForm(f => ({ ...f, employee_id: v }))}
                    employees={employees}
                    pendingByEmployee={pendingByEmployee}
                  />
                </div>
              </div>

              {/* Contexto de saldo do funcionário selecionado — registrar com visão do que já deve */}
              {form.employee_id && (
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="eyebrow">Saldo aberto</p>
                      <p className={cn('display text-base tabular-nums', (selectedBalance?.pending ?? 0) > 0 ? 'text-rose-600' : 'text-muted-foreground')}>
                        {fmt(selectedBalance?.pending ?? 0)}
                      </p>
                    </div>
                    <div>
                      <p className="eyebrow">Pendentes</p>
                      <p className="display text-base tabular-nums">{selectedBalance?.pendingCount ?? 0}</p>
                    </div>
                    <div>
                      <p className="eyebrow">Neste mês</p>
                      <p className="display text-base tabular-nums">{fmt(selectedBalance?.thisMonth ?? 0)}</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Valor</Label>
                  <CurrencyInput value={form.amount} onChange={v => setForm(f => ({ ...f, amount: v }))} />
                </div>
                <div>
                  <Label>Data</Label>
                  <Input type="date" value={form.advance_date} onChange={e => setForm(f => ({ ...f, advance_date: e.target.value }))} />
                </div>
              </div>
              <div>
                <Label>Descrição</Label>
                <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Ex.: vale farmácia, adiantamento mensal..." />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {DESC_PRESETS.map(p => (
                    <button
                      key={p} type="button"
                      onClick={() => setForm(f => ({ ...f, description: f.description === p ? '' : p }))}
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-xs transition-colors',
                        form.description === p
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pendente (a abater na folha)</SelectItem>
                    <SelectItem value="paid">Pago / quitado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleSave} disabled={!form.employee_id || !form.amount || addAdvance.isPending} className="w-full">
                {addAdvance.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Salvar
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Total no período</p>
          <p className="display text-xl tabular-nums">{fmt(stats.total)}</p>
          <p className="text-xs text-muted-foreground">{stats.count} vale{stats.count !== 1 ? 's' : ''}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Pendentes (período)</p>
          <p className="display text-xl tabular-nums text-amber-600">{fmt(stats.pendingValue)}</p>
          <p className="text-xs text-muted-foreground">{stats.pendingCount} vale{stats.pendingCount !== 1 ? 's' : ''}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Saldo aberto total</p>
          <p className="display text-xl tabular-nums text-rose-600">{fmt(stats.allPendingValue)}</p>
          <p className="text-xs text-muted-foreground">A abater em folha</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Funcionários afetados</p>
          <p className="display text-xl tabular-nums">{balancesByEmp.filter(b => b.pending > 0).length}</p>
          <p className="text-xs text-muted-foreground">Com saldo aberto</p>
        </CardContent></Card>
      </div>

      {/* Saldo por funcionário */}
      {balancesByEmp.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Saldo a abater na próxima folha
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Funcionário</TableHead>
                  <TableHead className="text-right">No mês</TableHead>
                  <TableHead className="text-right">Saldo aberto</TableHead>
                  <TableHead className="text-right">Vales pendentes</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {balancesByEmp.map(b => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.name}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(b.thisMonth)}</TableCell>
                    <TableCell className={`text-right font-mono font-bold ${b.pending > 0 ? 'text-rose-600' : ''}`}>
                      {fmt(b.pending)}
                    </TableCell>
                    <TableCell className="text-right">
                      {b.pendingCount > 0 ? <Badge variant="outline" className="text-xs">{b.pendingCount}</Badge> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm" variant="ghost"
                          className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => openNew(b.id)}
                          title={`Registrar novo vale para ${b.name}`}
                        >
                          <Plus className="h-3 w-3" /> Vale
                        </Button>
                        {b.pendingCountInPeriod > 0 && (
                          <Button
                            size="sm" variant="outline"
                            className="h-7 text-xs gap-1 border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10"
                            onClick={() => setSettleTarget({
                              id: b.id, name: b.name,
                              pending: b.pendingInPeriod, pendingCount: b.pendingCountInPeriod,
                              period: filterPeriod,
                            })}
                            disabled={settleEmployee.isPending}
                            title={`Dar baixa nos vales pendentes de ${filterPeriod} deste funcionário`}
                          >
                            <Check className="h-3 w-3" /> Dar baixa
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Filtros + Lista detalhada */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-sm">Vales registrados no período</CardTitle>
            <div className="flex gap-2 items-center">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Buscar por funcionário ou descrição…"
                resultCount={filtered.length}
                totalCount={statusFiltered.length}
                className="w-56"
                inputClassName="h-8 text-sm"
              />
              <Input type="month" value={filterPeriod} onChange={e => setFilterPeriod(e.target.value)} className="h-8 w-36 text-sm" />
              <Select value={filterStatus} onValueChange={(v: any) => setFilterStatus(v)}>
                <SelectTrigger className="h-8 w-32 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="pending">Pendentes</SelectItem>
                  <SelectItem value="paid">Pagos</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Funcionário</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-4">
                    {search ? (
                      <EmptyState
                        size="sm"
                        icon={Search}
                        title={`Nenhum resultado para "${search}"`}
                        action={<Button variant="outline" size="sm" onClick={() => setSearch('')}>Limpar busca</Button>}
                      />
                    ) : (
                      <p className="text-center text-muted-foreground py-4">Nenhum vale no período.</p>
                    )}
                  </TableCell>
                </TableRow>
              ) : filtered.map(a => {
                const emp = empMap.get(a.employee_id);
                return (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{emp?.name || '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{new Date(a.advance_date + 'T12:00:00').toLocaleDateString('pt-BR')}</TableCell>
                    <TableCell className="text-muted-foreground truncate max-w-[260px]">{a.description || '—'}</TableCell>
                    <TableCell className="text-right font-mono font-bold">{fmt(Number(a.amount))}</TableCell>
                    <TableCell>
                      <Badge variant={a.status === 'pending' ? 'outline' : 'default'}
                             className={`text-xs ${a.status === 'pending' ? 'text-amber-700 border-amber-400' : ''}`}>
                        {a.status === 'pending' ? 'Pendente' : 'Pago'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {a.status === 'pending' ? (
                          <Button
                            size="sm" variant="outline"
                            className="h-7 text-xs gap-1 border-emerald-400 text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                            onClick={() => setAdvanceStatus.mutate({ id: a.id, status: 'paid' })}
                            disabled={setAdvanceStatus.isPending}
                            title="Marcar como já descontado em folha"
                          >
                            <Check className="h-3 w-3" /> Dar baixa
                          </Button>
                        ) : (
                          <Button
                            size="sm" variant="ghost"
                            className="h-7 text-xs gap-1 text-muted-foreground"
                            onClick={() => setAdvanceStatus.mutate({ id: a.id, status: 'pending' })}
                            disabled={setAdvanceStatus.isPending}
                            title="Reabrir (voltar para pendente)"
                          >
                            <ArrowCounterClockwise className="h-3 w-3" /> Reabrir
                          </Button>
                        )}
                        <DeleteConfirmButton
                          onConfirm={() => deleteAdvance.mutate(a.id)}
                          description={`Remover vale de ${fmt(Number(a.amount))} de ${emp?.name || ''}?`}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Confirmação de baixa em lote dos vales pendentes de um funcionário */}
      <AlertDialog open={!!settleTarget} onOpenChange={o => { if (!o) setSettleTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Dar baixa em {settleTarget?.pendingCount ?? 0} vale{(settleTarget?.pendingCount ?? 0) === 1 ? '' : 's'} de {settleTarget?.period ?? ''}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {settleTarget
                ? `${settleTarget.name} — ${fmt(settleTarget.pending)} em aberto em ${settleTarget.period}. `
                  + 'Use depois que a folha desse período já descontou o saldo. '
                  + 'Vales de outras competências não são afetados.'
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={settleEmployee.isPending}
              onClick={() => {
                if (settleTarget) settleEmployee.mutate({ employeeId: settleTarget.id, period: settleTarget.period });
                setSettleTarget(null);
              }}
            >
              Dar baixa
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
