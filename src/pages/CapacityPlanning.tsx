import { useMemo, useState } from 'react';
import { Scissors, Layers, Hammer, Sparkles, AlertTriangle, TrendingUp, Hand, Printer, Flame, Footprints, Package } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ComposedChart, ReferenceLine, Legend,
} from 'recharts';
import { format, addDays, parseISO, startOfWeek } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { computeSectorLeadTimeDays } from '@/lib/leadTime';

// ─── TYPES & CONFIG ──────────────────────────────────────────────────────────

type SectorKey = 'corte_palmilha' | 'corte_forracao' | 'mesa' | 'silk' | 'colagem' | 'montagem' | 'solagem' | 'acabamento' | 'expedicao';

// Cores dos setores puxam dos tokens (handoff Novidade — antes 9 hexas
// hardcoded misturando paletas que não casavam com vermelho Squad).
const SECTORS = [
  {
    key: 'corte_palmilha' as SectorKey,
    label: 'Corte Palmilha',
    icon: Scissors,
    color: 'hsl(var(--stage-cut-fg))',
    capField: 'sewing_capacity_per_day',
    ltField: 'lead_time_costura_dias',
    defaultCap: 500,
    defaultLt: 1,
  },
  {
    key: 'corte_forracao' as SectorKey,
    label: 'Corte Forração',
    icon: Layers,
    color: 'hsl(var(--stage-sew-fg))',
    capField: 'cutting_capacity_per_day',
    ltField: 'lead_time_corte_dias',
    defaultCap: 450,
    defaultLt: 2,
  },
  {
    key: 'mesa' as SectorKey,
    label: 'Mesa',
    icon: Hand,
    color: 'hsl(var(--stage-pack-fg))',
    capField: 'mesa_daily_capacity',
    ltField: 'lead_time_corte_dias',
    defaultCap: 275,
    defaultLt: 1,
  },
  {
    key: 'silk' as SectorKey,
    label: 'Silk',
    icon: Printer,
    color: 'hsl(var(--stage-fin-fg))',
    capField: 'silk_capacity_per_day',
    ltField: 'lead_time_corte_dias',
    defaultCap: 400,
    defaultLt: 1,
  },
  {
    key: 'colagem' as SectorKey,
    label: 'Colagem',
    icon: Flame,
    color: 'hsl(var(--stage-assy-fg))',
    capField: 'gluing_capacity_per_day',
    ltField: 'lead_time_corte_dias',
    defaultCap: 500,
    defaultLt: 1,
  },
  {
    key: 'montagem' as SectorKey,
    label: 'Montagem',
    icon: Hammer,
    color: 'hsl(var(--success))',
    capField: 'assembly_capacity_per_day',
    ltField: 'lead_time_montagem_dias',
    defaultCap: 300,
    defaultLt: 2,
  },
  {
    key: 'solagem' as SectorKey,
    label: 'Solagem',
    icon: Footprints,
    color: 'hsl(var(--warning))',
    capField: 'soling_capacity_per_day',
    ltField: 'lead_time_montagem_dias',
    defaultCap: 425,
    defaultLt: 1,
  },
  {
    key: 'acabamento' as SectorKey,
    label: 'Acabamento',
    icon: Sparkles,
    color: 'hsl(var(--info))',
    capField: 'finishing_capacity_per_day',
    ltField: 'lead_time_acabamento_dias',
    defaultCap: 500,
    defaultLt: 1,
  },
  {
    key: 'expedicao' as SectorKey,
    label: 'Expedição',
    icon: Package,
    color: 'hsl(var(--primary))',
    capField: 'finishing_capacity_per_day',
    ltField: 'lead_time_acabamento_dias',
    defaultCap: 1000,
    defaultLt: 0,
  },
] as const;

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function addBizDays(d: Date, n: number): Date {
  const out = new Date(d);
  let rem = Math.abs(n);
  const dir = n >= 0 ? 1 : -1;
  while (rem > 0) {
    out.setDate(out.getDate() + dir);
    if (out.getDay() !== 0 && out.getDay() !== 6) rem--;
  }
  return out;
}

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

// Normalizes display/DB sector name → canonical SectorKey for production_sectors lookup
const SECTOR_NORM: Record<string, SectorKey> = {
  'corte palmilha': 'corte_palmilha', 'corte_palmilha': 'corte_palmilha', 'palmilha': 'corte_palmilha', 'corte': 'corte_palmilha',
  'corte forração': 'corte_forracao', 'corte forracão': 'corte_forracao', 'corte_forracao': 'corte_forracao',
  'costura': 'corte_forracao', 'forração': 'corte_forracao', 'forracao': 'corte_forracao',
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
  if (sectors.length === 0) return true; // no explicit config → include all
  return sectors.some(s => SECTOR_NORM[s.toLowerCase().trim()] === key);
}

function getSectorKey(stageName: string): SectorKey | null {
  const l = stageName.toLowerCase().trim();
  // Check 'forr' / 'costura' / 'corte_forracao' BEFORE generic 'corte' to avoid false matches
  if (l.includes('forr') || l === 'costura' || l === 'corte_forracao') return 'corte_forracao';
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

function occStatus(pct: number): 'ok' | 'warning' | 'critical' {
  if (pct > 100) return 'critical';
  if (pct > 75) return 'warning';
  return 'ok';
}

const BADGE_CLS = {
  ok: 'bg-green-500/10 text-green-700 border-green-500/20',
  warning: 'bg-amber-500/10 text-amber-700 border-amber-500/20',
  critical: 'bg-red-500/10 text-red-700 border-red-500/20',
};
const BORDER_CLS = {
  ok: 'border-l-green-500',
  warning: 'border-l-amber-500',
  critical: 'border-l-red-500',
};

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export default function CapacityPlanning() {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const [horizon, setHorizon] = useState(6);
  const [selectedSector, setSelectedSector] = useState<SectorKey | 'all'>('all');

  // ─── QUERIES ───────────────────────────────────────────────────────────────

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['cap_orders_v3'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id, order_number, quantity, status, planned_delivery, reference_id, color, sale_order_id,
          technical_sheets:reference_id (
            id, name, code,
            cutting_capacity_per_day, sewing_capacity_per_day,
            mesa_daily_capacity, silk_capacity_per_day,
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
    queryKey: ['cap_stages_v3'],
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

    inSector.forEach((o: any) => {
      const st = o.orderStages.find((s: any) => getSectorKey(s.stage_name) === sc.key);
      if (st) {
        const remaining = (st.quantity_total || o.quantity) - (st.quantity_processed || 0);
        queuePairs += Math.max(0, remaining);
      }
      const c = sheetCap(o.sheet, sc.capField, sc.defaultCap);
      capNumer += c * o.quantity;
      capDenom += o.quantity;
    });

    const avgCap = capDenom > 0 ? Math.round(capNumer / capDenom) : sc.defaultCap;
    const daysToComplete = avgCap > 0 ? Math.ceil(queuePairs / avgCap) : 0;
    // Occupancy = fila vs capacidade de 1 semana (5 dias úteis)
    const occupancy = avgCap > 0 ? Math.round((queuePairs / (avgCap * 5)) * 100) : 0;
    const status = occStatus(occupancy);

    return { ...sc, opsCount: inSector.length, queuePairs, avgCap, daysToComplete, occupancy, status, inSector };
  }), [enrichedOrders]);

  // ─── WEEKLY TIMELINE ───────────────────────────────────────────────────────

  const timelineData = useMemo(() => {
    type Entry = Record<SectorKey, number>;
    const zeroEntry = (): Entry => ({
      corte_palmilha: 0, corte_forracao: 0, mesa: 0, silk: 0,
      colagem: 0, montagem: 0, solagem: 0, acabamento: 0, expedicao: 0,
    });
    const dayMap = new Map<string, Entry>();

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

      // Lead time derivado da capacidade: ceil(qty / cap_per_day)
      const ltAcab = computeSectorLeadTimeDays('acabamento',     qty, s);
      const ltSola = computeSectorLeadTimeDays('solagem',        qty, s);
      const ltMont = computeSectorLeadTimeDays('montagem',       qty, s);
      const ltCola = computeSectorLeadTimeDays('colagem',        qty, s);
      const ltSilk = computeSectorLeadTimeDays('silk',           qty, s);
      const ltMesa = computeSectorLeadTimeDays('mesa',           qty, s);
      const ltForr = computeSectorLeadTimeDays('corte_forracao', qty, s);
      const ltPalm = computeSectorLeadTimeDays('corte_palmilha', qty, s);

      // Janelas de trás para frente (9-sector backward cascade)
      const acabEnd   = billing;
      const acabStart = addBizDays(acabEnd,   -ltAcab);
      const solaEnd   = acabStart;
      const solaStart = addBizDays(solaEnd,   -ltSola);
      const montEnd   = solaStart;
      const montStart = addBizDays(montEnd,   -ltMont);
      const colaEnd   = montStart;
      const colaStart = addBizDays(colaEnd,   -ltCola);
      const silkEnd   = colaStart;
      const silkStart = addBizDays(silkEnd,   -ltSilk);
      const mesaEnd   = silkStart;
      const mesaStart = addBizDays(mesaEnd,   -ltMesa);
      const forrEnd   = mesaStart;
      const forrStart = addBizDays(forrEnd,   -ltForr);
      const palmEnd   = forrStart;
      const palmStart = addBizDays(palmEnd,   -ltPalm);

      const windows: { key: SectorKey; start: Date; end: Date; active: boolean }[] = [
        { key: 'corte_palmilha', start: palmStart, end: palmEnd,  active: ltPalm > 0 },
        { key: 'corte_forracao', start: forrStart, end: forrEnd,  active: ltForr > 0 && hasSectorActive(s, 'corte_forracao') },
        { key: 'mesa',           start: mesaStart, end: mesaEnd,  active: ltMesa > 0 && hasSectorActive(s, 'mesa') },
        { key: 'silk',           start: silkStart, end: silkEnd,  active: ltSilk > 0 && hasSectorActive(s, 'silk') },
        { key: 'colagem',        start: colaStart, end: colaEnd,  active: ltCola > 0 && hasSectorActive(s, 'colagem') },
        { key: 'montagem',       start: montStart, end: montEnd,  active: ltMont > 0 },
        { key: 'solagem',        start: solaStart, end: solaEnd,  active: ltSola > 0 && hasSectorActive(s, 'solagem') },
        { key: 'acabamento',     start: acabStart, end: acabEnd,  active: ltAcab > 0 },
        { key: 'expedicao',      start: acabEnd,   end: billing,  active: true },
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

    type WeekEntry = Entry & { label: string; cnt: number };
    const weekMap = new Map<string, WeekEntry>();

    for (const [dayStr, data] of dayMap) {
      const d = parseISO(dayStr);
      const wk = format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd');
      if (!weekMap.has(wk)) {
        const lbl = `S${format(d, 'w', { locale: ptBR })} ${format(d, 'dd/MM')}`;
        weekMap.set(wk, { ...zeroEntry(), label: lbl, cnt: 0 });
      }
      const w = weekMap.get(wk)!;
      (Object.keys(data) as SectorKey[]).forEach(k => { w[k] += data[k]; });
      w.cnt++;
    }

    return Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, horizon)
      .map(([, w]) => {
        const out: Record<string, number | string> = { label: w.label };
        (Object.keys(zeroEntry()) as SectorKey[]).forEach(k => {
          out[k] = w.cnt > 0 ? Math.round(w[k] / w.cnt) : 0;
        });
        return out as { label: string } & Record<SectorKey, number>;
      });
  }, [enrichedOrders, today, horizon]);

  // ─── OPs FILTRADAS ─────────────────────────────────────────────────────────

  const filteredOps = useMemo(() => {
    if (selectedSector === 'all') return enrichedOrders;
    return enrichedOrders.filter((o: any) => o.currentSector === selectedSector);
  }, [enrichedOrders, selectedSector]);

  const unscheduledCount = enrichedOrders.filter((o: any) => !o.planned_delivery).length;

  // ─── RENDER ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="py-12 text-center text-muted-foreground text-sm">
        Carregando capacidade...
      </div>
    );
  }

  return (
    <div className="space-y-5 page-enter">
      <div>
        <h2 className="display text-xl tracking-tight">Capacidade por Setor</h2>
        <p className="text-sm text-muted-foreground">
          Carga real calculada a partir das fichas técnicas × OPs ativas — pares/dia por setor
        </p>
      </div>

      {/* ── KPI CARDS ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-9 gap-3">
        {sectorKPIs.map(kpi => {
          const Icon = kpi.icon;
          return (
            <Card key={kpi.key} className={cn('border-l-4', BORDER_CLS[kpi.status])}>
              <CardContent className="py-3 px-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {kpi.label}
                    </span>
                  </div>
                  <Badge variant="outline" className={cn('text-[10px]', BADGE_CLS[kpi.status])}>
                    {kpi.occupancy}%
                  </Badge>
                </div>

                <div className="display text-2xl tabular-nums font-mono">{kpi.queuePairs}</div>
                <p className="text-[10px] text-muted-foreground">pares na fila</p>

                {/* Progress bar */}
                <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all', {
                      'bg-green-500': kpi.status === 'ok',
                      'bg-amber-500': kpi.status === 'warning',
                      'bg-red-500': kpi.status === 'critical',
                    })}
                    style={{ width: `${Math.min(100, kpi.occupancy)}%` }}
                  />
                </div>

                <div className="mt-2 space-y-0.5">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-muted-foreground">Capacidade/dia</span>
                    <span className="font-mono font-medium">{kpi.avgCap} pares</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-muted-foreground">OPs ativas</span>
                    <span className="font-mono">{kpi.opsCount}</span>
                  </div>
                  {kpi.daysToComplete > 0 && (
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-muted-foreground">Dias p/ zerar fila</span>
                      <span className={cn('font-mono font-semibold', {
                        'text-red-600': kpi.daysToComplete > 5,
                        'text-amber-600': kpi.daysToComplete > 2 && kpi.daysToComplete <= 5,
                        'text-green-600': kpi.daysToComplete <= 2,
                      })}>
                        {kpi.daysToComplete}d
                      </span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ── TABS ───────────────────────────────────────────────────────────── */}
      <Tabs defaultValue="sectors">
        <TabsList>
          <TabsTrigger value="sectors">Visão por Setor</TabsTrigger>
          <TabsTrigger value="timeline">Previsão Semanal</TabsTrigger>
          <TabsTrigger value="ops">OPs Ativas ({enrichedOrders.length})</TabsTrigger>
        </TabsList>

        {/* ── TAB 1: POR SETOR ─────────────────────────────────────────────── */}
        <TabsContent value="sectors" className="space-y-4 mt-4">

          {/* Tabela resumo */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                Resumo de Capacidade
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="text-[11px]">Setor</TableHead>
                    <TableHead className="text-[11px] text-right">OPs Ativas</TableHead>
                    <TableHead className="text-[11px] text-right">Fila (pares)</TableHead>
                    <TableHead className="text-[11px] text-right">Cap./Dia</TableHead>
                    <TableHead className="text-[11px] text-right">Dias p/ Zerar</TableHead>
                    <TableHead className="text-[11px]">Ocupação (semana)</TableHead>
                    <TableHead className="text-[11px]">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sectorKPIs.map(kpi => {
                    const Icon = kpi.icon;
                    return (
                      <TableRow key={kpi.key}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-sm font-semibold">{kpi.label}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-right font-mono">{kpi.opsCount}</TableCell>
                        <TableCell className="text-sm text-right font-mono font-bold">{kpi.queuePairs}</TableCell>
                        <TableCell className="text-sm text-right font-mono">{kpi.avgCap}</TableCell>
                        <TableCell className="text-sm text-right font-mono">
                          {kpi.daysToComplete > 0 ? (
                            <span className={cn({
                              'text-red-600 font-bold': kpi.daysToComplete > 5,
                              'text-amber-600': kpi.daysToComplete > 2 && kpi.daysToComplete <= 5,
                            })}>
                              {kpi.daysToComplete}
                            </span>
                          ) : '—'}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div
                                className={cn('h-full rounded-full', {
                                  'bg-green-500': kpi.status === 'ok',
                                  'bg-amber-500': kpi.status === 'warning',
                                  'bg-red-500': kpi.status === 'critical',
                                })}
                                style={{ width: `${Math.min(100, kpi.occupancy)}%` }}
                              />
                            </div>
                            <span className={cn('text-xs font-mono', {
                              'text-red-600 font-bold': kpi.status === 'critical',
                              'text-amber-600': kpi.status === 'warning',
                              'text-green-600': kpi.status === 'ok',
                            })}>
                              {kpi.occupancy}%
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn('text-[10px]', BADGE_CLS[kpi.status])}>
                            {kpi.status === 'ok' ? 'Normal' : kpi.status === 'warning' ? 'Atenção' : 'Crítico'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Gráficos por setor */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {sectorKPIs.filter(k => k.inSector.length > 0).map(kpi => {
              const chartData = (kpi.inSector as any[])
                .map((o: any) => ({
                  name: o.order_number || '—',
                  ref: o.sheet?.name ? `${o.sheet.name}${o.color ? ` / ${o.color}` : ''}` : '',
                  pares: o.quantity,
                  cap: sheetCap(o.sheet, kpi.capField, kpi.defaultCap),
                }))
                .sort((a, b) => b.pares - a.pares)
                .slice(0, 10);

              return (
                <Card key={kpi.key}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <kpi.icon className="h-4 w-4 text-muted-foreground" />
                        {kpi.label}
                      </CardTitle>
                      <span className="text-[10px] text-muted-foreground">
                        {kpi.avgCap} pares/dia (média)
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[220px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} layout="vertical" margin={{ left: 4, right: 36 }}>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.12} />
                          <XAxis type="number" tick={{ fontSize: 10 }} />
                          <YAxis type="category" dataKey="name" width={72} tick={{ fontSize: 9 }} />
                          <Tooltip
                            formatter={(val: any, _name: string, props: any) => [
                              `${val} pares${props.payload?.ref ? ` — ${props.payload.ref}` : ''}`,
                              'Quantidade',
                            ]}
                          />
                          <Bar dataKey="pares" name="Pares" fill={kpi.color} radius={[0, 4, 4, 0]} />
                          <ReferenceLine
                            x={kpi.avgCap}
                            stroke="hsl(var(--destructive))"
                            strokeDasharray="4 2"
                            strokeWidth={1.5}
                            label={{ value: `${kpi.avgCap}`, fontSize: 9, fill: 'hsl(var(--destructive))', position: 'insideTopRight' }}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1 text-center">
                      — linha vermelha = capacidade/dia ({kpi.avgCap} pares)
                    </p>
                  </CardContent>
                </Card>
              );
            })}

            {sectorKPIs.every(k => k.inSector.length === 0) && (
              <div className="lg:col-span-2 py-12 text-center text-muted-foreground text-sm">
                Nenhuma OP com etapas de produção registradas.
                Inicie setores nas OPs para visualizar a carga por setor.
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── TAB 2: PREVISÃO SEMANAL ──────────────────────────────────────── */}
        <TabsContent value="timeline" className="space-y-4 mt-4">

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground font-medium">Horizonte:</span>
            {[4, 6, 8, 12].map(w => (
              <button
                key={w}
                onClick={() => setHorizon(w)}
                className={cn(
                  'px-3 py-1 rounded text-xs font-medium transition-colors',
                  horizon === w
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                )}
              >
                {w} sem.
              </button>
            ))}
          </div>

          {/* Gráfico consolidado */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Demanda por Setor — Média Diária (pares/dia)</CardTitle>
              <p className="text-[10px] text-muted-foreground">
                Calculado a partir de OPs com data de entrega planejada + lead times das fichas técnicas
              </p>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={timelineData} margin={{ bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.12} />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {SECTORS.map(sc => (
                      <Bar key={sc.key} dataKey={sc.key} name={sc.label} fill={sc.color} radius={[2, 2, 0, 0]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Gráficos individuais: demanda vs capacidade */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {SECTORS.map(sc => {
              const kpiCap = sectorKPIs.find(k => k.key === sc.key)?.avgCap ?? sc.defaultCap;
              return (
              <Card key={sc.key}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <sc.icon className="h-4 w-4 text-muted-foreground" />
                    {sc.label} — Demanda vs Capacidade
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={timelineData}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.12} />
                        <XAxis dataKey="label" tick={{ fontSize: 9 }} />
                        <YAxis tick={{ fontSize: 9 }} />
                        <Tooltip />
                        <Bar dataKey={sc.key} name="Demanda (pares/dia)" fill={sc.color} radius={[4, 4, 0, 0]} />
                        <ReferenceLine
                          y={kpiCap}
                          stroke="hsl(var(--destructive))"
                          strokeDasharray="4 2"
                          strokeWidth={1.5}
                          label={{
                            value: `Cap. ${kpiCap}`,
                            fontSize: 9,
                            fill: 'hsl(var(--destructive))',
                            position: 'insideTopRight',
                          }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* ── TAB 3: OPs ATIVAS ────────────────────────────────────────────── */}
        <TabsContent value="ops" className="space-y-3 mt-4">

          {/* Filtros de setor */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">Setor:</span>
            <button
              onClick={() => setSelectedSector('all')}
              className={cn(
                'px-3 py-1 rounded text-xs font-medium transition-colors',
                selectedSector === 'all'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted hover:bg-muted/80 text-muted-foreground'
              )}
            >
              Todas ({enrichedOrders.length})
            </button>
            {SECTORS.map(sc => {
              const cnt = enrichedOrders.filter((o: any) => o.currentSector === sc.key).length;
              return (
                <button
                  key={sc.key}
                  onClick={() => setSelectedSector(sc.key)}
                  className={cn(
                    'px-3 py-1 rounded text-xs font-medium transition-colors',
                    selectedSector === sc.key
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                  )}
                >
                  {sc.label} ({cnt})
                </button>
              );
            })}
          </div>

          {unscheduledCount > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
              <p className="text-xs text-amber-700">
                <strong>{unscheduledCount} OP{unscheduledCount > 1 ? 's' : ''}</strong> sem data de entrega planejada — não entram no cálculo de previsão.
              </p>
            </div>
          )}

          <Card>
            <CardContent className="p-0">
              <div className="max-h-[520px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="text-[11px]">OP</TableHead>
                      <TableHead className="text-[11px]">Referência / Cor</TableHead>
                      <TableHead className="text-[11px] text-right">Qtd</TableHead>
                      <TableHead className="text-[11px]">Setor Atual</TableHead>
                      <TableHead className="text-[11px]">Status OP</TableHead>
                      <TableHead className="text-[11px]">Entrega Planejada</TableHead>
                      <TableHead className="text-[11px] text-right">Cap/Dia</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOps.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                          Sem OPs para este filtro.
                        </TableCell>
                      </TableRow>
                    ) : (
                      (filteredOps as any[]).map((o: any) => {
                        const sc = o.currentSector
                          ? SECTORS.find(s => s.key === o.currentSector)
                          : null;
                        const cap = sc ? sheetCap(o.sheet, sc.capField, sc.defaultCap) : null;
                        const isLate =
                          o.planned_delivery &&
                          parseISO(o.planned_delivery) < today &&
                          !['Finalizado', 'Cancelada'].includes(o.status);

                        return (
                          <TableRow key={o.id}>
                            <TableCell className="text-xs font-mono font-semibold">
                              {o.order_number || '—'}
                            </TableCell>
                            <TableCell className="text-xs">
                              {o.sheet?.name || '—'}
                              {o.color ? (
                                <span className="text-muted-foreground"> / {o.color}</span>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-xs text-right font-mono">
                              {o.quantity}
                            </TableCell>
                            <TableCell>
                              {sc ? (
                                <Badge
                                  variant="outline"
                                  className="text-[10px]"
                                  style={{
                                    borderColor: `${sc.color}50`,
                                    color: sc.color,
                                    backgroundColor: `${sc.color}18`,
                                  }}
                                >
                                  {o.activeStage?.stage_name || sc.label}
                                </Badge>
                              ) : (
                                <span className="text-[10px] text-muted-foreground">
                                  {o.orderStages.length === 0
                                    ? 'Sem etapas'
                                    : o.activeStage?.stage_name || '—'}
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-[10px]">
                                {o.status}
                              </Badge>
                            </TableCell>
                            <TableCell className={cn('text-xs', isLate && 'text-red-600 font-semibold')}>
                              {o.planned_delivery ? (
                                <>
                                  {format(parseISO(o.planned_delivery), 'dd/MM/yy')}
                                  {isLate && (
                                    <span className="ml-1 text-[9px] font-bold"> ATRASADA</span>
                                  )}
                                </>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-right font-mono">
                              {cap ?? '—'}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
