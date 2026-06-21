import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { CircleNotch as Loader2, Plus, Wallet, MagnifyingGlass as Search, Warning as AlertTriangle, Check, ArrowCounterClockwise } from '@phosphor-icons/react';
import { CurrencyInput } from '@/components/ui/currency-input';
import {
  useEmployees, useEmployeeAdvances, useAddAdvance, useDeleteAdvance,
  useSetAdvanceStatus, useSettleEmployeeAdvances,
} from '@/hooks/useEmployees';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { todayISO } from '@/lib/date';
import { normalizeForSearch } from '@/lib/searchUtils';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function AdvancesPanel() {
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'paid'>('all');
  const [filterPeriod, setFilterPeriod] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
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

  const filtered = useMemo(() => {
    return periodAdvances.filter(a => {
      if (filterStatus !== 'all' && a.status !== filterStatus) return false;
      if (search) {
        const emp = empMap.get(a.employee_id);
        const q = normalizeForSearch(search);
        if (!normalizeForSearch(emp?.name ?? '').includes(q) && !normalizeForSearch(a.description).includes(q)) return false;
      }
      return true;
    });
  }, [periodAdvances, filterStatus, search, empMap]);

  // Saldo aberto por funcionário (todos os adiantamentos pendentes)
  const balancesByEmp = useMemo(() => {
    const map = new Map<string, { name: string; pending: number; pendingCount: number; thisMonth: number }>();
    for (const a of allAdvances) {
      const emp = empMap.get(a.employee_id);
      if (!emp) continue;
      const cur = map.get(a.employee_id) || { name: emp.name, pending: 0, pendingCount: 0, thisMonth: 0 };
      if (a.status === 'pending') {
        cur.pending += Number(a.amount) || 0;
        cur.pendingCount++;
      }
      if (a.advance_date.startsWith(filterPeriod)) {
        cur.thisMonth += Number(a.amount) || 0;
      }
      map.set(a.employee_id, cur);
    }
    return Array.from(map.entries())
      .map(([id, v]) => ({ id, ...v }))
      .filter(b => b.pending > 0 || b.thisMonth > 0)
      .sort((a, b) => b.pending - a.pending);
  }, [allAdvances, empMap, filterPeriod]);

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
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5"><Plus className="h-4 w-4" /> Novo vale</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Registrar vale</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Funcionário</Label>
                <Select value={form.employee_id} onValueChange={v => setForm(f => ({ ...f, employee_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {employees.filter(e => e.active).map(e => (
                      <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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
                      {b.pendingCount > 0 ? (
                        <Button
                          size="sm" variant="outline"
                          className="h-7 text-xs gap-1 border-emerald-400 text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                          onClick={() => {
                            if (window.confirm(`Dar baixa em ${b.pendingCount} vale(s) pendente(s) de ${b.name} (${fmt(b.pending)})? Use depois que a folha já descontou o saldo.`)) {
                              settleEmployee.mutate(b.id);
                            }
                          }}
                          disabled={settleEmployee.isPending}
                          title="Dar baixa em todos os vales pendentes deste funcionário"
                        >
                          <Check className="h-3 w-3" /> Dar baixa
                        </Button>
                      ) : <span className="text-muted-foreground">—</span>}
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
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input className="h-8 pl-7 w-40 text-sm" placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
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
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nenhum vale no período.</TableCell></TableRow>
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
    </div>
  );
}
