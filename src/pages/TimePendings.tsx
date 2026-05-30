import { useMemo, useState } from 'react';
import {
  Warning as AlertTriangle, Clock, CheckCircle, Funnel, X, Calendar,
  Users, Pencil, Lightning,
} from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/ui/empty-state';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { cn } from '@/lib/utils';
import {
  useTimePendings, useBulkApplySuggestions, isAutoResolvable,
  type TimePending, type Urgency,
} from '@/hooks/useTimePendings';
import { CompletePunchesDialog } from '@/components/rh/CompletePunchesDialog';
import { useBankHoursCutoff, formatCutoffBR } from '@/hooks/useBankHoursCutoff';

const URGENCY_STYLE: Record<Urgency, { label: string; cls: string }> = {
  overdue: { label: '+7 dias',  cls: 'bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-400' },
  aging:   { label: '4–7 dias', cls: 'bg-amber-500/15 text-amber-700 border-amber-500/40 dark:text-amber-400' },
  fresh:   { label: '0–3 dias', cls: 'bg-muted text-muted-foreground border-border' },
};

const STATUS_LABEL: Record<string, string> = {
  inconsistent: 'Batidas inconsistentes',
  irregular:    'Irregular',
  partial:      'Parcial',
  normal:       'Normal',
  overtime:     'Hora extra',
  late:         'Atraso',
  absent:       'Faltou',
  holiday:      'Feriado',
  weekend:      'Fim de semana',
};

const STATUS_TONE: Record<string, string> = {
  inconsistent: 'bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-400',
  irregular:    'bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-400',
  partial:      'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400',
  late:         'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400',
  absent:       'bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-400',
  overtime:     'bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-400',
  normal:       'bg-muted text-muted-foreground border-border',
  holiday:      'bg-muted text-muted-foreground border-border',
  weekend:      'bg-muted text-muted-foreground border-border',
};

const CONFIDENCE_STYLE: Record<string, string> = {
  high:   'bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-400',
  medium: 'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400',
  low:    'bg-muted text-muted-foreground border-border',
  none:   'bg-muted text-muted-foreground border-border',
};

function formatDateBR(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function dowName(dow: number): string {
  return ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'][dow - 1] || '—';
}

export default function TimePendingsPage() {
  const { data: pendings = [], isLoading } = useTimePendings({ onlyProblems: true });
  const { data: cutoff } = useBankHoursCutoff();
  const bulkApply = useBulkApplySuggestions();

  // Filtros
  const [employeeFilter, setEmployeeFilter] = useState<string>('all');
  const [urgencyFilter, setUrgencyFilter] = useState<string>('all');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');
  const [resolvableFilter, setResolvableFilter] = useState<string>('all');

  // Seleção bulk
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [bulkReason, setBulkReason] = useState('Completado em lote via padrão observado do funcionário.');

  // Dialog single
  const [editing, setEditing] = useState<TimePending | null>(null);

  // Listas distintas
  const employees = useMemo(() => {
    const map = new Map<string, string>();
    pendings.forEach((p) => { if (p.employee_id) map.set(p.employee_id, p.employee_name); });
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [pendings]);

  const departments = useMemo(() => {
    return [...new Set(pendings.map((p) => p.department).filter(Boolean) as string[])].sort();
  }, [pendings]);

  // Pendings filtrados
  const filtered = useMemo(() => {
    return pendings.filter((p) => {
      if (employeeFilter !== 'all' && p.employee_id !== employeeFilter) return false;
      if (urgencyFilter !== 'all' && p.urgency !== urgencyFilter) return false;
      if (departmentFilter !== 'all' && p.department !== departmentFilter) return false;
      if (resolvableFilter === 'resolvable' && !isAutoResolvable(p)) return false;
      if (resolvableFilter === 'manual' && isAutoResolvable(p)) return false;
      return true;
    });
  }, [pendings, employeeFilter, urgencyFilter, departmentFilter, resolvableFilter]);

  // KPIs
  const summary = useMemo(() => {
    const overdue = pendings.filter((p) => p.urgency === 'overdue').length;
    const distinctEmployees = new Set(pendings.map((p) => p.employee_id).filter(Boolean)).size;
    const resolvable = pendings.filter(isAutoResolvable).length;
    const empty = pendings.filter((p) => p.punches.length === 0).length;
    return { overdue, distinctEmployees, resolvable, empty };
  }, [pendings]);

  // Helpers seleção
  const selectedItems = useMemo(
    () => filtered.filter((p) => selectedIds.has(p.id) && isAutoResolvable(p)),
    [filtered, selectedIds],
  );
  const resolvableVisible = useMemo(() => filtered.filter(isAutoResolvable), [filtered]);
  const allResolvableSelected = resolvableVisible.length > 0
    && resolvableVisible.every((p) => selectedIds.has(p.id));

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAllResolvable = () => {
    setSelectedIds((prev) => {
      if (allResolvableSelected) {
        const next = new Set(prev);
        resolvableVisible.forEach((p) => next.delete(p.id));
        return next;
      }
      const next = new Set(prev);
      resolvableVisible.forEach((p) => next.add(p.id));
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());

  const hasFilters = employeeFilter !== 'all' || urgencyFilter !== 'all'
    || departmentFilter !== 'all' || resolvableFilter !== 'all';
  const clearFilters = () => {
    setEmployeeFilter('all');
    setUrgencyFilter('all');
    setDepartmentFilter('all');
    setResolvableFilter('all');
  };

  const handleBulkApply = async () => {
    const items = selectedItems.map((p) => ({
      timeRecordId: p.id,
      punches: p.suggestion!.suggested,
    }));
    if (items.length === 0 || bulkReason.trim().length < 4) return;
    await bulkApply.mutateAsync({ items, reason: bulkReason.trim() });
    setSelectedIds(new Set());
    setConfirmOpen(false);
  };

  if (isLoading) {
    return <div className="py-12 text-center text-muted-foreground text-sm">Carregando pendências...</div>;
  }

  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="RH · PONTO · PENDÊNCIAS"
        title="Pendências de Ponto"
        description={
          cutoff
            ? `Dias com batidas faltando, inconsistentes ou irregulares — a partir de ${formatCutoffBR(cutoff)} (registros anteriores ignorados). O sistema agora sugere completar baseado no padrão observado do funcionário.`
            : 'Dias com batidas faltando, inconsistentes ou irregulares. O sistema sugere completar baseado no padrão observado do funcionário.'
        }
      />

      <StatGrid>
        <StatCard
          label="Resolvíveis em 1 clique"
          value={summary.resolvable}
          icon={Lightning}
          tone={summary.resolvable > 0 ? 'success' : 'default'}
          hint="padrão do funcionário cobre"
        />
        <StatCard
          label="Atrasados (+7 dias)"
          value={summary.overdue}
          icon={AlertTriangle}
          tone={summary.overdue > 0 ? 'destructive' : 'default'}
          hint="urgente — pode virar falta"
        />
        <StatCard
          label="Dias vazios"
          value={summary.empty}
          icon={Clock}
          tone={summary.empty > 0 ? 'warning' : 'default'}
          hint="ver se é ausência"
        />
        <StatCard
          label="Funcionários afetados"
          value={summary.distinctEmployees}
          icon={Users}
          hint="distintos com pendências"
        />
      </StatGrid>

      {/* ─── Barra de seleção bulk ─── */}
      {selectedItems.length > 0 && (
        <div className="rounded-md border border-primary/30 bg-primary/5 px-4 py-2.5 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 text-sm">
            <Lightning className="h-4 w-4 text-primary" />
            <strong className="text-foreground">{selectedItems.length}</strong>
            <span className="text-muted-foreground">
              {selectedItems.length === 1 ? 'pendência selecionada' : 'pendências selecionadas'} — todas resolvíveis pelo padrão
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearSelection}>
              <X className="h-3.5 w-3.5 mr-1" /> Limpar seleção
            </Button>
            <Button size="sm" className="h-8 text-xs gap-1" onClick={() => setConfirmOpen(true)}>
              <Lightning className="h-3.5 w-3.5" />
              Aplicar padrão nas {selectedItems.length}
            </Button>
          </div>
        </div>
      )}

      <Panel
        title="Dias problemáticos (últimos 90 dias úteis)"
        subtitle={
          hasFilters
            ? `Filtrado: ${filtered.length} de ${pendings.length}`
            : `${pendings.length} ${pendings.length === 1 ? 'pendência' : 'pendências'}`
        }
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Funnel className="h-4 w-4 text-muted-foreground" />
            <Select value={resolvableFilter} onValueChange={setResolvableFilter}>
              <SelectTrigger className="h-9 w-[170px] text-xs">
                <SelectValue placeholder="Resolvível?" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="resolvable">Resolvíveis (padrão)</SelectItem>
                <SelectItem value="manual">Só manuais</SelectItem>
              </SelectContent>
            </Select>
            <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
              <SelectTrigger className="h-9 w-[200px] text-xs">
                <SelectValue placeholder="Funcionário" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os funcionários</SelectItem>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
              <SelectTrigger className="h-9 w-[150px] text-xs">
                <SelectValue placeholder="Setor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os setores</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={urgencyFilter} onValueChange={setUrgencyFilter}>
              <SelectTrigger className="h-9 w-[140px] text-xs">
                <SelectValue placeholder="Urgência" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="overdue">Atrasados (+7d)</SelectItem>
                <SelectItem value="aging">Em maturação</SelectItem>
                <SelectItem value="fresh">Recentes</SelectItem>
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
            icon={CheckCircle}
            title={hasFilters ? 'Nenhuma pendência com esses filtros' : 'Sem pendências'}
            description={hasFilters ? 'Limpe os filtros pra ver todas.' : 'Todo mundo bateu certinho — beleza! Volte amanhã.'}
            action={hasFilters ? (
              <Button variant="outline" size="sm" onClick={clearFilters}>Limpar filtros</Button>
            ) : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allResolvableSelected && resolvableVisible.length > 0}
                      onCheckedChange={toggleAllResolvable}
                      disabled={resolvableVisible.length === 0}
                      aria-label="Selecionar todas resolvíveis"
                    />
                  </TableHead>
                  <TableHead>Funcionário</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Atual</TableHead>
                  <TableHead>Sugestão</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Urgência</TableHead>
                  <TableHead className="w-28"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((p) => {
                  const u = URGENCY_STYLE[p.urgency];
                  const resolvable = isAutoResolvable(p);
                  const s = p.suggestion;
                  return (
                    <TableRow
                      key={p.id}
                      className={cn(
                        'hover:bg-muted/30',
                        selectedIds.has(p.id) && 'bg-primary/5',
                      )}
                    >
                      <TableCell className="w-10">
                        <Checkbox
                          checked={selectedIds.has(p.id)}
                          onCheckedChange={() => toggleOne(p.id)}
                          disabled={!resolvable}
                          aria-label={`Selecionar ${p.employee_name} em ${p.record_date}`}
                        />
                      </TableCell>
                      <TableCell className="text-xs font-medium cursor-pointer" onClick={() => setEditing(p)}>
                        <div>{p.employee_name}</div>
                        {p.department && (
                          <div className="text-[10px] text-muted-foreground font-normal">{p.department}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap cursor-pointer" onClick={() => setEditing(p)}>
                        <Calendar className="inline h-3 w-3 mr-1 text-muted-foreground" />
                        {formatDateBR(p.record_date)}
                        <span className="text-muted-foreground"> · {dowName(p.dow)}</span>
                      </TableCell>
                      <TableCell className="text-xs font-mono tabular-nums cursor-pointer" onClick={() => setEditing(p)}>
                        {p.punches.length === 0 ? (
                          <span className="text-muted-foreground italic">vazio</span>
                        ) : (
                          p.punches.join(' · ')
                        )}
                      </TableCell>
                      <TableCell className="text-xs font-mono tabular-nums cursor-pointer" onClick={() => setEditing(p)}>
                        {s && s.source !== 'none' && s.suggested.length === 4 ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-foreground">{s.suggested.join(' · ')}</span>
                            <div className="flex items-center gap-1">
                              <Badge variant="outline" className={cn('text-[9px] uppercase h-4 px-1', CONFIDENCE_STYLE[s.confidence])}>
                                {s.source === 'observed' ? `obs ${s.observed_days}d` : 'oficial'}
                              </Badge>
                              {s.is_absent_covered && (
                                <Badge variant="outline" className="text-[9px] uppercase h-4 px-1 bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-400">
                                  ausência
                                </Badge>
                              )}
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground italic text-[10px]">—</span>
                        )}
                      </TableCell>
                      <TableCell className="cursor-pointer" onClick={() => setEditing(p)}>
                        <Badge
                          variant="outline"
                          className={cn('text-[10px] uppercase', STATUS_TONE[p.day_summary?.status])}
                        >
                          {STATUS_LABEL[p.day_summary?.status] || p.day_summary?.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="cursor-pointer" onClick={() => setEditing(p)}>
                        <Badge variant="outline" className={cn('text-xs', u.cls)}>
                          {u.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant={resolvable ? 'default' : 'outline'}
                          size="sm"
                          className="h-7 text-xs gap-1"
                          onClick={(e) => { e.stopPropagation(); setEditing(p); }}
                        >
                          {resolvable ? <Lightning className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
                          {resolvable ? 'Aplicar' : 'Completar'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      <CompletePunchesDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        pending={editing}
      />

      {/* ─── Confirmação bulk apply ─── */}
      <AlertDialog open={confirmOpen} onOpenChange={(o) => !bulkApply.isPending && setConfirmOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Lightning className="h-5 w-5 text-primary" />
              Aplicar padrão em {selectedItems.length} {selectedItems.length === 1 ? 'pendência' : 'pendências'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Cada pendência receberá as batidas sugeridas (que <strong>preservam</strong> o que o funcionário
                  realmente bateu e preenchem só os buracos com base no padrão observado dele).
                </p>
                <div className="rounded-md border border-border bg-muted/30 p-3 text-xs max-h-40 overflow-y-auto space-y-1">
                  {selectedItems.slice(0, 12).map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-2 font-mono">
                      <span className="text-muted-foreground truncate">
                        {p.employee_name} · {formatDateBR(p.record_date)}
                      </span>
                      <span className="text-foreground shrink-0">{p.suggestion!.suggested.join(' · ')}</span>
                    </div>
                  ))}
                  {selectedItems.length > 12 && (
                    <div className="text-muted-foreground text-center pt-1">
                      ... e mais {selectedItems.length - 12}
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-xs font-medium text-foreground">Justificativa (mínimo 4 caracteres)</label>
                  <Textarea
                    value={bulkReason}
                    onChange={(e) => setBulkReason(e.target.value)}
                    rows={2}
                    className="mt-1 text-sm"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkApply.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkApply.isPending || bulkReason.trim().length < 4}
              onClick={handleBulkApply}
            >
              {bulkApply.isPending
                ? `Aplicando ${selectedItems.length}...`
                : `Aplicar ${selectedItems.length}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
