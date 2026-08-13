import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { usePersistedState } from '@/hooks/usePersistedState';
import { Plus, PencilSimple as Pencil, Trash as Trash2, CircleNotch as Loader2, Phone, ChatCircle as MessageCircle, CurrencyDollar as DollarSign, Users as Users2, MagnifyingGlass as Search, CheckCircle as CheckCircle2, UserCheck, UserMinus as UserX, Buildings as Building2, CalendarBlank as CalendarDays, Warning as AlertTriangle, Wallet } from '@phosphor-icons/react';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { useCan } from '@/hooks/useAccessControl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
import { toast } from 'sonner';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import { SearchInput } from '@/components/ui/search-input';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { HubTabsList } from '@/components/layout/HubTabs';
import AdvancesPanel from '@/components/hr/AdvancesPanel';
import { useProductionSectors } from '@/hooks/useSectorRoster';

// Folha por hora: o que importa do cadastro é nome, matrícula, salário-referência
// (220h/mês) e contato/PIX. HE/escala/mensalista-diarista foram aposentados (as
// colunas ainda existem no banco, só não são mais editadas aqui).
const emptyEmployee = {
  name: '', cpf: '', external_id: '', role: '', department: '', salary: 0,
  phone: '', whatsapp: '', pix_key: '', pix_type: '', notes: '', active: true,
  admission_date: new Date().toISOString().split('T')[0], termination_date: null as string | null,
};

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

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
    return matchSearch && matchStatus && matchDept;
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
    if (editing) updateEmployee.mutate({ id: editing.id, data: form });
    else addEmployee.mutate(form);
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
      {/* Header local removido — vive no RHHub. Actions ficam aqui em barra própria. */}
      <div className="flex items-center justify-end gap-2 flex-wrap">
        {perm.canCreate && (
        <Button onClick={() => { setForm(emptyEmployee); setEditing(null); setDialogOpen(true); }} className="gap-2" size="sm">
          <Plus className="h-4 w-4" /> Novo Funcionário
        </Button>
        )}
      </div>

      {/* KPI Cards */}
        <StatGrid>
          <StatCard label="Total" value={employees.length} hint="funcionários" icon={Users2} />
          <StatCard
            label="Ativos"
            value={activeEmployees.length}
            hint={`${employees.length - activeEmployees.length} inativos`}
            tone="success"
            icon={UserCheck}
          />
          <StatCard label="Folha Mensal" value={fmt(totalMonthlyPayroll)} hint="salário fixo · ativos" icon={DollarSign} />
          {producaoIds.size > 0 && (
            <StatCard label="Variável (por par)" value={fmt(variavelPorPar)} hint={`${producaoIds.size} por par · mês`} icon={Wallet} />
          )}
        </StatGrid>

        <div className="space-y-3 mt-4">
            {/* Filters */}
            <div className="flex flex-wrap gap-2 items-center">
              <SearchInput
                className="flex-1 min-w-[180px] max-w-xs"
                value={search}
                onChange={setSearch}
                placeholder="Buscar por nome, cargo, depto, ID relógio…"
                resultCount={filteredEmployees.length}
                totalCount={employees.length}
              />
              <div className="flex gap-1 bg-muted rounded-md p-1">
                {(['all', 'active', 'inactive'] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
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
              <span className="text-xs text-muted-foreground ml-1">{filteredEmployees.length} resultado{filteredEmployees.length !== 1 ? 's' : ''}</span>
            </div>

            <Panel flush>
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
                    <TableHead>Admissão</TableHead>
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
                      className={`cursor-pointer hover:bg-muted/50 transition-colors ${!e.active ? 'opacity-60' : ''} ${sel.isSelected(e.id) ? 'bg-primary/5 hover:bg-primary/10' : ''}`}
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
                            <span title={`ID Relógio: ${e.external_id}`} className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
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
                        {e.admission_date
                          ? new Date(e.admission_date + 'T12:00:00').toLocaleDateString('pt-BR')
                          : '—'}
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
                          ? <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-0 text-xs">Ativo</Badge>
                          : <Badge variant="outline" className="text-muted-foreground text-xs">Inativo</Badge>
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
                          {/* Inativar/Reativar em 1 clique: o destino certo quando
                              o funcionário tem ponto/folha no histórico (excluir é
                              bloqueado). Reversível, sem confirmação. */}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => updateEmployee.mutate({ id: e.id, data: { active: !e.active } })}
                            disabled={updateEmployee.isPending}
                            aria-label={e.active ? `Inativar funcionário ${e.name}` : `Reativar funcionário ${e.name}`}
                            title={e.active ? 'Inativar' : 'Reativar'}
                          >
                            {e.active
                              ? <UserX className="h-4 w-4 text-amber-600" />
                              : <UserCheck className="h-4 w-4 text-emerald-600" />}
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{editing ? 'Editar Funcionário' : 'Novo Funcionário'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4 mt-2">
            <div className="col-span-2"><Label>Nome</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
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
                <Input value={form.external_id || ''} onChange={e => setForm(f => ({ ...f, external_id: e.target.value }))} placeholder="Ex: 101" className={form.external_id ? 'pr-10 border-emerald-500 focus-visible:ring-emerald-500' : ''} />
                {form.external_id && (
                  <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-emerald-500" />
                )}
              </div>
              {form.external_id
                ? <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">✓ Vinculado por ID e data de vigência</p>
                : <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Necessário para importar e calcular ponto deste prestador.</p>}
            </div>
            <div><Label>Cargo</Label><Input value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} /></div>
            <div><SectorSelectField value={form.department} onChange={onSectorChange} /></div>
            <div><Label>Admissão</Label><Input type="date" value={form.admission_date} onChange={e => setForm(f => ({ ...f, admission_date: e.target.value }))} /></div>
            <div>
              <Label>Demissão</Label>
              <Input
                type="date"
                value={(form as any).termination_date ?? ''}
                onChange={e => setForm(f => ({ ...f, termination_date: e.target.value || null } as any))}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Último dia trabalhado. Deixe vazio se ainda ativo. Sistema para
                de calcular horas esperadas após essa data no registro de ponto.
              </p>
            </div>

            <div className="col-span-2">
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
            <div className="col-span-2">
              <Label>{(form as any).payment_type === 'diarista' ? 'Salário (referência — não usado no diarista)' : 'Salário (R$)'}</Label>
              <CurrencyInput value={form.salary} onChange={v => setForm(f => ({ ...f, salary: v }))} />
              <p className="text-xs text-muted-foreground mt-1">
                Valor-hora = salário ÷ 220 = <strong className="text-foreground">{fmt(form.salary > 0 ? form.salary / 220 : 0)}/h</strong>;
                valor-dia = salário ÷ 30. Base do atraso/HE/falta do mensalista (e do salário cheio do remoto).
              </p>
            </div>
            )}

            {(form as any).payment_type === 'diarista' && (
              <div className="col-span-2">
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
                  <p className="col-span-2 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" /> Defina o R$/par — sem valor, a folha por par sai R$ 0,00.
                  </p>
                )}
                <p className="col-span-2 text-xs text-muted-foreground">
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
            <div><Label>Telefone</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
            <div><Label>WhatsApp</Label><Input value={form.whatsapp} onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))} /></div>
            <div className="col-span-2"><Label>Chave PIX</Label><Input value={form.pix_key} onChange={e => setForm(f => ({ ...f, pix_key: e.target.value }))} /></div>
            <div className="col-span-2 flex items-center gap-2"><Switch checked={form.active} onCheckedChange={v => setForm(f => ({ ...f, active: v }))} /><Label>Funcionário Ativo</Label></div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave}>Salvar</Button>
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
