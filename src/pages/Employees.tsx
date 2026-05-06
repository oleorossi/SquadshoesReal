import { useState } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { Plus, Pencil, Trash2, Loader2, Phone, MessageCircle, DollarSign, Users2, Search, CheckCircle2, UserCheck, UserX, Building2, CalendarDays, AlertTriangle } from 'lucide-react';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Switch } from '@/components/ui/switch';
import {
  useEmployees, useAddEmployee, useUpdateEmployee, useDeleteEmployee,
  useEmployeeAdvances, useAddAdvance, useDeleteAdvance,
  Employee, EmployeeAdvance,
} from '@/hooks/useEmployees';
import { useWorkSchedules } from '@/hooks/useTimesheet';
import { toast } from 'sonner';
import AppLayout from '@/components/layout/AppLayout';

const emptyEmployee = {
  name: '', external_id: '', role: '', department: '', salary: 0, overtime_hourly_rate: null as number | null,
  work_schedule_id: null as string | null, phone: '', whatsapp: '', pix_key: '', pix_type: '', notes: '', active: true, admission_date: new Date().toISOString().split('T')[0]
};

const emptyAdvance = {
  employee_id: '',
  amount: 0,
  advance_date: new Date().toISOString().split('T')[0],
  time: new Date().toTimeString().split(' ')[0],
  description: '',
  receipt_url: '',
  status: 'pending'
};

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function Employees() {
  const { data: employees = [], isLoading, isError } = useEmployees();
  const { data: advances = [] } = useEmployeeAdvances(null);
  const { data: schedules = [] } = useWorkSchedules();
  const addEmployee = useAddEmployee();
  const updateEmployee = useUpdateEmployee();
  const deleteEmployee = useDeleteEmployee();
  const addAdvance = useAddAdvance();
  const deleteAdvance = useDeleteAdvance();

  const [tab, setTab] = usePersistedState('emp-tab', 'list');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [advanceDialogOpen, setAdvanceDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState(emptyEmployee);
  const [advanceForm, setAdvanceForm] = useState(emptyAdvance);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = usePersistedState<'all' | 'active' | 'inactive'>('emp-status-filter', 'active');
  const [deptFilter, setDeptFilter] = usePersistedState('emp-dept-filter', 'all');

  const departments = Array.from(new Set(employees.map(e => e.department).filter(Boolean))).sort() as string[];

  const filteredEmployees = employees.filter(e => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      e.name.toLowerCase().includes(q) ||
      (e.role || '').toLowerCase().includes(q) ||
      (e.department || '').toLowerCase().includes(q) ||
      (e.external_id || '').toLowerCase().includes(q);
    const matchStatus = statusFilter === 'all' || (statusFilter === 'active' ? e.active : !e.active);
    const matchDept = deptFilter === 'all' || e.department === deptFilter;
    return matchSearch && matchStatus && matchDept;
  });

  const activeEmployees = employees.filter(e => e.active);
  const totalMonthlyPayroll = activeEmployees.reduce((s, e) => s + (e.salary || 0), 0);

  // Advances grouped by employee
  const advancesByEmp = new Map<string, number>();
  advances.forEach(a => {
    advancesByEmp.set(a.employee_id, (advancesByEmp.get(a.employee_id) || 0) + (a.amount ?? 0));
  });
  const totalAdvances = advances.reduce((s, a) => s + (a.amount ?? 0), 0);

  const handleSave = () => {
    if (editing) updateEmployee.mutate({ id: editing.id, data: form });
    else addEmployee.mutate(form);
    setDialogOpen(false);
    setForm(emptyEmployee);
    setEditing(null);
  };

  const handleSaveAdvance = () => {
    addAdvance.mutate(advanceForm);
    setAdvanceDialogOpen(false);
    setAdvanceForm(emptyAdvance);
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
    <AppLayout>
      <div className="space-y-5 page-enter">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Funcionários</h1>
            <p className="text-sm text-muted-foreground">Gestão de equipe e adiantamentos</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => { setForm(emptyEmployee); setEditing(null); setDialogOpen(true); }} className="gap-2">
              <Plus className="h-4 w-4" /> Novo Funcionário
            </Button>
            <Button onClick={() => setAdvanceDialogOpen(true)} variant="outline" className="gap-2">
              <DollarSign className="h-4 w-4" /> Novo Adiantamento
            </Button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="border-0 bg-muted/40">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Users2 className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-wide">Total</span>
              </div>
              <div className="text-2xl font-bold">{employees.length}</div>
              <div className="text-xs text-muted-foreground">funcionários</div>
            </CardContent>
          </Card>
          <Card className="border-0 bg-muted/40">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-emerald-600 mb-1">
                <UserCheck className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-wide">Ativos</span>
              </div>
              <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{activeEmployees.length}</div>
              <div className="text-xs text-muted-foreground">{employees.length - activeEmployees.length} inativos</div>
            </CardContent>
          </Card>
          <Card className="border-0 bg-muted/40">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <DollarSign className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-wide">Folha Mensal</span>
              </div>
              <div className="text-lg font-bold font-mono">{fmt(totalMonthlyPayroll)}</div>
              <div className="text-xs text-muted-foreground">ativos</div>
            </CardContent>
          </Card>
          <Card className="border-0 bg-muted/40">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-amber-600 mb-1">
                <DollarSign className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-wide">Adiantamentos</span>
              </div>
              <div className="text-lg font-bold font-mono text-amber-700 dark:text-amber-400">{fmt(totalAdvances)}</div>
              <div className="text-xs text-muted-foreground">{advances.length} registros</div>
            </CardContent>
          </Card>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="list" className="gap-2"><Users2 className="h-4 w-4" /> Equipe</TabsTrigger>
            <TabsTrigger value="advances" className="gap-2"><DollarSign className="h-4 w-4" /> Adiantamentos</TabsTrigger>
          </TabsList>

          <TabsContent value="list" className="space-y-3 mt-4">
            {/* Filters */}
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[180px] max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Buscar nome, cargo, depto..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
              </div>
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

            <div className="rounded-lg border bg-card overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Nome</TableHead>
                    <TableHead>Cargo / Depto</TableHead>
                    <TableHead>Admissão</TableHead>
                    <TableHead className="text-right">Salário</TableHead>
                    <TableHead className="text-right">R$/hr (CLT)</TableHead>
                    <TableHead className="text-right">Taxa HE</TableHead>
                    <TableHead>Escala</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEmployees.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-10 text-muted-foreground text-sm">Nenhum funcionário encontrado</TableCell>
                    </TableRow>
                  )}
                  {filteredEmployees.map(e => {
                    const hourlyCLT = e.salary > 0 ? e.salary / 220 : null;
                    const schedule = schedules.find(s => s.id === e.work_schedule_id);
                    const defaultSchedule = schedules.find(s => s.is_default);
                    const effectiveSchedule = schedule || defaultSchedule;
                    const computedOTRate = hourlyCLT && effectiveSchedule
                      ? hourlyCLT * effectiveSchedule.overtime_multiplier
                      : null;
                    return (
                    <TableRow
                      key={e.id}
                      className={`cursor-pointer hover:bg-muted/50 transition-colors ${!e.active ? 'opacity-60' : ''}`}
                      onClick={(ev) => { if ((ev.target as HTMLElement).closest('button')) return; setEditing(e); setForm(e); setDialogOpen(true); }}
                    >
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
                      <TableCell className="font-mono text-sm text-right">{fmt(e.salary)}</TableCell>
                      <TableCell className="font-mono text-sm text-right text-muted-foreground">
                        {hourlyCLT != null ? fmt(hourlyCLT) : '—'}
                      </TableCell>
                      <TableCell className="font-mono text-sm text-right">
                        {e.overtime_hourly_rate != null && e.overtime_hourly_rate > 0 ? (
                          <span className="text-amber-700 dark:text-amber-400 font-semibold">{fmt(e.overtime_hourly_rate)}</span>
                        ) : computedOTRate != null ? (
                          <span className="text-muted-foreground text-xs" title={`Auto: salário/220 × ${effectiveSchedule?.overtime_multiplier}x`}>{fmt(computedOTRate)}</span>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell className="text-sm">
                        {schedule
                          ? <Badge variant="secondary" className="text-[10px] gap-1">{schedule.name}</Badge>
                          : defaultSchedule
                          ? <span className="text-xs text-muted-foreground" title="Usando escala padrão">{defaultSchedule.name}</span>
                          : <span className="text-xs text-muted-foreground">—</span>}
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
                          <Button variant="ghost" size="icon" onClick={() => { setEditing(e); setForm(e); setDialogOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                          <DeleteConfirmButton onConfirm={() => deleteEmployee.mutate(e.id)} size="icon" />
                        </div>
                      </TableCell>
                    </TableRow>
                  ); })}
                </TableBody>
              </Table>
            </div>

            {/* Payroll summary for filtered set */}
            {filteredEmployees.length > 0 && (
              <div className="flex justify-end">
                <div className="text-sm text-muted-foreground">
                  Folha filtrada: <span className="font-semibold font-mono text-foreground">{fmt(filteredEmployees.reduce((s, e) => s + (e.salary || 0), 0))}</span>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="advances" className="mt-4 space-y-3">
            <div className="rounded-lg border bg-card overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Data</TableHead>
                    <TableHead>Funcionário</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {advances.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-10 text-muted-foreground text-sm">Nenhum adiantamento registrado</TableCell>
                    </TableRow>
                  )}
                  {advances.map(a => {
                    const emp = employees.find(e => e.id === a.employee_id);
                    return (
                      <TableRow key={a.id}>
                        <TableCell className="text-sm">{new Date(a.advance_date).toLocaleDateString('pt-BR')}</TableCell>
                        <TableCell className="font-medium">{emp?.name || '—'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{a.description || '—'}</TableCell>
                        <TableCell className="text-right font-mono font-semibold">{fmt(a.amount)}</TableCell>
                        <TableCell className="text-right">
                          <DeleteConfirmButton onConfirm={() => deleteAdvance.mutate(a.id)} size="icon" />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {advances.length > 0 && (
                    <TableRow className="bg-muted/30 font-semibold">
                      <TableCell colSpan={3} className="text-sm">Total</TableCell>
                      <TableCell className="text-right font-mono">{fmt(totalAdvances)}</TableCell>
                      <TableCell />
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Per-employee advance summary */}
            {advances.length > 0 && (
              <div className="rounded-lg border bg-card p-4">
                <h3 className="text-sm font-semibold mb-3">Resumo por Funcionário</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {Array.from(advancesByEmp.entries())
                    .sort((a, b) => b[1] - a[1])
                    .map(([empId, total]) => {
                      const emp = employees.find(e => e.id === empId);
                      return (
                        <div key={empId} className="flex justify-between items-center text-sm bg-muted/30 rounded px-3 py-2">
                          <span className="font-medium truncate mr-2">{emp?.name || '—'}</span>
                          <span className="font-mono text-amber-700 dark:text-amber-400 shrink-0">{fmt(total)}</span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
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
              <Label>ID no Relógio (External ID)</Label>
              <div className="relative">
                <Input value={form.external_id || ''} onChange={e => setForm(f => ({ ...f, external_id: e.target.value }))} placeholder="Ex: 101" className={form.external_id ? 'pr-10 border-emerald-500 focus-visible:ring-emerald-500' : ''} />
                {form.external_id && (
                  <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-emerald-500" />
                )}
              </div>
              {form.external_id && <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">✓ Vinculado ao relógio de ponto</p>}
            </div>
            <div><Label>Cargo</Label><Input value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} /></div>
            <div><Label>Departamento</Label><Input value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} /></div>
            <div><Label>Admissão</Label><Input type="date" value={form.admission_date} onChange={e => setForm(f => ({ ...f, admission_date: e.target.value }))} /></div>
            <div><Label>Salário (R$)</Label><CurrencyInput value={form.salary} onChange={v => setForm(f => ({ ...f, salary: v }))} /></div>
            <div>
              <Label>Valor Hora Extra (R$/hr)</Label>
              <CurrencyInput value={form.overtime_hourly_rate ?? 0} onChange={v => setForm(f => ({ ...f, overtime_hourly_rate: v > 0 ? v : null }))} />
              <p className="text-xs text-muted-foreground mt-1">Se vazio, calcula automaticamente pelo salário.</p>
            </div>
            <div>
              <Label>Escala de Trabalho</Label>
              <Select value={form.work_schedule_id || 'none'} onValueChange={v => setForm(f => ({ ...f, work_schedule_id: v === 'none' ? null : v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Padrão do sistema" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Usar escala padrão —</SelectItem>
                  {schedules.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}{s.is_default ? ' (padrão)' : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">Define horários e multiplicadores individuais.</p>
            </div>
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

      {/* Advance Dialog */}
      <Dialog open={advanceDialogOpen} onOpenChange={setAdvanceDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Novo Adiantamento</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div><Label>Funcionário</Label><Select value={advanceForm.employee_id} onValueChange={v => setAdvanceForm(f => ({ ...f, employee_id: v }))}><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger><SelectContent>{employees.filter(e => e.active).map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Valor (R$)</Label><CurrencyInput value={advanceForm.amount} onChange={v => setAdvanceForm(f => ({ ...f, amount: v }))} /></div>
            <div><Label>Data</Label><Input type="date" value={advanceForm.advance_date} onChange={e => setAdvanceForm(f => ({ ...f, advance_date: e.target.value }))} /></div>
            <div><Label>Descrição</Label><Textarea value={advanceForm.description} onChange={e => setAdvanceForm(f => ({ ...f, description: e.target.value }))} /></div>
            <Button onClick={handleSaveAdvance} className="w-full">Registrar Adiantamento</Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
