import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus, Play, Package, Search, Filter, Layers, CalendarDays, Users,
  AlertTriangle, ChevronDown, ChevronRight, XCircle, Eye, Truck,
  ClipboardList, Factory, CheckCircle2, Clock, GanttChart,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
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
      <TableCell colSpan={9} className="p-0">
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
                <Table>
                  <TableHeader className="bg-muted/50 text-[10px] uppercase">
                    <TableRow>
                      <TableHead className="px-3 py-2 h-auto">Pedido</TableHead>
                      <TableHead className="px-3 py-2 h-auto">Cliente</TableHead>
                      <TableHead className="px-3 py-2 h-auto text-right">Pares</TableHead>
                      <TableHead className="px-3 py-2 h-auto">Entrega</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((o) => (
                      <TableRow key={o.sale_order_id ?? Math.random()}>
                        <TableCell className="px-3 py-2 font-mono text-xs">
                          {o.sale_order_id ? (
                            <Link
                              to={`/pedidos/${o.sale_order_id}`}
                              className="text-primary hover:underline"
                            >
                              {o.order_number ?? '—'}
                            </Link>
                          ) : (
                            o.order_number ?? '—'
                          )}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-xs truncate max-w-[200px]">
                          {o.client_fantasy || o.client_name || '—'}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-right tabular-nums text-xs">
                          {Number(o.total_pairs).toLocaleString('pt-BR')}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-xs">
                          {formatDate(o.delivery_deadline)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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
                <Table>
                  <TableHeader className="bg-muted/50 text-[10px] uppercase">
                    <TableRow>
                      <TableHead className="px-3 py-2 h-auto">Solado</TableHead>
                      <TableHead className="px-3 py-2 h-auto">Referência</TableHead>
                      <TableHead className="px-3 py-2 h-auto">Cor</TableHead>
                      <TableHead className="px-3 py-2 h-auto text-right">Pares</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.items.map((it) => (
                      <TableRow key={it.item_id}>
                        <TableCell className="px-3 py-2 text-xs font-medium">
                          {it.sole_name ?? '—'}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-xs">
                          {it.reference_name}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-xs">
                          <Badge variant="outline" className="text-[10px]">
                            {it.color || '—'}
                          </Badge>
                        </TableCell>
                        <TableCell className="px-3 py-2 text-right tabular-nums text-xs">
                          {Number(it.total_quantity).toLocaleString('pt-BR')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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

            <Tooltip>
              <TooltipTrigger asChild>
                <Button asChild variant="ghost" size="icon" className="h-7 w-7">
                  <Link to={`/pcp/ondas/${wave.id}/timeline`}>
                    <GanttChart className="w-4 h-4" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Linha do tempo</TooltipContent>
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

export default function ProductionWavesPage() {
  const [builderOpen, setBuilderOpen] = useState(false);
  const [selectedWave, setSelectedWave] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const { data: waves = [], isLoading } = useWaves();
  const startWave = useStartWave();
  const cancelWave = useCancelWave();

  const metrics = useMemo(() => {
    const m = {
      total: waves.length,
      planning: 0, running: 0, finished: 0, cancelled: 0,
      totalPairs: 0,
    };
    for (const w of waves) {
      if (w.status === 'draft' || w.status === 'planning') m.planning++;
      else if (w.status === 'running')   m.running++;
      else if (w.status === 'finished')  m.finished++;
      else if (w.status === 'cancelled') m.cancelled++;
      m.totalPairs += Number(w.total_pairs ?? 0);
    }
    return m;
  }, [waves]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
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

  return (
    <div className="p-6 space-y-5 page-enter">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Package className="w-6 h-6 text-primary" />
            Ondas de Produção
          </h1>
          <p className="text-sm text-muted-foreground">
            Gerencie ondas semanais: pedidos agrupados por solado → referência → cor,
            fluindo em sequência pelos setores produtivos.
          </p>
        </div>
        <div className="flex items-center gap-2">
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
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground font-bold">Total</div>
            <div className="text-2xl font-bold tabular-nums">{metrics.total}</div>
          </CardContent>
        </Card>
        <Card className="border-amber-500/30">
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-amber-600 font-bold flex items-center gap-1">
              <Clock className="w-3 h-3" /> Planejadas
            </div>
            <div className="text-2xl font-bold tabular-nums">{metrics.planning}</div>
          </CardContent>
        </Card>
        <Card className="border-primary/30">
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-primary font-bold flex items-center gap-1">
              <Factory className="w-3 h-3" /> Em produção
            </div>
            <div className="text-2xl font-bold tabular-nums">{metrics.running}</div>
          </CardContent>
        </Card>
        <Card className="border-green-500/30">
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-green-600 font-bold flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Finalizadas
            </div>
            <div className="text-2xl font-bold tabular-nums">{metrics.finished}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground font-bold flex items-center gap-1">
              <Layers className="w-3 h-3" /> Pares totais
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {metrics.totalPairs.toLocaleString('pt-BR')}
            </div>
          </CardContent>
        </Card>
      </div>

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
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50 text-[10px] uppercase text-muted-foreground">
              <TableRow>
                <TableHead className="w-10 px-3 py-2 h-auto"></TableHead>
                <TableHead className="px-3 py-2 h-auto">Código</TableHead>
                <TableHead className="px-3 py-2 h-auto">Semana</TableHead>
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
                  <TableCell colSpan={9}>
                    <Skeleton className="h-24 m-3" />
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9}>
                    <div className="p-8 text-center text-muted-foreground flex flex-col items-center gap-2">
                      <AlertTriangle className="w-8 h-8 opacity-50" />
                      <div className="text-sm">
                        {waves.length === 0
                          ? 'Nenhuma onda criada ainda.'
                          : 'Nenhuma onda corresponde aos filtros aplicados.'}
                      </div>
                      {waves.length === 0 && (
                        <Button size="sm" onClick={() => setBuilderOpen(true)}>
                          <Plus className="w-4 h-4 mr-1" /> Criar primeira onda
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && filtered.map((w) => (
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
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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