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

// Rótulo curto pra cabeçalhos densos (linha de produção)
const SHORT_LABEL: Record<string, string> = {
  corte_palmilha: 'Corte Palm.',
  corte_forracao: 'Corte Forr.',
  mesa: 'Aviamento',
  costura: 'Costura',
  silk: 'Silk',
  colagem: 'Colagem',
  montagem: 'Montagem',
  solagem: 'Solagem',
  acabamento: 'Acabam.',
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

// O número-chave de cada setor pra exibir/comparar (utilização quando há
// capacidade; senão os pares planejados do dia).
function sectorMetric(s: SectorDaily): { value: string; label: string } {
  if (s.severity === 'warning' || s.severity === 'critical' || s.severity === 'ok') {
    return { value: `${s.utilizationPct}%`, label: 'utilização' };
  }
  if (s.realPairs > 0) return { value: String(s.realPairs), label: 'em produção' };
  return { value: String(s.plannedPairs), label: 'pares planejados' };
}

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
  const s = new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  });
  // só a 1ª letra — CSS `capitalize` titularizaria os conectores ("De Junho De")
  return s.charAt(0).toUpperCase() + s.slice(1);
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
  const unknownCount = sectors.filter((s) => s.severity === 'unknown').length;

  // Gargalo do dia: alerta de capacidade primeiro; senão maior carga planejada;
  // por fim maior WIP. Só conta setores com alguma carga.
  const worst = useMemo<SectorDaily | null>(() => {
    const withLoad = sectors.filter(
      (s) => s.severity === 'warning' || s.severity === 'critical' || s.plannedPairs > 0 || s.realPairs > 0,
    );
    if (!withLoad.length) return null;
    return [...withLoad].sort((a, b) => {
      const aa = a.severity === 'warning' || a.severity === 'critical' ? 1 : 0;
      const bb = b.severity === 'warning' || b.severity === 'critical' ? 1 : 0;
      if (aa !== bb) return bb - aa;
      if (aa === 1 && b.utilizationPct !== a.utilizationPct) return b.utilizationPct - a.utilizationPct;
      if (b.plannedPairs !== a.plannedPairs) return b.plannedPairs - a.plannedPairs;
      return b.realPairs - a.realPairs;
    })[0];
  }, [sectors]);

  const maxPlanned = Math.max(1, ...sectors.map((s) => s.plannedPairs));
  const maxWip = Math.max(1, ...sectors.map((s) => s.realPairs));

  // mantém o sheet sincronizado quando muda o dia
  const selectedLive = selected ? sectors.find((s) => s.sector === selected.sector) ?? selected : null;
  const isToday = date === today;

  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · GARGALO DIÁRIO"
        title="Setores por Dia"
        live={isToday}
        description="Carga planejada (cronograma) do dia escolhido vs. o que está em produção agora. Bata o olho pra ver onde o trabalho acumula e clique num setor pra ver as OPs."
        actions={
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="icon" className="h-9 w-9 shrink-0"
              onClick={() => setDate((d) => addDaysISO(d, -1))} aria-label="Dia anterior">
              <CaretLeft className="h-4 w-4" />
            </Button>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value || today)}
              className="h-9 w-[150px] tabular-nums" aria-label="Data" />
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

      {/* Dia selecionado + legenda */}
      <div className="flex flex-wrap items-center justify-between gap-3 -mt-1">
        <p className="text-sm">
          <span className="text-muted-foreground">Programação de </span>
          <span className="font-semibold text-foreground">{longDate(date)}</span>
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

      {/* Aviso: setores sem capacidade cadastrada → sem cálculo de utilização */}
      {unknownCount > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
          <Warning className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            <strong>{unknownCount}</strong>{' '}
            {unknownCount === 1 ? 'setor sem capacidade cadastrada' : 'setores sem capacidade cadastrada'} na ficha —
            a utilização não é calculada (aparecem como “s/ cap.”). Cadastre a capacidade/dia em{' '}
            <span className="font-medium">Ficha Técnica → Operações</span> pra acender o gargalo desses setores.
          </span>
        </div>
      )}

      {/* Callout: gargalo do dia (headline do que está acontecendo) */}
      {!isLoading && worst && <BottleneckCallout worst={worst} onOpen={() => setSelected(worst)} />}

      {/* Linha de produção — carga por etapa, na ordem do fluxo */}
      <Panel
        eyebrow="Linha de produção · fluxo →"
        title="Carga por etapa no dia"
        subtitle="Altura da barra = pares planejados no dia · cor = utilização vs. capacidade · ● abaixo = pares em produção agora. Clique numa etapa pra detalhar."
      >
        {isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Calculando carga do dia…</div>
        ) : (
          <ProductionFlow sectors={sectors} worstKey={worst?.sector ?? null} maxPlanned={maxPlanned} onPick={setSelected} />
        )}
      </Panel>

      {/* Grade detalhada de setores */}
      {!isLoading && (
        <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(248px,1fr))]">
          {sectors.map((s, i) => (
            <SectorCard
              key={s.sector}
              data={s}
              index={i}
              step={i + 1}
              total={sectors.length}
              maxWip={maxWip}
              isWorst={worst?.sector === s.sector}
              onClick={() => setSelected(s)}
            />
          ))}
        </div>
      )}

      {/* Drill por setor */}
      <Sheet open={!!selectedLive} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {selectedLive && <SectorDetail data={selectedLive} dateISO={date} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ── Callout do gargalo do dia ─────────────────────────────────────────────────
function BottleneckCallout({ worst, onOpen }: { worst: SectorDaily; onOpen: () => void }) {
  const sev = SEV[worst.severity];
  const Icon = SECTOR_ICON[worst.sector] || Factory;
  const m = sectorMetric(worst);
  const tone =
    worst.severity === 'critical'
      ? 'border-red-500/50 bg-red-500/10'
      : worst.severity === 'warning'
        ? 'border-amber-500/50 bg-amber-500/10'
        : 'border-border bg-muted/40';

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'w-full text-left rounded-lg border p-3.5 flex items-center gap-3.5 transition-all duration-200',
        'hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-background focus:ring-foreground/20',
        tone,
      )}
    >
      <span className={cn('h-10 w-10 rounded-lg flex items-center justify-center shrink-0', sev.bar, 'text-white')}>
        <Icon className="h-5 w-5" weight="bold" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-muted-foreground flex items-center gap-1.5">
          <Warning className="h-3 w-3" /> Gargalo do dia
        </div>
        <div className="text-base font-bold text-foreground truncate leading-tight">{worst.label}</div>
        <div className="text-xs text-muted-foreground tabular-nums">
          {worst.realOpsCount > 0
            ? `${worst.realPairs} pares em produção · ${worst.realOpsCount} ${worst.realOpsCount === 1 ? 'OP' : 'OPs'}`
            : `${worst.plannedPairs} pares planejados no dia`}
          {worst.realDelayedCount > 0 && (
            <span className="text-red-700 dark:text-red-400 font-medium"> · {worst.realDelayedCount} atrasada{worst.realDelayedCount > 1 ? 's' : ''}</span>
          )}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className={cn('font-mono font-bold tabular-nums text-2xl leading-none', sev.text)}>{m.value}</div>
        <div className="text-[10px] text-muted-foreground mt-0.5">{m.label}</div>
      </div>
      <CaretRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

// ── Linha de produção (mini bar chart em ordem de fluxo) ──────────────────────
function ProductionFlow({
  sectors, worstKey, maxPlanned, onPick,
}: {
  sectors: SectorDaily[];
  worstKey: string | null;
  maxPlanned: number;
  onPick: (s: SectorDaily) => void;
}) {
  return (
    <div className="overflow-x-auto pb-1">
      <div className="min-w-[620px] flex items-stretch gap-1">
        {sectors.map((s) => {
          const sev = SEV[s.severity];
          const isWorst = s.sector === worstKey;
          const pct = s.plannedPairs > 0 ? Math.max(6, Math.round((s.plannedPairs / maxPlanned) * 100)) : 0;
          return (
            <button
              key={s.sector}
              type="button"
              onClick={() => onPick(s)}
              aria-label={`${s.label}: ${s.plannedPairs} pares planejados, ${s.realPairs} em produção`}
              className={cn(
                'group flex-1 min-w-[62px] flex flex-col items-center rounded-md px-1 pt-1.5 pb-2 transition-colors',
                'focus:outline-none focus:ring-2 focus:ring-foreground/20',
                isWorst ? 'bg-foreground/[0.04] ring-1 ring-inset ring-foreground/15' : 'hover:bg-muted/40',
              )}
            >
              {/* valor planejado (sempre visível) */}
              <span className={cn('text-[11px] font-mono font-bold tabular-nums leading-none mb-1',
                s.plannedPairs > 0 ? sev.text : 'text-muted-foreground/40')}>
                {s.plannedPairs > 0 ? s.plannedPairs : '—'}
              </span>
              {/* trilho + barra (cresce de baixo) */}
              <div className="w-full h-24 flex items-end justify-center">
                <div className="relative w-7 h-full flex items-end rounded-md bg-muted/50 overflow-hidden">
                  <div
                    className={cn('w-full rounded-t-md transition-all duration-500 motion-reduce:transition-none', sev.bar)}
                    style={{ height: `${pct}%` }}
                  />
                </div>
              </div>
              {/* nó do fluxo + WIP atual */}
              <span className={cn('mt-1.5 h-2 w-2 rounded-full', s.realPairs > 0 ? sev.dot : 'bg-border')} aria-hidden="true" />
              <span className="mt-1 text-[10px] font-mono tabular-nums text-foreground leading-none">
                {s.realPairs > 0 ? <>●{s.realPairs}<span className="text-muted-foreground"> ag.</span></> : <span className="text-muted-foreground/40">—</span>}
              </span>
              {/* rótulo */}
              <span className="mt-1 text-[9px] uppercase tracking-wide text-center text-muted-foreground leading-tight">
                {SHORT_LABEL[s.sector] ?? s.label}
              </span>
              {isWorst && (
                <span className="mt-1 text-[8px] font-bold uppercase tracking-wide rounded px-1 bg-foreground text-background leading-tight">
                  gargalo
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Card de setor (detalhe) ───────────────────────────────────────────────────
function SectorCard({
  data, index, step, total, maxWip, isWorst, onClick,
}: {
  data: SectorDaily; index: number; step: number; total: number; maxWip: number; isWorst: boolean; onClick: () => void;
}) {
  const sev = SEV[data.severity];
  const Icon = SECTOR_ICON[data.sector] || Factory;
  const fillPct = Math.min(100, Math.max(0, data.utilizationPct));
  const over = data.utilizationPct > 100;
  const wipPct = data.realPairs > 0 ? Math.max(4, Math.round((data.realPairs / maxWip) * 100)) : 0;

  return (
    <button
      type="button"
      onClick={onClick}
      style={{ animationDelay: `${Math.min(index * 40, 360)}ms` }}
      className={cn(
        'group text-left bg-card border rounded-lg overflow-hidden transition-all duration-200',
        'hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-background focus:ring-foreground/20',
        'animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none',
        isWorst ? 'border-foreground/40 ring-1 ring-foreground/15' : cn('border-border', sev.cardRing),
      )}
    >
      {/* faixa de severidade no topo */}
      <div className={cn('h-1', sev.bar)} aria-hidden="true" />
      <div className="p-3.5 flex flex-col gap-3">
        {/* header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="h-8 w-8 flex items-center justify-center bg-muted text-muted-foreground rounded-md shrink-0 relative">
              <Icon className="h-4 w-4" />
              <span className="absolute -top-1.5 -left-1.5 h-4 min-w-4 px-1 rounded-full bg-foreground text-background text-[9px] font-bold flex items-center justify-center tabular-nums leading-none">
                {step}
              </span>
            </span>
            <div className="min-w-0">
              <span className="text-sm font-bold text-foreground truncate block leading-tight">{data.label}</span>
              <span className="text-[10px] text-muted-foreground tabular-nums">etapa {step}/{total}</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {isWorst && (
              <Badge variant="outline" className="text-[9px] font-bold uppercase tracking-wide bg-foreground text-background border-foreground">
                gargalo
              </Badge>
            )}
            <Badge variant="outline" className={cn('text-[11px] font-bold tabular-nums', sev.chip)}>
              {data.severity === 'idle' ? '—' : data.severity === 'unknown' ? 's/ cap.' : `${data.utilizationPct}%`}
            </Badge>
          </div>
        </div>

        {/* barra de utilização (bullet: 100% = capacidade) */}
        <div>
          <div className="flex items-center justify-between mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            <span>Planejado</span>
            <span className="font-mono tabular-nums normal-case">
              {data.plannedPairs}<span className="text-muted-foreground/70"> / cap. {data.capacityPerDay > 0 ? data.capacityPerDay : '—'}</span>
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden relative">
            <div className={cn('h-full rounded-full transition-all duration-500 motion-reduce:transition-none', sev.bar)} style={{ width: `${fillPct}%` }} />
            {/* marca de capacidade (alvo do bullet) a 100% */}
            <div className="absolute inset-y-0 right-0 w-px bg-foreground/30" aria-hidden="true" />
            {over && <div className="absolute inset-y-0 right-0 w-1.5 bg-red-600/70 animate-pulse motion-reduce:animate-none" aria-hidden="true" />}
          </div>
        </div>

        {/* barra de WIP (em produção agora, relativa ao maior do dia) */}
        <div>
          <div className="flex items-center justify-between mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            <span>Agora</span>
            <span className="font-mono tabular-nums normal-case">
              {data.realPairs} pares
              {data.realOpsCount > 0 && <span className="text-muted-foreground/70"> · {data.realOpsCount} {data.realOpsCount === 1 ? 'OP' : 'OPs'}</span>}
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-foreground/55 transition-all duration-500 motion-reduce:transition-none" style={{ width: `${wipPct}%` }} />
          </div>
        </div>

        {/* rodapé: atraso */}
        {data.realDelayedCount > 0 && (
          <div className="flex items-center justify-end pt-0.5">
            <Badge variant="outline" className="text-[10px] gap-1 bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/40">
              <Warning className="h-3 w-3" />
              {data.realDelayedCount} atrasada{data.realDelayedCount > 1 ? 's' : ''}
            </Badge>
          </div>
        )}
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
