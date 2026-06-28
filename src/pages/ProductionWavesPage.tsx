import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Play, Package, MagnifyingGlass as Search, Funnel as Filter, Stack as Layers, CalendarBlank as CalendarDays, Users, Warning as AlertTriangle, CaretDown as ChevronDown, CaretRight as ChevronRight, XCircle, Eye, Truck, ClipboardText as ClipboardList, Factory, CheckCircle as CheckCircle2, Clock } from '@phosphor-icons/react';
import { getISOWeekFromString, fmtDayMonthBR } from '@/lib/isoWeek';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { WaveBuilder } from '@/components/production/WaveBuilder';
import { WaveDetailPanel } from '@/components/production/WaveDetailPanel';
import {
  useWaves, useStartWave, useCancelWave, useWaveDetail, useWaveOrders,
} from '@/hooks/useProductionWaves';
import {
  STAGE_LABEL, STAGE_ORDER, WAVE_STATUS_LABEL,
  type ProductionWave, type WaveStatus,
} from '@/types/production-waves';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { normalizeForSearch } from '@/lib/searchUtils';

type StatusFilter = 'all' | WaveStatus;

const STATUS_VARIANT: Record<WaveStatus, { className: string; icon: React.ElementType }> = {
  draft:     { className: 'bg-muted text-muted-foreground border-border',          icon: ClipboardList },
  planning:  { className: 'bg-amber-500/10 text-amber-600 border-amber-500/30',    icon: Clock },
  running:   { className: 'bg-primary/10 text-primary border-primary/30',          icon: Factory },
  finished:  { className: 'bg-green-500/10 text-green-600 border-green-500/30',    icon: CheckCircle2 },
  cancelled: { className: 'bg-red-500/10 text-red-600 border-red-500/30',          icon: XCircle },
};

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function formatDateLong(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function StatusBadge({ status }: { status: WaveStatus }) {
  const cfg = STATUS_VARIANT[status];
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={`gap-1 ${cfg.className}`}>
      <Icon className="w-3 h-3" />
      {WAVE_STATUS_LABEL[status]}
    </Badge>
  );
}

function ExpandedWaveRow({ waveId }: { waveId: string }) {
  const { data: detail, isLoading: loadingDetail } = useWaveDetail(waveId);
  const { data: orders = [], isLoading: loadingOrders } = useWaveOrders(waveId);

  return (
    <TableRow className="bg-muted/30 hover:bg-muted/30">
      <TableCell colSpan={10} className="p-0">
        <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Pedidos vinculados */}
          <div className="space-y-2">
            <div className="text-xs font-bold uppercase text-muted-foreground flex items-center gap-1">
              <Users className="w-3 h-3" />
              Pedidos vinculados ({orders.length})
            </div>
            <div className="border rounded-lg bg-card overflow-hidden">
              {loadingOrders ? (
                <Skeleton className="h-32" />
              ) : orders.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground text-center">
                  Nenhum pedido vinculado.
                </div>
              ) : (
                // Grid-based em vez de <Table> pra evitar warning React
                // "validateDOMNesting <tr> in <tr>" (esta lista vive dentro
                // de uma <TableCell> da tabela principal de ondas).
                <div className="text-xs">
                  <div className="grid grid-cols-[1fr_2fr_60px_80px] gap-x-3 px-3 py-2 bg-muted/40 font-bold uppercase tracking-wider text-muted-foreground border-b border-border">
                    <span>Pedido</span>
                    <span>Cliente</span>
                    <span className="text-right">Pares</span>
                    <span>Entrega</span>
                  </div>
                  {orders.map((o) => (
                    <div
                      key={o.sale_order_id ?? Math.random()}
                      className="grid grid-cols-[1fr_2fr_60px_80px] gap-x-3 px-3 py-2 border-b border-border/40 last:border-0 hover:bg-muted/30"
                    >
                      <span className="font-mono">
                        {o.sale_order_id ? (
                          <Link to={`/pedidos/${o.sale_order_id}`} className="text-primary hover:underline">
                            {o.order_number ?? '—'}
                          </Link>
                        ) : (
                          o.order_number ?? '—'
                        )}
                      </span>
                      <span className="truncate">{o.client_fantasy || o.client_name || '—'}</span>
                      <span className="text-right tabular-nums">{Number(o.total_pairs).toLocaleString('pt-BR')}</span>
                      <span>{formatDate(o.delivery_deadline)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Itens agrupados (solado/ref/cor) */}
          <div className="space-y-2">
            <div className="text-xs font-bold uppercase text-muted-foreground flex items-center gap-1">
              <Layers className="w-3 h-3" />
              Itens agrupados ({detail?.items?.length ?? 0})
            </div>
            <div className="border rounded-lg bg-card overflow-hidden">
              {loadingDetail ? (
                <Skeleton className="h-32" />
              ) : !detail?.items?.length ? (
                <div className="p-4 text-sm text-muted-foreground text-center">
                  Sem itens.
                </div>
              ) : (
                // Mesma razão da grid acima: evita warning de tr-in-tr.
                <div className="text-xs">
                  <div className="grid grid-cols-[1.2fr_1.5fr_1fr_60px] gap-x-3 px-3 py-2 bg-muted/40 font-bold uppercase tracking-wider text-muted-foreground border-b border-border">
                    <span>Solado</span>
                    <span>Referência</span>
                    <span>Cor</span>
                    <span className="text-right">Pares</span>
                  </div>
                  {detail.items.map((it) => (
                    <div
                      key={it.item_id}
                      className="grid grid-cols-[1.2fr_1.5fr_1fr_60px] gap-x-3 px-3 py-2 border-b border-border/40 last:border-0 items-center hover:bg-muted/30"
                    >
                      <span className="font-medium">{it.sole_name ?? '—'}</span>
                      <span>{it.reference_name}</span>
                      <span>
                        <Badge variant="outline" className="text-xs">
                          {it.color || '—'}
                        </Badge>
                      </span>
                      <span className="text-right tabular-nums">{Number(it.total_quantity).toLocaleString('pt-BR')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}

function WaveRow({
  wave, expanded, onToggle, onView, onStart, onCancel, isStarting,
}: {
  wave: ProductionWave;
  expanded: boolean;
  onToggle: () => void;
  onView: () => void;
  onStart: () => void;
  onCancel: (reason: string) => void;
  isStarting: boolean;
}) {
  const [cancelReason, setCancelReason] = useState('');
  const canStart = wave.status === 'draft' || wave.status === 'planning';
  const canCancel = canStart;

  return (
    <>
      <TableRow className="hover:bg-muted/40">
        <TableCell className="px-3 py-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onToggle}
            aria-label={expanded ? 'Recolher' : 'Expandir'}
          >
            {expanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </Button>
        </TableCell>
        <TableCell className="px-3 py-3 font-bold font-mono text-sm">
          {wave.code}
        </TableCell>
        <TableCell className="px-3 py-3">
          <div className="text-xs">
            <div className="font-medium">
              {formatDate(wave.week_start)} → {formatDate(wave.week_end)}
            </div>
            <div className="text-muted-foreground">
              Criada em {formatDate(wave.created_at)}
            </div>
          </div>
        </TableCell>
        <TableCell className="px-3 py-3">
          <div className="flex flex-col gap-1 text-xs font-mono">
            <Badge variant="outline" className="gap-1 px-1.5 py-0 bg-blue-500/10 text-blue-600 border-blue-500/30 w-fit">
              <Truck className="w-3 h-3" />
              Ter {formatDate(wave.pickup_tuesday_date)}
            </Badge>
            <Badge variant="outline" className="gap-1 px-1.5 py-0 bg-emerald-500/10 text-emerald-600 border-emerald-500/30 w-fit">
              <Truck className="w-3 h-3" />
              Sex {formatDate(wave.pickup_friday_date)}
            </Badge>
          </div>
        </TableCell>
        <TableCell className="px-3 py-3">
          <StatusBadge status={wave.status} />
        </TableCell>
        <TableCell className="px-3 py-3">
          {wave.current_stage ? (
            <Badge variant="secondary" className="gap-1">
              <Factory className="w-3 h-3" />
              {STAGE_LABEL[wave.current_stage]}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell className="px-3 py-3 text-right tabular-nums font-medium">
          {Number(wave.total_pairs ?? 0).toLocaleString('pt-BR')}
        </TableCell>
        <TableCell className="px-3 py-3 text-right tabular-nums">
          {wave.total_items ?? 0}
        </TableCell>
        <TableCell className="px-3 py-3 text-xs">
          {wave.started_at ? formatDateLong(wave.started_at) : '—'}
        </TableCell>
        <TableCell className="px-3 py-3 text-right">
          <div className="flex items-center justify-end gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onView}>
                  <Eye className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Ver detalhes completos</TooltipContent>
            </Tooltip>

            {canStart && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    onClick={onStart}
                    disabled={isStarting}
                    className="h-7 gap-1"
                  >
                    <Play className="w-3 h-3" />
                    Iniciar
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Liberar para Corte</TooltipContent>
              </Tooltip>
            )}

            {canCancel && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" aria-label={`Cancelar onda ${wave.code}`}>
                    <XCircle className="w-4 h-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Cancelar onda {wave.code}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Esta ação libera os pedidos vinculados para serem incluídos em outras
                      ondas. Só é possível cancelar ondas que ainda não iniciaram.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <Input
                    placeholder="Motivo (opcional)"
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    className="my-2"
                  />
                  <AlertDialogFooter>
                    <AlertDialogCancel>Voltar</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => onCancel(cancelReason)}
                    >
                      Cancelar onda
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </TableCell>
      </TableRow>
      {expanded && <ExpandedWaveRow waveId={wave.id} />}
    </>
  );
}

export default function ProductionWavesPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [builderOpen, setBuilderOpen] = useState(false);
  const [selectedWave, setSelectedWave] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const { data: waves = [], isLoading } = useWaves();
  const startWave = useStartWave();
  const cancelWave = useCancelWave();

  // Métricas (auditoria 2026-06-28): ondas CANCELADAS não entram em nenhum KPI
  // (eram contadas no "Total" e nos "Pares totais", inflando os números-âncora).
  // Pares: separa o PIPELINE ATIVO (planning+running+finished) do RASCUNHO (draft,
  // ainda não comprometido) — antes os 2 eram somados como se fossem produção.
  const metrics = useMemo(() => {
    const m = {
      total: 0,                         // ondas ativas (exclui canceladas)
      planning: 0, running: 0, finished: 0, cancelled: 0,
      activePairs: 0,                   // pares em pipeline comprometido
      draftPairs: 0,                    // pares só em rascunho
    };
    for (const w of waves) {
      const pairs = Number(w.total_pairs ?? 0);
      if (w.status === 'cancelled') { m.cancelled++; continue; }
      m.total++;
      if (w.status === 'draft')         { m.planning++; m.draftPairs += pairs; }
      else if (w.status === 'planning') { m.planning++; m.activePairs += pairs; }
      else if (w.status === 'running')  { m.running++;  m.activePairs += pairs; }
      else if (w.status === 'finished') { m.finished++; m.activePairs += pairs; }
    }
    return m;
  }, [waves]);

  const filtered = useMemo(() => {
    const term = normalizeForSearch(search.trim());
    return waves.filter((w) => {
      if (statusFilter !== 'all') {
        if (statusFilter === 'planning' && !(w.status === 'planning' || w.status === 'draft')) {
          return false;
        }
        if (statusFilter !== 'planning' && w.status !== statusFilter) return false;
      }
      if (!term) return true;
      return (w.code ?? '').toLowerCase().includes(term);
    });
  }, [waves, search, statusFilter]);

  type WeekGroup = {
    code: string;
    monday: Date;
    sunday: Date;
    waves: ProductionWave[];
    totalPairs: number;
  };

  const weekGroups = useMemo((): WeekGroup[] => {
    const map = new Map<string, WeekGroup>();
    for (const w of filtered) {
      const iso = getISOWeekFromString(w.week_start);
      const code = iso?.code ?? '—';
      if (!map.has(code)) {
        map.set(code, {
          code,
          monday: iso?.monday ?? new Date(),
          sunday: iso?.sunday ?? new Date(),
          waves: [],
          totalPairs: 0,
        });
      }
      const g = map.get(code)!;
      g.waves.push(w);
      g.totalPairs += Number(w.total_pairs ?? 0);
    }
    return Array.from(map.values()).sort((a, b) => b.code.localeCompare(a.code));
  }, [filtered]);

  return (
    <div className={embedded ? "space-y-5" : "p-6 space-y-5 page-enter editorial-stagger"}>
      {embedded ? (
        <div className="flex items-center justify-end gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/pcp">
              <Truck className="w-4 h-4 mr-1" />
              Painel PCP
            </Link>
          </Button>
          <Button onClick={() => setBuilderOpen(true)}>
            <Plus className="w-4 h-4 mr-1" />
            Nova onda
          </Button>
        </div>
      ) : (
        <EditorialPageHeader
          sectionLabel="PCP · ONDAS"
          title="Ondas de Produção"
          description="Gerencie ondas semanais: pedidos agrupados por solado → referência → cor, fluindo em sequência pelos setores produtivos."
          actions={
            <>
              <Button asChild variant="outline" size="sm">
                <Link to="/pcp">
                  <Truck className="w-4 h-4 mr-1" />
                  Painel PCP
                </Link>
              </Button>
              <Button onClick={() => setBuilderOpen(true)}>
                <Plus className="w-4 h-4 mr-1" />
                Nova onda
              </Button>
            </>
          }
        />
      )}

      {/* Métricas */}
      <StatGrid>
        <StatCard label="Ondas ativas" value={metrics.total} hint={metrics.cancelled > 0 ? `${metrics.cancelled} canceladas` : undefined} />
        <StatCard label="Planejadas" value={metrics.planning} icon={Clock} tone="warning" />
        <StatCard label="Em produção" value={metrics.running} icon={Factory} tone="primary" />
        <StatCard label="Finalizadas" value={metrics.finished} icon={CheckCircle2} tone="success" />
        <StatCard label="Pares em produção" value={metrics.activePairs.toLocaleString('pt-BR')} icon={Layers} hint={metrics.draftPairs > 0 ? `+${metrics.draftPairs.toLocaleString('pt-BR')} em rascunho` : undefined} />
      </StatGrid>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por código da onda…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <Filter className="w-4 h-4 mr-2" />
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="planning">Planejadas</SelectItem>
            <SelectItem value="running">Em produção</SelectItem>
            <SelectItem value="finished">Finalizadas</SelectItem>
            <SelectItem value="cancelled">Canceladas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tabela de ondas */}
      <Panel flush>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                <TableHead className="w-10 px-3 py-2 h-auto"></TableHead>
                <TableHead className="px-3 py-2 h-auto">Código</TableHead>
                <TableHead className="px-3 py-2 h-auto">Semana</TableHead>
                <TableHead className="px-3 py-2 h-auto">Pickups</TableHead>
                <TableHead className="px-3 py-2 h-auto">Status</TableHead>
                <TableHead className="px-3 py-2 h-auto">Setor atual</TableHead>
                <TableHead className="px-3 py-2 h-auto text-right">Pares</TableHead>
                <TableHead className="px-3 py-2 h-auto text-right">Itens</TableHead>
                <TableHead className="px-3 py-2 h-auto">Iniciada em</TableHead>
                <TableHead className="px-3 py-2 h-auto text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={10}>
                    <Skeleton className="h-24 m-3" />
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10}>
                    <EmptyState
                      icon={AlertTriangle}
                      title={waves.length === 0 ? 'Nenhuma onda criada ainda' : 'Nenhuma onda encontrada'}
                      description={waves.length === 0
                        ? 'Crie a primeira onda de produção para começar.'
                        : 'Nenhuma onda corresponde aos filtros aplicados.'}
                      action={waves.length === 0 ? (
                        <Button size="sm" onClick={() => setBuilderOpen(true)}>
                          <Plus className="w-4 h-4 mr-1" /> Criar primeira onda
                        </Button>
                      ) : undefined}
                    />
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && weekGroups.map((wg) => (
                <React.Fragment key={wg.code}>
                  <TableRow className="bg-muted/60 hover:bg-muted/60 sticky">
                    <TableCell colSpan={10} className="px-3 py-1.5">
                      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide">
                        <CalendarDays className="w-3.5 h-3.5 text-primary" />
                        <span>Semana {wg.code}</span>
                        <span className="text-muted-foreground font-normal normal-case tracking-normal">
                          · {fmtDayMonthBR(wg.monday)} – {fmtDayMonthBR(wg.sunday)}
                        </span>
                        <span className="ml-auto text-xs text-muted-foreground font-normal">
                          {wg.waves.length} onda{wg.waves.length !== 1 ? 's' : ''} · {wg.totalPairs.toLocaleString('pt-BR')} pares
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                  {wg.waves.map((w) => (
                    <WaveRow
                      key={w.id}
                      wave={w}
                      expanded={expandedId === w.id}
                      onToggle={() => setExpandedId(expandedId === w.id ? null : w.id)}
                      onView={() => setSelectedWave(w.id)}
                      onStart={() => startWave.mutate(w.id)}
                      isStarting={startWave.isPending}
                      onCancel={(reason) =>
                        cancelWave.mutate({ waveId: w.id, reason: reason || undefined })
                      }
                    />
                  ))}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
      </Panel>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <CalendarDays className="w-3 h-3" />
        Setores: {STAGE_ORDER.map((s) => STAGE_LABEL[s]).join(' → ')}
      </div>

      <WaveBuilder
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        onCreated={(id) => setSelectedWave(id)}
      />
      <WaveDetailPanel
        waveId={selectedWave}
        open={Boolean(selectedWave)}
        onOpenChange={(v) => !v && setSelectedWave(null)}
      />
    </div>
  );
}