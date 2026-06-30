import { useMemo, useState } from 'react';
import {
  Warning as AlertTriangle, Pen, Hand, Scissors, Stack as Layers,
  Calendar, Buildings, Package as Boxes, Lightning as Zap, Users,
  CaretRight,
} from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from '@/components/ui/sheet';
import { EmptyState } from '@/components/ui/empty-state';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import {
  useSectorBottlenecks, useActiveOSForBottleneck, SECTOR_LABEL, type SectorKey,
  type SectorBottleneck,
} from '@/hooks/useSectorBottlenecks';
import { useContractors } from '@/hooks/useContractors';
import { BulkAssignServiceOrderDialog } from '@/components/bottlenecks/BulkAssignServiceOrderDialog';
import { cn, formatCurrency } from '@/lib/utils';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { StatGridSkeleton, TableSkeleton } from '@/components/layout/PageSkeleton';
import { Skeleton } from '@/components/ui/skeleton';

// ─────────────────────────────────────────────────────────────────────────────
// Setores cobertos pela view (alinhado com v_sector_bottlenecks)
// ─────────────────────────────────────────────────────────────────────────────
const SECTORS: { key: SectorKey; icon: React.ElementType }[] = [
  { key: 'costura',         icon: Pen },
  { key: 'mesa',            icon: Hand },
  { key: 'corte_palmilha',  icon: Scissors },
  { key: 'corte_forracao',  icon: Layers },
];

// ─────────────────────────────────────────────────────────────────────────────
// Paleta do heatmap por bucket de utilização
// ─────────────────────────────────────────────────────────────────────────────
type HeatBucket = 'idle' | 'low' | 'fit' | 'warn' | 'crit';

function bucketOf(pct: number | null): HeatBucket {
  if (pct == null) return 'idle';
  if (pct < 50) return 'low';
  if (pct < 100) return 'fit';
  if (pct < 150) return 'warn';
  return 'crit';
}

const HEAT_STYLE: Record<HeatBucket, {
  cell: string;
  pct: string;
  hint: string;
  ring: string;
}> = {
  idle: {
    cell: 'bg-muted/40 border-border hover:border-foreground/40',
    pct:  'text-muted-foreground',
    hint: 'text-muted-foreground/60',
    ring: 'ring-foreground/15',
  },
  low: {
    cell: 'bg-green-500/5 border-green-500/20 hover:border-green-600/50',
    pct:  'text-green-700 dark:text-green-400',
    hint: 'text-green-700/70 dark:text-green-400/70',
    ring: 'ring-green-500/30',
  },
  fit: {
    cell: 'bg-green-500/15 border-green-500/40 hover:border-green-600/70',
    pct:  'text-green-800 dark:text-green-300',
    hint: 'text-green-800/70 dark:text-green-300/70',
    ring: 'ring-green-500/40',
  },
  warn: {
    cell: 'bg-amber-500/15 border-amber-500/40 hover:border-amber-600/70',
    pct:  'text-amber-800 dark:text-amber-300',
    hint: 'text-amber-800/70 dark:text-amber-300/70',
    ring: 'ring-amber-500/50',
  },
  crit: {
    cell: 'bg-red-500/15 border-red-500/45 hover:border-red-600/80',
    pct:  'text-red-700 dark:text-red-300',
    hint: 'text-red-700/70 dark:text-red-300/70',
    ring: 'ring-red-500/50',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Datas: gerar as próximas 4 semanas ISO a partir da semana atual
// ─────────────────────────────────────────────────────────────────────────────
function isoMondayOf(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay(); // 0=dom, 1=seg, ... 6=sáb
  const offset = dow === 0 ? -6 : 1 - dow; // segunda da mesma semana
  d.setDate(d.getDate() + offset);
  return d;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isoWeekNum(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(
    ((d.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
  );
}

function weekColumnLabel(monday: Date): { week: string; range: string } {
  const end = new Date(monday);
  end.setDate(end.getDate() + 4); // sex
  const fmt = (x: Date) => x.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return {
    week: `Sem ${isoWeekNum(monday).toString().padStart(2, '0')}`,
    range: `${fmt(monday)}–${fmt(end)}`,
  };
}

function nextWeeks(count: number): Date[] {
  const start = isoMondayOf(new Date());
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i * 7);
    return d;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Página
// ─────────────────────────────────────────────────────────────────────────────
export default function BottlenecksPage() {
  const { data: all = [], isLoading } = useSectorBottlenecks();
  const { data: contractors = [] } = useContractors();

  const weeks = useMemo(() => nextWeeks(4), []);
  const weekKeys = useMemo(() => weeks.map(toIsoDate), [weeks]);
  const currentWeekKey = weekKeys[0];

  // Indexa por (sector|week_start) pra lookup O(1) no heatmap
  const byKey = useMemo(() => {
    const m = new Map<string, SectorBottleneck>();
    for (const b of all) m.set(`${b.sector}::${b.week_start}`, b);
    return m;
  }, [all]);

  // Subset que aparece no heatmap (horizonte 4 semanas)
  const horizonCells = useMemo(() => {
    const cells: SectorBottleneck[] = [];
    for (const s of SECTORS) {
      for (const wk of weekKeys) {
        const b = byKey.get(`${s.key}::${wk}`);
        if (b) cells.push(b);
      }
    }
    return cells;
  }, [byKey, weekKeys]);

  // Sheet lateral selecionada
  const [selected, setSelected] = useState<SectorBottleneck | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  // KPIs do topo (baseados no horizonte)
  const summary = useMemo(() => {
    const criticalNow = horizonCells.filter(
      (c) => c.week_start === currentWeekKey && c.severity === 'critical',
    ).length;
    const atRisk = horizonCells.filter((c) => c.utilization_pct >= 100);
    return {
      criticalNow,
      atRiskWeeks: atRisk.length,
      opsAtRisk: atRisk.reduce((s, c) => s + c.ops_count, 0),
      activeContractors: contractors.filter((c: any) => c.active !== false).length,
    };
  }, [horizonCells, currentWeekKey, contractors]);

  if (isLoading) {
    return (
      <div className="space-y-5 page-enter">
        <EditorialPageHeader
          sectionLabel="PRODUÇÃO · GARGALOS"
          title="Monitoramento de Gargalos"
          description="Heatmap setor × próximas 4 semanas. Clique numa célula sobrecarregada pra ver as OPs e encaminhar pra terceirizadas antes que atrase a Montagem."
        />
        <StatGridSkeleton count={4} />
        <Skeleton className="h-[320px] rounded-lg" />
        <TableSkeleton rows={6} />
      </div>
    );
  }

  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · GARGALOS"
        title="Monitoramento de Gargalos"
        description="Heatmap setor × próximas 4 semanas. Clique numa célula sobrecarregada pra ver as OPs e encaminhar pra terceirizadas antes que atrase a Montagem."
      />

      {/* KPIs */}
      <StatGrid>
        <StatCard
          label="Críticos esta semana"
          value={summary.criticalNow}
          icon={AlertTriangle}
          tone={summary.criticalNow > 0 ? 'destructive' : 'default'}
          hint="utilização ≥ 150%"
        />
        <StatCard
          label="Semanas com risco"
          value={summary.atRiskWeeks}
          icon={Zap}
          tone={summary.atRiskWeeks > 0 ? 'warning' : 'default'}
          hint="células ≥ 100% no horizonte"
        />
        <StatCard
          label="OPs em risco"
          value={summary.opsAtRisk}
          icon={Boxes}
          hint="contagem agregada"
        />
        <StatCard
          label="Contratadas disponíveis"
          value={summary.activeContractors}
          icon={Users}
          hint="pra encaminhar gargalo"
        />
      </StatGrid>

      {/* Heatmap principal — setores × próximas 4 semanas */}
      <Panel
        eyebrow="Horizonte de 4 semanas"
        title="Carga por setor"
        subtitle="Cor por utilização. Verde = folga · Âmbar = atenção · Vermelho = crítico. Clique numa célula pra agir."
      >
        {/* Legenda compacta */}
        <div className="flex flex-wrap items-center gap-3 mb-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className={cn('inline-block h-3 w-3 rounded-sm border', HEAT_STYLE.low.cell)} />
            &lt; 50%
          </span>
          <span className="flex items-center gap-1.5">
            <span className={cn('inline-block h-3 w-3 rounded-sm border', HEAT_STYLE.fit.cell)} />
            50–99%
          </span>
          <span className="flex items-center gap-1.5">
            <span className={cn('inline-block h-3 w-3 rounded-sm border', HEAT_STYLE.warn.cell)} />
            100–149%
          </span>
          <span className="flex items-center gap-1.5">
            <span className={cn('inline-block h-3 w-3 rounded-sm border', HEAT_STYLE.crit.cell)} />
            ≥ 150%
          </span>
          <span className="flex items-center gap-1.5">
            <span className={cn('inline-block h-3 w-3 rounded-sm border', HEAT_STYLE.idle.cell)} />
            sem demanda
          </span>
        </div>

        {/* Grid responsivo: setor à esquerda + 4 colunas semana */}
        <div className="overflow-x-auto">
          <div className="min-w-[600px] grid grid-cols-[160px_repeat(4,minmax(0,1fr))] gap-2">
            {/* Header row */}
            <div className="text-[10px] tracking-[0.18em] uppercase font-bold text-muted-foreground py-2">
              Setor / Semana
            </div>
            {weeks.map((w, i) => {
              const { week, range } = weekColumnLabel(w);
              const isCurrent = i === 0;
              return (
                <div
                  key={toIsoDate(w)}
                  className={cn(
                    'flex flex-col items-center gap-0.5 py-2 px-2 rounded-md',
                    isCurrent && 'bg-foreground/[0.04] ring-1 ring-foreground/15',
                  )}
                >
                  <span className="text-[10px] tracking-[0.18em] uppercase font-bold text-foreground">
                    {week}{isCurrent && ' · agora'}
                  </span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">{range}</span>
                </div>
              );
            })}

            {/* Linhas dos setores */}
            {SECTORS.map(({ key, icon: Icon }) => (
              <FragmentRow
                key={key}
                Icon={Icon}
                sectorKey={key}
                weekKeys={weekKeys}
                byKey={byKey}
                onCellClick={(b) => setSelected(b)}
              />
            ))}
          </div>
        </div>
      </Panel>

      {/* Tabela secundária — alinhada com o que está visível no heatmap */}
      {horizonCells.length > 0 && (
        <Panel
          title="Detalhe das células"
          subtitle="Listagem linear das mesmas células do heatmap acima, pra busca rápida."
          flush
        >
          <Table>
            <TableHeader>
              <TableRow className="sticky top-0 z-sticky bg-muted/40 backdrop-blur-sm [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                <TableHead>Setor</TableHead>
                <TableHead>Semana</TableHead>
                <TableHead className="text-right tabular-nums">OPs</TableHead>
                <TableHead className="text-right tabular-nums">Pares</TableHead>
                <TableHead className="text-right tabular-nums">Capacidade</TableHead>
                <TableHead className="text-right tabular-nums">Utilização</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {horizonCells.map((b) => {
                const bk = bucketOf(b.utilization_pct);
                const style = HEAT_STYLE[bk];
                const wkDate = new Date(b.week_start + 'T00:00:00');
                const { week, range } = weekColumnLabel(wkDate);
                return (
                  <TableRow
                    key={`${b.sector}-${b.week_start}`}
                    className="cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => setSelected(b)}
                  >
                    <TableCell className="text-xs font-medium">{SECTOR_LABEL[b.sector]}</TableCell>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">
                      {week} · {range}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{b.ops_count}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">
                      {b.total_pairs_planned.toLocaleString('pt-BR')}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                      {b.total_capacity_week.toLocaleString('pt-BR')}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <Badge variant="outline" className={cn('text-xs tabular-nums', style.pct, style.cell.replace('hover:border', 'border'))}>
                        {b.utilization_pct}%
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      <CaretRight className="inline h-3.5 w-3.5" />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Panel>
      )}

      {horizonCells.length === 0 && (
        <EmptyState
          icon={AlertTriangle}
          title="Nenhuma demanda detectada nas próximas 4 semanas"
          description="As OPs ativas estão fora do horizonte exibido, ou não há OPs ativas com prazo definido."
        />
      )}

      {/* Sheet lateral — detalhe da célula clicada */}
      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {selected && (
            <CellDetail
              cell={selected}
              onEncaminhar={() => setBulkOpen(true)}
              onClose={() => setSelected(null)}
            />
          )}
        </SheetContent>
      </Sheet>

      {selected && (
        <BulkAssignServiceOrderDialog
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          sector={selected.sector}
          weekStart={selected.week_start}
          contributingOrders={selected.contributing_orders}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Linha do heatmap (setor + 4 células semanais)
// ─────────────────────────────────────────────────────────────────────────────
function FragmentRow({
  Icon,
  sectorKey,
  weekKeys,
  byKey,
  onCellClick,
}: {
  Icon: React.ElementType;
  sectorKey: SectorKey;
  weekKeys: string[];
  byKey: Map<string, SectorBottleneck>;
  onCellClick: (b: SectorBottleneck) => void;
}) {
  return (
    <>
      <div className="flex items-center gap-2 py-3">
        <span className="h-7 w-7 flex items-center justify-center bg-muted text-muted-foreground rounded-md shrink-0">
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-sm font-semibold text-foreground truncate">
          {SECTOR_LABEL[sectorKey]}
        </span>
      </div>
      {weekKeys.map((wk) => {
        const cell = byKey.get(`${sectorKey}::${wk}`);
        if (!cell) {
          // Sem dados ainda — célula idle
          return (
            <div
              key={`${sectorKey}::${wk}`}
              className={cn(
                'rounded-md border p-3 min-h-[78px] flex flex-col items-center justify-center text-center',
                HEAT_STYLE.idle.cell,
              )}
            >
              <span className={cn('mono text-base font-bold leading-none', HEAT_STYLE.idle.pct)}>—</span>
              <span className={cn('text-[10px] mt-1 leading-none', HEAT_STYLE.idle.hint)}>sem demanda</span>
            </div>
          );
        }
        const bk = bucketOf(cell.utilization_pct);
        const style = HEAT_STYLE[bk];
        const interactive = cell.ops_count > 0;
        return (
          <button
            key={`${sectorKey}::${wk}`}
            type="button"
            disabled={!interactive}
            onClick={() => interactive && onCellClick(cell)}
            className={cn(
              'rounded-md border p-3 min-h-[78px] flex flex-col items-center justify-center text-center transition-all duration-150',
              style.cell,
              interactive
                ? 'cursor-pointer hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-background ' + style.ring
                : 'cursor-default opacity-60',
            )}
            aria-label={
              `${SECTOR_LABEL[sectorKey]} semana de ${wk}: ${cell.utilization_pct}% de utilização` +
              (interactive ? '. Clique para ver as OPs.' : '')
            }
          >
            <span className={cn('mono text-2xl font-bold leading-none tabular-nums', style.pct)}>
              {cell.utilization_pct}
              <span className="text-sm font-medium ml-0.5">%</span>
            </span>
            <span className={cn('text-[11px] mt-1.5 leading-none tabular-nums', style.hint)}>
              {cell.total_pairs_planned}/{cell.total_capacity_week} pares
            </span>
            {cell.ops_count > 0 && (
              <span className={cn('text-[10px] mt-1 leading-none', style.hint)}>
                {cell.ops_count} {cell.ops_count === 1 ? 'OP' : 'OPs'}
              </span>
            )}
          </button>
        );
      })}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Detalhe da célula (Sheet lateral)
// ─────────────────────────────────────────────────────────────────────────────
function CellDetail({
  cell, onEncaminhar, onClose,
}: {
  cell: SectorBottleneck;
  onEncaminhar: () => void;
  onClose: () => void;
}) {
  const wkDate = new Date(cell.week_start + 'T00:00:00');
  const { week, range } = weekColumnLabel(wkDate);
  const bk = bucketOf(cell.utilization_pct);
  const style = HEAT_STYLE[bk];

  const { data: activeOS = [] } = useActiveOSForBottleneck(cell.sector, cell.week_start);

  return (
    <>
      <SheetHeader className="pb-3 border-b border-border">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1 pr-6">
            <span className="text-[10px] tracking-[0.18em] uppercase font-bold text-muted-foreground">
              {SECTOR_LABEL[cell.sector]} · {week}
            </span>
            <SheetTitle className="text-xl mono">
              <span className={style.pct}>{cell.utilization_pct}%</span>
              <span className="text-muted-foreground text-base font-normal ml-2">
                de utilização
              </span>
            </SheetTitle>
            <SheetDescription>
              Semana de <span className="font-mono text-foreground">{range}</span> ·
              {' '}{cell.total_pairs_planned.toLocaleString('pt-BR')} pares planejados ·
              {' '}capacidade {cell.total_capacity_week.toLocaleString('pt-BR')} pares
            </SheetDescription>
          </div>
        </div>
      </SheetHeader>

      <div className="py-4 space-y-4">
        {/* OSs já criadas pra esse gargalo */}
        {activeOS.length > 0 && (
          <div className="rounded-md border border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-xs space-y-1">
            <p className="font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
              <Buildings className="h-3.5 w-3.5" />
              {activeOS.length} {activeOS.length === 1 ? 'OS já ativa' : 'OSs já ativas'} nesse gargalo
            </p>
            <ul className="text-emerald-800 dark:text-emerald-300 space-y-0.5">
              {activeOS.slice(0, 4).map((os: any) => (
                <li key={os.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    {os.contractors?.name || '—'} · {os.quantity} pares
                  </span>
                  <span className="font-mono tabular-nums text-[11px] text-emerald-700/80 dark:text-emerald-400/80">
                    {os.unit_price > 0 ? formatCurrency(os.total_value || 0) : ''}
                  </span>
                </li>
              ))}
              {activeOS.length > 4 && (
                <li className="text-[11px] italic">+ {activeOS.length - 4} mais...</li>
              )}
            </ul>
          </div>
        )}

        {/* Lista de OPs contribuintes */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[10px] tracking-[0.18em] uppercase font-bold text-muted-foreground">
              OPs contribuintes ({cell.contributing_orders.length})
            </h4>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {cell.total_pairs_planned} pares totais
            </span>
          </div>
          {cell.contributing_orders.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-4 text-center">
              Sem OPs detalhadas pra esta semana.
            </p>
          ) : (
            <div className="rounded-md border border-border divide-y divide-border/60 max-h-[420px] overflow-y-auto">
              {cell.contributing_orders.map((o) => (
                <div key={o.order_id} className="px-3 py-2 text-xs hover:bg-muted/30">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <span className="font-mono font-medium text-foreground">{o.order_number}</span>
                      <span className="text-muted-foreground"> · </span>
                      <span>{o.sheet_name || '—'}</span>
                      {o.color && <span className="text-muted-foreground"> · {o.color}</span>}
                    </div>
                    <span className="font-mono font-semibold tabular-nums whitespace-nowrap">
                      {o.quantity}<span className="text-muted-foreground font-normal text-[10px] ml-0.5">pares</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-1 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {new Date(o.planned_delivery + 'T00:00:00').toLocaleDateString('pt-BR')}
                    </span>
                    <span className="tabular-nums">
                      {o.pairs_per_day} pares/dia
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <SheetFooter className="border-t border-border pt-3 mt-2 flex flex-row gap-2 justify-end sm:justify-end">
        <Button variant="outline" onClick={onClose}>
          Fechar
        </Button>
        <Button onClick={onEncaminhar} className="gap-1.5" disabled={cell.contributing_orders.length === 0}>
          <Buildings className="h-3.5 w-3.5" />
          Encaminhar todas
        </Button>
      </SheetFooter>
    </>
  );
}
