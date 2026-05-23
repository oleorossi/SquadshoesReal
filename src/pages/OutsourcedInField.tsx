import { useMemo, useState } from 'react';
import {
  Truck, ArrowSquareOut, Buildings, Funnel, Warning as AlertTriangle,
  CurrencyDollar as DollarSign, Package as Boxes, X, CheckCircle, Clock,
  Calendar, DotsThreeVertical, Printer,
} from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/components/ui/empty-state';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { cn, formatCurrency } from '@/lib/utils';
import {
  useOutsourcedInField, useReceiveOutsourcedItem, useExtendOutsourcedDeadline,
  type OutsourcedItem,
} from '@/hooks/useOutsourcedInField';
import { SECTOR_LABEL, type SectorKey } from '@/hooks/useSectorBottlenecks';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de formatação
// ─────────────────────────────────────────────────────────────────────────────

function formatDateBR(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

const sectorLabel = (sector: string): string =>
  SECTOR_LABEL[sector as SectorKey] ?? sector;

// Status visual derivado: "Atrasado +Nd" | "Vence hoje" | "Vence em Nd" | "No prazo"
type DeadlineState = { kind: 'late' | 'today' | 'soon' | 'ok' | 'unknown'; label: string };

function deadlineState(item: OutsourcedItem): DeadlineState {
  if (item.days_late > 0) {
    return { kind: 'late', label: `Atrasado +${item.days_late}d` };
  }
  const d = daysUntil(item.expected_back);
  if (d === null) return { kind: 'unknown', label: 'Sem prazo' };
  if (d === 0) return { kind: 'today', label: 'Vence hoje' };
  if (d <= 7) return { kind: 'soon', label: `Vence em ${d}d` };
  return { kind: 'ok', label: 'No prazo' };
}

const STATE_STYLE: Record<DeadlineState['kind'], string> = {
  late:    'bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-400',
  today:   'bg-amber-500/15 text-amber-700 border-amber-500/40 dark:text-amber-400',
  soon:    'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400',
  ok:      'bg-green-500/10 text-green-700 border-green-500/30 dark:text-green-400',
  unknown: 'bg-muted text-muted-foreground border-border',
};

// ─────────────────────────────────────────────────────────────────────────────

export default function OutsourcedInFieldPage() {
  const { data: items = [], isLoading } = useOutsourcedInField();
  const receiveItem = useReceiveOutsourcedItem();
  const extendDeadline = useExtendOutsourcedDeadline();

  // Filtros locais
  const [contractorFilter, setContractorFilter] = useState<string | null>(null);
  const [sectorFilter, setSectorFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [onlyLate, setOnlyLate] = useState(false);

  // Dialog de prorrogação
  const [extendItem, setExtendItem] = useState<OutsourcedItem | null>(null);
  const [newDeadline, setNewDeadline] = useState('');

  // Agregação por contractor
  type ContractorBucket = {
    contractor_id: string;
    contractor_name: string;
    items: OutsourcedItem[];
    total_pairs: number;
    total_value: number;
    late_count: number;
  };

  const byContractor = useMemo<ContractorBucket[]>(() => {
    const map = new Map<string, ContractorBucket>();
    for (const it of items) {
      const key = it.contractor_id || 'sem-contractor';
      if (!map.has(key)) {
        map.set(key, {
          contractor_id: key,
          contractor_name: it.contractor_name || 'Sem contratada',
          items: [],
          total_pairs: 0,
          total_value: 0,
          late_count: 0,
        });
      }
      const b = map.get(key)!;
      b.items.push(it);
      b.total_pairs += Number(it.pairs || 0);
      b.total_value += Number(it.total_value || 0);
      if (it.days_late > 0) b.late_count += 1;
    }
    return [...map.values()].sort((a, b) => {
      if (b.late_count !== a.late_count) return b.late_count - a.late_count;
      return b.total_pairs - a.total_pairs;
    });
  }, [items]);

  // KPIs do topo
  const summary = useMemo(() => {
    const distinctContractors = new Set(items.map((i) => i.contractor_id)).size;
    return {
      total_items: items.length,
      total_pairs: items.reduce((s, i) => s + Number(i.pairs || 0), 0),
      total_value: items.reduce((s, i) => s + Number(i.total_value || 0), 0),
      late_count: items.filter((i) => i.days_late > 0).length,
      distinct_contractors: distinctContractors,
    };
  }, [items]);

  // Tabela: aplica filtros + sort
  const filtered = useMemo(() => {
    let arr = items;
    if (contractorFilter) arr = arr.filter((i) => i.contractor_id === contractorFilter);
    if (sectorFilter !== 'all') arr = arr.filter((i) => i.sector === sectorFilter);
    if (statusFilter !== 'all') {
      arr = arr.filter((i) => {
        const k = deadlineState(i).kind;
        if (statusFilter === 'late')  return k === 'late';
        if (statusFilter === 'today') return k === 'today';
        if (statusFilter === 'soon')  return k === 'soon' || k === 'today';
        if (statusFilter === 'ok')    return k === 'ok';
        return true;
      });
    }
    if (onlyLate) arr = arr.filter((i) => i.days_late > 0);
    // sort por prazo asc (sem prazo no fim), depois enviado asc
    return [...arr].sort((a, b) => {
      const ax = a.expected_back ? new Date(a.expected_back).getTime() : Number.POSITIVE_INFINITY;
      const bx = b.expected_back ? new Date(b.expected_back).getTime() : Number.POSITIVE_INFINITY;
      if (ax !== bx) return ax - bx;
      const ay = a.sent_at ? new Date(a.sent_at).getTime() : 0;
      const by = b.sent_at ? new Date(b.sent_at).getTime() : 0;
      return ay - by;
    });
  }, [items, contractorFilter, sectorFilter, statusFilter, onlyLate]);

  const clearFilters = () => {
    setContractorFilter(null);
    setSectorFilter('all');
    setStatusFilter('all');
    setOnlyLate(false);
  };

  const hasFilters = contractorFilter || sectorFilter !== 'all' || statusFilter !== 'all' || onlyLate;

  const handleReceive = (item: OutsourcedItem) => {
    if (!confirm(`Marcar OP ${item.op_number} como recebida da terceirizada?`)) return;
    receiveItem.mutate(item);
  };

  const openExtendDialog = (item: OutsourcedItem) => {
    if (item.source !== 'service_order') {
      alert('OPs terceirizadas pré-produção têm seu prazo controlado pela data de entrega da OP em /orders.');
      return;
    }
    setExtendItem(item);
    setNewDeadline(item.expected_back || new Date().toISOString().slice(0, 10));
  };

  const confirmExtend = async () => {
    if (!extendItem || !newDeadline) return;
    await extendDeadline.mutateAsync({ item: extendItem, newDeadline });
    setExtendItem(null);
    setNewDeadline('');
  };

  if (isLoading) {
    return (
      <div className="py-12 text-center text-muted-foreground text-sm">
        Carregando itens em produção externa...
      </div>
    );
  }

  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · TERCEIROS"
        title="Terceiros na Rua"
        description="Tudo o que está fora da fábrica agora — OSs de gargalo + OPs inteiras terceirizadas. Acompanhe prazo, atraso e recebimento num único lugar."
      />

      {/* KPIs */}
      <StatGrid>
        <StatCard
          label="Itens na rua"
          value={summary.total_items}
          icon={Truck}
          hint={`em ${summary.distinct_contractors} ${summary.distinct_contractors === 1 ? 'contratada' : 'contratadas'}`}
        />
        <StatCard
          label="Pares na rua"
          value={summary.total_pairs.toLocaleString('pt-BR')}
          icon={Boxes}
          hint="total agregado"
        />
        <StatCard
          label="Em produção externa"
          value={formatCurrency(summary.total_value)}
          icon={DollarSign}
          hint="somente OSs com valor"
        />
        <StatCard
          label="Atrasados"
          value={summary.late_count}
          icon={AlertTriangle}
          tone={summary.late_count > 0 ? 'destructive' : 'default'}
          hint="prazo vencido"
        />
      </StatGrid>

      {/* Cards-resumo por contractor (clicáveis) */}
      {byContractor.length > 0 && (
        <Panel
          eyebrow="Por contratada"
          title="Carga em produção externa"
          subtitle="Clique num card pra filtrar a tabela. Clique novamente pra desfiltrar."
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {byContractor.map((b) => {
              const selected = contractorFilter === b.contractor_id;
              return (
                <button
                  key={b.contractor_id}
                  type="button"
                  onClick={() =>
                    setContractorFilter(selected ? null : b.contractor_id)
                  }
                  className={cn(
                    'group relative bg-card border rounded-lg p-3 text-left transition-all duration-200',
                    'hover:border-foreground/40 hover:-translate-y-0.5',
                    selected
                      ? 'border-foreground shadow-[0_0_0_2px_var(--ring)] ring-2 ring-foreground/15'
                      : 'border-border',
                  )}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0 flex items-center gap-2">
                      <span className="shrink-0 h-7 w-7 -mt-0.5 flex items-center justify-center bg-muted text-muted-foreground rounded-md">
                        <Buildings className="h-4 w-4" />
                      </span>
                      <span
                        className="text-sm font-semibold truncate"
                        title={b.contractor_name}
                      >
                        {b.contractor_name}
                      </span>
                    </div>
                    {b.late_count > 0 && (
                      <Badge
                        variant="outline"
                        className={cn(STATE_STYLE.late, 'text-xs whitespace-nowrap')}
                      >
                        {b.late_count} atrasado{b.late_count > 1 ? 's' : ''}
                      </Badge>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <div className="text-muted-foreground">OSs</div>
                      <div className="mono font-semibold text-sm tabular-nums">
                        {b.items.length}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Pares</div>
                      <div className="mono font-semibold text-sm tabular-nums">
                        {b.total_pairs.toLocaleString('pt-BR')}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">R$</div>
                      <div className="mono font-semibold text-sm tabular-nums truncate" title={formatCurrency(b.total_value)}>
                        {b.total_value > 0
                          ? Intl.NumberFormat('pt-BR', {
                              notation: 'compact',
                              style: 'currency',
                              currency: 'BRL',
                              maximumFractionDigits: 1,
                            }).format(b.total_value)
                          : '—'}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </Panel>
      )}

      {/* Toolbar de filtros */}
      <Panel
        title="Itens em produção externa"
        subtitle={
          contractorFilter
            ? `Filtrado por ${byContractor.find(b => b.contractor_id === contractorFilter)?.contractor_name ?? '—'}`
            : `${filtered.length} ${filtered.length === 1 ? 'item' : 'itens'}`
        }
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Funnel className="h-4 w-4 text-muted-foreground" />
            <Select value={sectorFilter} onValueChange={setSectorFilter}>
              <SelectTrigger className="h-9 w-[160px] text-xs">
                <SelectValue placeholder="Setor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os setores</SelectItem>
                <SelectItem value="costura">Costura</SelectItem>
                <SelectItem value="mesa">Aviamento</SelectItem>
                <SelectItem value="corte_palmilha">Corte Palmilha</SelectItem>
                <SelectItem value="corte_forracao">Corte Forração</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-[150px] text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                <SelectItem value="late">Atrasados</SelectItem>
                <SelectItem value="today">Vence hoje</SelectItem>
                <SelectItem value="soon">Vence em até 7d</SelectItem>
                <SelectItem value="ok">No prazo</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant={onlyLate ? 'default' : 'outline'}
              size="sm"
              className="h-9 text-xs gap-1"
              onClick={() => setOnlyLate(!onlyLate)}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {onlyLate ? 'Mostrando atrasados' : 'Só atrasados'}
            </Button>
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 text-xs gap-1 text-muted-foreground"
                onClick={clearFilters}
              >
                <X className="h-3.5 w-3.5" />
                Limpar
              </Button>
            )}
          </div>
        }
        flush
      >
        {filtered.length === 0 ? (
          <EmptyState
            icon={Truck}
            title={hasFilters ? 'Nenhum item com esses filtros' : 'Nada em produção externa'}
            description={
              hasFilters
                ? 'Limpe os filtros pra ver todos os itens na rua.'
                : 'Quando você encaminhar OPs pra contratadas, elas aparecem aqui pra acompanhar prazo de retorno.'
            }
            action={hasFilters ? (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Limpar filtros
              </Button>
            ) : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                  <TableHead>OP</TableHead>
                  <TableHead>PV / Cliente</TableHead>
                  <TableHead>Modelo / Cor</TableHead>
                  <TableHead className="text-right">Pares</TableHead>
                  <TableHead>Setor</TableHead>
                  <TableHead>Contratada</TableHead>
                  <TableHead>Enviado</TableHead>
                  <TableHead>Prazo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((it) => {
                  const state = deadlineState(it);
                  return (
                    <TableRow key={`${it.source}:${it.id}`} className="hover:bg-muted/30">
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {it.op_number}
                        {it.source === 'outsourced_op' && (
                          <Badge variant="outline" className="ml-1.5 h-4 text-[10px] uppercase tracking-wide">
                            OP int.
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="font-mono">{it.sale_order_number}</div>
                        {it.client_name && (
                          <div className="text-muted-foreground truncate max-w-[160px]" title={it.client_name}>
                            {it.client_name}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {it.sheet_name}
                        {it.color && (
                          <span className="text-muted-foreground"> · {it.color}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {Number(it.pairs).toLocaleString('pt-BR')}
                      </TableCell>
                      <TableCell className="text-xs">{sectorLabel(it.sector)}</TableCell>
                      <TableCell className="text-xs">{it.contractor_name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        <Calendar className="inline h-3 w-3 mr-1" />
                        {formatDateBR(it.sent_at)}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {it.expected_back ? formatDateBR(it.expected_back) : (
                          <span className="text-muted-foreground italic">sem prazo</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn(STATE_STYLE[state.kind], 'text-xs whitespace-nowrap')}>
                          {state.kind === 'late' && <AlertTriangle className="inline h-3 w-3 mr-1" />}
                          {state.kind === 'ok' && <CheckCircle className="inline h-3 w-3 mr-1" />}
                          {(state.kind === 'today' || state.kind === 'soon') && <Clock className="inline h-3 w-3 mr-1" />}
                          {state.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums whitespace-nowrap">
                        {it.total_value && it.total_value > 0
                          ? formatCurrency(it.total_value)
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <DotsThreeVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem onClick={() => handleReceive(it)} className="text-xs gap-2">
                              <CheckCircle className="h-3.5 w-3.5" />
                              Marcar recebido
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => openExtendDialog(it)}
                              className="text-xs gap-2"
                              disabled={it.source !== 'service_order'}
                            >
                              <Clock className="h-3.5 w-3.5" />
                              Prorrogar prazo
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => window.print()}
                              className="text-xs gap-2"
                            >
                              <Printer className="h-3.5 w-3.5" />
                              Imprimir guia
                            </DropdownMenuItem>
                            {it.sale_order_id && (
                              <DropdownMenuItem asChild>
                                <a
                                  href={`/sales/${it.sale_order_id}`}
                                  className="text-xs gap-2 flex items-center"
                                >
                                  <ArrowSquareOut className="h-3.5 w-3.5" />
                                  Abrir PV
                                </a>
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      {/* Dialog: prorrogar prazo */}
      <Dialog open={!!extendItem} onOpenChange={(open) => !open && setExtendItem(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              Prorrogar prazo de entrega
            </DialogTitle>
            <DialogDescription>
              {extendItem && (
                <>
                  OS da OP <strong className="text-foreground">{extendItem.op_number}</strong>{' '}
                  com <strong className="text-foreground">{extendItem.contractor_name}</strong>.
                  {extendItem.expected_back && (
                    <span className="block mt-1 text-xs">
                      Prazo atual: <span className="font-mono">{formatDateBR(extendItem.expected_back)}</span>
                    </span>
                  )}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Novo prazo de entrega</Label>
              <Input
                type="date"
                value={newDeadline}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setNewDeadline(e.target.value)}
                className="mt-1 h-9 text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtendItem(null)} disabled={extendDeadline.isPending}>
              Cancelar
            </Button>
            <Button onClick={confirmExtend} disabled={!newDeadline || extendDeadline.isPending}>
              {extendDeadline.isPending ? 'Salvando...' : 'Confirmar novo prazo'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
