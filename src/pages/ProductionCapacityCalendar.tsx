import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { computeSectorLeadTimeDays } from '@/lib/leadTime';
import type { SectorKey } from '@/lib/leadTime';
import { computeParallelWindows } from '@/lib/sectorCapacity';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/empty-state';
import { CircleNotch as Loader2, CaretLeft as ChevronLeft, CaretRight as ChevronRight, CalendarBlank as CalendarDays, ChartBar as BarChart3, Info, ArrowsClockwise as RefreshCw } from '@phosphor-icons/react';
import {
  format, startOfWeek, addDays, addWeeks,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';

// ── Constants ───────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

const DISPLAY_SECTORS: { key: SectorKey; label: string }[] = [
  { key: 'corte_palmilha', label: 'Corte Palmilha' },
  { key: 'corte_forracao', label: 'Corte Forração' },
  { key: 'mesa',           label: 'Aviamento' },
  { key: 'costura',        label: 'Costura' },   // FIX D3
  { key: 'silk',           label: 'Silk' },
  { key: 'colagem',        label: 'Colagem' },
  { key: 'montagem',       label: 'Montagem' },
  { key: 'solagem',        label: 'Solagem' },
  { key: 'acabamento',     label: 'Acabamento' },
];

// 8 semantic palettes cycling through waves
const WAVE_PALETTES = [
  { chip: 'bg-blue-500/15 border-blue-500/40 text-blue-700 dark:text-blue-300', bar: 'bg-blue-500' },
  { chip: 'bg-purple-500/15 border-purple-500/40 text-purple-700 dark:text-purple-300', bar: 'bg-purple-500' },
  { chip: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300', bar: 'bg-emerald-500' },
  { chip: 'bg-orange-500/15 border-orange-500/40 text-orange-700 dark:text-orange-300', bar: 'bg-orange-500' },
  { chip: 'bg-pink-500/15 border-pink-500/40 text-pink-700 dark:text-pink-300', bar: 'bg-pink-500' },
  { chip: 'bg-cyan-500/15 border-cyan-500/40 text-cyan-700 dark:text-cyan-300', bar: 'bg-cyan-500' },
  { chip: 'bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-300', bar: 'bg-amber-500' },
  { chip: 'bg-indigo-500/15 border-indigo-500/40 text-indigo-700 dark:text-indigo-300', bar: 'bg-indigo-500' },
];

// ── Types ────────────────────────────────────────────────────────────────────

type ViewMode = 'daily' | 'weekly';

interface CapBlock {
  waveId: string;
  waveCode: string;
  paletteIdx: number;
  referenceCode: string;
  referenceName: string;
  itemColor: string;
  sector: SectorKey;
  startDate: Date; // inclusive (first day)
  endDate: Date;   // exclusive (= start of next sector, or deadline)
  totalQty: number;
  capPerDay: number;
  leadTimeDays: number;
  qtyPerDay: number;
}

interface ColDef {
  label: string;
  sub: string;
  startDate: Date;
  endDate: Date; // inclusive column end (for overlap check)
}

// ── Date helpers ─────────────────────────────────────────────────────────────

function addBizDays(date: Date, days: number): Date {
  if (days === 0) return new Date(date);
  const d = new Date(date);
  let added = 0;
  const dir = days > 0 ? 1 : -1;
  while (added < Math.abs(days)) {
    d.setTime(d.getTime() + dir * DAY_MS);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

function bizDaysInRange(start: Date, endExclusive: Date): number {
  if (endExclusive.getTime() <= start.getTime()) return 1;
  let count = 0;
  const cur = new Date(start);
  while (cur.getTime() < endExclusive.getTime()) {
    if (cur.getDay() !== 0 && cur.getDay() !== 6) count++;
    cur.setTime(cur.getTime() + DAY_MS);
  }
  return Math.max(1, count);
}

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }

// ── Sector helpers ────────────────────────────────────────────────────────────

const SECTOR_NORM: Record<string, SectorKey> = {
  'corte palmilha': 'corte_palmilha', 'corte forração': 'corte_forracao',
  'corte forracao': 'corte_forracao', mesa: 'mesa', silk: 'silk',
  serigrafia: 'silk', colagem: 'colagem', montagem: 'montagem',
  solagem: 'solagem', acabamento: 'acabamento', expedição: 'expedicao',
  expedicao: 'expedicao', corte: 'corte_palmilha', palmilha: 'corte_palmilha',
  // FIX D3: Costura é setor próprio desde PR 2 (não é mais alias de corte_forracao)
  costura: 'costura',
  forração: 'corte_forracao', forracao: 'corte_forracao',
  aviamento: 'mesa',
};

function hasSector(sheet: any, key: SectorKey): boolean {
  const sectors: string[] = Array.isArray(sheet?.production_sectors) ? sheet.production_sectors : [];
  if (sectors.length === 0) return true;
  return sectors.some((s: string) => {
    const norm = SECTOR_NORM[s.toLowerCase().trim()];
    return norm === key;
  });
}

// ── Window computation ────────────────────────────────────────────────────────

type WindowMap = Partial<Record<SectorKey, { start: Date; end: Date; cap: number }>>;

// FIX D2+D3: usa computeParallelWindows de lib/sectorCapacity.ts. Antes essa
// tela calculava cascata sequencial e ignorava Costura.
function computeWindows(sheet: any, qty: number, deadline: Date, _defaults: any | null): WindowMap {
  const w = computeParallelWindows(sheet, qty, deadline);
  const out: WindowMap = {};
  if (w.corte_palmilha.required) out.corte_palmilha = { start: w.corte_palmilha.start, end: w.corte_palmilha.end, cap: w.corte_palmilha.cap };
  if (w.corte_forracao.required) out.corte_forracao = { start: w.corte_forracao.start, end: w.corte_forracao.end, cap: w.corte_forracao.cap };
  if (w.costura.required && w.costura.cap > 0)
                                 out.costura        = { start: w.costura.start,        end: w.costura.end,        cap: w.costura.cap };
  if (w.mesa.required)           out.mesa           = { start: w.mesa.start,           end: w.mesa.end,           cap: w.mesa.cap };
  if (w.silk.required)           out.silk           = { start: w.silk.start,           end: w.silk.end,           cap: w.silk.cap };
  if (w.colagem.required)        out.colagem        = { start: w.colagem.start,        end: w.colagem.end,        cap: w.colagem.cap };
  if (w.montagem.required)       out.montagem       = { start: w.montagem.start,       end: w.montagem.end,       cap: w.montagem.cap };
  if (w.solagem.required)        out.solagem        = { start: w.solagem.start,        end: w.solagem.end,        cap: w.solagem.cap };
  if (w.acabamento.required)     out.acabamento     = { start: w.acabamento.start,     end: w.acabamento.end,     cap: w.acabamento.cap };
  return out;
}

// ── Data hook ─────────────────────────────────────────────────────────────────

function useCapacityCalendar() {
  return useQuery({
    queryKey: ['production_capacity_calendar'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [wavesRes, defaultsRes] = await Promise.all([
        supabase
          .from('production_waves')
          .select(`
            id, code, status, earliest_deadline, total_pairs,
            production_wave_items(
              id, reference_id, total_quantity, color,
              technical_sheets(
                id, code, name, shoe_category, production_sectors,
                cutting_capacity_per_day, sewing_capacity_per_day,
                assembly_capacity_per_day, finishing_capacity_per_day,
                mesa_daily_capacity, silk_capacity_per_day,
                gluing_capacity_per_day, soling_capacity_per_day,
                costura_capacity_per_day,
                lead_time_corte_dias, lead_time_costura_dias,
                lead_time_montagem_dias, lead_time_acabamento_dias
              )
            )
          `)
          .in('status', ['draft', 'planning', 'running'])
          .not('earliest_deadline', 'is', null)
          .order('earliest_deadline', { ascending: true }),
        supabase
          .from('default_lead_times' as any)
          .select('shoe_category, cutting_capacity_per_day, sewing_capacity_per_day, mesa_daily_capacity, assembly_capacity_per_day, finishing_capacity_per_day, silk_capacity_per_day, gluing_capacity_per_day, soling_capacity_per_day, costura_capacity_per_day, lead_time_corte_dias, lead_time_costura_dias, lead_time_montagem_dias, lead_time_acabamento_dias'),
      ]);

      if (wavesRes.error) throw wavesRes.error;

      const defaultsMap = new Map<string, any>();
      ((defaultsRes.data || []) as any[]).forEach((d: any) => {
        if (d.shoe_category) defaultsMap.set(d.shoe_category, d);
      });

      const waves = (wavesRes.data || []) as any[];
      const blocks: CapBlock[] = [];
      const waveColorMap = new Map<string, number>();
      let colorIdx = 0;

      for (const wave of waves) {
        if (!wave.earliest_deadline) continue;

        if (!waveColorMap.has(wave.id)) {
          waveColorMap.set(wave.id, colorIdx % WAVE_PALETTES.length);
          colorIdx++;
        }
        const paletteIdx = waveColorMap.get(wave.id)!;
        const deadline = new Date(wave.earliest_deadline + 'T00:00:00');

        for (const item of (wave.production_wave_items || [])) {
          const sheet = item.technical_sheets;
          if (!sheet) continue;
          const qty = Number(item.total_quantity || 0);
          if (qty <= 0) continue;

          const defaults = defaultsMap.get(sheet.shoe_category) ?? null;
          const wins = computeWindows(sheet, qty, deadline, defaults);

          for (const [sector, w] of Object.entries(wins)) {
            if (!w) continue;
            const lt = bizDaysInRange(w.start, w.end);
            blocks.push({
              waveId: wave.id,
              waveCode: wave.code,
              paletteIdx,
              referenceCode: sheet.code || '',
              referenceName: sheet.name || '',
              itemColor: item.color || '',
              sector: sector as SectorKey,
              startDate: w.start,
              endDate: w.end,   // exclusive
              totalQty: qty,
              capPerDay: w.cap,
              leadTimeDays: lt,
              qtyPerDay: qty / lt,
            });
          }
        }
      }

      // Summary per sector for the next 30 business days
      const sectorSummary = computeSectorSummary(blocks);

      return { blocks, waveColorMap, sectorSummary };
    },
  });
}

// ── Sector load summary (next 14 days) ───────────────────────────────────────

function computeSectorSummary(blocks: CapBlock[]) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const horizon = addDays(today, 14);

  const summary: Record<SectorKey, { peakQtyPerDay: number; peakCapPerDay: number }> = {} as any;
  for (const { key } of DISPLAY_SECTORS) {
    summary[key] = { peakQtyPerDay: 0, peakCapPerDay: 0 };
  }

  // For each business day in the next 14 days
  const cur = new Date(today);
  while (cur <= horizon) {
    if (cur.getDay() !== 0 && cur.getDay() !== 6) {
      const dayISO = isoDate(cur);
      for (const { key } of DISPLAY_SECTORS) {
        const dayBlocks = blocks.filter(b =>
          b.sector === key &&
          isoDate(b.startDate) <= dayISO &&
          isoDate(b.endDate) > dayISO,
        );
        const totalQty = dayBlocks.reduce((s, b) => s + b.qtyPerDay, 0);
        // All blocks in the same sector share the same daily capacity — take the max, not the sum
        const totalCap = dayBlocks.reduce((s, b) => Math.max(s, b.capPerDay), 0);
        if (totalQty > summary[key].peakQtyPerDay) {
          summary[key].peakQtyPerDay = totalQty;
          summary[key].peakCapPerDay = totalCap;
        }
      }
    }
    cur.setTime(cur.getTime() + DAY_MS);
  }
  return summary;
}

// ── Column generation ─────────────────────────────────────────────────────────

function generateColumns(viewMode: ViewMode, offset: number): ColDef[] {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const monday = startOfWeek(today, { weekStartsOn: 1 });

  if (viewMode === 'daily') {
    const baseMonday = addWeeks(monday, offset);
    return [0, 1, 2, 3, 4].map(i => {
      const day = addDays(baseMonday, i);
      const isToday = isoDate(day) === isoDate(today);
      return {
        label: format(day, 'EEE', { locale: ptBR }),
        sub: isToday ? 'Hoje' : format(day, 'dd/MM'),
        startDate: day,
        endDate: day,
      };
    });
  }

  // Weekly: 6 weeks from the 6*offset week
  const baseMonday = addWeeks(monday, offset * 6);
  return Array.from({ length: 6 }, (_, i) => {
    const wStart = addWeeks(baseMonday, i);
    const wEnd = addDays(wStart, 4);
    const weekNum = format(wStart, 'w');
    return {
      label: `Sem. ${weekNum}`,
      sub: `${format(wStart, 'dd/MM')} – ${format(wEnd, 'dd/MM')}`,
      startDate: wStart,
      endDate: wEnd,
    };
  });
}

// ── Overlap logic ──────────────────────────────────────────────────────────────

function blocksForCell(blocks: CapBlock[], sector: SectorKey, col: ColDef): CapBlock[] {
  // block active if [block.start, block.end) overlaps with [col.start, col.end]
  // → block.start <= col.endDate AND block.end > col.startDate
  return blocks.filter(b =>
    b.sector === sector &&
    b.startDate <= col.endDate &&
    b.endDate > col.startDate,
  );
}

// ── Cell component ────────────────────────────────────────────────────────────

function CapCell({ blocks, viewMode }: { blocks: CapBlock[]; viewMode: ViewMode }) {
  if (blocks.length === 0) {
    return <div className="h-full min-h-[52px] bg-muted/10" />;
  }

  return (
    <div className="p-1.5 space-y-1.5 min-h-[52px]">
      {blocks.map((b, i) => {
        const palette = WAVE_PALETTES[b.paletteIdx];
        const qty = viewMode === 'weekly' ? b.qtyPerDay : b.qtyPerDay;
        const cap = b.capPerDay;
        const pct = cap > 0 ? Math.min(100, Math.round((qty / cap) * 100)) : (qty > 0 ? 100 : 0);
        const barColor = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500';

        return (
          <TooltipProvider key={`${b.waveId}-${b.referenceCode}-${i}`} delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className={`rounded border px-1.5 py-1 text-[10px] leading-tight cursor-default ${palette.chip}`}>
                  <div className="font-semibold truncate max-w-[100px]">{b.waveCode}</div>
                  <div className="text-muted-foreground truncate max-w-[100px]">{b.referenceCode}{b.itemColor ? ` · ${b.itemColor}` : ''}</div>
                  {cap > 0 && (
                    <div className="mt-1">
                      <div className="flex justify-between text-[9px] mb-0.5">
                        <span>{Math.round(qty)}<span className="opacity-60">/{cap}</span></span>
                        <span className={pct >= 90 ? 'text-red-600 font-bold' : pct >= 70 ? 'text-amber-600 font-semibold' : ''}>{pct}%</span>
                      </div>
                      <div className="h-1 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )}
                  {cap === 0 && (
                    <div className="text-[9px] opacity-60 mt-0.5">{Math.round(b.totalQty)} pares · {b.leadTimeDays}d</div>
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs max-w-[220px]">
                <p className="font-semibold">{b.waveCode} — {b.referenceName}</p>
                {b.itemColor && <p>Cor: {b.itemColor}</p>}
                <p>Total: {b.totalQty} pares em {b.leadTimeDays} dia{b.leadTimeDays !== 1 ? 's' : ''}</p>
                <p>Ritmo: {Math.round(qty)} pares/dia</p>
                {cap > 0 && <p>Capacidade: {cap} pares/dia ({pct}%)</p>}
                <p className="opacity-70 text-[10px]">
                  {format(b.startDate, 'dd/MM')} → {format(addDays(b.endDate, -1), 'dd/MM')}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      })}
    </div>
  );
}

// ── Summary cards ─────────────────────────────────────────────────────────────

function SectorSummaryCards({
  summary,
}: {
  summary: ReturnType<typeof computeSectorSummary>;
}) {
  const active = DISPLAY_SECTORS.filter(s => summary[s.key].peakQtyPerDay > 0);
  if (active.length === 0) return null;

  return (
    <StatGrid>
      {active.map(({ key, label }) => {
        const { peakQtyPerDay, peakCapPerDay } = summary[key];
        const pct = peakCapPerDay > 0 ? Math.min(100, Math.round((peakQtyPerDay / peakCapPerDay) * 100)) : 0;
        return (
          <StatCard
            key={key}
            label={label}
            value={Math.round(peakQtyPerDay)}
            unit={`/${peakCapPerDay > 0 ? peakCapPerDay : '?'} par/dia`}
            tone={pct >= 90 ? 'destructive' : pct >= 70 ? 'warning' : 'default'}
            delta={peakCapPerDay > 0 ? `${pct}%` : undefined}
            deltaTone={pct >= 90 ? 'down' : pct >= 70 ? 'neutral' : 'up'}
            hint="pico (próx. 14 dias)"
          />
        );
      })}
    </StatGrid>
  );
}

// ── Wave legend ───────────────────────────────────────────────────────────────

function WaveLegend({ waveColorMap, blocks }: { waveColorMap: Map<string, number>; blocks: CapBlock[] }) {
  const waves = Array.from(
    new Map(blocks.map(b => [b.waveId, { code: b.waveCode, paletteIdx: b.paletteIdx }])).values(),
  );
  if (waves.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <span className="text-xs text-muted-foreground">Legenda:</span>
      {waves.map(w => (
        <div key={w.code} className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded border ${WAVE_PALETTES[w.paletteIdx].chip}`}>
          <div className={`w-2 h-2 rounded-full ${WAVE_PALETTES[w.paletteIdx].bar}`} />
          {w.code}
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ProductionCapacityCalendar() {
  const [viewMode, setViewMode] = useState<ViewMode>('daily');
  const [offset, setOffset] = useState(0);

  const { data, isLoading, error, refetch, isFetching } = useCapacityCalendar();
  const blocks = data?.blocks ?? [];
  const waveColorMap = data?.waveColorMap ?? new Map();
  const sectorSummary = data?.sectorSummary;

  const columns = useMemo(() => generateColumns(viewMode, offset), [viewMode, offset]);

  // Label for the period navigator
  const periodLabel = useMemo(() => {
    if (viewMode === 'daily') {
      const first = columns[0];
      const last = columns[columns.length - 1];
      return `${format(first.startDate, "dd 'de' MMMM", { locale: ptBR })} – ${format(last.endDate, "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}`;
    }
    const first = columns[0];
    const last = columns[columns.length - 1];
    return `${format(first.startDate, "dd/MM")} – ${format(last.endDate, "dd/MM/yyyy")}`;
  }, [columns, viewMode]);

  function goToday() { setOffset(0); }

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary opacity-50" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-destructive">
        <p>Erro ao carregar dados de capacidade.</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-5">
        <EditorialPageHeader
          sectionLabel="PRODUÇÃO · Capacidade"
          title="Calendário de Produção"
          description="Carga planejada por setor, calculada pelas ondas e cronograma reverso"
          actions={
            <>
              {/* View toggle */}
              <div className="flex rounded-md border overflow-hidden">
                <button
                  onClick={() => { setViewMode('daily'); setOffset(0); }}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5
                    ${viewMode === 'daily' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/40 text-muted-foreground'}`}
                >
                  <CalendarDays className="h-3 w-3" /> Diário
                </button>
                <button
                  onClick={() => { setViewMode('weekly'); setOffset(0); }}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5
                    ${viewMode === 'weekly' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/40 text-muted-foreground'}`}
                >
                  <BarChart3 className="h-3 w-3" /> Semanal
                </button>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => refetch()} disabled={isFetching} aria-label="Atualizar dados">
                <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
              </Button>
            </>
          }
        />

        {/* Summary cards */}
        {sectorSummary && <SectorSummaryCards summary={sectorSummary} />}

        {/* Navigation + legend */}
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setOffset(o => o - 1)} aria-label="Período anterior">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium min-w-[200px] text-center">{periodLabel}</span>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setOffset(o => o + 1)} aria-label="Próximo período">
              <ChevronRight className="h-4 w-4" />
            </Button>
            {offset !== 0 && (
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={goToday}>
                Hoje
              </Button>
            )}
          </div>
          {data && <WaveLegend waveColorMap={waveColorMap} blocks={blocks} />}
        </div>

        {/* Grid */}
        {blocks.length === 0 ? (
          <div className="rounded-lg border border-border">
            <EmptyState
              icon={CalendarDays}
              title="Nenhuma onda em planejamento ou produção"
              description="Crie ondas de produção com data de entrega para visualizar o calendário."
            />
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse min-w-[600px]">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-muted/40 border-b border-r border-border px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-36 min-w-[140px]">
                    Setor
                  </th>
                  {columns.map((col, ci) => {
                    const isToday = viewMode === 'daily' && isoDate(col.startDate) === isoDate(new Date());
                    return (
                      <th
                        key={ci}
                        className={`border-b border-r border-border px-2 py-2 text-center text-[10px] font-bold uppercase tracking-wider min-w-[120px]
                          ${isToday ? 'bg-primary/10 text-primary' : 'bg-muted/40 text-muted-foreground'}`}
                      >
                        <div className="capitalize">{col.label}</div>
                        <div className={`font-normal text-[11px] ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>{col.sub}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {DISPLAY_SECTORS.map(({ key, label }, ri) => {
                  const rowHasAny = columns.some(col => blocksForCell(blocks, key, col).length > 0);
                  return (
                    <tr key={key} className={ri % 2 === 0 ? 'bg-background' : 'bg-muted/10'}>
                      <td className="sticky left-0 z-10 bg-inherit border-b border-r border-border px-3 py-2">
                        <span className={`text-xs font-medium ${rowHasAny ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {label}
                        </span>
                      </td>
                      {columns.map((col, ci) => {
                        const cellBlocks = blocksForCell(blocks, key, col);
                        const isToday = viewMode === 'daily' && isoDate(col.startDate) === isoDate(new Date());
                        return (
                          <td
                            key={ci}
                            className={`border-b border-r border-border align-top p-0
                              ${isToday ? 'bg-primary/5' : ''}`}
                          >
                            <CapCell blocks={cellBlocks} viewMode={viewMode} />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Legend note */}
        <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <span>
            Carga calculada a partir das fichas técnicas de cada referência nas ondas (capacidade por setor →
            tempo por onda). Setores sem capacidade configurada não exibem barra de utilização.
            As datas são calculadas no cronograma reverso a partir do prazo de entrega de cada onda.
          </span>
        </div>
      </div>
    </TooltipProvider>
  );
}
