import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  Factory, Warning, Gauge, Lightning, CaretRight, CalendarBlank, Lock,
} from '@phosphor-icons/react';
import { useSectorPeriodLoad, type SectorPeriodLoad } from '@/hooks/useSectorPeriodLoad';
import type { DailySeverity } from '@/lib/sectorCapacity';

// Mesma linguagem visual do gargalo diário (severidade → cor).
const SEV: Record<DailySeverity, { bar: string; text: string; chip: string; ring: string; dot: string; label: string }> = {
  idle:    { bar: 'bg-muted-foreground/25', text: 'text-muted-foreground', chip: 'bg-muted/60 text-muted-foreground border-border', ring: 'hover:border-foreground/30', dot: 'bg-muted-foreground/40', label: 'sem demanda' },
  ok:      { bar: 'bg-green-500', text: 'text-green-700 dark:text-green-400', chip: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30', ring: 'hover:border-green-500/50', dot: 'bg-green-500', label: 'folga' },
  warning: { bar: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400', chip: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/40', ring: 'hover:border-amber-500/60', dot: 'bg-amber-500', label: 'atenção' },
  critical:{ bar: 'bg-red-500', text: 'text-red-700 dark:text-red-400', chip: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/40', ring: 'hover:border-red-500/70', dot: 'bg-red-500', label: 'crítico' },
  unknown: { bar: 'bg-muted-foreground/25', text: 'text-muted-foreground', chip: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30', ring: 'hover:border-amber-500/50', dot: 'bg-amber-500/60', label: 'sem capacidade' },
};
const SEV_RANK: Record<DailySeverity, number> = { critical: 0, warning: 1, unknown: 2, ok: 3, idle: 4 };

const GRANS = [
  { key: 'dia', label: 'Diário', len: 0 },
  { key: 'semana', label: 'Semanal', len: 6 },
  { key: 'quinzena', label: 'Quinzenal', len: 14 },
  { key: 'mes', label: 'Mensal', len: 29 },
] as const;

function localISO(d: Date): string {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
const todayISO = () => localISO(new Date());
function addDaysISO(iso: string, n: number): string { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return localISO(d); }
function diffDays(a: string, b: string): number { return Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000); }
const fmtBR = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const num = (n: number) => n.toLocaleString('pt-BR');

export default function SectorBottleneckView() {
  const [sp, setSp] = useSearchParams();
  const today = todayISO();
  const from = sp.get('from') || today;
  const to = sp.get('to') || today;
  const [selected, setSelected] = useState<string | null>(null);

  const setRange = (f: string, t: string) => {
    setSp((prev) => { const p = new URLSearchParams(prev); p.set('from', f); p.set('to', t > f ? t : f); return p; }, { replace: true });
  };
  const activeGran = useMemo(() => {
    if (from !== today) return null;
    const d = diffDays(from, to);
    return GRANS.find((g) => g.len === d)?.key ?? null;
  }, [from, to, today]);

  const { data, isLoading } = useSectorPeriodLoad(from, to);
  const sectors = data?.sectors ?? [];
  const summary = data?.summary;

  // Gargalo no topo: severidade depois utilização desc.
  const ordered = useMemo(
    () => [...sectors].sort((a, b) =>
      SEV_RANK[a.severity] - SEV_RANK[b.severity]
      || b.utilizationPct - a.utilizationPct
      || b.demandPairs - a.demandPairs,
    ),
    [sectors],
  );
  const sel = ordered.find((s) => s.sector === selected) || null;

  return (
    <div className="space-y-5">
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · GARGALO POR SETOR"
        title="Gargalos"
        description="Onde está apertando — demanda planejada vs. capacidade de cada setor no período escolhido, mais o que está no chão de fábrica agora. Clique num setor pra ver as OPs."
      />

      {/* Seletor de período */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5" role="group" aria-label="Granularidade">
          {GRANS.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => setRange(today, addDaysISO(today, g.len))}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                activeGran === g.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {g.label}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-1.5">
          <div>
            <label className="mb-0.5 block text-[10px] font-mono uppercase tracking-wider text-muted-foreground">De</label>
            <Input type="date" value={from} max={to} onChange={(e) => setRange(e.target.value || today, to)} className="h-9 w-[150px]" />
          </div>
          <div>
            <label className="mb-0.5 block text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Até</label>
            <Input type="date" value={to} min={from} onChange={(e) => setRange(from, e.target.value || from)} className="h-9 w-[150px]" />
          </div>
        </div>
        <div className="flex items-center gap-1.5 pb-1 text-xs text-muted-foreground">
          <CalendarBlank className="h-3.5 w-3.5" />
          {from === to ? fmtBR(from) : `${fmtBR(from)} – ${fmtBR(to)}`}
          <Badge variant="outline" className="ml-1 text-[10px]">{data?.businessDays ?? 0} dias úteis</Badge>
        </div>
      </div>

      <StatGrid>
        <StatCard label="Pares planejados" value={summary?.demandPairs ?? 0} icon={Factory} hint="demanda do cronograma no período" />
        <StatCard label="Setores em alerta" value={summary?.sectorsAlert ?? 0} icon={Warning}
          tone={(summary?.sectorsAlert ?? 0) > 0 ? 'warning' : 'default'} hint="utilização acima da capacidade" />
        <StatCard label="Em produção agora" value={summary?.realPairs ?? 0} icon={Gauge} hint="pares no chão de fábrica" />
        <StatCard label="OPs atrasadas" value={summary?.realDelayed ?? 0} icon={Lightning}
          tone={(summary?.realDelayed ?? 0) > 0 ? 'warning' : 'default'} hint="acima do tempo esperado" />
      </StatGrid>

      <Panel eyebrow={`${ordered.filter((s) => s.demandPairs > 0 || s.realPairs > 0).length} setores com carga`} title="Carga por setor no período">
        {isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Calculando carga do período…</div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {ordered.map((s) => {
              const sev = SEV[s.severity];
              const isOpen = selected === s.sector;
              return (
                <button
                  key={s.sector}
                  type="button"
                  onClick={() => setSelected(isOpen ? null : s.sector)}
                  className={cn(
                    'flex flex-col rounded-xl border bg-card p-3.5 text-left transition-colors',
                    isOpen ? 'border-primary/50 ring-1 ring-primary/20' : cn('border-border/60', sev.ring),
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={cn('h-2 w-2 shrink-0 rounded-full', sev.dot)} />
                      <span className="truncate text-sm font-semibold text-foreground">{s.label}</span>
                    </div>
                    <Badge variant="outline" className={cn('shrink-0 text-[10px]', sev.chip)}>
                      {s.severity === 'idle' || s.severity === 'unknown' ? sev.label : `${s.utilizationPct}%`}
                    </Badge>
                  </div>

                  <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-muted">
                    <div className={cn('h-full rounded-full transition-all', sev.bar)} style={{ width: `${Math.min(100, s.utilizationPct)}%` }} />
                  </div>

                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      <span className={cn('font-mono font-semibold', sev.text)}>{num(s.demandPairs)}</span>
                      <span className="text-muted-foreground/70"> / {num(s.capacityPairs)} pares</span>
                    </span>
                    <span className="flex items-center gap-2 text-muted-foreground">
                      {s.realPairs > 0 && <span className="font-mono">{num(s.realPairs)} agora</span>}
                      {s.realDelayedCount > 0 && (
                        <span className="flex items-center gap-0.5 text-amber-600"><Lightning className="h-3 w-3" />{s.realDelayedCount}</span>
                      )}
                      <CaretRight className={cn('h-3.5 w-3.5 transition-transform', isOpen && 'rotate-90')} />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Panel>

      {sel && <SectorDrill sector={sel} period={from === to ? fmtBR(from) : `${fmtBR(from)} – ${fmtBR(to)}`} />}
    </div>
  );
}

function SectorDrill({ sector, period }: { sector: SectorPeriodLoad; period: string }) {
  return (
    <Panel eyebrow={`${period} · cap. ${num(sector.capacityPerDay)}/dia × ${sector.businessDays} dias úteis`} title={`${sector.label} — OPs`}>
      {sector.realOps.length > 0 && (
        <div className="mb-3">
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">No setor agora ({sector.realOps.length})</p>
          <div className="space-y-1">
            {sector.realOps.map((o) => (
              <div key={o.order_id} className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5 text-xs">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="font-mono font-semibold">{o.order_number || '—'}</span>
                  <span className="truncate text-muted-foreground">{o.sheet_name}{o.color ? ` · ${o.color}` : ''}</span>
                  {o.bottleneck?.unstarted && <Badge variant="outline" className="h-4 gap-0.5 bg-amber-500/10 text-[9px] text-amber-700 border-amber-500/30 dark:text-amber-400"><Lock className="h-2.5 w-2.5" />sem início</Badge>}
                  {o.bottleneck && o.bottleneck.severity !== 'ok' && !o.bottleneck.unstarted && <Badge variant="outline" className="h-4 bg-red-500/10 text-[9px] text-red-700 border-red-500/30 dark:text-red-400">atrasada</Badge>}
                </span>
                <span className="shrink-0 font-mono font-semibold">{num(o.remaining)} pares</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Planejadas no período ({sector.ops.length})</p>
      {sector.ops.length === 0 ? (
        <p className="py-3 text-center text-xs text-muted-foreground">Sem OPs planejadas neste setor no período.</p>
      ) : (
        <div className="space-y-1">
          {sector.ops.map((o) => (
            <div key={o.order_id} className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2.5 py-1.5 text-xs">
              <span className="flex min-w-0 items-center gap-2">
                <span className="font-mono font-semibold">{o.order_number || '—'}</span>
                <span className="truncate text-muted-foreground">{o.sheet_name}{o.color ? ` · ${o.color}` : ''}</span>
              </span>
              <span className="shrink-0 font-mono font-semibold">{num(o.pairs)} pares</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
