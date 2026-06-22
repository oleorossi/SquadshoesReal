import { useMemo, useState } from 'react';
import {
  CaretLeft, CaretRight, Warning, Calendar, Package,
  Lightning, Factory, Gauge,
  Scissors, Stack, Hand, Needle, Stamp, Drop, Sneaker, Boot, Sparkle,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { cn } from '@/lib/utils';
import { type DailySeverity } from '@/lib/sectorCapacity';
import { useSectorDailyLoad, type SectorDaily } from '@/hooks/useSectorDailyLoad';

// ── Ícone por setor (control-room: cada setor com sua marca) ──────────────────
const SECTOR_ICON: Record<string, React.ElementType> = {
  corte_palmilha: Scissors,
  corte_forracao: Stack,
  mesa: Hand,
  costura: Needle,
  silk: Stamp,
  colagem: Drop,
  montagem: Sneaker,
  solagem: Boot,
  acabamento: Sparkle,
  expedicao: Package,
  corte: Scissors,
};

// ── Paleta de severidade (cores semânticas — permitidas pelo check:tokens) ────
const SEV: Record<DailySeverity, {
  bar: string; text: string; chip: string; cardRing: string; dot: string; label: string;
}> = {
  idle: {
    bar: 'bg-muted-foreground/25', text: 'text-muted-foreground',
    chip: 'bg-muted/60 text-muted-foreground border-border',
    cardRing: 'hover:border-foreground/30', dot: 'bg-muted-foreground/40', label: 'sem demanda',
  },
  ok: {
    bar: 'bg-green-500', text: 'text-green-700 dark:text-green-400',
    chip: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30',
    cardRing: 'hover:border-green-500/50', dot: 'bg-green-500', label: 'folga',
  },
  warning: {
    bar: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400',
    chip: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/40',
    cardRing: 'hover:border-amber-500/60', dot: 'bg-amber-500', label: 'atenção',
  },
  critical: {
    bar: 'bg-red-500', text: 'text-red-700 dark:text-red-400',
    chip: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/40',
    cardRing: 'hover:border-red-500/70', dot: 'bg-red-500', label: 'crítico',
  },
  unknown: {
    bar: 'bg-muted-foreground/25', text: 'text-muted-foreground',
    chip: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
    cardRing: 'hover:border-amber-500/50', dot: 'bg-amber-500/60', label: 'sem capacidade',
  },
};

// ── Datas (local, sem shift de fuso) ──────────────────────────────────────────
function localISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function todayISO(): string { return localISO(new Date()); }
function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return localISO(d);
}
function longDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  });
}
function shortDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export default function SectorDailyView() {
  const today = useMemo(todayISO, []);
  const [date, setDate] = useState<string>(today);
  const [selected, setSelected] = useState<SectorDaily | null>(null);

  const { data, isLoading } = useSectorDailyLoad(date);
  const sectors = data?.sectors ?? [];
  const summary = data?.summary;

  // mantém o sheet sincronizado quando muda o dia
  const selectedLive = selected ? sectors.find((s) => s.sector === selected.sector) ?? selected : null;

  const isToday = date === today;

  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · GARGALO DIÁRIO"
        title="Setores por Dia"
        live={isToday}
        description="Carga planejada (cronograma) vs. o que está em produção no dia. Bata o olho pra ver qual setor está em gargalo e clique pra ver as OPs."
        actions={
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="icon" className="h-9 w-9 shrink-0"
              onClick={() => setDate((d) => addDaysISO(d, -1))} aria-label="Dia anterior">
              <CaretLeft className="h-4 w-4" />
            </Button>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value || today)}
              className="h-9 w-[150px] tabular-nums" />
            <Button variant="outline" size="icon" className="h-9 w-9 shrink-0"
              onClick={() => setDate((d) => addDaysISO(d, 1))} aria-label="Próximo dia">
              <CaretRight className="h-4 w-4" />
            </Button>
            <Button variant={isToday ? 'default' : 'outline'} size="sm" className="h-9"
              onClick={() => setDate(today)}>
              Hoje
            </Button>
            <Button variant="outline" size="sm" className="h-9 gap-1.5"
              onClick={() => setDate((d) => addDaysISO(d, 7))} aria-label="Avançar uma semana">
              +7d
            </Button>
          </div>
        }
      />

      {/* Dia selecionado, legível */}
      <div className="flex flex-wrap items-center justify-between gap-3 -mt-1">
        <p className="text-sm">
          <span className="text-muted-foreground">Programação de </span>
          <span className="font-semibold text-foreground capitalize">{longDate(date)}</span>
          {isToday && <Badge variant="outline" className="ml-2 text-[10px]">hoje</Badge>}
        </p>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className={cn('h-2.5 w-2.5 rounded-sm', SEV.ok.bar)} />folga</span>
          <span className="inline-flex items-center gap-1.5"><span className={cn('h-2.5 w-2.5 rounded-sm', SEV.warning.bar)} />&gt;100%</span>
          <span className="inline-flex items-center gap-1.5"><span className={cn('h-2.5 w-2.5 rounded-sm', SEV.critical.bar)} />&gt;150%</span>
          <span className="inline-flex items-center gap-1.5"><span className={cn('h-2.5 w-2.5 rounded-sm', SEV.idle.bar)} />ocioso</span>
        </div>
      </div>

      {/* KPIs do dia */}
      <StatGrid>
        <StatCard label="Pares planejados" value={summary?.plannedPairs ?? 0} icon={Factory} hint="carga do cronograma no dia" />
        <StatCard label="Setores em alerta" value={summary?.sectorsAlert ?? 0} icon={Warning}
          tone={(summary?.sectorsAlert ?? 0) > 0 ? 'destructive' : 'default'} hint="utilização > 100%" />
        <StatCard label="Em produção agora" value={summary?.realPairs ?? 0} icon={Gauge} hint="pares no chão de fábrica" />
        <StatCard label="OPs atrasadas" value={summary?.realDelayed ?? 0} icon={Lightning}
          tone={(summary?.realDelayed ?? 0) > 0 ? 'warning' : 'default'} hint="acima do tempo esperado" />
      </StatGrid>

      {/* Grade de setores — control room */}
      <Panel
        eyebrow="Fluxo de fábrica"
        title="Carga por setor"
        subtitle="Planejado vs. capacidade do dia (média ponderada). Verde = folga · Âmbar = sobrecarga · Vermelho = crítico. Clique num setor pra detalhar."
      >
        {isLoading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Calculando carga do dia…</div>
        ) : (
          <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
            {sectors.map((s, i) => (
              <SectorCard key={s.sector} data={s} index={i} onClick={() => setSelected(s)} />
            ))}
          </div>
        )}
      </Panel>

      {/* Drill por setor */}
      <Sheet open={!!selectedLive} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {selectedLive && <SectorDetail data={selectedLive} dateISO={date} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ── Card de setor ─────────────────────────────────────────────────────────────
function SectorCard({ data, index, onClick }: { data: SectorDaily; index: number; onClick: () => void }) {
  const sev = SEV[data.severity];
  const Icon = SECTOR_ICON[data.sector] || Factory;
  const fillPct = Math.min(100, Math.max(0, data.utilizationPct));
  const over = data.utilizationPct > 100;

  return (
    <button
      type="button"
      onClick={onClick}
      style={{ animationDelay: `${Math.min(index * 40, 360)}ms` }}
      className={cn(
        'group text-left bg-card border border-border rounded-lg overflow-hidden transition-all duration-200',
        'hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-background focus:ring-foreground/20',
        'animate-in fade-in slide-in-from-bottom-2',
        sev.cardRing,
      )}
    >
      {/* faixa de severidade no topo */}
      <div className={cn('h-1', sev.bar)} aria-hidden="true" />
      <div className="p-3.5 flex flex-col gap-3">
        {/* header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="h-8 w-8 flex items-center justify-center bg-muted text-muted-foreground rounded-md shrink-0">
              <Icon className="h-4 w-4" />
            </span>
            <span className="text-sm font-bold text-foreground truncate">{data.label}</span>
          </div>
          <Badge variant="outline" className={cn('text-[11px] font-bold tabular-nums shrink-0', sev.chip)}>
            {data.severity === 'idle' ? '—' : data.severity === 'unknown' ? 's/ cap.' : `${data.utilizationPct}%`}
          </Badge>
        </div>

        {/* barra de utilização */}
        <div>
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden relative">
            <div className={cn('h-full rounded-full transition-all duration-500', sev.bar)} style={{ width: `${fillPct}%` }} />
            {over && <div className="absolute inset-y-0 right-0 w-1.5 bg-red-600/70 animate-pulse" aria-hidden="true" />}
          </div>
          <div className="flex items-center justify-between mt-1.5 text-[11px] tabular-nums">
            <span className="font-mono font-semibold text-foreground">
              {data.plannedPairs}
              <span className="text-muted-foreground font-normal"> pares</span>
            </span>
            <span className="text-muted-foreground">
              cap. {data.capacityPerDay > 0 ? data.capacityPerDay : '—'}/dia
            </span>
          </div>
        </div>

        {/* sub-bloco: produção real */}
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/60 text-[11px]">
          <span className="text-muted-foreground">
            Em produção:{' '}
            <span className="font-semibold text-foreground tabular-nums">{data.realPairs}</span>{' '}
            {data.realOpsCount > 0 && (
              <span className="text-muted-foreground">· {data.realOpsCount} {data.realOpsCount === 1 ? 'OP' : 'OPs'}</span>
            )}
          </span>
          {data.realDelayedCount > 0 ? (
            <Badge variant="outline" className="text-[10px] gap-1 bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/40">
              <Warning className="h-3 w-3" />
              {data.realDelayedCount} atrasada{data.realDelayedCount > 1 ? 's' : ''}
            </Badge>
          ) : (
            <span className={cn('h-1.5 w-1.5 rounded-full', sev.dot)} aria-hidden="true" />
          )}
        </div>
      </div>
    </button>
  );
}

// ── Detalhe do setor (Sheet) ──────────────────────────────────────────────────
function SectorDetail({ data, dateISO }: { data: SectorDaily; dateISO: string }) {
  const sev = SEV[data.severity];
  const Icon = SECTOR_ICON[data.sector] || Factory;

  return (
    <>
      <SheetHeader className="pb-3 border-b border-border">
        <span className="text-[10px] tracking-[0.18em] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5" /> Setor · {shortDate(dateISO)}
        </span>
        <SheetTitle className="text-xl flex items-baseline gap-2">
          {data.label}
          <span className={cn('text-base font-bold tabular-nums', sev.text)}>
            {data.severity === 'idle' ? 'ocioso' : data.severity === 'unknown' ? 'sem capacidade' : `${data.utilizationPct}%`}
          </span>
        </SheetTitle>
        <SheetDescription>
          {data.plannedPairs.toLocaleString('pt-BR')} pares planejados ·
          {' '}capacidade {data.capacityPerDay > 0 ? `${data.capacityPerDay.toLocaleString('pt-BR')}/dia` : 'não cadastrada'} ·
          {' '}{data.realPairs.toLocaleString('pt-BR')} em produção
        </SheetDescription>
      </SheetHeader>

      <div className="py-4 space-y-5">
        {data.severity === 'unknown' && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
            Capacidade diária não cadastrada na ficha deste setor — não dá pra calcular % de utilização.
            Cadastre em <span className="font-medium">Ficha Técnica → Operações</span>.
          </div>
        )}

        {/* PLANEJADO */}
        <section>
          <h4 className="text-[10px] tracking-[0.18em] uppercase font-bold text-muted-foreground mb-2">
            Planejado no dia ({data.contributions.length})
          </h4>
          {data.contributions.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-3 text-center">Nenhuma OP programada para este setor no dia.</p>
          ) : (
            <div className="rounded-md border border-border divide-y divide-border/60 max-h-[280px] overflow-y-auto">
              {data.contributions.map((c) => (
                <div key={c.order_id} className="px-3 py-2 text-xs hover:bg-muted/30">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <span className="font-mono font-medium text-foreground">{c.order_number || '—'}</span>
                      <span className="text-muted-foreground"> · {c.sheet_name || '—'}</span>
                      {c.color && <span className="text-muted-foreground"> · {c.color}</span>}
                    </div>
                    <span className="font-mono font-semibold tabular-nums whitespace-nowrap">
                      {c.pairs_per_day}<span className="text-muted-foreground font-normal text-[10px] ml-0.5">p/dia</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-1 text-[11px] text-muted-foreground tabular-nums">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {shortDate(c.window_start)}–{shortDate(c.window_end)}
                    </span>
                    <span>entrega {new Date(c.planned_delivery + 'T00:00:00').toLocaleDateString('pt-BR')}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* EM PRODUÇÃO */}
        <section>
          <h4 className="text-[10px] tracking-[0.18em] uppercase font-bold text-muted-foreground mb-2">
            Em produção agora ({data.realOps.length})
          </h4>
          {data.realOps.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-3 text-center">Nada em execução neste setor no dia.</p>
          ) : (
            <div className="rounded-md border border-border divide-y divide-border/60 max-h-[280px] overflow-y-auto">
              {data.realOps.map((r) => {
                const delayed = r.bottleneck && r.bottleneck.severity !== 'ok';
                return (
                  <div key={r.order_id} className="px-3 py-2 text-xs hover:bg-muted/30">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <span className="font-mono font-medium text-foreground">{r.order_number || '—'}</span>
                        <span className="text-muted-foreground"> · {r.sheet_name || '—'}</span>
                        {r.color && <span className="text-muted-foreground"> · {r.color}</span>}
                      </div>
                      <span className="font-mono font-semibold tabular-nums whitespace-nowrap">
                        {r.quantityProcessed}/{r.quantityTotal}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-1">
                      <Badge variant="outline" className="text-[10px] capitalize">
                        {r.status.replace('_', ' ')}
                      </Badge>
                      {delayed ? (
                        <span className="text-[11px] text-red-700 dark:text-red-400 flex items-center gap-1">
                          <Warning className="h-3 w-3" />
                          {r.bottleneck?.reason || 'atrasada'}
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground tabular-nums">{r.remaining} restantes</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
