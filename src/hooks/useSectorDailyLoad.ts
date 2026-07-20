import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { EXCLUDED_ORDER_STATUSES } from '@/lib/orderStatus';
import {
  loadHolidayCache,
  computeSectorDailyLoad,
  type DailyOpInput,
  type SectorDayLoad,
} from '@/lib/sectorCapacity';
import { normalizeSector, DISPLAY_SECTORS, type SectorKey } from '@/lib/sectors';
import { loadBottlenecksForOrders, type BottleneckInfo } from '@/lib/sectorBottleneck';

/**
 * Carga por setor num DIA — combina:
 *  - PLANEJADO: projeção do cronograma (computeSectorDailyLoad, reusa a cascata
 *    canônica computeParallelWindows) — funciona pra qualquer dia (inclusive futuro).
 *  - REAL: o que está FISICAMENTE no setor nesse dia, lido de order_stages
 *    (etapa iniciada e não concluída cobrindo o dia) + flag de atraso por
 *    sectorBottleneck (elapsed vs esperado).
 *
 * Fonte única dos setores: DISPLAY_SECTORS (sectors.ts). Sem motor SQL novo.
 */

// Fonte única (src/lib/orderStatus.ts) — a lista morava aqui e cada tela que
// precisava do mesmo conceito escrevia a sua; o Sistema de Etiquetas escreveu
// errado e deixava OP cancelada contando pares.
const EXCLUDED_SET = new Set(EXCLUDED_ORDER_STATUSES.map((s) => s.toLowerCase()));

export interface RealStageOp {
  order_id: string;
  order_number: string | null;
  sheet_name: string | null;
  color: string | null;
  status: string;
  quantityTotal: number;
  quantityProcessed: number;
  remaining: number;
  bottleneck: BottleneckInfo | null;
}

export interface SectorDaily extends SectorDayLoad {
  /** Pares em produção AGORA neste setor — etapa corrente das OPs (Σ restante). */
  realPairs: number;
  realOpsCount: number;
  /** Quantas dessas OPs estão atrasadas (gargalo em andamento). */
  realDelayedCount: number;
  /** OPs em produção neste setor SEM início apontado (started_at nulo). */
  realUnstartedCount: number;
  realOps: RealStageOp[];
}

export interface SectorDailyResult {
  date: string;
  sectors: SectorDaily[];
  summary: {
    plannedPairs: number;
    sectorsAlert: number;   // setores em warning + critical (planejado)
    realPairs: number;
    realDelayed: number;
    /** Total de OPs em produção sem início apontado (adoção do apontamento). */
    realUnstarted: number;
  };
}

const DISPLAY_KEYS = new Set<string>(DISPLAY_SECTORS.map((s) => s.key));

export function useSectorDailyLoad(dateISO: string) {
  return useQuery<SectorDailyResult>({
    queryKey: ['sector-daily-load', dateISO],
    queryFn: async () => {
      await loadHolidayCache();

      // ── 1. OPs ativas (quantidade > 0) ──────────────────────────────────────
      // NÃO exige planned_delivery aqui: o REAL (em produção) precisa de TODAS as
      // OPs ativas, mesmo sem prazo cadastrado. O PLANEJADO ignora sozinho as OPs
      // sem planned_delivery (computeSectorDailyLoad pula quando falta o prazo).
      const { data: ordersRaw } = await supabase
        .from('orders')
        .select('id, order_number, reference_id, color, quantity, planned_delivery, status')
        .gt('quantity', 0);

      const orders = (ordersRaw || []).filter(
        (o: any) => !EXCLUDED_SET.has(String(o.status || '').toLowerCase()),
      );

      const emptyResult: SectorDailyResult = {
        date: dateISO,
        sectors: DISPLAY_SECTORS.map((s) => ({
          sector: s.key, label: s.label, plannedPairs: 0, capacityPerDay: 0,
          utilizationPct: 0, severity: 'idle', opsCount: 0, contributions: [],
          realPairs: 0, realOpsCount: 0, realDelayedCount: 0, realUnstartedCount: 0, realOps: [],
        })),
        summary: { plannedPairs: 0, sectorsAlert: 0, realPairs: 0, realDelayed: 0, realUnstarted: 0 },
      };
      if (orders.length === 0) return emptyResult;

      // ── 2. Fichas técnicas (capacidades + lead times + setores) ─────────────
      const refIds = Array.from(new Set(orders.map((o: any) => o.reference_id).filter(Boolean)));
      const sheetMap = new Map<string, any>();
      if (refIds.length > 0) {
        const { data: sheets } = await supabase
          .from('technical_sheets')
          .select(
            'id, name, code, shoe_category, production_sectors, cutting_capacity_per_day, sewing_capacity_per_day, assembly_capacity_per_day, finishing_capacity_per_day, mesa_daily_capacity, costura_capacity_per_day, silk_capacity_per_day, gluing_capacity_per_day, soling_capacity_per_day, lead_time_corte_dias, lead_time_costura_dias, lead_time_montagem_dias, lead_time_acabamento_dias, requires_cutting, requires_sewing',
          )
          .in('id', refIds as string[]);
        (sheets || []).forEach((s: any) => sheetMap.set(s.id, s));
      }

      const orderMap = new Map<string, any>();
      orders.forEach((o: any) => orderMap.set(o.id, o));

      // ── 3. PLANEJADO (cascata) ──────────────────────────────────────────────
      const ops: DailyOpInput[] = orders.map((o: any) => ({
        order_id: o.id,
        order_number: o.order_number ?? null,
        reference_id: o.reference_id,
        color: o.color ?? null,
        quantity: Number(o.quantity || 0),
        planned_delivery: o.planned_delivery,
        sheet_name: sheetMap.get(o.reference_id)?.name ?? null,
      }));
      const planned = computeSectorDailyLoad(dateISO, ops, sheetMap);

      // ── 4. REAL (WIP atual: etapa CORRENTE de cada OP) ──────────────────────
      // Neste schema as etapas abertas de order_stages NÃO têm started_at e não
      // existe status 'em_andamento' — então a presença física é dada pela ETAPA
      // CORRENTE (1ª não-concluída na ordem do fluxo), igual ao
      // loadBottlenecksForOrders. É um retrato do AGORA (sem histórico por dia):
      // ao trocar o dia, o planejado muda, o real continua sendo o estado atual.
      const orderIds = orders.map((o: any) => o.id);
      const { data: stagesRaw } = await supabase
        .from('order_stages')
        .select('order_id, stage_name, status, stage_order, quantity_total, quantity_processed')
        .in('order_id', orderIds)
        .neq('status', 'concluido')
        .order('stage_order', { ascending: true });

      // Etapa corrente por OP = a 1ª aberta (menor stage_order). Uma OP entra em
      // UM setor só → sem duplo-cont em realPairs. Prefere a etapa `em_andamento`
      // (trabalho realmente apontado pelo operador) à 1ª pendente — assim, quando
      // alguém aponta o início de um setor adiante, o WIP real reflete onde o
      // trabalho está, não a 1ª etapa ainda não tocada.
      const currentStageByOrder = new Map<string, any>();
      for (const st of stagesRaw || []) {
        const oid = (st as any).order_id;
        const existing = currentStageByOrder.get(oid);
        if (!existing) {
          currentStageByOrder.set(oid, st);
        } else if (existing.status !== 'em_andamento' && (st as any).status === 'em_andamento') {
          currentStageByOrder.set(oid, st);
        }
      }

      const realBySector = new Map<SectorKey, RealStageOp[]>();
      const realOrderIds = new Set<string>();
      for (const [oid, st] of currentStageByOrder) {
        const key = normalizeSector((st as any).stage_name) as SectorKey;
        if (!DISPLAY_KEYS.has(key)) continue;
        const ord = orderMap.get(oid);
        if (!ord) continue;
        const total = Number((st as any).quantity_total ?? ord.quantity ?? 0);
        const processed = Number((st as any).quantity_processed ?? 0);
        const remaining = Math.max(0, total - processed);
        const arr = realBySector.get(key) || [];
        arr.push({
          order_id: ord.id,
          order_number: ord.order_number ?? null,
          sheet_name: sheetMap.get(ord.reference_id)?.name ?? null,
          color: ord.color ?? null,
          status: String((st as any).status || ''),
          quantityTotal: total,
          quantityProcessed: processed,
          remaining,
          bottleneck: null,
        });
        realBySector.set(key, arr);
        realOrderIds.add(oid);
      }

      // ── 5. Flag de atraso (gargalo em andamento) ────────────────────────────
      let bottlenecks = new Map<string, BottleneckInfo>();
      if (realOrderIds.size > 0) {
        bottlenecks = await loadBottlenecksForOrders(Array.from(realOrderIds));
      }

      // ── 6. Mescla planejado + real ──────────────────────────────────────────
      const sectors: SectorDaily[] = planned.map((p) => {
        const realOps = (realBySector.get(p.sector) || []).map((r) => ({
          ...r,
          bottleneck: bottlenecks.get(r.order_id) || null,
        }));
        const realPairs = realOps.reduce((s, r) => s + r.remaining, 0);
        const realDelayedCount = realOps.filter(
          (r) => r.bottleneck && r.bottleneck.severity !== 'ok',
        ).length;
        const realUnstartedCount = realOps.filter((r) => r.bottleneck?.unstarted).length;
        return {
          ...p,
          realPairs,
          realOpsCount: realOps.length,
          realDelayedCount,
          realUnstartedCount,
          realOps: realOps.sort((a, b) => b.remaining - a.remaining),
        };
      });

      return {
        date: dateISO,
        sectors,
        summary: {
          plannedPairs: sectors.reduce((s, x) => s + x.plannedPairs, 0),
          sectorsAlert: sectors.filter((x) => x.severity === 'warning' || x.severity === 'critical').length,
          realPairs: sectors.reduce((s, x) => s + x.realPairs, 0),
          realDelayed: sectors.reduce((s, x) => s + x.realDelayedCount, 0),
          realUnstarted: sectors.reduce((s, x) => s + x.realUnstartedCount, 0),
        },
      };
    },
    staleTime: 60_000,
  });
}
