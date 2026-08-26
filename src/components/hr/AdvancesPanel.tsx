import { useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  CircleNotch as Loader2, Plus, Wallet, MagnifyingGlass as Search,
  Warning as AlertTriangle, Check, XCircle,
} from '@phosphor-icons/react';
import { CurrencyInput } from '@/components/ui/currency-input';
import {
  useEmployees, useEmployeeAdvances, useAddAdvance, useCancelAdvance,
  useMarkAdvanceExternallySettled, useSettleEmployeeAdvancesExternally,
} from '@/hooks/useEmployees';
import { EmployeeCombobox } from '@/components/hr/EmployeeCombobox';
import { SearchInput } from '@/components/ui/search-input';
import { EmptyState } from '@/components/ui/empty-state';
import { todayISO } from '@/lib/date';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import { cn } from '@/lib/utils';
import {
  canManageOpenEmployeeAdvance,
  createEmployeeAdvanceIdempotencyKey,
  employeeAdvanceStatusLabel,
  isOpenEmployeeAdvance,
  matchesEmployeeAdvanceStatusFilter,
  type EmployeeAdvanceStatusFilter,
} from '@/lib/employeeAdvances';

const DESC_PRESETS = ['Vale farmácia', 'Adiantamento mensal', 'Vale alimentação', 'Vale transporte', 'Empréstimo'];

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function AdvancesPanel() {
  const [filterStatus, setFilterStatus] = useState<EmployeeAdvanceStatusFilter>('all');
  const [filterPeriod, setFilterPeriod] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  // `period` fica congelado no clique: se o usuário trocar o filtro com o diálogo
  // aberto, o número exibido e o que será baixado continuam sendo do mesmo mês.
  const [settleTarget, setSettleTarget] = useState<{ id: string; name: string; open: number; openCount: number; period: string } | null>(null);
  const [singleSettleTarget, setSingleSettleTarget] = useState<{ id: string; name: string; amount: number } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{ id: string; name: string; amount: number } | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const advanceIdempotencyKey = useRef(createEmployeeAdvanceIdempotencyKey());
  const [form, setForm] = useState({
    employee_id: '',
    amount: 0,
    advance_date: todayISO(),
    time: new Date().toTimeString().split(' ')[0],
    description: '',
    receipt_url: '',
  });

  const { data: employees = [] } = useEmployees();
  const { data: allAdvances = [], isLoading } = useEmployeeAdvances(null);
  const addAdvance = useAddAdvance();
  const cancelAdvance = useCancelAdvance();
  const settleOneExternally = useMarkAdvanceExternallySettled();
  const settleEmployeeExternally = useSettleEmployeeAdvancesExternally();

  const empMap = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);

  const periodAdvances = useMemo(() => {
    return allAdvances.filter(a => a.advance_date.startsWith(filterPeriod));
  }, [allAdvances, filterPeriod]);

  const statusFiltered = useMemo(() => {
    return periodAdvances.filter(a => matchesEmployeeAdvanceStatusFilter(a.status, filterStatus));
  }, [periodAdvances, filterStatus]);

  const filtered = useMemo(() => {
    return statusFiltered.filter(a => searchMatchesAllTerms(
      search,
      empMap.get(a.employee_id)?.name,
      a.description,
      a.cancellation_reason,
    ));
  }, [statusFiltered, search, empMap]);

  // Saldo aberto por funcionário (`pending` + `paid`) — fonte única
  // reaproveitada pela tabela de saldos, pelo combobox e pelo card de contexto do modal.
  const balanceMap = useMemo(() => {
    const map = new Map<string, {
      open: number; openCount: number; thisMonth: number;
      /** Abertos SÓ do mês filtrado — exatamente o recorte da baixa externa em lote. */
      openInPeriod: number; openCountInPeriod: number;
    }>();
    for (const a of allAdvances) {
      const cur = map.get(a.employee_id)
        || { open: 0, openCount: 0, thisMonth: 0, openInPeriod: 0, openCountInPeriod: 0 };
      const noPeriodo = a.advance_date.startsWith(filterPeriod);
      if (isOpenEmployeeAdvance(a.status)) {
        cur.open += Number(a.amount) || 0;
        cur.openCount++;
        if (noPeriodo) {
          cur.openInPeriod += Number(a.amount) || 0;
          cur.openCountInPeriod++;
        }
      }
      if (noPeriodo && a.status !== 'cancelado') {
        cur.thisMonth += Number(a.amount) || 0;
      }
      map.set(a.employee_id, cur);
    }
    return map;
  }, [allAdvances, filterPeriod]);

  // Saldo de vales em aberto por funcionário (pra badge do combobox).
  const openByEmployee = useMemo(() => {
    const m = new Map<string, number>();
    for (const [id, v] of balanceMap) if (v.open > 0) m.set(id, v.open);
    return m;
  }, [balanceMap]);

  const balancesByEmp = useMemo(() => {
    return Array.from(balanceMap.entries())
      .filter(([id]) => empMap.has(id))
      .map(([id, v]) => ({ id, name: empMap.get(id)!.name, ...v }))
      .filter(b => b.open > 0 || b.thisMonth > 0)
      .sort((a, b) => b.open - a.open);
  }, [balanceMap, empMap]);

  const selectedBalance = form.employee_id ? balanceMap.get(form.employee_id) : undefined;

  const stats = useMemo(() => {
    const effective = periodAdvances.filter(a => a.status !== 'cancelado');
    const total = effective.reduce((s, a) => s + (Number(a.amount) || 0), 0);
    const open = periodAdvances.filter(a => isOpenEmployeeAdvance(a.status));
    const openValue = open.reduce((s, a) => s + (Number(a.amount) || 0), 0);
    const allOpenValue = allAdvances.filter(a => isOpenEmployeeAdvance(a.status)).reduce((s, a) => s + (Number(a.amount) || 0), 0);
    return { total, openCount: open.length, openValue, allOpenValue, count: effective.length };
  }, [periodAdvances, allAdvances]);

  const handleSave = () => {
    if (!form.employee_id || !form.amount) return;
    addAdvance.mutate({ ...form, idempotencyKey: advanceIdempotencyKey.current }, {
      onSuccess: () => {
        advanceIdempotencyKey.current = createEmployeeAdvanceIdempotencyKey();
        setDialogOpen(false);
        setForm(f => ({ ...f, amount: 0, description: '', receipt_url: '' }));
      },
    });
  };

  // Abre o modal limpo (opcionalmente já com o funcionário pré-selecionado pela
  // tabela de saldos), evitando carregar resíduo de um lançamento anterior.
  const openNew = (employeeId = '') => {
    advanceIdempotencyKey.current = createEmployeeAdvanceIdempotencyKey();
    setForm({
      employee_id: employeeId,
      amount: 0,
      advance_date: todayISO(),
      time: new Date().toTimeString().split(' ')[0],
      description: '',
      receipt_url: '',
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
            Valores entregues no período e saldo a abater na próxima folha.
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => openNew()}><Plus className="h-4 w-4" /> Novo vale</Button>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Registrar vale</DialogTitle>
              <DialogDescription>Lance o adiantamento com valor e data; todo novo vale fica em aberto para desconto na folha.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Funcionário</Label>
                <div className="mt-1">
                  <EmployeeCombobox
                    value={form.employee_id}
                    onChange={v => setForm(f => ({ ...f, employee_id: v }))}
                    employees={employees}
                    openBalanceByEmployee={openByEmployee}
                  />
                </div>
              </div>

              {/* Contexto de saldo do funcionário selecionado — registrar com visão do que já deve */}
              {form.employee_id && (
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="eyebrow">Saldo aberto</p>
                      <p className={cn('display text-base tabular-nums', (selectedBalance?.open ?? 0) > 0 ? 'text-rose-600' : 'text-muted-foreground')}>
                        {fmt(selectedBalance?.open ?? 0)}
                      </p>
                    </div>
                    <div>
                      <p className="eyebrow">Em aberto</p>
                      <p className="display text-base tabular-nums">{selectedBalance?.openCount ?? 0}</p>
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
          <p className="text-xs text-muted-foreground uppercase">Em aberto (período)</p>
          <p className="display text-xl tabular-nums text-amber-600">{fmt(stats.openValue)}</p>
          <p className="text-xs text-muted-foreground">{stats.openCount} vale{stats.openCount !== 1 ? 's' : ''}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Saldo aberto total</p>
          <p className="display text-xl tabular-nums text-rose-600">{fmt(stats.allOpenValue)}</p>
          <p className="text-xs text-muted-foreground">A abater em folha</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Funcionários afetados</p>
          <p className="display text-xl tabular-nums">{balancesByEmp.filter(b => b.open > 0).length}</p>
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
                  <TableHead className="text-right">Vales em aberto</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {balancesByEmp.map(b => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.name}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(b.thisMonth)}</TableCell>
                    <TableCell className={`text-right font-mono font-bold ${b.open > 0 ? 'text-rose-600' : ''}`}>
                      {fmt(b.open)}
                    </TableCell>
                    <TableCell className="text-right">
                      {b.openCount > 0 ? <Badge variant="outline" className="text-xs">{b.openCount}</Badge> : <span className="text-muted-foreground">—</span>}
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
                        {b.openCountInPeriod > 0 && (
                          <Button
                            size="sm" variant="outline"
                            className="h-7 text-xs gap-1 border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10"
                            onClick={() => setSettleTarget({
                              id: b.id, name: b.name,
                              open: b.openInPeriod, openCount: b.openCountInPeriod,
                              period: filterPeriod,
                            })}
                            disabled={settleEmployeeExternally.isPending}
                            title={`Baixar fora da folha os vales em aberto de ${filterPeriod}`}
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
              <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as EmployeeAdvanceStatusFilter)}>
                <SelectTrigger className="h-8 w-48 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="open">Em aberto</SelectItem>
                  <SelectItem value="pending">Pendente · a descontar</SelectItem>
                  <SelectItem value="paid">Entregue · a descontar</SelectItem>
                  <SelectItem value="deducted">Descontado em folha</SelectItem>
                  <SelectItem value="baixado_externo">Baixado fora da folha</SelectItem>
                  <SelectItem value="cancelado">Cancelado</SelectItem>
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
                const isOpen = isOpenEmployeeAdvance(a.status);
                const canManage = canManageOpenEmployeeAdvance(a);
                return (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{emp?.name || '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{new Date(a.advance_date + 'T12:00:00').toLocaleDateString('pt-BR')}</TableCell>
                    <TableCell className="max-w-[260px]">
                      <div className="truncate text-muted-foreground">{a.description || '—'}</div>
                      {a.status === 'cancelado' && a.cancellation_reason && (
                        <div className="truncate text-[11px] text-destructive" title={a.cancellation_reason}>
                          Motivo: {a.cancellation_reason}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold">{fmt(Number(a.amount))}</TableCell>
                    <TableCell>
                      <Badge
                        variant={a.status === 'cancelado' ? 'destructive-soft' : isOpen ? 'outline' : a.status === 'deducted' ? 'default' : 'secondary'}
                        className={cn('text-xs', isOpen && 'border-amber-400 text-amber-700')}
                      >
                        {employeeAdvanceStatusLabel(a.status)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {canManage ? (
                          <>
                            <Button
                              size="sm" variant="outline"
                              className="h-7 text-xs gap-1 border-emerald-400 text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                              onClick={() => setSingleSettleTarget({
                                id: a.id,
                                name: emp?.name || 'funcionário',
                                amount: Number(a.amount) || 0,
                              })}
                              disabled={settleOneExternally.isPending}
                              title="Baixar fora da folha; este valor não será descontado"
                            >
                              <Check className="h-3 w-3" /> Dar baixa
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                              title="Cancelar vale"
                              aria-label="Cancelar vale"
                              disabled={cancelAdvance.isPending}
                              onClick={() => {
                                setCancelReason('');
                                setCancelTarget({
                                  id: a.id,
                                  name: emp?.name || 'funcionário',
                                  amount: Number(a.amount) || 0,
                                });
                              }}
                            >
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </>
                        ) : (
                          <span
                            className="px-2 text-xs text-muted-foreground"
                            title={a.status === 'cancelado'
                              ? 'Cancelamento preservado no histórico'
                              : a.status === 'deducted' || a.payroll_run_id
                                ? 'Controlado pela folha; não pode ser alterado aqui'
                                : 'Baixa externa preservada no histórico'}
                          >
                            —
                          </span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Confirmação de baixa externa em lote dos vales abertos de um funcionário */}
      <AlertDialog open={!!settleTarget} onOpenChange={o => { if (!o) setSettleTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Baixar fora da folha {settleTarget?.openCount ?? 0} vale{(settleTarget?.openCount ?? 0) === 1 ? '' : 's'} de {settleTarget?.period ?? ''}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {settleTarget
                ? `${settleTarget.name} — ${fmt(settleTarget.open)} em aberto em ${settleTarget.period}. `
                  + 'Esses vales serão marcados como acertados por outro meio e NÃO serão descontados nesta nem em folhas futuras. '
                  + 'Use somente quando o valor já tiver sido liquidado fora da folha; outras competências não são afetadas.'
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={settleEmployeeExternally.isPending}
              onClick={() => {
                if (settleTarget) settleEmployeeExternally.mutate({ employeeId: settleTarget.id, period: settleTarget.period });
                setSettleTarget(null);
              }}
            >
              Confirmar baixa externa
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmação de baixa externa de um vale individual */}
      <AlertDialog open={!!singleSettleTarget} onOpenChange={o => { if (!o) setSingleSettleTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Baixar este vale fora da folha?</AlertDialogTitle>
            <AlertDialogDescription>
              {singleSettleTarget
                ? `${singleSettleTarget.name} — ${fmt(singleSettleTarget.amount)}. `
                  + 'O vale será marcado como acertado por outro meio e NÃO será descontado nesta nem em folhas futuras. '
                  + 'Use somente se o valor já tiver sido liquidado fora da folha.'
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={settleOneExternally.isPending}
              onClick={() => {
                if (singleSettleTarget) settleOneExternally.mutate(singleSettleTarget.id);
                setSingleSettleTarget(null);
              }}
            >
              Confirmar baixa externa
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancelamento preserva o lançamento e exige justificativa auditável. */}
      <AlertDialog
        open={!!cancelTarget}
        onOpenChange={o => {
          if (!o && !cancelAdvance.isPending) {
            setCancelTarget(null);
            setCancelReason('');
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar este vale?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget ? `${cancelTarget.name} — ${fmt(cancelTarget.amount)}. ` : ''}
              O lançamento continuará visível no histórico, mas deixará de compor totais e saldos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="advance-cancellation-reason">Motivo do cancelamento *</Label>
            <Textarea
              id="advance-cancellation-reason"
              value={cancelReason}
              onChange={event => setCancelReason(event.target.value)}
              placeholder="Explique por que este lançamento deve ser cancelado"
              rows={3}
              autoFocus
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelAdvance.isPending}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!cancelReason.trim() || cancelAdvance.isPending}
              onClick={event => {
                event.preventDefault();
                if (!cancelTarget || !cancelReason.trim()) return;
                cancelAdvance.mutate(
                  { id: cancelTarget.id, reason: cancelReason },
                  {
                    onSuccess: () => {
                      setCancelTarget(null);
                      setCancelReason('');
                    },
                  },
                );
              }}
            >
              {cancelAdvance.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Cancelar vale
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
