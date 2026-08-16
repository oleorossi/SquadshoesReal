import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { usePersistedState } from '@/hooks/usePersistedState';
import { Plus, PencilSimple as Pencil, Trash as Trash2, CircleNotch as Loader2, Phone, ChatCircle as MessageCircle, CurrencyDollar as DollarSign, Users as Users2, MagnifyingGlass as Search, CheckCircle as CheckCircle2, UserCheck, UserMinus as UserX, Buildings as Building2, Warning as AlertTriangle, Wallet, ClockCounterClockwise as History, ArrowRight } from '@phosphor-icons/react';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { useCan } from '@/hooks/useAccessControl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SectorSelectField } from '@/components/hr/SectorSelectField';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { BulkActionsBar } from '@/components/ui/bulk-actions-bar';
import { useMarqueeSelection } from '@/hooks/useMarqueeSelection';
import { confirmAndBulkDelete } from '@/lib/bulkConfirm';
import {
  useEmployees, useAddEmployee, useUpdateEmployee, useDeleteEmployee,
  Employee,
} from '@/hooks/useEmployees';
import { useMontadorProducao } from '@/hooks/useMontadorProducao';
import { MONTHLY_HOURS_DIVISOR } from '@/lib/hourlyPayroll';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import { SearchInput } from '@/components/ui/search-input';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { HubTabsList } from '@/components/layout/HubTabs';
import AdvancesPanel from '@/components/hr/AdvancesPanel';
import { useProductionSectors } from '@/hooks/useSectorRoster';
import { normalizeEmployeeEmploymentState } from '@/lib/employeeEmployment';

// Folha por hora: o que importa do cadastro é nome, matrícula, salário-referência
// (220h/mês) e contato/PIX. HE/escala/mensalista-diarista foram aposentados (as
// colunas ainda existem no banco, só não são mais editadas aqui).
const emptyEmployee = {
  name: '', cpf: '', external_id: '', role: '', department: '', salary: 0,
  phone: '', whatsapp: '', pix_key: '', pix_type: '', notes: '', active: true,
  admission_date: new Date().toISOString().split('T')[0], termination_date: null as string | null,
};

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (date?: string | null) => date
  ? new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR')
  : '—';

export default function Employees() {
  const { data: employees = [], isLoading, isError } = useEmployees();
  const addEmployee = useAddEmployee();
  const updateEmployee = useUpdateEmployee();
  const deleteEmployee = useDeleteEmployee();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  // Gates de ação da área RH/Pessoas (/rh). Admin e sem-granular sempre passam.
  const perm = useCan('/rh');
  const [form, setForm] = useState(emptyEmployee);
  // Aceita ?q= na URL — a busca global navega pra cá com ?q=<termo>.
  // ?q= REATIVO: o ⌘K navega pra /rh?tab=funcionarios&q=<nome> e a página não
  // remonta quando já se está no RH (AppLayout keia só por pathname).
  const [searchParams] = useSearchParams();
  const urlQ = searchParams.get('q') || '';
  const [search, setSearch] = useState(urlQ);
  useEffect(() => { if (urlQ) setSearch(urlQ); }, [urlQ]);
  const [statusFilter, setStatusFilter] = usePersistedState<'all' | 'active' | 'inactive'>('emp-status-filter', 'active');
  const [deptFilter, setDeptFilter] = usePersistedState('emp-dept-filter', 'all');
  const [paymentFilter, setPaymentFilter] = usePersistedState('emp-payment-filter', 'all');
  const [setupFilter, setSetupFilter] = usePersistedState('emp-setup-filter', 'all');
  // Sub-abas da página Funcionários: cadastro + Adiantamentos (movido da Folha em 2026-06-28).
  const [subTab, setSubTab] = usePersistedState('rh-func-subtab', 'funcionarios');

  // Filtra null/undefined/'' E strings só com whitespace — Radix Select
  // crasha se algum SelectItem.value for string vazia ou só espaços.
  const departments = Array.from(
    new Set(
      employees
        .map(e => (e.department || '').trim())
        .filter(d => d.length > 0)
    )
  ).sort() as string[];

  // Setores que pagam POR PAR (sector_settings.pays_by_pair) — hoje Montagem e
  // Solagem. Marcar o setor evita o passo que todo mundo esquecia: escolher
  // "Montagem" e sair sem trocar o regime, salvando um montador mensalista com
  // campos de hora extra e nenhum R$/par. Foi assim que os 3 montadores ficaram
  // com R$/par 0,00 em 33 lançamentos.
  const { data: prodSectors = [] } = useProductionSectors();
  const setorPagaPorPar = (label: string) =>
    prodSectors.some(s => s.label === label && s.paysByPair);
  /** Setor separa médio/difícil? (sector_settings.pays_by_difficulty). A Solagem
   *  não separa — mostrar "R$/par difícil" lá cria um campo que ninguém preenche
   *  e que, se um par difícil for lançado, valora a produção em R$ 0,00 calado.
   *  Setor desconhecido cai em `true` pra nunca esconder campo por falha de
   *  leitura da view. */
  const setorSeparaDificuldade = (label: string) =>
    !prodSectors.some(s => s.label === label && !s.paysByDifficulty);

  /** Trocar pra um setor por par já coloca o funcionário no regime certo — o que
   *  troca hora extra por R$/par no formulário. O select de regime continua
   *  visível e editável: quem for exceção (um mensalista dentro da Montagem)
   *  desmarca na mão e os campos voltam ao normal. */
  const onSectorChange = (v: string) => setForm(f => {
    const next: typeof f & { payment_type?: string } = { ...f, department: v };
    if (setorPagaPorPar(v) && next.payment_type !== 'producao') next.payment_type = 'producao';
    return next;
  });

  const filteredEmployees = employees.filter(e => {
    const matchSearch = searchMatchesAllTerms(search, e.name, e.role, e.department, e.external_id, e.phone, e.whatsapp);
    const matchStatus = statusFilter === 'all' || (statusFilter === 'active' ? e.active : !e.active);
    const matchDept = deptFilter === 'all' || e.department === deptFilter;
    const matchPayment = paymentFilter === 'all' || e.payment_type === paymentFilter;
    const needsClock = (e.payment_type === 'mensalista' || e.payment_type === 'diarista') && !String(e.external_id || '').trim();
    const needsSchedule = (e.payment_type === 'mensalista' || e.payment_type === 'diarista') && !e.work_schedule_id;
    const matchSetup = setupFilter === 'all'
      || (setupFilter === 'clock' && needsClock)
      || (setupFilter === 'schedule' && needsSchedule)
      || (setupFilter === 'ready' && !needsClock && !needsSchedule);
    return matchSearch && matchStatus && matchDept && matchPayment && matchSetup;
  });

  const sel = useMarqueeSelection(filteredEmployees, (e) => e.id);
  const handleBulkDeleteEmployees = async () => {
    const ids = Array.from(sel.selectedIds);
    const sampleLines = filteredEmployees
      .filter(e => sel.selectedIds.has(e.id))
      .slice(0, 5)
      .map(e => `• ${e.name}${e.role ? ` (${e.role})` : ''}`);
    await confirmAndBulkDelete({
      ids,
      entityLabel: 'funcionário',
      sampleLines,
      deleteOne: (id) => deleteEmployee.mutateAsync(id),
      onAfter: () => sel.clear(),
    });
  };

  const activeEmployees = employees.filter(e => e.active);
  const peopleSetupPending = activeEmployees.filter(e =>
    (e.payment_type === 'mensalista' || e.payment_type === 'diarista')
    && (!String(e.external_id || '').trim() || !e.work_schedule_id),
  ).length;
  // Folha mensal FIXA = só salários (mensalista/remoto/diarista). Quem é por par
  // (payment_type='producao') é variável — não tem salário fixo, sai daqui.
  const totalMonthlyPayroll = activeEmployees
    .filter(e => (e as any).payment_type !== 'producao')
    .reduce((s, e) => s + (e.salary || 0), 0);
  // Variável (por par) do MÊS corrente = Σ pares × R$/par dos funcionários por par.
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const mesFrom = `${ym}-01`;
  const mesTo = `${ym}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;
  const producaoIds = new Set(activeEmployees.filter(e => (e as any).payment_type === 'producao').map(e => e.id));
  const { data: prodMap } = useMontadorProducao(mesFrom, mesTo, producaoIds.size > 0);
  const variavelPorPar = producaoIds.size
    ? Array.from(prodMap?.entries() || []).filter(([id]) => producaoIds.has(id)).reduce((s, [, v]) => s + v.bruto, 0)
    : 0;
  const inactiveEmployees = employees.length - activeEmployees.length;
  const activeRatio = employees.length > 0 ? Math.round((activeEmployees.length / employees.length) * 100) : 0;

  const handleToggleEmployeeStatus = (employee: Employee) => {
    if (!employee.active && employee.termination_date) {
      const ok = confirm(
        `Reativar ${employee.name}?\n\nA data de demissão (${fmtDate(employee.termination_date)}) será removida para abrir um novo vínculo ativo.`,
      );
      if (!ok) return;
      updateEmployee.mutate({ id: employee.id, data: { active: true, termination_date: null } });
      return;
    }
    updateEmployee.mutate({ id: employee.id, data: { active: !employee.active } });
  };

  const handleSave = () => {
    // A3 da auditoria 2026-05-28: warn em demissão retroativa.
    // Marcar termination_date no passado pode quebrar cálculo de saldo de
    // funcionários que já tiveram batidas importadas após essa data.
    if (editing && form.termination_date && form.termination_date !== editing.termination_date) {
      const termDate = new Date(form.termination_date + 'T00:00:00');
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (termDate < today) {
        const days = Math.ceil((today.getTime() - termDate.getTime()) / 86400000);
        const ok = confirm(
          `⚠️ Demissão retroativa: ${days} dia(s) atrás.\n\n` +
          `Atenção: batidas de ponto importadas DEPOIS de ${form.termination_date} ` +
          `serão ignoradas no saldo (que agora usa termination_date como limite).\n\n` +
          `Confirme se a data está correta. Recomendado: fechar período/folha ANTES ` +
          `de marcar demissão retroativa.\n\nProsseguir?`
        );
        if (!ok) return;
      }
    }
    const payload = normalizeEmployeeEmploymentState(form);
    if (editing) updateEmployee.mutate({ id: editing.id, data: payload });
    else addEmployee.mutate(payload);
    setDialogOpen(false);
    setForm(emptyEmployee);
    setEditing(null);
  };

  if (isLoading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

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
    <>
    <div className="space-y-4 page-enter">
      <Tabs value={subTab} onValueChange={setSubTab} className="w-full">
        <HubTabsList tabs={[
          { value: 'funcionarios', label: 'Funcionários', icon: Users2 },
          { value: 'adiantamentos', label: 'Adiantamentos', icon: Wallet },
        ]} />
        <TabsContent value="funcionarios" className="space-y-4 mt-4">
      <div className="flex flex-col gap-3 border-b-2 border-foreground pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">PESSOAS · REGISTRO FUNCIONAL</p>
          <h2 className="mt-1 text-xl font-bold tracking-tight">Quadro e vínculos</h2>
          <p className="mt-1 text-sm text-muted-foreground">Cadastro, vigência no relógio de ponto e remuneração em uma única ficha.</p>
        </div>
        {perm.canCreate && (
        <Button id="novo-funcionario" onClick={() => { setForm(emptyEmployee); setEditing(null); setDialogOpen(true); }} className="gap-2 shrink-0" size="sm">
          <Plus className="h-4 w-4" /> Novo Funcionário
        </Button>
        )}
      </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="grid grid-cols-2 xl:grid-cols-[1.35fr_repeat(4,minmax(0,1fr))]">
            <div className="col-span-2 flex min-h-36 flex-col justify-between bg-foreground p-5 text-background xl:col-span-1">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-background/65">Quadro em operação</span>
                <UserCheck className="h-5 w-5 text-background/70" />
              </div>
              <div className="mt-5 flex items-end justify-between gap-4">
                <div>
                  <span className="ed-display text-5xl leading-none">{activeEmployees.length}</span>
                  <p className="mt-2 text-xs text-background/70">ativos de {employees.length} cadastros</p>
                </div>
                <span className="font-mono text-sm tabular-nums text-background/80">{activeRatio}%</span>
              </div>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-background/20" aria-label={`${activeRatio}% do quadro ativo`}>
                <div className="h-full rounded-full bg-background" style={{ width: `${activeRatio}%` }} />
              </div>
            </div>

            <div className="flex min-h-28 flex-col justify-between border-t border-border p-4 xl:border-l xl:border-t-0">
              <div className="flex items-center justify-between gap-2"><span className="eyebrow">Folha fixa</span><DollarSign className="h-4 w-4 text-muted-foreground" /></div>
              <div><p className="ed-display text-2xl leading-none">{fmt(totalMonthlyPayroll)}</p><p className="mt-2 text-xs text-muted-foreground">salários dos vínculos ativos</p></div>
            </div>
            <div className="flex min-h-28 flex-col justify-between border-l border-t border-border p-4 xl:border-t-0">
              <div className="flex items-center justify-between gap-2"><span className="eyebrow">Produção do mês</span><Wallet className="h-4 w-4 text-muted-foreground" /></div>
              <div><p className="ed-display text-2xl leading-none">{fmt(variavelPorPar)}</p><p className="mt-2 text-xs text-muted-foreground">{producaoIds.size} pagos por par</p></div>
            </div>
            <div className="flex min-h-28 flex-col justify-between border-t border-border p-4 xl:border-l xl:border-t-0">
              <div className="flex items-center justify-between gap-2"><span className="eyebrow">A concluir</span><AlertTriangle className="h-4 w-4 text-warning" /></div>
              <div><p className="ed-display text-3xl leading-none text-warning">{peopleSetupPending}</p><p className="mt-2 text-xs text-muted-foreground">sem matrícula ou jornada</p></div>
            </div>
            <div className="flex min-h-28 flex-col justify-between border-l border-t border-border p-4 xl:border-t-0">
              <div className="flex items-center justify-between gap-2"><span className="eyebrow">Histórico</span><History className="h-4 w-4 text-muted-foreground" /></div>
              <div><p className="ed-display text-3xl leading-none">{inactiveEmployees}</p><p className="mt-2 text-xs text-muted-foreground">inativos preservados</p></div>
            </div>
          </div>
        </div>

        <div className="space-y-3 mt-4">
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
              <SearchInput
                className="min-w-[220px] flex-1 lg:max-w-md"
                value={search}
                onChange={setSearch}
                placeholder="Buscar por nome, cargo, depto, ID relógio…"
                resultCount={filteredEmployees.length}
                totalCount={employees.length}
              />
              <div className="flex gap-1 bg-muted rounded-md p-1">
                {(['all', 'active', 'inactive'] as const).map(s => (
                  <button
                    type="button"
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    aria-pressed={statusFilter === s}
                    className={`px-3 py-1 rounded text-xs font-medium transition-colors ${statusFilter === s ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {s === 'all' ? 'Todos' : s === 'active' ? 'Ativos' : 'Inativos'}
                  </button>
                ))}
              </div>
              {departments.length > 0 && (
                <Select value={deptFilter} onValueChange={setDeptFilter}>
                  <SelectTrigger className="w-[160px] h-8 text-xs">
                    <Building2 className="h-3 w-3 mr-1" />
                    <SelectValue placeholder="Departamento" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os deptos</SelectItem>
                    {departments.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <Select value={paymentFilter} onValueChange={setPaymentFilter}>
                <SelectTrigger className="w-[145px] h-8 text-xs"><SelectValue placeholder="Regime" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os regimes</SelectItem>
                  <SelectItem value="mensalista">Mensalista</SelectItem>
                  <SelectItem value="diarista">Diarista</SelectItem>
                  <SelectItem value="producao">Por par</SelectItem>
                  <SelectItem value="remoto">Remoto</SelectItem>
                </SelectContent>
              </Select>
              <Select value={setupFilter} onValueChange={setSetupFilter}>
                <SelectTrigger className="w-[170px] h-8 text-xs"><SelectValue placeholder="Cadastro" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Cadastro: todos</SelectItem>
                  <SelectItem value="ready">Cadastro completo</SelectItem>
                  <SelectItem value="clock">Sem matrícula do relógio</SelectItem>
                  <SelectItem value="schedule">Sem jornada</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground ml-1">{filteredEmployees.length} resultado{filteredEmployees.length !== 1 ? 's' : ''}</span>
            </div>

            <Panel
              flush
              eyebrow="CADASTRO · VIGÊNCIA · REMUNERAÇÃO"
              title="Diretório de funcionários"
              subtitle="Clique em uma linha para abrir a ficha completa. Desligados continuam disponíveis no histórico."
              actions={<Badge variant="outline" className="font-mono tabular-nums">{filteredEmployees.length} registros</Badge>}
            >
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                    <TableHead className="w-8">
                      <Checkbox
                        checked={filteredEmployees.length > 0 && filteredEmployees.every(e => sel.isSelected(e.id))}
                        onCheckedChange={(v) => filteredEmployees.forEach(e => { if (!!v !== sel.isSelected(e.id)) sel.toggle(e.id); })}
                        aria-label="Selecionar todos"
                      />
                    </TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Cargo / Depto</TableHead>
                    <TableHead>Vínculo</TableHead>
                    <TableHead className="text-right">Salário</TableHead>
                    <TableHead className="text-right">Valor-hora</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Contato</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEmployees.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="p-0">
                        <EmptyState
                          icon={search ? Search : Users2}
                          title={search ? `Nenhum resultado para "${search}"` : 'Nenhum funcionário encontrado'}
                          description="Ajuste os filtros ou cadastre um novo funcionário."
                          action={search ? <Button variant="outline" size="sm" onClick={() => setSearch('')}>Limpar busca</Button> : undefined}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                  {filteredEmployees.map(e => {
                    const valorHora = e.salary > 0 ? e.salary / MONTHLY_HOURS_DIVISOR : null;
                    return (
                    <TableRow
                      key={e.id}
                      className={`cursor-pointer transition-colors hover:bg-muted/50 ${!e.active ? 'border-l-2 border-l-muted-foreground/30 bg-muted/20' : 'border-l-2 border-l-success/50'} ${sel.isSelected(e.id) ? 'bg-primary/5 hover:bg-primary/10' : ''}`}
                      onClick={(ev) => { if ((ev.target as HTMLElement).closest('button,[role="checkbox"]')) return; setEditing(e); setForm(e); setDialogOpen(true); }}
                    >
                      <TableCell onClick={(ev) => ev.stopPropagation()}>
                        <Checkbox
                          checked={sel.isSelected(e.id)}
                          onCheckedChange={() => sel.toggle(e.id)}
                          aria-label={`Selecionar ${e.name}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <span>{e.name}</span>
                          {e.external_id && (
                            <span title={`ID Relógio: ${e.external_id}`} className="inline-flex items-center gap-1 text-xs text-success">
                              <CheckCircle2 className="h-3.5 w-3.5" /> {e.external_id}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{e.role || '—'}</div>
                        {e.department && <div className="text-xs text-muted-foreground">{e.department}</div>}
                      </TableCell>
                      <TableCell className="text-sm">
                        <div className="font-mono text-xs tabular-nums">
                          {fmtDate(e.admission_date)}
                          {e.termination_date && <span className="text-muted-foreground"> → {fmtDate(e.termination_date)}</span>}
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {e.termination_date ? 'último dia trabalhado registrado' : 'vínculo em aberto'}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm text-right">
                        {(e as any).payment_type === 'producao'
                          ? <span className="font-sans text-xs text-muted-foreground">por par</span>
                          : fmt(e.salary)}
                      </TableCell>
                      <TableCell className="font-mono text-sm text-right text-muted-foreground">
                        {valorHora != null ? `${fmt(valorHora)}/h` : '—'}
                      </TableCell>
                      <TableCell>
                        {e.active
                          ? <Badge className="border-0 bg-success/15 text-xs text-success">Ativo</Badge>
                          : <Badge variant="outline" className="text-muted-foreground text-xs">{e.termination_date ? 'Desligado' : 'Inativo'}</Badge>
                        }
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {e.phone && <Badge variant="outline" className="gap-1 text-xs"><Phone className="h-3 w-3" /> {e.phone}</Badge>}
                          {e.whatsapp && <Badge variant="outline" className="gap-1 text-xs"><MessageCircle className="h-3 w-3" /> {e.whatsapp}</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => { setEditing(e); setForm(e); setDialogOpen(true); }} aria-label={`Editar funcionário ${e.name}`}><Pencil className="h-4 w-4" /></Button>
                          {/* Inativar preserva o histórico. Reabrir vínculo encerrado
                              remove a data de demissão somente após confirmação. */}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleToggleEmployeeStatus(e)}
                            disabled={updateEmployee.isPending}
                            aria-label={e.active ? `Inativar funcionário ${e.name}` : `Reativar funcionário ${e.name}`}
                            title={e.active ? 'Inativar' : e.termination_date ? 'Reabrir vínculo' : 'Reativar'}
                          >
                            {e.active
                              ? <UserX className="h-4 w-4 text-warning" />
                              : <UserCheck className="h-4 w-4 text-success" />}
                          </Button>
                          {perm.canDelete && <DeleteConfirmButton onConfirm={() => deleteEmployee.mutate(e.id)} size="icon" />}
                        </div>
                      </TableCell>
                    </TableRow>
                  ); })}
                </TableBody>
              </Table>
            </Panel>

            {/* Payroll summary for filtered set */}
            {filteredEmployees.length > 0 && (
              <div className="flex justify-end">
                <div className="text-sm text-muted-foreground">
                  Folha filtrada: <span className="font-semibold font-mono text-foreground">{fmt(filteredEmployees.reduce((s, e) => s + (e.salary || 0), 0))}</span>
                </div>
              </div>
            )}
        </div>
        </TabsContent>
        <TabsContent value="adiantamentos" className="mt-4">
          <AdvancesPanel />
        </TabsContent>
      </Tabs>
      </div>

      {/* Employee Form Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="gap-0 p-0 sm:max-w-3xl">
          <DialogHeader className="border-b border-border px-5 pb-4 pt-5 pr-14 sm:px-6 sm:pt-6">
            <p className="eyebrow">RH · FICHA FUNCIONAL</p>
            <DialogTitle>{editing ? 'Editar funcionário' : 'Novo funcionário'}</DialogTitle>
            <DialogDescription>Identificação, vigência no ponto e remuneração do colaborador.</DialogDescription>
          </DialogHeader>

          <div className="border-b border-border bg-muted/30 px-5 py-4 sm:px-6">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center">
              <div className="flex items-center gap-3">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${form.admission_date ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'}`}>
                  <CheckCircle2 className="h-4 w-4" weight="fill" />
                </span>
                <div><p className="eyebrow">Admissão</p><p className="mt-1 font-mono text-xs tabular-nums">{fmtDate(form.admission_date)}</p></div>
              </div>
              <ArrowRight className="hidden h-4 w-4 text-muted-foreground sm:block" />
              <div className="flex items-center gap-3">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${form.termination_date ? 'bg-muted text-muted-foreground' : 'bg-success text-success-foreground'}`}>
                  <UserCheck className="h-4 w-4" weight="fill" />
                </span>
                <div><p className="eyebrow">Atividade</p><p className="mt-1 text-xs font-semibold">{form.termination_date ? 'Encerrada' : form.active ? 'Em atividade' : 'Inativo'}</p></div>
              </div>
              <ArrowRight className="hidden h-4 w-4 text-muted-foreground sm:block" />
              <div className="flex items-center gap-3">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${form.termination_date ? 'bg-destructive text-destructive-foreground' : 'bg-muted text-muted-foreground'}`}>
                  <UserX className="h-4 w-4" weight="fill" />
                </span>
                <div><p className="eyebrow">Demissão</p><p className="mt-1 font-mono text-xs tabular-nums">{fmtDate(form.termination_date)}</p></div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 sm:p-6">
            <div className="section-label border-b border-border pb-2 sm:col-span-2">01 · Identificação e relógio</div>
            <div className="sm:col-span-2"><Label>Nome</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div>
              <Label>CPF</Label>
              <Input
                value={(() => {
                  // Máscara visual XXX.XXX.XXX-XX (PR 2026-05-28 LGPD).
                  // Storage continua só dígitos; display formatado pra evitar
                  // PII em screenshots/print de tela.
                  const d = (form.cpf || '').replace(/\D/g, '');
                  if (d.length <= 3) return d;
                  if (d.length <= 6) return `${d.slice(0,3)}.${d.slice(3)}`;
                  if (d.length <= 9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`;
                  return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9,11)}`;
                })()}
                onChange={e => setForm(f => ({ ...f, cpf: e.target.value.replace(/\D/g, '').slice(0, 11) }))}
                placeholder="000.000.000-00"
                className="font-mono"
                maxLength={14}
              />
              <p className="text-xs text-muted-foreground mt-0.5">Usado apenas para identificação interna quando necessário.</p>
            </div>
            <div>
              <Label>ID do relógio de ponto</Label>
              <div className="relative">
                <Input value={form.external_id || ''} onChange={e => setForm(f => ({ ...f, external_id: e.target.value }))} placeholder="Ex: 101" className={form.external_id ? 'border-success pr-10 focus-visible:ring-success' : ''} />
                {form.external_id && (
                  <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-success" />
                )}
              </div>
              {form.external_id
                ? <p className="mt-1 text-xs text-success">✓ Vinculado por ID e data de vigência</p>
                : <p className="mt-1 text-xs text-warning">Necessário para importar e calcular ponto deste prestador.</p>}
            </div>
            <div className="section-label mt-2 border-b border-border pb-2 sm:col-span-2">02 · Vínculo de trabalho</div>
            <div><Label>Cargo</Label><Input value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} /></div>
            <div><SectorSelectField value={form.department} onChange={onSectorChange} /></div>
            <div><Label>Admissão</Label><Input type="date" value={form.admission_date} onChange={e => setForm(f => ({ ...f, admission_date: e.target.value }))} /></div>
            <div>
              <Label>Demissão</Label>
              <Input
                type="date"
                value={(form as any).termination_date ?? ''}
                onChange={e => setForm(f => ({
                  ...f,
                  termination_date: e.target.value || null,
                  active: e.target.value ? false : f.active,
                } as any))}
              />
              <p className={`mt-1 text-xs ${form.termination_date ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
                {form.termination_date
                  ? `Ao salvar, o cadastro será inativado. Relatórios posteriores não incluem o funcionário; o histórico fica preservado até ${fmtDate(form.termination_date)}.`
                  : 'Último dia trabalhado. Deixe vazio enquanto o vínculo estiver em aberto.'}
              </p>
            </div>

            <div className="section-label mt-2 border-b border-border pb-2 sm:col-span-2">03 · Regime e remuneração</div>
            <div className="sm:col-span-2">
              <Label>Regime de pagamento</Label>
              <Select value={(form as any).payment_type || 'mensalista'} onValueChange={v => setForm(f => ({ ...f, payment_type: v } as any))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mensalista">Mensalista — salário, desconta ponto</SelectItem>
                  <SelectItem value="remoto">Remoto — salário cheio, não bate ponto</SelectItem>
                  <SelectItem value="diarista">Diarista — paga por dia trabalhado</SelectItem>
                  <SelectItem value="producao">Por par — paga por par produzido (Ficha de Montadores)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {(form as any).payment_type === 'remoto'
                  ? 'Recebe o salário cheio do período — o ponto não desconta falta/atraso nem paga hora extra.'
                  : (form as any).payment_type === 'diarista'
                  ? 'Paga a diária × dias com batida no período. Sem salário mensal nem desconto de falta.'
                  : (form as any).payment_type === 'producao'
                  ? 'Paga por par produzido (Ficha de Montadores), valorado por dificuldade. Ignora salário e ponto — o relógio serve só de presença. Líquido = pares × R$/par − adiantamentos.'
                  : 'Salário do mês − faltas/atrasos + hora extra, contados por dia (sem compensar entre dias).'}
              </p>
            </div>

            {(form as any).payment_type !== 'producao' && (
            <div className="sm:col-span-2">
              <Label>{(form as any).payment_type === 'diarista' ? 'Salário (referência — não usado no diarista)' : 'Salário (R$)'}</Label>
              <CurrencyInput value={form.salary} onChange={v => setForm(f => ({ ...f, salary: v }))} />
              <p className="text-xs text-muted-foreground mt-1">
                Valor-hora = salário ÷ 220 = <strong className="text-foreground">{fmt(form.salary > 0 ? form.salary / 220 : 0)}/h</strong>;
                valor-dia = salário ÷ 30. Base do atraso/HE/falta do mensalista (e do salário cheio do remoto).
              </p>
            </div>
            )}

            {(form as any).payment_type === 'diarista' && (
              <div className="sm:col-span-2">
                <Label>Valor da diária (R$/dia)</Label>
                <CurrencyInput value={(form as any).daily_rate || 0} onChange={v => setForm(f => ({ ...f, daily_rate: v } as any))} />
                <p className="text-xs text-muted-foreground mt-1">Pagamento = diária × nº de dias com batida no período.</p>
              </div>
            )}

            {(form as any).payment_type === 'producao' && (
              <>
                <div>
                  <Label>{setorSeparaDificuldade(form.department) ? 'R$/par — dificuldade média' : 'R$/par'}</Label>
                  <CurrencyInput value={(form as any).valor_par_medio || 0} onChange={v => setForm(f => ({ ...f, valor_par_medio: v } as any))} />
                </div>
                {setorSeparaDificuldade(form.department) && (
                  <div>
                    <Label>R$/par — dificuldade difícil</Label>
                    <CurrencyInput value={(form as any).valor_par_dificil || 0} onChange={v => setForm(f => ({ ...f, valor_par_dificil: v } as any))} />
                  </div>
                )}
                {(!((form as any).valor_par_medio > 0) && !((form as any).valor_par_dificil > 0)) && (
                  <p className="flex items-center gap-1 text-xs text-warning sm:col-span-2">
                    <AlertTriangle className="h-3.5 w-3.5" /> Defina o R$/par — sem valor, a folha por par sai R$ 0,00.
                  </p>
                )}
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  {setorPagaPorPar(form.department)
                    ? `${form.department} é setor pago por par, então o regime já veio marcado. `
                    : ''}
                  {!setorSeparaDificuldade(form.department)
                    ? `${form.department} paga taxa única — não separa médio e difícil. `
                    : ''}
                  Cada apontamento na Ficha de Montadores guarda o valor da época (congelado). Reajustar aqui não altera folhas passadas.
                </p>
              </>
            )}

            {/* HE por funcionário — valor ABSOLUTO em R$/h (negociação individual, não-CLT).
                Só mensalista faz hora extra descontada/paga; remoto, diarista e por par não usam. */}
            {(form as any).payment_type !== 'diarista' && (form as any).payment_type !== 'remoto' && (form as any).payment_type !== 'producao' && (
              <>
                <div>
                  <Label>Hora extra (R$/h)</Label>
                  <CurrencyInput value={(form as any).he_normal_rate || 0} onChange={v => setForm(f => ({ ...f, he_normal_rate: v } as any))} />
                  <p className="text-xs text-muted-foreground mt-1">Dia útil, sábado e noturno. Valor negociado — não sai do salário.</p>
                </div>
                <div>
                  <Label>Hora extra domingo/feriado (R$/h)</Label>
                  <CurrencyInput value={(form as any).he_sunday_holiday_rate || 0} onChange={v => setForm(f => ({ ...f, he_sunday_holiday_rate: v } as any))} />
                  <p className="text-xs text-muted-foreground mt-1">Vazio = usa o mesmo valor da HE normal.</p>
                </div>
              </>
            )}
            <div className="section-label mt-2 border-b border-border pb-2 sm:col-span-2">04 · Contato e situação atual</div>
            <div><Label>Telefone</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
            <div><Label>WhatsApp</Label><Input value={form.whatsapp} onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))} /></div>
            <div className="sm:col-span-2"><Label>Chave PIX</Label><Input value={form.pix_key} onChange={e => setForm(f => ({ ...f, pix_key: e.target.value }))} /></div>
            <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/30 p-3 sm:col-span-2">
              <div>
                <Label htmlFor="employee-active">Vínculo ativo</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  {form.termination_date
                    ? 'Bloqueado pela demissão. Limpe a data antes de reabrir o vínculo.'
                    : 'Funcionários inativos deixam as rotinas atuais, mas o histórico permanece consultável.'}
                </p>
              </div>
              <Switch
                id="employee-active"
                checked={form.active && !form.termination_date}
                disabled={!!form.termination_date}
                onCheckedChange={v => setForm(f => ({ ...f, active: v }))}
              />
            </div>
          </div>
          <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-background px-5 py-4 sm:px-6">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button data-dialog-primary="true" onClick={handleSave} disabled={addEmployee.isPending || updateEmployee.isPending}>
              {(addEmployee.isPending || updateEmployee.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar ficha
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <BulkActionsBar
        selectedIds={sel.selectedIds}
        onClear={sel.clear}
        itemLabel={sel.selectedIds.size === 1 ? 'funcionário' : 'funcionários'}
        actions={[
          {
            label: 'Excluir',
            variant: 'destructive',
            icon: <Trash2 className="h-3.5 w-3.5" />,
            onClick: handleBulkDeleteEmployees,
          },
        ]}
      />
    </>
  );
}
