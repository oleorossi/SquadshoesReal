/**
 * Gestão · Setores — aba "Setores" da Central de Produção.
 *
 * Visão por setor: carga × capacidade (dia / semana), pressão de prazo,
 * fila de OPs NA ORDEM DO MOTOR, atrasos, gargalo, cabedal complexo × simples,
 * OPs aguardando prestador ou material, e sugestões de apoio à decisão.
 *
 * Somente leitura: nenhuma ação aqui move OP. "Abrir no Chão" só leva ao
 * quadro (onde apontar/mover continuam como sempre) já filtrado pela OP.
 */
import { useMemo, useState } from 'react';
import {
  ArrowSquareOut, CalendarBlank, Factory, Lightbulb, Scissors, Truck, Warning, Package, Gauge, X,
} from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSectorPanorama } from '@/hooks/useSectorPanorama';
import { useEngineRefetchInterval } from '@/hooks/useProductionEngine';
import {
  EMPTY_MATERIAL_SHORTAGES, materialShortageStatus, useSaleOrderMaterialShortages,
} from '@/hooks/useSaleOrderMaterialShortages';
import {
  EMPTY_FILTERS, addDaysISO, buildDeadlinePressure, buildLoadMatrix, buildSectorQueues,
  buildSuggestions, bottleneckSectors, filterOps, fmtDM, occupancyTone, opFlags, weekStartISO, workdaysBetween,
  type OpFlags, type PanoramaFilters, type Suggestion, type SectorQueueItem,
} from '@/lib/sectorPanorama';

const TONE_CLASS: Record<ReturnType<typeof occupancyTone>, string> = {
  idle: 'bg-muted/40 text-muted-foreground',
  ok: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  high: 'bg-amber-500/20 text-amber-600 dark:text-amber-400',
  over: 'bg-red-500/20 text-red-600 dark:text-red-400 font-bold',
};

const SUGGESTION_ICON: Record<Suggestion['kind'], typeof Warning> = {
  sobrecarga: Gauge, ocioso: Lightbulb, atraso: Warning, prestador: Scissors, material: Package, gargalo: Factory,
};

const WEEKDAY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
function weekdayLabel(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export interface SectorPanoramaProps {
  /** Abre a OP no quadro do Chão (busca pelo número da OP). */
  onOpenOp?: (orderNumber: string) => void;
}

export function SectorPanorama({ onOpenOp }: SectorPanoramaProps) {
  const { data, isLoading, isError, error, refetch, dataUpdatedAt, isFetching } = useSectorPanorama(28);
  // Falta de material por PV: mesma RPC e mesma cache do quadro (sem ida extra
  // quando o usuário vem do Chão). Falha → mapa vazio, sem selo.
  const saleOrderIds = useMemo(() => (data?.ops ?? []).map(o => o.sale_order_id), [data?.ops]);
  const shortageRefetch = useEngineRefetchInterval();
  const { data: shortages = EMPTY_MATERIAL_SHORTAGES } =
    useSaleOrderMaterialShortages(saleOrderIds, { refetchInterval: shortageRefetch });
  const shortPv = useMemo(() => {
    const s = new Set<string>();
    for (const [id, info] of shortages) if (materialShortageStatus(info) === 'falta') s.add(id);
    return s;
  }, [shortages]);
  const [filters, setFilters] = useState<PanoramaFilters>(EMPTY_FILTERS);
  const [mode, setMode] = useState<'dia' | 'semana'>('dia');
  const [focusSector, setFocusSector] = useState<string | null>(null);

  const today = data?.from ?? new Date().toISOString().slice(0, 10);
  const sectors = useMemo(
    () => (data?.sectors ?? []).filter(s => s.enabled),
    [data?.sectors],
  );
  const groupOf = useMemo(
    () => new Map(sectors.map(s => [s.sector, s.parallel_group])),
    [sectors],
  );
  const flags = useMemo(() => {
    const m = new Map<string, OpFlags>();
    for (const op of data?.ops ?? []) m.set(op.order_id, opFlags(op, today, groupOf, shortPv));
    return m;
  }, [data?.ops, today, groupOf, shortPv]);

  const days = useMemo(() => workdaysBetween(today, data?.to ?? addDaysISO(today, 28)), [today, data?.to]);
  const weeks = useMemo(() => [...new Set(days.map(weekStartISO))], [days]);

  const ops = useMemo(
    () => filterOps(data?.ops ?? [], flags, data?.schedule ?? [], filters),
    [data?.ops, data?.schedule, flags, filters],
  );
  const opIds = useMemo(() => new Set(ops.map(o => o.order_id)), [ops]);
  const schedule = useMemo(
    () => (data?.schedule ?? []).filter(r => opIds.has(r.order_id)),
    [data?.schedule, opIds],
  );

  const dayMatrix = useMemo(
    () => buildLoadMatrix(sectors, schedule, opIds, flags, days, 'dia'),
    [sectors, schedule, opIds, flags, days],
  );
  const viewMatrix = useMemo(
    () => (mode === 'dia' ? dayMatrix : buildLoadMatrix(sectors, schedule, opIds, flags, days, 'semana')),
    [mode, dayMatrix, sectors, schedule, opIds, flags, days],
  );
  const pressure = useMemo(
    () => buildDeadlinePressure(sectors, ops, flags, today, weeks),
    [sectors, ops, flags, today, weeks],
  );
  const bn = useMemo(() => bottleneckSectors(sectors, ops, flags), [sectors, ops, flags]);
  /** Só destaca UM gargalo quando ele existe de fato (sem empate). */
  const bottleneck = bn.sectors.length === 1 ? bn.sectors[0] : null;
  const suggestions = useMemo(() => buildSuggestions({
    today, sectors, ops, flags, schedule, dayCells: dayMatrix.cells, pressure, weeks,
  }), [today, sectors, ops, flags, schedule, dayMatrix, pressure, weeks]);
  const queues = useMemo(
    () => buildSectorQueues(sectors, ops, flags, schedule),
    [sectors, ops, flags, schedule],
  );

  const options = useMemo(() => {
    const all = data?.ops ?? [];
    const uniq = (xs: (string | null)[]) => [...new Set(xs.filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    return {
      pv: uniq(all.map(o => o.sale_order_number)),
      ref: uniq(all.map(o => o.reference_name)),
      color: uniq(all.map(o => o.color)),
    };
  }, [data?.ops]);

  const kpis = useMemo(() => {
    let pairs = 0, late = 0, prestador = 0, material = 0, complexo = 0;
    for (const op of ops) {
      const f = flags.get(op.order_id)!;
      pairs += op.remaining_pairs_net || 0;
      if (f.late) late++;
      if (f.waitingAtelier) prestador++;
      if (f.waitingMaterial) material++;
      if (f.kind === 'complexo') complexo++;
    }
    return { ops: ops.length, pairs, late, prestador, material, complexo, simples: ops.length - complexo };
  }, [ops, flags]);

  const filtersActive = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);
  const set = <K extends keyof PanoramaFilters>(k: K, v: PanoramaFilters[K]) => setFilters(f => ({ ...f, [k]: v }));

  if (isLoading) {
    return (
      <div className="flex-1 space-y-3 overflow-hidden p-3" aria-busy="true">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-md rounded-lg border border-red-500/40 bg-red-500/5 p-4 text-center">
          <p className="font-semibold text-red-600 dark:text-red-400">Não foi possível carregar a visão por setor</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Isto é falha de consulta — não quer dizer que os setores estão vazios.
          </p>
          <p className="mt-2 break-words font-mono text-[11px] text-muted-foreground">{(error as Error)?.message}</p>
          <Button className="mt-3 h-10" onClick={() => refetch()}>Tentar de novo</Button>
        </div>
      </div>
    );
  }

  const visibleSectors = focusSector ? sectors.filter(s => s.sector === focusSector) : sectors;
  const updated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';

  return (
    <div className="flex-1 min-h-0 overflow-y-auto" data-testid="sector-panorama">
      {/* ── Filtros ───────────────────────────────────────────────────── */}
      <div className="z-10 flex flex-wrap md:sticky md:top-0 items-center gap-2 border-b border-border bg-card px-2 py-2 md:px-3">
        <div className="flex overflow-hidden rounded-md border border-border" role="group" aria-label="Granularidade">
          {(['dia', 'semana'] as const).map(m => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`h-9 px-3 text-xs font-semibold uppercase tracking-wide ${mode === m ? 'bg-foreground text-background' : 'bg-card text-muted-foreground hover:bg-muted/40'}`}
            >
              {m === 'dia' ? 'Dia' : 'Semana'}
            </button>
          ))}
        </div>
        <FilterSelect label="Semana" value={filters.week} onChange={v => set('week', v)}
          options={[['todas', 'Todas as semanas'], ...weeks.map(w => [w, `Semana ${fmtDM(w)}`] as [string, string])]} />
        <FilterSelect label="PV" value={filters.pv} onChange={v => set('pv', v)}
          options={[['todos', 'Todos os PVs'], ...options.pv.map(v => [v, v] as [string, string])]} />
        <FilterSelect label="Referência" value={filters.reference} onChange={v => set('reference', v)}
          options={[['todas', 'Todas as refs'], ...options.ref.map(v => [v, v] as [string, string])]} />
        <FilterSelect label="Cor" value={filters.color} onChange={v => set('color', v)}
          options={[['todas', 'Todas as cores'], ...options.color.map(v => [v, v] as [string, string])]} />
        <FilterSelect label="Cabedal" value={filters.kind} onChange={v => set('kind', v as PanoramaFilters['kind'])}
          options={[['todos', 'Complexo e simples'], ['complexo', 'Só complexo'], ['simples', 'Só simples']]} />
        <ToggleChip active={filters.onlyLate} onClick={() => set('onlyLate', !filters.onlyLate)}>Atrasadas</ToggleChip>
        <ToggleChip active={filters.onlyBlocked} onClick={() => set('onlyBlocked', !filters.onlyBlocked)}>Aguardando prestador/material</ToggleChip>
        {filtersActive && (
          <Button variant="ghost" size="sm" className="h-9 gap-1" onClick={() => setFilters(EMPTY_FILTERS)}>
            <X className="h-3.5 w-3.5" /> Limpar
          </Button>
        )}
        <span className="ml-auto font-mono text-[11px] text-muted-foreground" title="Hora do último dado recebido. Atualiza a cada 90s e a cada apontamento.">
          {isFetching ? 'atualizando…' : `atualizado ${updated}`}
          {data?.last_run ? ` · motor ${new Date(data.last_run.ran_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}
        </span>
      </div>

      {/* ── KPIs ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 px-2 py-2 sm:grid-cols-4 lg:grid-cols-7 md:px-3">
        <Kpi label="OPs" value={kpis.ops} />
        <Kpi label="Pares reais" value={kpis.pairs.toLocaleString('pt-BR')} hint="Pares físicos que faltam (remaining_pairs_net), não carga pares·setor." />
        <Kpi label="Atrasadas" value={kpis.late} tone={kpis.late > 0 ? 'bad' : undefined} hint="Previsão do motor depois do prazo de faturamento." />
        <Kpi label="Complexo / simples" value={`${kpis.complexo} / ${kpis.simples}`} />
        <Kpi label="Aguardando Ateliê/prestador" value={kpis.prestador} tone={kpis.prestador > 0 ? 'warn' : undefined} />
        <Kpi label="Aguardando material" value={kpis.material} tone={kpis.material > 0 ? 'warn' : undefined} />
        <Kpi
          label="Gargalo"
          value={bottleneck ?? (bn.sectors.length > 1 ? `${bn.sectors.length} empatados` : '—')}
          hint={bn.sectors.length > 1
            ? `Carga equilibrada (~${bn.days.toFixed(1)} dias de fila): ${bn.sectors.join(', ')}`
            : 'Setor com mais dias de trabalho na fila (pares da fábrica ÷ capacidade/dia).'}
        />
      </div>

      <div className="grid gap-3 px-2 pb-3 md:px-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
        {/* ── Mapa carga × capacidade ─────────────────────────────────── */}
        <section className="min-w-0 rounded-md border border-border bg-card" aria-label="Carga por capacidade por setor">
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-3 py-2">
            <h2 className="text-sm font-bold uppercase tracking-wide">Carga × capacidade {mode === 'dia' ? 'por dia' : 'por semana'}</h2>
            <p className="text-[11px] text-muted-foreground">
              % = ocupação planejada da fábrica{mode === 'semana' ? ' · "prazo" = pares que faltam para faturar até a semana ÷ capacidade até lá' : ''}. Clique no setor para focar.
            </p>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr>
                  <th className="sticky left-0 z-[1] bg-card px-2 py-1 text-left font-semibold">Setor</th>
                  <th className="px-1 py-1 text-right font-semibold text-muted-foreground">Cap./dia</th>
                  {viewMatrix.columns.map(c => (
                    <th key={c} className={`px-1 py-1 text-center font-mono font-semibold ${c === today ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {mode === 'dia' ? (<><div>{weekdayLabel(c)}</div><div>{fmtDM(c)}</div></>) : `sem ${fmtDM(c)}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sectors.map(s => {
                  const isBn = s.sector === bottleneck;
                  const isFocus = s.sector === focusSector;
                  return (
                    <tr key={s.sector} className={`border-t border-border/60 ${isFocus ? 'bg-primary/5' : ''}`}>
                      <th scope="row" className="sticky left-0 z-[1] bg-card px-2 py-1 text-left font-medium">
                        <button
                          type="button"
                          className="flex items-center gap-1 text-left hover:underline"
                          onClick={() => setFocusSector(isFocus ? null : s.sector)}
                          aria-pressed={isFocus}
                          title={isFocus ? 'Mostrar todos os setores' : `Focar a fila em ${s.sector}`}
                        >
                          {s.sector}
                          {isBn && <Badge variant="destructive-soft" className="ml-1">gargalo</Badge>}
                        </button>
                      </th>
                      <td className="px-1 py-1 text-right font-mono text-muted-foreground">{s.daily_capacity_pairs}</td>
                      {viewMatrix.columns.map(col => {
                        const c = viewMatrix.cells.get(`${s.sector}|${col}`);
                        const pr = mode === 'semana' ? pressure.get(`${s.sector}|${col}`) : undefined;
                        const pct = c?.occupancyPct ?? 0;
                        const shown = Math.max(pct, pr?.pct ?? 0);
                        const empty = !c || (c.plannedPairs === 0 && (c.outsourcedPairs === 0) && !(pr && pr.requiredPairs > 0));
                        return (
                          <td key={col} className="p-0.5">
                            <div
                              className={`min-w-[3.25rem] rounded px-1 py-0.5 text-center font-mono leading-tight ${empty ? 'text-muted-foreground/50' : TONE_CLASS[occupancyTone(shown)]}`}
                              title={c ? [
                                `${s.sector} · ${mode === 'dia' ? fmtDM(col) : `semana ${fmtDM(col)}`}`,
                                `Ocupação planejada: ${pct}% · ${c.plannedPairs.toLocaleString('pt-BR')} pares de ${c.capacityPairs.toLocaleString('pt-BR')} · ${c.ops} OP(s)`,
                                c.outsourcedPairs > 0 ? `No prestador (fora da fábrica): ${c.outsourcedPairs.toLocaleString('pt-BR')} pares` : '',
                                pr ? `Prazo: ${pr.requiredPairs.toLocaleString('pt-BR')} pares para faturar até ${fmtDM(addDaysISO(col, 6))} ÷ ${pr.capacityPairs.toLocaleString('pt-BR')} de capacidade = ${pr.pct}%` : '',
                              ].filter(Boolean).join('\n') : ''}
                            >
                              {empty ? '·' : (
                                <>
                                  <div>{pct}%</div>
                                  {mode === 'semana' && pr && pr.requiredPairs > 0 && (
                                    <div className="text-[9px] opacity-80">prazo {pr.pct}%</div>
                                  )}
                                  {c && c.outsourcedPairs > 0 && <div className="text-[9px] opacity-80">+{c.outsourcedPairs} fora</div>}
                                </>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <footer className="flex flex-wrap gap-3 border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
            <Legend tone="idle">&lt; 40% ocioso</Legend>
            <Legend tone="ok">40–84%</Legend>
            <Legend tone="high">85–100%</Legend>
            <Legend tone="over">&gt; 100% estourado</Legend>
            <span>"fora" = etapa do cabedal complexo no prestador, não ocupa a fábrica.</span>
          </footer>
        </section>

        {/* ── Sugestões ───────────────────────────────────────────────── */}
        <section className="rounded-md border border-border bg-card" aria-label="Sugestões do motor">
          <header className="border-b border-border px-3 py-2">
            <h2 className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide">
              <Lightbulb className="h-4 w-4" /> Sugestões
            </h2>
            <p className="text-[11px] text-muted-foreground">Apoio à decisão. Nada aqui é executado sozinho.</p>
          </header>
          {suggestions.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">Sem alertas para os filtros atuais.</p>
          ) : (
            <ul className="divide-y divide-border">
              {suggestions.map(sg => {
                const Icon = SUGGESTION_ICON[sg.kind];
                const op = sg.orderId ? ops.find(o => o.order_id === sg.orderId) : undefined;
                return (
                  <li key={sg.id} className="px-3 py-2">
                    <div className={`flex items-start gap-2 text-sm font-semibold ${sg.severity === 3 ? 'text-red-600 dark:text-red-400' : sg.severity === 2 ? 'text-amber-600 dark:text-amber-400' : ''}`}>
                      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{sg.title}</span>
                    </div>
                    <p className="mt-0.5 pl-6 text-xs text-muted-foreground">{sg.detail}</p>
                    <div className="mt-1 flex gap-2 pl-6">
                      {sg.sector && (
                        <button type="button" className="text-[11px] font-semibold underline-offset-2 hover:underline" onClick={() => setFocusSector(sg.sector!)}>
                          Ver fila de {sg.sector}
                        </button>
                      )}
                      {op && onOpenOp && (
                        <button type="button" className="inline-flex items-center gap-1 text-[11px] font-semibold underline-offset-2 hover:underline" onClick={() => onOpenOp(op.order_number)}>
                          Abrir {op.order_number} no Chão <ArrowSquareOut className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* ── Fila por setor (ordem do motor) ────────────────────────────── */}
      <section className="px-2 pb-4 md:px-3" aria-label="Fila de OPs por setor">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wide">Fila por setor · ordem do motor</h2>
          {focusSector && (
            <Button variant="outline" size="sm" className="h-8 gap-1" onClick={() => setFocusSector(null)}>
              <X className="h-3.5 w-3.5" /> {focusSector}
            </Button>
          )}
        </div>
        {ops.length === 0 ? (
          <p className="rounded-md border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground">
            Nenhuma OP para os filtros atuais.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {visibleSectors.map(s => (
              <SectorQueueCard
                key={s.sector}
                sector={s.sector}
                items={queues.get(s.sector) ?? []}
                capacity={s.daily_capacity_pairs}
                isBottleneck={s.sector === bottleneck}
                onOpenOp={onOpenOp}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Peças ───────────────────────────────────────────────────────────────────

function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: [string, string][];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-auto min-w-[8.5rem] text-xs" aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function ToggleChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`h-9 rounded-md border px-3 text-xs font-semibold ${active ? 'border-foreground bg-foreground text-background' : 'border-border bg-card text-muted-foreground hover:bg-muted/40'}`}
    >
      {children}
    </button>
  );
}

function Kpi({ label, value, tone, hint }: { label: string; value: React.ReactNode; tone?: 'bad' | 'warn'; hint?: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2" title={hint}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`truncate font-mono text-lg font-bold ${tone === 'bad' ? 'text-red-600 dark:text-red-400' : tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : ''}`}>
        {value}
      </div>
    </div>
  );
}

function Legend({ tone, children }: { tone: ReturnType<typeof occupancyTone>; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block h-2.5 w-4 rounded-sm ${TONE_CLASS[tone]}`} />
      {children}
    </span>
  );
}

function SectorQueueCard({ sector, items, capacity, isBottleneck, onOpenOp }: {
  sector: string; items: SectorQueueItem[]; capacity: number; isBottleneck: boolean; onOpenOp?: (n: string) => void;
}) {
  const inHouse = items.filter(i => !i.outsourced);
  const pairsHere = inHouse.filter(i => i.isCurrent).reduce((a, i) => a + i.pairsAtSector, 0);
  const pairsAll = inHouse.reduce((a, i) => a + i.pairsAtSector, 0);
  const daysOfWork = capacity > 0 ? pairsAll / capacity : 0;
  return (
    <article className={`flex min-h-0 flex-col rounded-md border bg-card ${isBottleneck ? 'border-red-500/50' : 'border-border'}`}>
      <header className="flex items-baseline justify-between gap-2 border-b border-border px-3 py-1.5">
        <h3 className="truncate text-xs font-bold uppercase tracking-wide">{sector}</h3>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground" title="Pares no setor agora · pares que ainda vão passar · dias de trabalho na capacidade atual">
          {pairsHere.toLocaleString('pt-BR')} agora · {pairsAll.toLocaleString('pt-BR')} a passar · {daysOfWork.toFixed(1)} d
        </span>
      </header>
      {items.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">Sem OP aberta neste setor.</p>
      ) : (
        <ol className="max-h-80 divide-y divide-border/60 overflow-y-auto">
          {items.map(it => {
            const op = it.op;
            const f = it.flags;
            return (
              <li key={op.order_id} className={`px-3 py-1.5 text-xs ${it.isCurrent ? '' : 'opacity-70'}`}>
                <div className="flex items-center gap-1.5">
                  <span className="w-6 shrink-0 font-mono text-[10px] text-muted-foreground" title="Posição na fila do motor">#{op.queue_position}</span>
                  <button
                    type="button"
                    className="truncate font-semibold hover:underline disabled:no-underline"
                    disabled={!onOpenOp}
                    onClick={() => onOpenOp?.(op.order_number)}
                    title="Abrir no Chão"
                  >
                    {op.order_number}
                  </button>
                  <span className="truncate text-muted-foreground">{op.sale_order_number ?? ''}</span>
                  <span className="ml-auto shrink-0 font-mono font-semibold">{it.pairsAtSector.toLocaleString('pt-BR')} pr</span>
                </div>
                <div className="truncate pl-7 text-muted-foreground">
                  {op.reference_name} · {op.color}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1 pl-7">
                  {it.isCurrent
                    ? <Badge variant="info">no setor</Badge>
                    : <Badge variant="outline">a caminho</Badge>}
                  <Badge variant={f.kind === 'complexo' ? 'warning-soft' : 'outline'}>{f.kind === 'complexo' ? 'complexo' : 'simples'}</Badge>
                  {it.outsourced && <Badge variant="warning-soft"><Truck className="mr-0.5 h-3 w-3" />prestador</Badge>}
                  {f.atelierState === 'aguardando_corte' && <Badge variant="warning-soft"><Scissors className="mr-0.5 h-3 w-3" />cabedal s/ corte</Badge>}
                  {f.atelierState === 'no_prestador' && !it.outsourced && <Badge variant="warning-soft"><Truck className="mr-0.5 h-3 w-3" />cabedal no prestador</Badge>}
                  {f.waitingMaterial && <Badge variant="warning-soft" title={f.materialReason ?? undefined}><Package className="mr-0.5 h-3 w-3" />material</Badge>}
                  {f.late && <Badge variant="destructive-soft">+{op.late_days}d</Badge>}
                </div>
                <div className="mt-0.5 flex items-center gap-2 pl-7 font-mono text-[10px] text-muted-foreground">
                  <CalendarBlank className="h-3 w-3" />
                  <span title="Datas deste setor na agenda do motor">agenda {it.firstDate ? `${fmtDM(it.firstDate)}${it.lastDate && it.lastDate !== it.firstDate ? `–${fmtDM(it.lastDate)}` : ''}` : '—'}</span>
                  <span className={f.late ? 'text-red-600 dark:text-red-400' : ''} title="Prazo de faturamento × previsão do motor">
                    fatura {fmtDM(op.due_date)} · prev. {fmtDM(op.projected_completion)}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </article>
  );
}

export default SectorPanorama;
