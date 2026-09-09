import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Calendar, ChartLineUp, DownloadSimple, GearSix, Plus, PencilSimple, Trash, Wallet, WarningCircle, ArrowsClockwise } from '@phosphor-icons/react';
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { HubTabsList } from '@/components/layout/HubTabs';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useCan } from '@/hooks/useAccessControl';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import { useCfoPlans, useCfoOrders, useCfoEntries, useCfoWeeks, useDeleteCfoOrder, useDeleteCfoEntry } from '@/hooks/useCfo';
import { buildCfoProjection, type CfoProjectionResult } from '@/lib/cfoProjection';
import { cn, formatCurrency as money } from '@/lib/utils';
import { safeFormatBR } from '@/lib/date';
import type { CfoEntry, CfoEntryType, CfoOrder } from '@/types/cfo';
import CfoPlanDialog from '@/components/finance/cfo/CfoPlanDialog';
import CfoOrderDialog from '@/components/finance/cfo/CfoOrderDialog';
import CfoEntryDialog from '@/components/finance/cfo/CfoEntryDialog';
import { CFO_ENTRY_LABELS } from '@/lib/cfoLabels';
import CfoWeeklyInputs from '@/components/finance/cfo/CfoWeeklyInputs';

const CFO_VIEWS = ['weeks', 'orders', 'entries'] as const;
const dateShort = (date: string) => safeFormatBR(date, '—', 'dd/MM');
const numberShort = (value: number) => new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(value);

function exportWeeks(projection: CfoProjectionResult) {
  const header = ['Início', 'Fim', 'Saldo inicial', 'Recebimentos', 'Aportes', 'Materiais', 'Despesas', 'Retiradas', 'Saldo final', 'Menor saldo', 'Lucro das entregas', 'Lucro acumulado', 'Contas informadas', 'Reinvestimento informado', 'Pares produzidos', 'Pares acumulados'];
  const rows = projection.weeks.map(w => [safeFormatBR(w.inicio), safeFormatBR(w.fim), ...[
    w.saldoInicial, w.recebimentos, w.aportes, w.materiais, w.despesas, w.retiradas, w.saldoFinal, w.menorSaldo, w.lucro, w.lucroAcumulado,
  ].map(n => n.toFixed(2).replace('.', ',')),
    w.contasInformadas === null ? '' : w.contasInformadas.toFixed(2).replace('.', ','),
    w.reinvestimentoInformado === null ? '' : w.reinvestimentoInformado.toFixed(2).replace('.', ','),
    w.paresProduzidos === null ? '' : String(w.paresProduzidos), String(w.paresAcumulados),
  ]);
  const blob = new Blob(['\uFEFF', [header, ...rows].map(row => row.join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'cfo-projecao-semanal.csv'; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function CfoTab() {
  const permission = useCan('/financeiro');
  const [params, setParams] = useSearchParams();
  const plansQuery = useCfoPlans();
  const plans = plansQuery.data ?? [];
  const plan = plans.find(p => p.id === params.get('cfoPlano')) ?? plans[0];
  const ordersQuery = useCfoOrders(plan?.id);
  const entriesQuery = useCfoEntries(plan?.id);
  const weeksQuery = useCfoWeeks(plan?.id);
  const orders = ordersQuery.data ?? [];
  const entries = entriesQuery.data ?? [];
  const removeOrder = useDeleteCfoOrder();
  const removeEntry = useDeleteCfoEntry();
  const [planDialog, setPlanDialog] = useState<'new' | 'edit' | null>(null);
  const [orderDialog, setOrderDialog] = useState<CfoOrder | 'new' | null>(null);
  const [entryDialog, setEntryDialog] = useState<{ entry?: CfoEntry; orderId?: string; type?: CfoEntryType } | null>(null);
  const [deleting, setDeleting] = useState<{ type: 'order' | 'entry'; id: string; label: string } | null>(null);
  const [delay, setDelay] = useState(0);
  const [increase, setIncrease] = useState(0);
  const [entryFilter, setEntryFilter] = useState('todos');
  const { value: view, setValue: setView } = useUrlTabState({ values: CFO_VIEWS, defaultValue: 'weeks', param: 'cfoView' });
  const scenario = delay > 0 || increase > 0;
  const calculation = useMemo(() => {
    if (!plan || !ordersQuery.data || !entriesQuery.data || !weeksQuery.data) return { projection: null, error: null };
    try { return { projection: buildCfoProjection(plan, ordersQuery.data, entriesQuery.data, { receivableDelayDays: delay, materialIncreasePct: increase, weeklyInputs: weeksQuery.data }), error: null }; }
    catch (error) { return { projection: null, error: error instanceof Error ? error.message : 'Confira as datas e os valores do planejamento.' }; }
  }, [plan, ordersQuery.data, entriesQuery.data, weeksQuery.data, delay, increase]);
  const base = useMemo(() => {
    if (!scenario || !plan || !ordersQuery.data || !entriesQuery.data || !weeksQuery.data) return null;
    try { return buildCfoProjection(plan, ordersQuery.data, entriesQuery.data, { weeklyInputs: weeksQuery.data }); } catch { return null; }
  }, [plan, ordersQuery.data, entriesQuery.data, weeksQuery.data, scenario]);
  const projection = calculation.projection;
  const loading = plansQuery.isLoading || (plan && (ordersQuery.isLoading || entriesQuery.isLoading || weeksQuery.isLoading));
  const error = plansQuery.error || ordersQuery.error || entriesQuery.error || weeksQuery.error || calculation.error;
  const choosePlan = (id: string) => {
    setParams(current => { const next = new URLSearchParams(current); next.set('cfoPlano', id); return next; });
    setDelay(0); setIncrease(0);
  };
  const selectedEntries = entries.filter(e => entryFilter === 'todos' || e.status === entryFilter).slice().sort((a, b) => {
    const ad = a.status === 'realizado' ? a.data_realizada : a.data_prevista;
    const bd = b.status === 'realizado' ? b.data_realizada : b.data_prevista;
    return (ad ?? '').localeCompare(bd ?? '');
  });
  async function confirmDelete() {
    if (!deleting || !plan) return;
    try {
      await (deleting.type === 'order' ? removeOrder : removeEntry).mutateAsync({ id: deleting.id, plano_id: plan.id });
      setDeleting(null);
    } catch { /* toast do hook */ }
  }

  return <div className="space-y-5 py-2">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-2xl"><h2 className="font-display text-3xl">CFO</h2><p className="text-sm text-muted-foreground">Planeje o lucro das entregas e o dinheiro disponível, semana a semana.</p></div>
      <div className="flex flex-wrap gap-2">
        {plan && !error && <>
          {permission.canEdit && <Button variant="outline" size="sm" onClick={() => setPlanDialog('edit')}><GearSix className="mr-1.5 h-4 w-4" />Configurar</Button>}
          {permission.canCreate && <><Button variant="outline" size="sm" onClick={() => setEntryDialog({})}><Plus className="mr-1.5 h-4 w-4" />Entrada / saída</Button><Button size="sm" onClick={() => setOrderDialog('new')}><Plus className="mr-1.5 h-4 w-4" />Projetar pedido</Button></>}
        </>}
      </div>
    </div>

    {loading ? <div className="space-y-4"><Skeleton className="h-24" /><Skeleton className="h-80" /></div> : error ? <Card><CardContent className="py-8 space-y-3 text-center">
      <WarningCircle className="h-8 w-8 mx-auto text-destructive" /><p className="font-semibold">Não foi possível abrir a projeção</p><p className="text-sm text-muted-foreground">{typeof error === 'string' ? error : (error as Error).message}</p>
      <Button variant="outline" onClick={() => { void plansQuery.refetch(); if (plan) { void ordersQuery.refetch(); void entriesQuery.refetch(); void weeksQuery.refetch(); } }}><ArrowsClockwise className="mr-2 h-4 w-4" />Tentar novamente</Button>
      {plan && permission.canEdit && <Button variant="outline" className="ml-2" onClick={() => setPlanDialog('edit')}>Conferir configuração</Button>}
    </CardContent></Card> : !plan ? <Card><EmptyState icon={ChartLineUp} title="Comece pela data e pelo saldo inicial" description="Depois adicione pedidos, lucro esperado e compras de material. Cada lançamento atualiza as semanas do planejamento."
      action={permission.canCreate ? <Button onClick={() => setPlanDialog('new')}>Criar planejamento CFO</Button> : <p className="text-sm text-muted-foreground">Peça a criação do plano a alguém com permissão de cadastro no Financeiro.</p>} /></Card> : projection && <>
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border bg-muted/20 p-3">
        <div className="space-y-1.5 min-w-0 w-full sm:w-72"><Label htmlFor="cfo-plan-selector">Planejamento</Label><Select value={plan.id} onValueChange={choosePlan}><SelectTrigger id="cfo-plan-selector"><SelectValue /></SelectTrigger><SelectContent>{plans.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}</SelectContent></Select></div>
        <p className="text-sm text-muted-foreground flex items-center gap-2"><Calendar className="h-4 w-4" />{safeFormatBR(plan.data_inicio)} a {safeFormatBR(plan.data_fim)}</p>
        <div className="flex flex-wrap gap-2">{permission.canCreate && <Button size="sm" variant="ghost" onClick={() => setPlanDialog('new')}>Novo planejamento</Button>}<Button size="sm" variant="outline" onClick={() => exportWeeks(projection)}><DownloadSimple className="mr-1.5 h-4 w-4" />Exportar semanas</Button></div>
      </div>

      <div className="rounded-lg border border-border p-3 text-sm leading-relaxed text-muted-foreground">
        <strong className="text-foreground">Lucro e caixa têm datas diferentes.</strong> O lucro aparece na entrega. O caixa considera os recebimentos, as contas e o reinvestimento que você informar. Este planejamento não gera contas a pagar, não altera estoque e não soma automaticamente os títulos do Financeiro.
      </div>

      {projection.warnings.length > 0 && <div className="rounded-lg border border-warning/40 bg-warning/5 p-4 space-y-2" role="status">
        <p className="font-semibold flex items-center gap-2"><WarningCircle className="h-5 w-5 text-warning shrink-0" />Confira as premissas da projeção</p>
        <ul className="list-disc pl-5 space-y-1 text-sm">{projection.warnings.map((warning, i) => <li key={`${warning.code}-${i}`}>{warning.message}</li>)}</ul>
      </div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard label="Lucro das entregas" value={money(projection.totals.lucroTotal)} hint="Soma dos resultados dos pedidos no período" tone={projection.totals.lucroTotal < 0 ? 'destructive' : 'success'} icon={ChartLineUp} />
        <StatCard label={scenario ? 'Caixa final simulado' : 'Caixa final projetado'} value={money(projection.totals.saldoFinal)} hint={`Saldo inicial de ${money(plan.saldo_inicial)} + entradas − saídas`} tone={projection.totals.saldoFinal < 0 ? 'destructive' : 'default'} icon={Wallet} />
        <StatCard label="Compras de materiais" value={money(projection.totals.materiais)} hint="Reinvestimento semanal com compras detalhadas incluídas" />
        <StatCard label="Capital adicional necessário" value={money(projection.totals.capitalNecessario)} hint={projection.firstShortfallDate ? `Primeiro déficit em ${safeFormatBR(projection.firstShortfallDate)}` : 'Para cobrir o menor saldo, sem incluir a reserva'} tone={projection.totals.capitalNecessario > 0 ? 'destructive' : 'default'} />
      </div>

      <details className="rounded-lg border border-border p-4">
        <summary className="cursor-pointer font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Simular atrasos e materiais mais caros{scenario ? ' — simulação ativa' : ''}</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5"><Label htmlFor="cfo-delay">Atraso dos recebimentos (dias)</Label><Input id="cfo-delay" type="number" min={0} max={180} step={1} value={delay} onChange={e => setDelay(Math.min(180, Math.max(0, Math.trunc(Number(e.target.value) || 0))))} /></div>
          <div className="space-y-1.5"><Label htmlFor="cfo-increase">Aumento nos materiais (%)</Label><Input id="cfo-increase" type="number" min={0} max={100} step={1} value={increase} onChange={e => setIncrease(Math.min(100, Math.max(0, Number(e.target.value) || 0)))} /></div>
          <div className="flex items-end"><Button variant="outline" onClick={() => { setDelay(0); setIncrease(0); }} disabled={!scenario}>Voltar ao plano salvo</Button></div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Só os lançamentos previstos mudam na simulação. Os valores realizados e o planejamento salvo permanecem iguais.</p>
        {base && <p className="mt-2 text-sm">Caixa final do plano salvo: <strong>{money(base.totals.saldoFinal)}</strong>. Diferença na simulação: <strong className={projection.totals.saldoFinal < base.totals.saldoFinal ? 'text-destructive' : ''}>{money(projection.totals.saldoFinal - base.totals.saldoFinal)}</strong>.</p>}
      </details>

      <Tabs value={view} onValueChange={v => setView(v as typeof view)}>
        <HubTabsList ariaLabel="Acompanhamento CFO" tabs={[{ value: 'weeks', label: 'Semana a semana', icon: Calendar }, { value: 'orders', label: 'Pedidos', badge: orders.length }, { value: 'entries', label: 'Entradas e saídas', badge: entries.length }]} />
        <TabsContent value="weeks" className="space-y-4">
          <CfoWeeklyInputs key={plan.id} plan={plan} weeks={projection.weeks} records={weeksQuery.data ?? []} />
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Contas informadas" value={money(projection.totals.contasInformadas)} hint={projection.totals.semanasSemContas > 0 ? `${projection.totals.semanasSemContas} semana(s) com preenchimento pendente` : 'Todas as semanas preenchidas'} />
            <StatCard label="Reinvestimento definido" value={money(projection.totals.reinvestimentoInformado)} hint="Soma dos valores escolhidos por você" />
            <StatCard label="Pares produzidos" value={projection.totals.paresProduzidos.toLocaleString('pt-BR')} hint="Acumulado das semanas já apuradas" />
          </div>
          {orders.length === 0 && entries.length === 0 && <EmptyState size="sm" title="Adicione os pedidos para projetar as entradas" description="As contas e o reinvestimento já podem ser preenchidos. Cadastre entregas, lucro e recebimentos para completar a projeção." action={permission.canCreate && <Button onClick={() => setOrderDialog('new')}>Projetar primeiro pedido</Button>} />}
          <>
            <Card><CardContent className="pt-5"><h3 className="text-base font-semibold">Dinheiro disponível ao fim de cada semana</h3>
              <div className="h-64 mt-4" role="img" aria-label="Gráfico do saldo de caixa no fim de cada semana. Valores completos na tabela abaixo."><ResponsiveContainer width="100%" height="100%"><LineChart data={projection.weeks} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} /><XAxis dataKey="inicio" tickFormatter={dateShort} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} /><YAxis tickFormatter={numberShort} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                <Tooltip labelFormatter={v => `Semana de ${dateShort(String(v))}`} formatter={(v: number) => money(v)} contentStyle={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }} /><Legend />
                <ReferenceLine y={0} stroke="hsl(var(--destructive))" /><ReferenceLine y={plan.reserva_minima} stroke="hsl(var(--warning))" strokeDasharray="5 5" />
                <Line dataKey="saldoFinal" name="Saldo final" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={false} isAnimationActive={false} />
              </LineChart></ResponsiveContainer></div>
              <p className="text-xs text-muted-foreground">Menor saldo do período: <strong>{money(projection.totals.menorSaldo)}</strong>. Para identificar falta de capital, consideramos os pagamentos antes dos recebimentos do mesmo dia. Reserva desejada: {money(plan.reserva_minima)}.</p>
            </CardContent></Card>
            <div className="rounded-lg border border-border overflow-hidden"><Table>
              <TableHeader><TableRow><TableHead>Semana</TableHead><TableHead className="text-right">Saldo inicial</TableHead><TableHead className="text-right">Recebimentos</TableHead><TableHead className="text-right">Materiais</TableHead><TableHead className="text-right">Outras saídas</TableHead><TableHead className="text-right">Aportes</TableHead><TableHead className="text-right">Saldo final</TableHead><TableHead className="text-right">Menor saldo</TableHead><TableHead className="text-right">Lucro entregas</TableHead><TableHead className="text-right">Lucro acumulado</TableHead></TableRow></TableHeader>
              <TableBody>{projection.weeks.map(w => <TableRow key={w.inicio} className={cn(w.menorSaldo < 0 && 'bg-destructive/5')}>
                <TableCell className="whitespace-nowrap font-medium">{dateShort(w.inicio)} a {dateShort(w.fim)}{w.menorSaldo < 0 && <span className="block text-xs text-destructive">Falta de caixa</span>}</TableCell>
                {[w.saldoInicial, w.recebimentos, w.materiais, w.despesas + w.retiradas, w.aportes].map((n, i) => <TableCell key={i} className="text-right tabular-nums whitespace-nowrap">{money(n)}</TableCell>)}
                <TableCell className={cn('text-right tabular-nums whitespace-nowrap font-semibold', w.saldoFinal < 0 && 'text-destructive')}>{money(w.saldoFinal)}</TableCell>
                <TableCell className={cn('text-right tabular-nums whitespace-nowrap', w.menorSaldo < 0 && 'text-destructive')}>{money(w.menorSaldo)}</TableCell>
                <TableCell className="text-right tabular-nums whitespace-nowrap">{money(w.lucro)}</TableCell><TableCell className="text-right tabular-nums whitespace-nowrap font-medium">{money(w.lucroAcumulado)}</TableCell>
              </TableRow>)}</TableBody>
            </Table></div>
            <p className="text-xs text-muted-foreground">Semanas de segunda a domingo, limitadas ao período escolhido. Outras saídas incluem as contas informadas e os lançamentos de despesas/retiradas, sem duplicá-los. O complemento ainda não detalhado é considerado como saída no primeiro dia exibido. O lucro não é somado novamente ao caixa.</p>
          </>
        </TabsContent>

        <TabsContent value="orders"><div className="rounded-lg border border-border"><Table>
          <TableHeader><TableRow><TableHead>Pedido</TableHead><TableHead>Entrega</TableHead><TableHead className="text-right">Resultado previsto</TableHead><TableHead className="text-right">Total a receber</TableHead><TableHead>Situação</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader>
          <TableBody>{orders.length === 0 ? <TableRow><TableCell colSpan={6}><EmptyState size="sm" title="Nenhum pedido projetado" description="Informe quando você vai entregar e quanto espera lucrar." action={permission.canCreate && <Button onClick={() => setOrderDialog('new')}>Projetar pedido</Button>} /></TableCell></TableRow> : orders.map(o => <TableRow key={o.id}>
            <TableCell className="font-medium min-w-48 max-w-80 break-words">{o.descricao}<span className="block text-xs font-normal text-muted-foreground">{o.lucro_liquido ? 'Materiais já descontados do lucro' : 'Materiais descontados pelo CFO'}</span></TableCell>
            <TableCell className="whitespace-nowrap">{safeFormatBR(o.entrega_em)}{(o.entrega_em < plan.data_inicio || o.entrega_em > plan.data_fim) && <span className="block text-xs text-warning">Fora do período</span>}</TableCell>
            <TableCell className="text-right tabular-nums whitespace-nowrap">{money(projection.orderProfits[o.id] ?? 0)}</TableCell><TableCell className="text-right tabular-nums whitespace-nowrap">{o.receita_total === null ? 'Não informado' : money(o.receita_total)}</TableCell>
            <TableCell><Badge variant={o.status === 'cancelado' ? 'secondary' : 'outline'}>{o.status === 'cancelado' ? 'Cancelado' : 'Ativo'}</Badge></TableCell>
            <TableCell><div className="flex justify-end gap-1">
              {permission.canCreate && o.status === 'ativo' && <><Button size="sm" variant="outline" onClick={() => setEntryDialog({ orderId: o.id, type: 'material' })}>Material</Button><Button size="sm" variant="outline" onClick={() => setEntryDialog({ orderId: o.id, type: 'recebimento' })}>Recebimento</Button></>}
              {permission.canEdit && <Button size="icon" variant="ghost" aria-label={`Editar pedido ${o.descricao}`} onClick={() => setOrderDialog(o)}><PencilSimple className="h-4 w-4" /></Button>}
              {permission.canDelete && !entries.some(e => e.pedido_id === o.id) && <Button size="icon" variant="ghost" aria-label={`Excluir pedido ${o.descricao}`} onClick={() => setDeleting({ type: 'order', id: o.id, label: o.descricao })}><Trash className="h-4 w-4" /></Button>}
            </div></TableCell>
          </TableRow>)}</TableBody>
        </Table></div></TabsContent>

        <TabsContent value="entries" className="space-y-3">
          <div className="max-w-xs space-y-1.5"><Label htmlFor="cfo-filter">Exibir lançamentos</Label><Select value={entryFilter} onValueChange={setEntryFilter}><SelectTrigger id="cfo-filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todos">Todos</SelectItem><SelectItem value="previsto">Previstos</SelectItem><SelectItem value="realizado">Realizados</SelectItem><SelectItem value="cancelado">Cancelados</SelectItem></SelectContent></Select></div>
          <div className="rounded-lg border border-border"><Table><TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Descrição / pedido</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Previsto</TableHead><TableHead className="text-right">Realizado</TableHead><TableHead>Situação</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader>
            <TableBody>{selectedEntries.length === 0 ? <TableRow><TableCell colSpan={7}><EmptyState size="sm" title="Nenhum lançamento nesta seleção" description="Programe materiais, recebimentos, despesas, retiradas e aportes." action={permission.canCreate && <Button onClick={() => setEntryDialog({})}>Programar entrada ou saída</Button>} /></TableCell></TableRow> : selectedEntries.map(e => {
              const order = orders.find(o => o.id === e.pedido_id);
              const effectiveDate = e.status === 'realizado' ? e.data_realizada! : e.data_prevista;
              return <TableRow key={e.id}><TableCell className="whitespace-nowrap">{safeFormatBR(effectiveDate)}{e.status === 'realizado' && e.data_realizada !== e.data_prevista && <span className="block text-xs text-muted-foreground">Prev.: {safeFormatBR(e.data_prevista)}</span>}{(effectiveDate < plan.data_inicio || effectiveDate > plan.data_fim) && <span className="block text-xs text-warning">Fora do período</span>}</TableCell>
                <TableCell className="min-w-48 max-w-80 break-words font-medium">{e.descricao}<span className="block text-xs font-normal text-muted-foreground">{order?.descricao ?? 'Sem pedido específico'}</span></TableCell>
                <TableCell className="whitespace-nowrap">{CFO_ENTRY_LABELS[e.tipo]}</TableCell><TableCell className="text-right tabular-nums whitespace-nowrap">{money(e.valor_previsto)}</TableCell><TableCell className="text-right tabular-nums whitespace-nowrap">{e.status === 'realizado' ? money(e.valor_realizado) : '—'}</TableCell>
                <TableCell><Badge variant={e.status === 'realizado' ? 'default' : 'outline'}>{e.status === 'realizado' ? 'Realizado' : e.status === 'cancelado' ? 'Cancelado' : 'Previsto'}</Badge>{e.status === 'previsto' && order?.status === 'cancelado' && <span className="block text-xs text-warning">Pedido cancelado: ignorado</span>}</TableCell>
                <TableCell><div className="flex justify-end gap-1">{permission.canEdit && <Button variant="ghost" size="sm" aria-label={`Editar lançamento ${e.descricao}`} onClick={() => setEntryDialog({ entry: e })}>{e.status === 'previsto' ? 'Registrar / editar' : <PencilSimple className="h-4 w-4" />}</Button>}{permission.canDelete && <Button variant="ghost" size="icon" aria-label={`Excluir lançamento ${e.descricao}`} onClick={() => setDeleting({ type: 'entry', id: e.id, label: e.descricao })}><Trash className="h-4 w-4" /></Button>}</div></TableCell>
              </TableRow>;
            })}</TableBody>
          </Table></div>
          <p className="text-xs text-muted-foreground">Os valores desta lista são os salvos. A simulação afeta apenas os indicadores, o gráfico e a tabela semanal.</p>
        </TabsContent>
      </Tabs>
    </>}

    {planDialog && <CfoPlanDialog plan={planDialog === 'edit' ? plan : undefined} onClose={() => setPlanDialog(null)} onSaved={p => choosePlan(p.id)} />}
    {plan && orderDialog && <CfoOrderDialog plan={plan} order={orderDialog === 'new' ? undefined : orderDialog} onClose={() => setOrderDialog(null)} onSaved={() => setView('orders')} />}
    {plan && entryDialog && <CfoEntryDialog plan={plan} orders={orders} entries={entries} entry={entryDialog.entry} initialOrderId={entryDialog.orderId} initialType={entryDialog.type} onClose={() => setEntryDialog(null)} />}
    <AlertDialog open={!!deleting} onOpenChange={open => { if (!open && !removeOrder.isPending && !removeEntry.isPending) setDeleting(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Excluir do planejamento?</AlertDialogTitle><AlertDialogDescription>“{deleting?.label}” será removido deste plano, recalculando a projeção. Contas e pedidos do sistema não serão alterados.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={removeOrder.isPending || removeEntry.isPending}>Voltar</AlertDialogCancel><AlertDialogAction disabled={removeOrder.isPending || removeEntry.isPending} onClick={event => { event.preventDefault(); void confirmDelete(); }}>Excluir do plano</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}
