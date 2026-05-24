import { useMemo, useState } from 'react';
import {
  Warning as AlertTriangle, Clock, CheckCircle, Funnel, X, Calendar,
  Users, Pencil,
} from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { cn } from '@/lib/utils';
import {
  useTimePendings, type TimePending, type Urgency,
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
  absent:       'Faltou',
  holiday:      'Feriado',
  weekend:      'Fim de semana',
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

  // Filtros
  const [employeeFilter, setEmployeeFilter] = useState<string>('all');
  const [urgencyFilter, setUrgencyFilter] = useState<string>('all');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');

  // Dialog
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
      return true;
    });
  }, [pendings, employeeFilter, urgencyFilter, departmentFilter]);

  // KPIs
  const summary = useMemo(() => {
    const overdue = pendings.filter((p) => p.urgency === 'overdue').length;
    const aging = pendings.filter((p) => p.urgency === 'aging').length;
    const fresh = pendings.filter((p) => p.urgency === 'fresh').length;
    const distinctEmployees = new Set(pendings.map((p) => p.employee_id).filter(Boolean)).size;
    return { overdue, aging, fresh, distinctEmployees };
  }, [pendings]);

  const hasFilters = employeeFilter !== 'all' || urgencyFilter !== 'all' || departmentFilter !== 'all';
  const clearFilters = () => {
    setEmployeeFilter('all');
    setUrgencyFilter('all');
    setDepartmentFilter('all');
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
            ? `Dias com batidas faltando, inconsistentes ou irregulares — a partir de ${formatCutoffBR(cutoff)} (registros anteriores ignorados). Completar aqui recalcula automaticamente o banco de horas.`
            : 'Dias com batidas faltando, inconsistentes ou irregulares. Completar aqui recalcula automaticamente o banco de horas do funcionário.'
        }
      />

      <StatGrid>
        <StatCard
          label="Atrasados (+7 dias)"
          value={summary.overdue}
          icon={AlertTriangle}
          tone={summary.overdue > 0 ? 'destructive' : 'default'}
          hint="urgente — pode virar falta"
        />
        <StatCard
          label="Em maturação (4–7d)"
          value={summary.aging}
          icon={Clock}
          tone={summary.aging > 0 ? 'warning' : 'default'}
          hint="prioridade média"
        />
        <StatCard
          label="Recentes (0–3d)"
          value={summary.fresh}
          icon={CheckCircle}
          hint="tempo hábil"
        />
        <StatCard
          label="Funcionários afetados"
          value={summary.distinctEmployees}
          icon={Users}
          hint="distintos com pendências"
        />
      </StatGrid>

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
                  <TableHead>Funcionário</TableHead>
                  <TableHead>Setor</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Batidas</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Urgência</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((p) => {
                  const u = URGENCY_STYLE[p.urgency];
                  return (
                    <TableRow
                      key={p.id}
                      className="hover:bg-muted/30 cursor-pointer"
                      onClick={() => setEditing(p)}
                    >
                      <TableCell className="text-xs font-medium">{p.employee_name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{p.department || '—'}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        <Calendar className="inline h-3 w-3 mr-1 text-muted-foreground" />
                        {formatDateBR(p.record_date)}
                        <span className="text-muted-foreground"> · {dowName(p.dow)}</span>
                      </TableCell>
                      <TableCell className="text-xs font-mono">
                        {p.punches.length === 0 ? (
                          <span className="text-muted-foreground italic">vazio</span>
                        ) : (
                          p.punches.join(' · ')
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {STATUS_LABEL[p.day_summary?.status] || p.day_summary?.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn('text-xs', u.cls)}>
                          {u.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline" size="sm" className="h-7 text-xs gap-1"
                          onClick={(e) => { e.stopPropagation(); setEditing(p); }}
                        >
                          <Pencil className="h-3 w-3" /> Completar
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
    </div>
  );
}
