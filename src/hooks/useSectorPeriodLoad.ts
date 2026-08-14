import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  loadHolidayCache, isBusinessDay, computeSectorDailyLoad, fetchCategoryDefaultsMap,
  type DailyOpInput, type DailySeverity,
} from '@/lib/sectorCapacity';
import { normalizeSector, DISPLAY_SECTORS, type SectorKey } from '@/lib/sectors';
import { loadBottlenecksForOrders, type BottleneckInfo } from '@/lib/sectorBottleneck';

/**
 * Carga por setor num PERÍODO (diário/semanal/quinzenal/mensal/custom).
 *
 * Reusa o motor diário canônico `computeSectorDailyLoad` (cascata
 * computeParallelWindows) somando o PLANEJADO por dia útil do range, e a
 * CAPACIDADE do período = capacidade/dia efetiva × dias úteis. A utilização do
 * período = demanda ÷ capacidade (gargalo = >100%). Também traz o WIP REAL de
 * AGORA (etapa corrente em order_stages) — retrato do chão, independente do
 * período. Sem motor SQL novo. Fonte de setores: DISPLAY_SECTORS.
 */

const EXCLUDED = new Set([
  'finalizado', 'concluído', 'concluido', 'cancelada', 'cancelado', 'rascunho',
]);
const DISPLAY_KEYS = new Set<string>(DISPLAY_SECTORS.map((s) => s.key));

export interface PeriodRealOp {
  order_id: string; order_number: string | null; sheet_name: string | null;
  color: string | null; remaining: number; bottleneck: BottleneckInfo | null;
}
export interface PeriodSectorOp {
  order_id: string; order_number: string | null; sheet_name: string | null;
  color: string | null; pairs: number;
}
export interface SectorPeriodLoad {
  sector: SectorKey; label: string;
  demandPairs: number;        // Σ planejado dos dias úteis do período
  capacityPerDay: number;     // capacidade/dia efetiva do setor (ponderada)
  capacityPairs: number;      // capacidade/dia × dias úteis
  utilizationPct: number;     // demanda ÷ capacidade do período
  severity: DailySeverity;
  businessDays: number;
  opsCount: number;
  ops: PeriodSectorOp[];      // OPs que passam pelo setor no período (drill)
  realPairs: number;          // em produção AGORA neste setor (Σ restante)
  realOpsCount: number;
  realDelayedCount: number;
  realUnstartedCount: number;
  realOps: PeriodRealOp[];
}
export interface SectorPeriodResult {
  start: string; end: string; businessDays: number;
  sectors: SectorPeriodLoad[];
  summary: { demandPairs: number; sectorsAlert: number; realPairs: number; realDelayed: number; realUnstarted: number };
}

function localISO(d: Date): string {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function useSectorPeriodLoad(startISO: string, endISO: string) {
  return useQuery<SectorPeriodResult>({
    queryKey: ['sector-period-load', startISO, endISO],
    enabled: !!startISO && !!endISO && startISO <= endISO,
    staleTime: 60_000,
    queryFn: async () => {
      await loadHolidayCache();

      // Dias úteis do range.
      const days: string[] = [];
      const cur = new Date(startISO + 'T00:00:00');
      const end = new Date(endISO + 'T00:00:00');
      let guard = 0;
      while (cur <= end && guard < 400) {
        if (isBusinessDay(cur)) days.push(localISO(cur));
        cur.setDate(cur.getDate() + 1);
        guard++;
      }
      const bizDays = days.length;

      const emptySectors = (): SectorPeriodLoad[] => DISPLAY_SECTORS.map((s) => ({
        sector: s.key, label: s.label, demandPairs: 0, capacityPerDay: 0, capacityPairs: 0,
        utilizationPct: 0, severity: 'idle', businessDays: bizDays, opsCount: 0, ops: [],
        realPairs: 0, realOpsCount: 0, realDelayedCount: 0, realUnstartedCount: 0, realOps: [],
      }));

      const { data: ordersRaw } = await supabase
        .from('orders')
        .select('id, order_number, reference_id, color, quantity, planned_delivery, status')
        .gt('quantity', 0);
      const orders = (ordersRaw || []).filter((o: any) => !EXCLUDED.has(String(o.status || '').toLowerCase()));
      if (orders.length === 0) {
        return { start: startISO, end: endISO, businessDays: bizDays, sectors: emptySectors(),
          summary: { demandPairs: 0, sectorsAlert: 0, realPairs: 0, realDelayed: 0, realUnstarted: 0 } };
      }

      const refIds = Array.from(new Set(orders.map((o: any) => o.reference_id).filter(Boolean)));
      const sheetMap = new Map<string, any>();
      if (refIds.length > 0) {
        const { data: sheets } = await supabase
          .from('technical_sheets')
          .select('id, name, code, shoe_category, production_sectors, corte_palmilha_capacity_per_day, cutting_capacity_per_day, sewing_capacity_per_day, assembly_capacity_per_day, finishing_capacity_per_day, mesa_daily_capacity, costura_capacity_per_day, costura_cabedal_capacity_per_day, costura_palmilha_capacity_per_day, silk_capacity_per_day, gluing_capacity_per_day, soling_capacity_per_day, expedition_capacity_per_day, lead_time_corte_dias, lead_time_costura_dias, lead_time_montagem_dias, lead_time_acabamento_dias, lead_time_expedicao_dias, requires_cutting, requires_sewing')
          .in('id', refIds as string[]);
        (sheets || []).forEach((s: any) => sheetMap.set(s.id, s));
      }
      // F1-05: fallback de capacidade por categoria (default_lead_times) —
      // mesma cadeia ficha > categoria do SQL compute_wave_timeline.
      const categories = Array.from(new Set(
        Array.from(sheetMap.values()).map((s: any) => s.shoe_category).filter(Boolean),
      ));
      const categoryDefaultsMap = await fetchCategoryDefaultsMap(categories as string[]);
      const orderMap = new Map<string, any>();
      orders.forEach((o: any) => orderMap.set(o.id, o));
      const ops: DailyOpInput[] = orders.map((o: any) => ({
        order_id: o.id, order_number: o.order_number ?? null, reference_id: o.reference_id,
        color: o.color ?? null, quantity: Number(o.quantity || 0), planned_delivery: o.planned_delivery,
        sheet_name: sheetMap.get(o.reference_id)?.name ?? null,
      }));

      // ── PLANEJADO agregado (Σ por dia útil) ──
      type Agg = { demand: number; cap: number; ops: Map<string, PeriodSectorOp> };
      const agg = new Map<SectorKey, Agg>();
      for (const s of DISPLAY_SECTORS) agg.set(s.key, { demand: 0, cap: 0, ops: new Map() });
      for (const dayISO of days) {
        for (const sd of computeSectorDailyLoad(dayISO, ops, sheetMap, categoryDefaultsMap)) {
          const a = agg.get(sd.sector); if (!a) continue;
          a.demand += sd.plannedPairs;
          a.cap = Math.max(a.cap, sd.capacityPerDay); // capacidade/dia efetiva do setor
          for (const c of sd.contributions) {
            const ex = a.ops.get(c.order_id);
            if (ex) ex.pairs += c.pairs_per_day;
            else a.ops.set(c.order_id, { order_id: c.order_id, order_number: c.order_number, sheet_name: c.sheet_name, color: c.color, pairs: c.pairs_per_day });
          }
        }
      }

      // ── REAL (WIP de AGORA: etapa corrente, igual ao gargalo diário) ──
      const orderIds = orders.map((o: any) => o.id);
      const { data: stagesRaw } = await supabase
        .from('order_stages')
        .select('order_id, stage_name, status, stage_order, quantity_total, quantity_processed')
        .in('order_id', orderIds)
        .neq('status', 'concluido')
        .order('stage_order', { ascending: true });
      const currentByOrder = new Map<string, any>();
      for (const st of stagesRaw || []) {
        const oid = (st as any).order_id; const ex = currentByOrder.get(oid);
        if (!ex) currentByOrder.set(oid, st);
        else if (ex.status !== 'em_andamento' && (st as any).status === 'em_andamento') currentByOrder.set(oid, st);
      }
      const realBySector = new Map<SectorKey, PeriodRealOp[]>();
      const realOrderIds = new Set<string>();
      for (const [oid, st] of currentByOrder) {
        const key = normalizeSector((st as any).stage_name) as SectorKey;
        if (!DISPLAY_KEYS.has(key)) continue;
        const ord = orderMap.get(oid); if (!ord) continue;
        const total = Number((st as any).quantity_total ?? ord.quantity ?? 0);
        const proc = Number((st as any).quantity_processed ?? 0);
        const arr = realBySector.get(key) || [];
        arr.push({ order_id: ord.id, order_number: ord.order_number ?? null, sheet_name: sheetMap.get(ord.reference_id)?.name ?? null, color: ord.color ?? null, remaining: Math.max(0, total - proc), bottleneck: null });
        realBySector.set(key, arr); realOrderIds.add(oid);
      }
      let bottlenecks = new Map<string, BottleneckInfo>();
      if (realOrderIds.size > 0) bottlenecks = await loadBottlenecksForOrders(Array.from(realOrderIds));

      const sectors: SectorPeriodLoad[] = DISPLAY_SECTORS.map((s) => {
        const a = agg.get(s.key)!;
        const capacityPairs = a.cap * bizDays;
        let severity: DailySeverity; let util = 0;
        if (a.demand <= 0) severity = 'idle';
        else if (capacityPairs <= 0) severity = 'unknown';
        else { const r = a.demand / capacityPairs; util = Math.round(r * 100); severity = r > 1.5 ? 'critical' : r > 1.0 ? 'warning' : 'ok'; }
        const realOps = (realBySector.get(s.key) || []).map((r) => ({ ...r, bottleneck: bottlenecks.get(r.order_id) || null }));
        return {
          sector: s.key, label: s.label,
          demandPairs: Math.round(a.demand), capacityPerDay: a.cap, capacityPairs: Math.round(capacityPairs),
          utilizationPct: util, severity, businessDays: bizDays,
          opsCount: a.ops.size,
          ops: Array.from(a.ops.values()).map((o) => ({ ...o, pairs: Math.round(o.pairs) })).sort((x, y) => y.pairs - x.pairs),
          realPairs: realOps.reduce((x, r) => x + r.remaining, 0),
          realOpsCount: realOps.length,
          realDelayedCount: realOps.filter((r) => r.bottleneck && r.bottleneck.severity !== 'ok').length,
          realUnstartedCount: realOps.filter((r) => r.bottleneck?.unstarted).length,
          realOps: realOps.sort((x, y) => y.remaining - x.remaining),
        };
      });

      return {
        start: startISO, end: endISO, businessDays: bizDays, sectors,
        summary: {
          demandPairs: sectors.reduce((x, s) => x + s.demandPairs, 0),
          sectorsAlert: sectors.filter((s) => s.severity === 'warning' || s.severity === 'critical').length,
          realPairs: sectors.reduce((x, s) => x + s.realPairs, 0),
          realDelayed: sectors.reduce((x, s) => x + s.realDelayedCount, 0),
          realUnstarted: sectors.reduce((x, s) => x + s.realUnstartedCount, 0),
        },
      };
    },
  });
}
