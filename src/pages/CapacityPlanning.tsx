import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Scissors, Stack as Layers, Hammer, Sparkle as Sparkles,
  TrendUp as TrendingUp, Hand, Pen, Printer, Flame, Footprints, Package,
  CaretRight, ArrowSquareOut, Lightning, CheckCircle, Warning,
} from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, addDays, parseISO, startOfWeek } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { computeParallelWindows, setHolidayCache } from '@/lib/sectorCapacity';
import { useHolidays } from '@/hooks/useTimesheet';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';

// ─── TYPES & CONFIG ──────────────────────────────────────────────────────────

type SectorKey =
  | 'corte_palmilha' | 'corte_forracao' | 'mesa' | 'costura' | 'silk'
  | 'colagem' | 'montagem' | 'solagem' | 'acabamento' | 'expedicao';

type StatusKey = 'ok' | 'warning' | 'critical';

const SECTORS = [
  { key: 'corte_palmilha' as SectorKey, label: 'Corte Palmilha', short: 'Cor. Palm', icon: Scissors,   capField: 'sewing_capacity_per_day',    defaultCap: 500 },
  { key: 'corte_forracao' as SectorKey, label: 'Corte Forração', short: 'Cor. Forr', icon: Layers,     capField: 'cutting_capacity_per_day',   defaultCap: 450 },
  { key: 'mesa'           as SectorKey, label: 'Aviamento',      short: 'Aviam.',    icon: Hand,       capField: 'mesa_daily_capacity',        defaultCap: 275 },
  { key: 'costura'        as SectorKey, label: 'Costura',        short: 'Costura',   icon: Pen,        capField: 'costura_capacity_per_day',   defaultCap: 300 },
  { key: 'silk'           as SectorKey, label: 'Silk',           short: 'Silk',      icon: Printer,    capField: 'silk_capacity_per_day',      defaultCap: 400 },
  { key: 'colagem'        as SectorKey, label: 'Colagem',        short: 'Colag.',    icon: Flame,      capField: 'gluing_capacity_per_day',    defaultCap: 500 },
  { key: 'montagem'       as SectorKey, label: 'Montagem',       short: 'Mont.',     icon: Hammer,     capField: 'assembly_capacity_per_day',  defaultCap: 300 },
  { key: 'solagem'        as SectorKey, label: 'Solagem',        short: 'Solag.',    icon: Footprints, capField: 'soling_capacity_per_day',    defaultCap: 425 },
  { key: 'acabamento'     as SectorKey, label: 'Acabamento',     short: 'Acab.',     icon: Sparkles,   capField: 'finishing_capacity_per_day', defaultCap: 500 },
  { key: 'expedicao'      as SectorKey, label: 'Expedição',      short: 'Exped.',    icon: Package,    capField: 'finishing_capacity_per_day', defaultCap: 1000 },
] as const;

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function bizDaysBetween(a: Date, b: Date): number {
  if (b <= a) return 1;
  const d = new Date(a);
  let c = 0;
  while (d <= b) {
    if (d.getDay() !== 0 && d.getDay() !== 6) c++;
    d.setDate(d.getDate() + 1);
  }
  return Math.max(1, c);
}

const SECTOR_NORM: Record<string, SectorKey> = {
  'corte palmilha': 'corte_palmilha', 'corte_palmilha': 'corte_palmilha', 'palmilha': 'corte_palmilha', 'corte': 'corte_palmilha',
  'corte forração': 'corte_forracao', 'corte forracão': 'corte_forracao', 'corte_forracao': 'corte_forracao',
  'costura': 'costura',
  'forração': 'corte_forracao', 'forracao': 'corte_forracao',
  'mesa': 'mesa', 'aviamento': 'mesa',
  'silk': 'silk', 'serigrafia': 'silk',
  'colagem': 'colagem',
  'montagem': 'montagem',
  'solagem': 'solagem',
  'acabamento': 'acabamento',
  'expedição': 'expedicao', 'expedicao': 'expedicao',
};

function hasSectorActive(sheet: any, key: SectorKey): boolean {
  const sectors: string[] = Array.isArray(sheet?.production_sectors) ? sheet.production_sectors : [];
  if (sectors.length === 0) return true;
  return sectors.some(s => SECTOR_NORM[s.toLowerCase().trim()] === key);
}

function getSectorKey(stageName: string): SectorKey | null {
  const l = stageName.toLowerCase().trim();
  if (l.includes('forr') || l === 'corte_forracao') return 'corte_forracao';
  if (l === 'costura') return 'costura';
  if (l.includes('corte') || l.includes('palmilha') || l === 'corte_palmilha') return 'corte_palmilha';
  if (l === 'mesa' || l === 'aviamento') return 'mesa';
  if (l === 'silk' || l.includes('serigraf')) return 'silk';
  if (l === 'colagem') return 'colagem';
  if (l === 'montagem') return 'montagem';
  if (l === 'solagem') return 'solagem';
  if (l === 'acabamento') return 'acabamento';
  if (l.includes('expedi') || l === 'expedicao') return 'expedicao';
  return null;
}

function sheetCap(sheet: any, field: string, def: number): number {
  const v = Number(sheet?.[field] ?? 0);
  return v > 0 ? v : def;
}

// Buckets alinhados ao critério da página /gargalos:
//   até 100% → ok | 100–149% → warning | ≥150% → critical
function occStatus(pct: number): StatusKey {
  if (pct >= 150) return 'critical';
  if (pct >= 100) return 'warning';
  return 'ok';
}

function ratioStatus(ratio: number): StatusKey {
  if (ratio >= 1.5) return 'critical';
  if (ratio >= 1.0) return 'warning';
  return 'ok';
}

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export default function CapacityPlanning() {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const [selectedSector, setSelectedSector] = useState<SectorKey | null>(null);
  const [horizon, setHorizon] = useState<4 | 6 | 8 | 12>(6);

  // ─── QUERIES ───────────────────────────────────────────────────────────────

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['cap_orders_v4'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id, order_number, quantity, status, planned_delivery, reference_id, color, sale_order_id,
          technical_sheets:reference_id (
            id, name, code,
            cutting_capacity_per_day, sewing_capacity_per_day,
            mesa_daily_capacity, costura_capacity_per_day, silk_capacity_per_day,
            gluing_capacity_per_day, soling_capacity_per_day,
            assembly_capacity_per_day, finishing_capacity_per_day,
            lead_time_corte_dias, lead_time_costura_dias,
            lead_time_montagem_dias, lead_time_acabamento_dias,
            requires_cutting, requires_sewing,
            production_sectors
          )
        `)
        .not('status', 'in', '("Finalizado","Concluído","Cancelada","Cancelado","finalizado","concluído","cancelada","cancelado","Rascunho","rascunho")')
        .order('planned_delivery', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data || []) as any[];
    },
    staleTime: 30_000,
  });

  const { data: stages = [] } = useQuery({
    queryKey: ['cap_stages_v4'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_stages')
        .select('order_id, stage_name, stage_order, status, quantity_total, quantity_processed')
        .not('status', 'in', '("concluido","cancelado")')
        .order('stage_order');
      if (error) throw error;
      return (data || []) as any[];
    },
    staleTime: 30_000,
  });

  // Feriados → cache do motor de capacidade (alinha janelas ao SQL). Populado
  // antes do timelineData (abaixo) recomputar; holidays entra nas deps dele.
  const { data: holidays = [] } = useHolidays();
  useMemo(() => setHolidayCache(holidays), [holidays]);

  // ─── ENRICHED ORDERS ───────────────────────────────────────────────────────

  const stagesByOrder = useMemo(() => {
    const m = new Map<string, any[]>();
    stages.forEach((s: any) => {
      const list = m.get(s.order_id) || [];
      list.push(s);
      m.set(s.order_id, list);
    });
    return m;
  }, [stages]);

  const enrichedOrders = useMemo(() => orders.map((o: any) => {
    const sheet = (o.technical_sheets || {}) as any;
    const orderStages = (stagesByOrder.get(o.id) || []).sort((a: any, b: any) => a.stage_order - b.stage_order);

    const activeStage =
      orderStages.find((s: any) => ['em_andamento', 'em_progresso', 'in_progress'].includes((s.status || '').toLowerCase())) ||
      orderStages.find((s: any) => (s.status || '').toLowerCase() === 'pendente');

    const currentSector = activeStage ? getSectorKey(activeStage.stage_name) : null;

    return { ...o, sheet, orderStages, activeStage, currentSector };
  }), [orders, stagesByOrder]);

  // ─── SECTOR KPIs ───────────────────────────────────────────────────────────

  const sectorKPIs = useMemo(() => SECTORS.map(sc => {
    const inSector = enrichedOrders.filter((o: any) =>
      o.orderStages.some((s: any) => getSectorKey(s.stage_name) === sc.key)
    );

    let queuePairs = 0;
    let capNumer = 0;
    let capDenom = 0;
    let lateInSector = 0;

    inSector.forEach((o: any) => {
      const st = o.orderStages.find((s: any) => getSectorKey(s.stage_name) === sc.key);
      if (st) {
        const remaining = (st.quantity_total || o.quantity) - (st.quantity_processed || 0);
        queuePairs += Math.max(0, remaining);
      }
      const c = sheetCap(o.sheet, sc.capField, sc.defaultCap);
      capNumer += c * o.quantity;
      capDenom += o.quantity;
      if (o.planned_delivery && parseISO(o.planned_delivery) < today) {
        lateInSector++;
      }
    });

    const avgCap = capDenom > 0 ? Math.round(capNumer / capDenom) : sc.defaultCap;
    const daysToComplete = avgCap > 0 ? Math.ceil(queuePairs / avgCap) : 0;
    const occupancy = avgCap > 0 ? Math.round((queuePairs / (avgCap * 5)) * 100) : 0;
    const status = occStatus(occupancy);

    return { ...sc, opsCount: inSector.length, queuePairs, avgCap, daysToComplete, occupancy, status, inSector, lateInSector };
  }), [enrichedOrders, today]);

  // ─── WEEKLY TIMELINE (per-sector daily-avg matrix) ─────────────────────────

  const timelineData = useMemo(() => {
    const zeroEntry = (): Record<SectorKey, number> => ({
      corte_palmilha: 0, corte_forracao: 0, mesa: 0, costura: 0, silk: 0,
      colagem: 0, montagem: 0, solagem: 0, acabamento: 0, expedicao: 0,
    });
    const dayMap = new Map<string, Record<SectorKey, number>>();

    for (let i = -7; i < horizon * 7 + 7; i++) {
      const d = addDays(today, i);
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      dayMap.set(format(d, 'yyyy-MM-dd'), zeroEntry());
    }

    enrichedOrders.forEach((o: any) => {
      if (!o.planned_delivery) return;
      const qty = Number(o.quantity || 0);
      if (qty <= 0) return;

      const s = o.sheet;
      const billing = parseISO(o.planned_delivery);
      const pw = computeParallelWindows(s, qty, billing);

      const windows: { key: SectorKey; start: Date; end: Date; active: boolean }[] = [
        { key: 'corte_palmilha', start: pw.corte_palmilha.start, end: pw.corte_palmilha.end, active: pw.corte_palmilha.required },
        { key: 'corte_forracao', start: pw.corte_forracao.start, end: pw.corte_forracao.end, active: pw.corte_forracao.required && hasSectorActive(s, 'corte_forracao') },
        { key: 'mesa',           start: pw.mesa.start,           end: pw.mesa.end,           active: pw.mesa.required && hasSectorActive(s, 'mesa') },
        { key: 'costura',        start: pw.costura.start,        end: pw.costura.end,        active: pw.costura.required && pw.costura.cap > 0 },
        { key: 'silk',           start: pw.silk.start,           end: pw.silk.end,           active: pw.silk.required && hasSectorActive(s, 'silk') },
        { key: 'colagem',        start: pw.colagem.start,        end: pw.colagem.end,        active: pw.colagem.required && hasSectorActive(s, 'colagem') },
        { key: 'montagem',       start: pw.montagem.start,       end: pw.montagem.end,       active: pw.montagem.required },
        { key: 'solagem',        start: pw.solagem.start,        end: pw.solagem.end,        active: pw.solagem.required && hasSectorActive(s, 'solagem') },
        { key: 'acabamento',     start: pw.acabamento.start,     end: pw.acabamento.end,     active: pw.acabamento.required },
        { key: 'expedicao',      start: pw.acabamento.end,       end: billing,               active: true },
      ];

      for (const w of windows) {
        if (!w.active) continue;
        const days = bizDaysBetween(w.start, w.end);
        const perDay = qty / days;
        const cur = new Date(w.start);
        while (cur < w.end) {
          if (cur.getDay() !== 0 && cur.getDay() !== 6) {
            const k = format(cur, 'yyyy-MM-dd');
            const e = dayMap.get(k);
            if (e) e[w.key] += perDay;
          }
          cur.setDate(cur.getDate() + 1);
        }
      }
    });

    type WeekRow = { iso: string; label: string; values: Record<SectorKey, number>; cnt: number };
    const weekMap = new Map<string, WeekRow>();

    for (const [dayStr, data] of dayMap) {
      const d = parseISO(dayStr);
      const wk = format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd');
      if (!weekMap.has(wk)) {
        const lbl = `S${format(d, 'w', { locale: ptBR })}`;
        weekMap.set(wk, { iso: wk, label: lbl, values: zeroEntry(), cnt: 0 });
      }
      const w = weekMap.get(wk)!;
      (Object.keys(data) as SectorKey[]).forEach(k => { w.values[k] += data[k]; });
      w.cnt++;
    }

    return Array.from(weekMap.values())
      .sort((a, b) => a.iso.localeCompare(b.iso))
      .slice(0, horizon)
      .map(w => {
        const daily = {} as Record<SectorKey, number>;
        (Object.keys(w.values) as SectorKey[]).forEach(k => {
          daily[k] = w.cnt > 0 ? Math.round(w.values[k] / w.cnt) : 0;
        });
        const wkStart = parseISO(w.iso);
        return {
          iso: w.iso,
          label: w.label,
          range: `${format(wkStart, 'dd/MM')}–${format(addDays(wkStart, 4), 'dd/MM')}`,
          values: daily,
        };
      });
  }, [enrichedOrders, today, horizon, holidays]);

  // ─── DERIVED (status strip + drill-down) ───────────────────────────────────

  const totalQueue = sectorKPIs.reduce((s, k) => s + k.queuePairs, 0);
  const hotspots = sectorKPIs.filter(k => k.status !== 'ok').sort((a, b) => b.occupancy - a.occupancy);
  const calmSectors = sectorKPIs.filter(k => k.status === 'ok');
  const lateOps = enrichedOrders.filter((o: any) =>
    o.planned_delivery && parseISO(o.planned_delivery) < today
  ).length;
  const unscheduledCount = enrichedOrders.filter((o: any) => !o.planned_delivery).length;

  const selectedKpi = selectedSector ? sectorKPIs.find(k => k.key === selectedSector) ?? null : null;
  const drillOps = useMemo(() => {
    if (!selectedKpi) return [];
    return (selectedKpi.inSector as any[])
      .map((o: any) => {
        const st = o.orderStages.find((s: any) => getSectorKey(s.stage_name) === selectedKpi.key);
        const total = st?.quantity_total || o.quantity;
        const done = st?.quantity_processed || 0;
        const remaining = Math.max(0, total - done);
        const due = o.planned_delivery ? parseISO(o.planned_delivery) : null;
        const isLate = due ? due < today : false;
        const progress = total > 0 ? Math.round((done / total) * 100) : 0;
        return { ...o, remaining, total, done, progress, isLate, due };
      })
      .sort((a: any, b: any) => {
        if (a.isLate !== b.isLate) return a.isLate ? -1 : 1;
        if (a.due && b.due) return a.due.getTime() - b.due.getTime();
        return b.remaining - a.remaining;
      });
  }, [selectedKpi, today]);

  // ─── RENDER ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="py-12 text-center text-muted-foreground text-sm">
        Carregando capacidade...
      </div>
    );
  }

  return (
    <div className="space-y-6 page-enter">
      <EditorialPageHeader
        sectionNumber="01"
        sectionLabel="PRODUÇÃO · CAPACIDADE"
        title="Sala de Controle"
        description="Onde está apertando agora, como flui pela fábrica e como vai ser nas próximas semanas."
        actions={
          <Button asChild variant="outline" size="sm" className="h-9">
            <Link to="/capacity-planning/distribuir">
              Planejar distribuição
              <ArrowSquareOut className="h-4 w-4 ml-1.5" />
            </Link>
          </Button>
        }
        noRule
      />

      <StatusStrip
        today={today}
        totalOps={enrichedOrders.length}
        totalQueue={totalQueue}
        hotspots={hotspots.length}
        lateOps={lateOps}
        unscheduled={unscheduledCount}
      />

      <HotspotsSection
        hotspots={hotspots}
        selected={selectedSector}
        onSelect={setSelectedSector}
      />

      <FlowStrip
        kpis={sectorKPIs}
        selected={selectedSector}
        onSelect={(k) => setSelectedSector(prev => prev === k ? null : k)}
      />

      <HeatmapSection
        weeks={timelineData}
        kpis={sectorKPIs}
        horizon={horizon}
        onHorizon={setHorizon}
      />

      <DrillDownSection
        kpi={selectedKpi}
        ops={drillOps}
        onClear={() => setSelectedSector(null)}
      />

      {calmSectors.length === SECTORS.length && (
        <div className="text-center py-3 text-xs text-muted-foreground">
          Tudo no ritmo · nenhum setor acima de 100% de ocupação
        </div>
      )}
    </div>
  );
}

// ─── STATUS STRIP ────────────────────────────────────────────────────────────

function StatusStrip({
  today, totalOps, totalQueue, hotspots, lateOps, unscheduled,
}: {
  today: Date;
  totalOps: number;
  totalQueue: number;
  hotspots: number;
  lateOps: number;
  unscheduled: number;
}) {
  const stats = [
    { label: 'Hoje', value: format(today, 'dd MMM', { locale: ptBR }).toUpperCase(), tone: 'muted' as const },
    { label: 'OPs ativas', value: totalOps.toLocaleString('pt-BR'), tone: 'muted' as const },
    { label: 'Pares em fila', value: totalQueue.toLocaleString('pt-BR'), tone: 'muted' as const },
    { label: 'Gargalos', value: String(hotspots), tone: hotspots > 0 ? 'critical' as const : 'ok' as const },
    { label: 'OPs atrasadas', value: String(lateOps), tone: lateOps > 0 ? 'warning' as const : 'ok' as const },
    { label: 'Sem entrega', value: String(unscheduled), tone: unscheduled > 0 ? 'warning' as const : 'muted' as const },
  ];

  return (
    <div className="border-y border-foreground/15 bg-card">
      <div className="grid grid-cols-3 md:grid-cols-6 divide-y md:divide-y-0 md:divide-x divide-border/70">
        {stats.map((s) => (
          <div key={s.label} className="px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-1">
              {s.label}
            </div>
            <div className={cn(
              'ed-display text-xl md:text-2xl tabular-nums',
              s.tone === 'critical' && 'text-red-600',
              s.tone === 'warning' && 'text-amber-600',
              s.tone === 'ok' && 'text-emerald-600',
              s.tone === 'muted' && 'text-foreground'
            )}>
              {s.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── HOTSPOTS ────────────────────────────────────────────────────────────────

function HotspotsSection({
  hotspots, selected, onSelect,
}: {
  hotspots: any[];
  selected: SectorKey | null;
  onSelect: (k: SectorKey) => void;
}) {
  if (hotspots.length === 0) {
    return (
      <div className="border border-emerald-500/30 bg-emerald-500/[0.04] rounded-lg p-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-emerald-500/15 flex items-center justify-center">
            <CheckCircle className="h-5 w-5 text-emerald-600" weight="fill" />
          </div>
          <div>
            <div className="ed-eyebrow text-emerald-700">Status geral</div>
            <div className="ed-display text-lg text-emerald-900">Nenhum gargalo ativo</div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Todos os setores estão abaixo de 100% de ocupação semanal.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <div className="flex items-baseline gap-3">
          <Lightning className="h-4 w-4 text-red-600 self-center" weight="fill" />
          <h2 className="ed-display text-xl text-foreground">Gargalos ativos</h2>
          <span className="text-xs text-muted-foreground">
            {hotspots.length} {hotspots.length === 1 ? 'setor' : 'setores'} acima da capacidade
          </span>
        </div>
      </div>

      <div className="space-y-2">
        {hotspots.map((h) => (
          <HotspotCard
            key={h.key}
            kpi={h}
            isSelected={selected === h.key}
            onSelect={() => onSelect(h.key)}
          />
        ))}
      </div>
    </section>
  );
}

function HotspotCard({
  kpi, isSelected, onSelect,
}: {
  kpi: any;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const Icon = kpi.icon;
  const isCritical = kpi.status === 'critical';
  const accent = isCritical ? 'red' : 'amber';
  const ringCls = isSelected
    ? 'ring-2 ring-offset-2 ring-offset-background ring-foreground/40'
    : '';
  const accentBar = isCritical ? 'bg-red-600' : 'bg-amber-500';
  const barFill = Math.min(100, (kpi.occupancy / 200) * 100);

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-lg border bg-card transition-all',
        isCritical
          ? 'border-red-500/30 hover:border-red-500/60'
          : 'border-amber-500/30 hover:border-amber-500/60',
        ringCls,
      )}
    >
      <div className={cn('absolute left-0 top-0 bottom-0 w-1', accentBar)} />

      <div className="pl-5 pr-4 py-4 md:flex md:items-center md:gap-6">
        {/* Sector identity */}
        <div className="flex items-center gap-3 md:w-72 md:shrink-0">
          <div className={cn(
            'h-11 w-11 rounded-md flex items-center justify-center',
            isCritical ? 'bg-red-500/10 text-red-700' : 'bg-amber-500/10 text-amber-700'
          )}>
            <Icon className="h-5 w-5" weight="bold" />
          </div>
          <div className="min-w-0">
            <div className="ed-eyebrow">{isCritical ? 'Crítico' : 'Atenção'}</div>
            <div className="ed-display text-xl md:text-2xl text-foreground leading-tight">
              {kpi.label}
            </div>
          </div>
        </div>

        {/* Big number + bar */}
        <div className="flex-1 mt-3 md:mt-0 min-w-0">
          <div className="flex items-baseline gap-2">
            <div className={cn(
              'ed-display tabular-nums',
              'text-[44px] md:text-[56px] leading-[0.85]',
              isCritical ? 'text-red-600' : 'text-amber-600'
            )}>
              {kpi.occupancy}
            </div>
            <div className="ed-display text-xl text-muted-foreground">%</div>
            <div className="ml-auto hidden sm:flex items-baseline gap-1.5 text-xs text-muted-foreground">
              ocupação da semana
            </div>
          </div>
          <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden relative">
            <div className={cn('h-full transition-all', accentBar)} style={{ width: `${barFill}%` }} />
            {/* 100% mark */}
            <div className="absolute top-0 bottom-0 w-px bg-foreground/30" style={{ left: '50%' }} />
          </div>
          <div className="mt-1 flex justify-between text-[9px] tabular-nums font-mono text-muted-foreground uppercase tracking-wider">
            <span>0%</span><span>100%</span><span>200%+</span>
          </div>
        </div>

        {/* Stats grid */}
        <div className="mt-3 md:mt-0 grid grid-cols-3 gap-x-5 gap-y-1 md:w-[300px] md:shrink-0">
          <HotspotStat label="Pares em fila" value={kpi.queuePairs.toLocaleString('pt-BR')} />
          <HotspotStat label="Dias p/ zerar" value={kpi.daysToComplete > 0 ? `${kpi.daysToComplete}d` : '—'} tone={kpi.daysToComplete > 5 ? 'critical' : kpi.daysToComplete > 2 ? 'warning' : 'muted'} />
          <HotspotStat label="OPs na fila" value={String(kpi.opsCount)} />
          <HotspotStat label="Cap./dia" value={`${kpi.avgCap}p`} mute />
          <HotspotStat label="Excedente" value={`${Math.max(0, kpi.queuePairs - kpi.avgCap * 5).toLocaleString('pt-BR')}p`} mute />
          <HotspotStat
            label="Atrasadas aqui"
            value={String(kpi.lateInSector || 0)}
            tone={kpi.lateInSector > 0 ? 'critical' : 'muted'}
          />
        </div>

        {/* Action */}
        <div className="mt-4 md:mt-0 md:shrink-0">
          <Button
            variant={isSelected ? 'default' : 'outline'}
            size="sm"
            className="h-9 w-full md:w-auto"
            onClick={onSelect}
          >
            {isSelected ? 'Ver outro' : 'Ver fila'}
            <CaretRight className="h-3.5 w-3.5 ml-1" weight="bold" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function HotspotStat({
  label, value, tone, mute,
}: {
  label: string;
  value: string;
  tone?: StatusKey | 'muted';
  mute?: boolean;
}) {
  return (
    <div>
      <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80 leading-tight">
        {label}
      </div>
      <div className={cn(
        'font-mono tabular-nums text-sm font-semibold leading-tight',
        tone === 'critical' && 'text-red-600',
        tone === 'warning' && 'text-amber-600',
        mute ? 'text-muted-foreground' : !tone && 'text-foreground'
      )}>
        {value}
      </div>
    </div>
  );
}

// ─── FLOW STRIP ──────────────────────────────────────────────────────────────

function FlowStrip({
  kpis, selected, onSelect,
}: {
  kpis: any[];
  selected: SectorKey | null;
  onSelect: (k: SectorKey) => void;
}) {
  return (
    <Panel
      eyebrow="FLUXO DA FÁBRICA"
      title="Status de cada setor, na ordem de produção"
      subtitle="Clique pra ver as OPs do setor lá embaixo"
    >
      <div className="-mx-2 overflow-x-auto">
        <div className="flex items-stretch gap-0 px-2 min-w-max">
          {kpis.map((kpi, idx) => {
            const Icon = kpi.icon;
            const isSelected = selected === kpi.key;
            const dotCls = kpi.status === 'critical'
              ? 'bg-red-500'
              : kpi.status === 'warning'
                ? 'bg-amber-500'
                : 'bg-emerald-500';
            const isLast = idx === kpis.length - 1;

            return (
              <div key={kpi.key} className="flex items-stretch">
                <button
                  type="button"
                  onClick={() => onSelect(kpi.key)}
                  className={cn(
                    'group relative px-3 py-2.5 text-left min-w-[112px] transition-all rounded-md',
                    'hover:bg-muted/50',
                    isSelected && 'bg-foreground text-background hover:bg-foreground',
                  )}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="relative">
                      <Icon className={cn(
                        'h-4 w-4',
                        isSelected ? 'text-background' : 'text-foreground'
                      )} weight="bold" />
                      <span className={cn(
                        'absolute -top-1 -right-1 h-2 w-2 rounded-full ring-2',
                        dotCls,
                        isSelected ? 'ring-foreground' : 'ring-card',
                      )} />
                    </div>
                  </div>
                  <div className={cn(
                    'text-[10px] font-semibold uppercase tracking-wider leading-tight mb-0.5',
                    isSelected ? 'text-background/70' : 'text-muted-foreground'
                  )}>
                    {kpi.short}
                  </div>
                  <div className={cn(
                    'ed-display tabular-nums text-lg leading-none',
                    isSelected
                      ? 'text-background'
                      : kpi.status === 'critical' ? 'text-red-600'
                        : kpi.status === 'warning' ? 'text-amber-600'
                          : 'text-foreground'
                  )}>
                    {kpi.occupancy}%
                  </div>
                  <div className={cn(
                    'mt-1 text-[10px] tabular-nums font-mono',
                    isSelected ? 'text-background/60' : 'text-muted-foreground'
                  )}>
                    {kpi.queuePairs.toLocaleString('pt-BR')}p
                  </div>
                </button>

                {!isLast && (
                  <div className="flex items-center px-0.5 text-muted-foreground/40">
                    <CaretRight className="h-3 w-3" weight="bold" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

// ─── HEATMAP ─────────────────────────────────────────────────────────────────

function HeatmapSection({
  weeks, kpis, horizon, onHorizon,
}: {
  weeks: { iso: string; label: string; range: string; values: Record<SectorKey, number> }[];
  kpis: any[];
  horizon: 4 | 6 | 8 | 12;
  onHorizon: (h: 4 | 6 | 8 | 12) => void;
}) {
  return (
    <Panel
      eyebrow={`PREVISÃO · ${horizon} SEMANAS`}
      title="Demanda futura ÷ capacidade por setor"
      subtitle="Calculado a partir das OPs com data de entrega + lead times das fichas. Cada célula = média diária da semana."
      actions={
        <div className="flex items-center gap-1">
          {([4, 6, 8, 12] as const).map(h => (
            <button
              key={h}
              type="button"
              onClick={() => onHorizon(h)}
              className={cn(
                'px-2 py-1 text-[11px] font-mono font-semibold uppercase tracking-wider rounded transition-colors',
                horizon === h
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              )}
            >
              {h}s
            </button>
          ))}
        </div>
      }
      flush
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-3 py-2 ed-eyebrow text-left sticky left-0 bg-card z-10 min-w-[140px]">
                Setor
              </th>
              {weeks.map(w => (
                <th key={w.iso} className="px-2 py-2 text-center min-w-[64px]">
                  <div className="ed-eyebrow">{w.label}</div>
                  <div className="text-[10px] text-muted-foreground/70 font-mono mt-0.5 normal-case tracking-normal">
                    {w.range}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {kpis.map(kpi => {
              const Icon = kpi.icon;
              return (
                <tr key={kpi.key} className="border-b border-border/60 last:border-b-0 hover:bg-muted/20">
                  <td className="px-3 py-2 sticky left-0 bg-card z-10">
                    <div className="flex items-center gap-2">
                      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" weight="bold" />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-foreground truncate">{kpi.label}</div>
                        <div className="text-[10px] font-mono tabular-nums text-muted-foreground">
                          cap. {kpi.avgCap}p/dia
                        </div>
                      </div>
                    </div>
                  </td>
                  {weeks.map(w => {
                    const demand = w.values[kpi.key as SectorKey] || 0;
                    const ratio = kpi.avgCap > 0 ? demand / kpi.avgCap : 0;
                    return (
                      <HeatmapCell
                        key={w.iso}
                        demand={demand}
                        capacity={kpi.avgCap}
                        ratio={ratio}
                      />
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="border-t border-border px-3 py-2 flex items-center gap-4 text-[10px] uppercase tracking-wider font-mono text-muted-foreground">
        <span>Legenda:</span>
        <LegendSwatch tone="muted" label="vazio (0%)" />
        <LegendSwatch tone="ok" label="ok (<100%)" />
        <LegendSwatch tone="warning" label="atenção (≥100%)" />
        <LegendSwatch tone="critical" label="gargalo (≥150%)" />
      </div>
    </Panel>
  );
}

function HeatmapCell({
  demand, capacity, ratio,
}: {
  demand: number;
  capacity: number;
  ratio: number;
}) {
  const empty = demand <= 0;
  const status = ratioStatus(ratio);
  const intensity = Math.min(1, ratio / 1.5);

  // Cor por status; opacidade por intensidade
  const bgStyle = empty
    ? { backgroundColor: 'transparent' }
    : status === 'ok'
      ? { backgroundColor: `hsl(142 72% 45% / ${0.10 + intensity * 0.18})` }
      : status === 'warning'
        ? { backgroundColor: `hsl(38 92% 50% / ${0.18 + intensity * 0.20})` }
        : { backgroundColor: `hsl(0 84% 55% / ${0.22 + intensity * 0.28})` };

  const txtCls = empty
    ? 'text-muted-foreground/40'
    : status === 'critical'
      ? 'text-red-900 font-bold'
      : status === 'warning'
        ? 'text-amber-900 font-semibold'
        : 'text-emerald-900';

  return (
    <td
      className="px-1 py-1 text-center align-middle"
      title={`${Math.round(demand)}p/dia ÷ ${capacity}p cap. = ${Math.round(ratio * 100)}%`}
    >
      <div
        className={cn(
          'mx-auto rounded h-9 flex flex-col items-center justify-center min-w-[52px]',
          empty && 'border border-dashed border-border/40'
        )}
        style={bgStyle}
      >
        <div className={cn('font-mono tabular-nums text-xs leading-none', txtCls)}>
          {empty ? '—' : `${Math.round(ratio * 100)}%`}
        </div>
        {!empty && (
          <div className={cn('font-mono tabular-nums text-[9px] leading-none mt-0.5', txtCls, 'opacity-70')}>
            {Math.round(demand)}p
          </div>
        )}
      </div>
    </td>
  );
}

function LegendSwatch({ tone, label }: { tone: StatusKey | 'muted'; label: string }) {
  const styleMap: Record<string, string> = {
    muted: 'bg-muted',
    ok: 'bg-emerald-500/30',
    warning: 'bg-amber-500/40',
    critical: 'bg-red-500/50',
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('h-3 w-4 rounded', styleMap[tone])} />
      <span>{label}</span>
    </span>
  );
}

// ─── DRILL-DOWN ──────────────────────────────────────────────────────────────

function DrillDownSection({
  kpi, ops, onClear,
}: {
  kpi: any | null;
  ops: any[];
  onClear: () => void;
}) {
  if (!kpi) {
    return (
      <Panel
        eyebrow="DRILL-DOWN"
        title="Selecione um setor"
      >
        <EmptyState
          icon={TrendingUp}
          title="Nenhum setor selecionado"
          description="Clique num card de gargalo ou num setor do fluxo pra ver as OPs na fila."
        />
      </Panel>
    );
  }

  const Icon = kpi.icon;
  const statusLabel = kpi.status === 'critical' ? 'Crítico' : kpi.status === 'warning' ? 'Atenção' : 'Normal';
  const statusCls = kpi.status === 'critical'
    ? 'bg-red-500/10 text-red-700 border-red-500/30'
    : kpi.status === 'warning'
      ? 'bg-amber-500/10 text-amber-700 border-amber-500/30'
      : 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30';

  return (
    <Panel
      eyebrow="DRILL-DOWN"
      title={
        <span className="flex items-center gap-2">
          <Icon className="h-4 w-4" weight="bold" />
          {kpi.label}
          <span className="text-xs font-normal text-muted-foreground">·</span>
          <span className="text-xs font-normal text-muted-foreground">
            {ops.length} {ops.length === 1 ? 'OP' : 'OPs'} · {kpi.queuePairs.toLocaleString('pt-BR')}p em fila
          </span>
        </span>
      }
      actions={
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={cn('text-xs', statusCls)}>
            {statusLabel} · {kpi.occupancy}%
          </Badge>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClear}>
            Limpar
          </Button>
        </div>
      }
      flush
    >
      {ops.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          Nenhuma OP com etapa registrada nesse setor.
        </div>
      ) : (
        <div className="max-h-[480px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card z-10 border-b border-border">
              <tr>
                <th className="px-3 py-2 ed-eyebrow text-left">OP</th>
                <th className="px-3 py-2 ed-eyebrow text-left">Referência / Cor</th>
                <th className="px-3 py-2 ed-eyebrow text-right">Restam</th>
                <th className="px-3 py-2 ed-eyebrow text-left">Progresso no setor</th>
                <th className="px-3 py-2 ed-eyebrow text-left">Entrega</th>
                <th className="px-3 py-2 ed-eyebrow text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {ops.map((o: any) => (
                <tr key={o.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="px-3 py-2.5 font-mono font-semibold text-xs">
                    {o.order_number || '—'}
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    <div className="font-medium">{o.sheet?.name || '—'}</div>
                    {o.color && (
                      <div className="text-muted-foreground text-[11px]">{o.color}</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <span className="font-mono tabular-nums font-semibold">{o.remaining.toLocaleString('pt-BR')}</span>
                    <span className="text-muted-foreground text-[10px] ml-0.5">/{o.total}</span>
                  </td>
                  <td className="px-3 py-2.5 min-w-[120px]">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className={cn('h-full rounded-full', {
                            'bg-emerald-500': o.progress >= 80,
                            'bg-amber-500': o.progress >= 30 && o.progress < 80,
                            'bg-red-500': o.progress < 30,
                          })}
                          style={{ width: `${o.progress}%` }}
                        />
                      </div>
                      <span className="font-mono tabular-nums text-[10px] text-muted-foreground w-8 text-right">
                        {o.progress}%
                      </span>
                    </div>
                  </td>
                  <td className={cn('px-3 py-2.5 text-xs', o.isLate && 'text-red-600 font-semibold')}>
                    {o.due ? (
                      <span className="inline-flex items-center gap-1">
                        {format(o.due, 'dd/MM/yy')}
                        {o.isLate && <Warning className="h-3 w-3" weight="fill" />}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge variant="outline" className="text-[10px]">
                      {o.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
