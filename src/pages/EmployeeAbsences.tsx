import { useMemo, useState } from 'react';
import {
  Calendar, Plus, Trash, Users, UmbrellaSimple as Vacation, FirstAid, Info,
  Funnel, X,
} from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { cn } from '@/lib/utils';
import { useEmployees } from '@/hooks/useEmployees';
import {
  useEmployeeAbsences, useCreateAbsence, useDeleteAbsence,
  ABSENCE_LABEL, type AbsenceKind,
} from '@/hooks/useEmployeeAbsences';

const todayISO = () => new Date().toISOString().slice(0, 10);

function formatDateBR(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date((iso.length === 10 ? iso + 'T00:00:00' : iso));
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('pt-BR');
}

function daysBetween(a: string, b: string): number {
  const d1 = new Date(a + 'T00:00:00');
  const d2 = new Date(b + 'T00:00:00');
  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return 0;
  return Math.round((d2.getTime() - d1.getTime()) / 86_400_000) + 1;
}

const KIND_STYLE: Record<string, string> = {
  ferias:              'bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-400',
  atestado:            'bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-400',
  licenca:             'bg-blue-500/10 text-blue-700 border-blue-500/30 dark:text-blue-400',
  folga_compensatoria: 'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400',
  suspensao:           'bg-purple-500/10 text-purple-700 border-purple-500/30 dark:text-purple-400',
  outro:               'bg-muted text-muted-foreground border-border',
};

export default function EmployeeAbsencesPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { data: absences = [], isLoading, isError, error } = useEmployeeAbsences();
  const { data: employees = [] } = useEmployees();
  const createAbsence = useCreateAbsence();
  const deleteAbsence = useDeleteAbsence();

  // Filtros
  const [employeeFilter, setEmployeeFilter] = useState<string>('all');
  const [kindFilter, setKindFilter] = useState<string>('all');
  const [showActive, setShowActive] = useState<string>('all');

  // Dialog criar
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    employee_id: '',
    start_date: todayISO(),
    end_date: todayISO(),
    absence_type: 'ferias' as AbsenceKind,
    notes: '',
  });

  const resetForm = () => setForm({
    employee_id: '', start_date: todayISO(), end_date: todayISO(),
    absence_type: 'ferias', notes: '',
  });

  // Filtrados
  const filtered = useMemo(() => {
    return absences.filter((a) => {
      if (employeeFilter !== 'all' && a.employee_id !== employeeFilter) return false;
      if (kindFilter !== 'all' && a.absence_type !== kindFilter) return false;
      if (showActive !== 'all') {
        const today = todayISO();
        const isActive = a.start_date <= today && a.end_date >= today;
        if (showActive === 'active' && !isActive) return false;
        if (showActive === 'past' && isActive) return false;
      }
      return true;
    });
  }, [absences, employeeFilter, kindFilter, showActive]);

  // KPIs
  const summary = useMemo(() => {
    const today = todayISO();
    const active = absences.filter((a) => a.start_date <= today && a.end_date >= today).length;
    const upcoming = absences.filter((a) => a.start_date > today).length;
    const totalDays = absences.reduce((s, a) => s + daysBetween(a.start_date, a.end_date), 0);
    const employeesAffected = new Set(absences.map((a) => a.employee_id)).size;
    return { active, upcoming, totalDays, employeesAffected };
  }, [absences]);

  const handleCreate = async () => {
    try {
      await createAbsence.mutateAsync({
        employee_id: form.employee_id,
        start_date: form.start_date,
        end_date: form.end_date,
        absence_type: form.absence_type,
        notes: form.notes,
      });
      resetForm();
      setCreateOpen(false);
    } catch {
      // O hook mantém o diálogo aberto e apresenta a mensagem específica no toast.
    }
  };

  const handleDelete = (id: string, label: string) => {
    if (!confirm(`Remover ausência "${label}"?\n\nOs dias voltam a contar no desconto de falta/atraso da folha.`)) return;
    deleteAbsence.mutate(id);
  };

  const canSubmit = form.employee_id && form.start_date && form.end_date && form.end_date >= form.start_date;
  const previewDays = form.start_date && form.end_date ? daysBetween(form.start_date, form.end_date) : 0;

  const hasFilters = employeeFilter !== 'all' || kindFilter !== 'all' || showActive !== 'all';
  const clearFilters = () => {
    setEmployeeFilter('all'); setKindFilter('all'); setShowActive('all');
  };

  if (isLoading) {
    return <div className="py-12 text-center text-muted-foreground text-sm">Carregando ausências...</div>;
  }

  if (isError) {
    return (
      <EmptyState
        icon={FirstAid}
        title="Não foi possível carregar as justificativas"
        description={error instanceof Error ? error.message : 'Atualize a página e tente novamente.'}
      />
    );
  }

  return (
    <div className="space-y-5 page-enter">
      {/* Quando embutida na aba Ponto do RHHub (embedded), esconde o próprio header
          pra não duplicar com o header do hub. Standalone (/rh/ausencias) mostra. */}
      {!embedded && (
      <EditorialPageHeader
        sectionLabel="RH · PONTO · AUSÊNCIAS"
        title="Justificativas de ausência"
        description="Férias, atestados, licenças e folgas de dia inteiro. Os períodos cadastrados deixam de gerar desconto na folha."
        actions={
          <Button size="sm" className="h-9 gap-1.5" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Nova justificativa
          </Button>
        }
      />
      )}
      {embedded && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
            Justifique ausências de <strong className="text-foreground">dia inteiro</strong>. Para completar uma batida ou corrigir um atraso parcial, use a etapa <strong className="text-foreground">Corrigir</strong>.
          </p>
          <Button size="sm" className="h-9 gap-1.5" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Nova justificativa
          </Button>
        </div>
      )}

      <StatGrid>
        <StatCard
          label="Justificativas ativas"
          value={summary.active}
          icon={Vacation}
          tone={summary.active > 0 ? 'warning' : 'default'}
          hint="cobrindo a data atual"
        />
        <StatCard
          label="Agendadas (futuras)"
          value={summary.upcoming}
          icon={Calendar}
          hint="ainda não começaram"
        />
        <StatCard
          label="Dias abonados"
          value={summary.totalDays}
          icon={FirstAid}
          hint="soma de todas as ausências"
        />
        <StatCard
          label="Pessoas justificadas"
          value={summary.employeesAffected}
          icon={Users}
          hint="com pelo menos 1 ausência"
        />
      </StatGrid>

      <Panel
        title="Justificativas registradas"
        subtitle={hasFilters
          ? `Filtrado: ${filtered.length} de ${absences.length}`
          : `${absences.length} ${absences.length === 1 ? 'registro' : 'registros'}`}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Funnel className="h-4 w-4 text-muted-foreground" />
            <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
              <SelectTrigger className="h-9 w-[200px] text-xs">
                <SelectValue placeholder="Funcionário" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os funcionários</SelectItem>
                {employees.map((e: any) => (
                  <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={kindFilter} onValueChange={setKindFilter}>
              <SelectTrigger className="h-9 w-[180px] text-xs">
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os tipos</SelectItem>
                {Object.entries(ABSENCE_LABEL).map(([k, l]) => (
                  <SelectItem key={k} value={k}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={showActive} onValueChange={setShowActive}>
              <SelectTrigger className="h-9 w-[140px] text-xs">
                <SelectValue placeholder="Período" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="active">Ativas hoje</SelectItem>
                <SelectItem value="past">Encerradas</SelectItem>
              </SelectContent>
            </Select>
            {hasFilters && (
              <Button variant="ghost" size="sm" className="h-9 text-xs gap-1 text-muted-foreground" onClick={clearFilters}>
                <X className="h-3.5 w-3.5" /> Limpar
              </Button>
            )}
          </div>
        }
        flush
      >
        {filtered.length === 0 ? (
          <EmptyState
            icon={Vacation}
            title={hasFilters ? 'Nenhuma justificativa com esses filtros' : 'Nenhuma justificativa cadastrada'}
            description={hasFilters
              ? 'Limpe os filtros pra ver todas.'
              : 'Cadastre férias, atestados ou folgas para abonar os dias correspondentes na folha.'}
            action={!hasFilters ? (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Nova justificativa
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={clearFilters}>Limpar filtros</Button>
            )}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                <TableHead>Funcionário</TableHead>
                <TableHead>Setor</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Início</TableHead>
                <TableHead>Fim</TableHead>
                <TableHead className="text-right">Dias</TableHead>
                <TableHead>Observações</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((a) => {
                const today = todayISO();
                const isActive = a.start_date <= today && a.end_date >= today;
                const isFuture = a.start_date > today;
                const days = daysBetween(a.start_date, a.end_date);
                return (
                  <TableRow key={a.id} className="hover:bg-muted/30">
                    <TableCell className="text-xs font-medium">
                      {a.employees?.name || a.employee_id.slice(0, 8)}
                      {isActive && (
                        <Badge variant="outline" className="ml-2 h-4 text-[10px] bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400">
                          ativa
                        </Badge>
                      )}
                      {isFuture && (
                        <Badge variant="outline" className="ml-2 h-4 text-[10px] bg-blue-500/10 text-blue-700 border-blue-500/30 dark:text-blue-400">
                          futura
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {a.employees?.department || '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn('text-xs', KIND_STYLE[a.absence_type] || KIND_STYLE.outro)}>
                        {ABSENCE_LABEL[a.absence_type] || a.absence_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{formatDateBR(a.start_date)}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{formatDateBR(a.end_date)}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{days}</TableCell>
                    <TableCell className="text-xs max-w-[220px] truncate" title={a.notes || ''}>
                      {a.notes || <span className="text-muted-foreground italic">—</span>}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        onClick={() => handleDelete(
                          a.id,
                          `${a.employees?.name || '—'} · ${ABSENCE_LABEL[a.absence_type]} ${formatDateBR(a.start_date)}–${formatDateBR(a.end_date)}`
                        )}
                        aria-label="Remover ausência"
                      >
                        <Trash className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Panel>

      {/* Dialog criar */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!createAbsence.isPending) { setCreateOpen(o); if (!o) resetForm(); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Vacation className="h-5 w-5 text-primary" />
              Nova justificativa
            </DialogTitle>
            <DialogDescription>
              O período selecionado será abonado integralmente no cálculo da folha.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Funcionário *</Label>
              <Select value={form.employee_id} onValueChange={(v) => setForm({ ...form, employee_id: v })}>
                <SelectTrigger className="mt-1 h-9 text-sm">
                  <SelectValue placeholder="Selecione…" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((e: any) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name} {e.department && <span className="text-muted-foreground">· {e.department}</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Tipo *</Label>
              <Select value={form.absence_type} onValueChange={(v) => setForm({ ...form, absence_type: v as AbsenceKind })}>
                <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ABSENCE_LABEL).map(([k, l]) => (
                    <SelectItem key={k} value={k}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Início *</Label>
                <Input
                  type="date" value={form.start_date}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                  className="mt-1 h-9 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Fim *</Label>
                <Input
                  type="date" value={form.end_date} min={form.start_date}
                  onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                  className="mt-1 h-9 text-sm"
                />
              </div>
            </div>
            {previewDays > 0 && (
              <div className="text-xs text-muted-foreground flex items-center gap-1.5 px-1">
                <Info className="h-3 w-3" />
                <strong className="text-foreground">{previewDays}</strong>{' '}
                {previewDays === 1 ? 'dia' : 'dias'} ficarão isentos do desconto da folha.
              </div>
            )}
            <div>
              <Label className="text-xs">Observações</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Ex.: nº do atestado, motivo, autorização do médico, etc."
                rows={2}
                className="mt-1 text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); resetForm(); }} disabled={createAbsence.isPending}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={!canSubmit || createAbsence.isPending}>
              {createAbsence.isPending ? 'Salvando...' : 'Cadastrar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
