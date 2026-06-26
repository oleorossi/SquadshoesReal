import { supabase } from '@/integrations/supabase/client';
import { loadHolidayCache, businessDaysBetween as businessDaysBetweenHolidayAware } from '@/lib/sectorCapacity';

/**
 * Detector de gargalos no sequenciamento de setores.
 *
 * Uma OP é considerada gargalo quando o tempo já gasto no setor atual
 * (started_at → agora) excede o tempo esperado calculado por:
 *   tempoEsperado = ceil(quantidade / capacity_per_day_do_setor) dias úteis
 *
 * Severidade:
 *   - warning: 1 a 2 dias acima do esperado
 *   - critical: 3+ dias acima do esperado, ou setor saturado (fila > capacity * 2)
 */

export type BottleneckSeverity = 'ok' | 'warning' | 'critical';

export interface BottleneckInfo {
  severity: BottleneckSeverity;
  daysOver: number;          // dias úteis acima do esperado (>=0)
  expectedDays: number;      // dias esperados para a quantidade
  elapsedDays: number;       // dias úteis já decorridos no setor
  capacityPerDay: number;    // capacity do setor (referência)
  reason: string;            // texto curto p/ tooltip
  /** Detalhes da próxima etapa, quando aplicável. */
  nextStage?: NextStageEstimate | null;
  /** TRUE quando a OP está no setor mas a etapa não tem `started_at` (operador
   *  não apontou o início). Sem o timestamp não dá pra medir idade da fila, então
   *  a severidade fica 'ok' (não infla "atrasadas"), mas a flag deixa a UI cobrar
   *  o apontamento em vez de descartar a OP silenciosamente. */
  unstarted?: boolean;
}

/** Estimativa de gargalo na próxima etapa de produção. */
export interface NextStageEstimate {
  sectorName: string;
  capacityPerDay: number;
  /** Quantidade de pares já enfileirada para esse setor (todas as OPs em setores anteriores + a atual). */
  queuedPairs: number;
  /** Quantidade da própria OP. */
  ownPairs: number;
  /** Dias úteis estimados para zerar a fila (queuedPairs / capacity). */
  queueDays: number;
  /** Dias úteis estimados para processar APENAS a OP atual. */
  ownProcessingDays: number;
  severity: BottleneckSeverity;
  reason: string;
}

/**
 * Dias úteis entre duas datas (zeradas à meia-noite), feriado-aware.
 * Reusa o cache de feriados de sectorCapacity — populado por loadHolidayCache()
 * no início de loadBottlenecksForOrders. Antes só pulava fim de semana, o que
 * superestimava o "elapsed" em semanas com feriado → gargalo falso (auditoria
 * 2026-06-14, Área 1).
 */
function businessDaysBetween(start: Date, end: Date): number {
  const a = new Date(start);
  a.setHours(0, 0, 0, 0);
  const b = new Date(end);
  b.setHours(0, 0, 0, 0);
  if (b <= a) return 0;
  return businessDaysBetweenHolidayAware(a, b);
}

/**
 * Mapeia o nome do setor (Kanban) para a coluna de capacity na ficha técnica.
 * Alinhado com SECTOR_CONFIG em leadTime.ts:
 *   Corte Palmilha → sewing_capacity_per_day  (coluna herdada de "Costura", repurposed para corte de palmilha)
 *   Corte Forração → cutting_capacity_per_day (coluna herdada de "Corte", repurposed para corte de forração)
 */
const SECTOR_TO_CAPACITY_COLUMN: Record<string, string> = {
  // Post-rename canonical names (migration 20260506120000)
  'Corte Palmilha': 'sewing_capacity_per_day',
  'Corte Forração': 'cutting_capacity_per_day',
  'Aviamento':      'mesa_daily_capacity',
  'Costura':        'costura_capacity_per_day',
  'Silk':           'silk_capacity_per_day',
  'Colagem':        'gluing_capacity_per_day',
  'Montagem':       'assembly_capacity_per_day',
  'Solagem':        'soling_capacity_per_day',
  'Acabamento':     'finishing_capacity_per_day',
  // Expedição ganhou capacidade própria (B4): expedition_capacity_per_day, com
  // fallback pra finishing_capacity_per_day quando não cadastrada (sem regressão).
  'Expedição':      'expedition_capacity_per_day',
  // Pre-rename names kept for historical stage rows.
  // 'Mesa' foi renomeado pra 'Aviamento' (PR 1).
  // 'Costura' antes da PR 2 era apelido de Corte Forração; após PR 2 virou setor próprio
  // com coluna 'costura_capacity_per_day'. Mapping acima já cobre o caso canônico.
  Corte:     'sewing_capacity_per_day',
  Forração:  'cutting_capacity_per_day',
  Mesa:      'mesa_daily_capacity',
};

export interface BottleneckInput {
  orderId: string;
  quantity: number;
  currentSector: string;
  startedAt: string | null;       // started_at do stage atual (ISO)
  capacityPerDay: number;         // já resolvido a partir da ficha
}

export function computeBottleneck(input: BottleneckInput): BottleneckInfo {
  const { quantity, currentSector, startedAt, capacityPerDay } = input;

  if (!startedAt || !capacityPerDay || capacityPerDay <= 0 || !currentSector) {
    return {
      severity: 'ok',
      daysOver: 0,
      expectedDays: 0,
      elapsedDays: 0,
      capacityPerDay: capacityPerDay || 0,
      reason: '',
      nextStage: null,
    };
  }

  const expectedDays = Math.max(1, Math.ceil(quantity / capacityPerDay));
  const elapsedDays = businessDaysBetween(new Date(startedAt), new Date());
  const daysOver = Math.max(0, elapsedDays - expectedDays);

  let severity: BottleneckSeverity = 'ok';
  if (daysOver >= 3) severity = 'critical';
  else if (daysOver >= 1) severity = 'warning';

  const reason =
    severity === 'ok'
      ? `${currentSector} dentro do prazo (${elapsedDays}/${expectedDays}d)`
      : `${currentSector}: ${elapsedDays}d gastos (esperado ${expectedDays}d, capacity ${capacityPerDay}p/d)`;

  return { severity, daysOver, expectedDays, elapsedDays, capacityPerDay, reason, nextStage: null };
}

/**
 * Carrega capacities das fichas técnicas envolvidas e a lista de stages atuais
 * (apenas o stage `em_andamento`/`pendente` mais recente por OP).
 * Retorna um Map<orderId, BottleneckInfo>. Inclui também OPs com severity 'ok'
 * (com nextStage estimado quando houver gargalo na próxima etapa).
 */
export async function loadBottlenecksForOrders(
  orderIds: string[],
): Promise<Map<string, BottleneckInfo>> {
  const out = new Map<string, BottleneckInfo>();
  if (orderIds.length === 0) return out;

  // Feriados → dias úteis alinhados ao SQL is_business_day (idem sectorCapacity).
  await loadHolidayCache();

  const { data: ordersRaw } = await supabase
    .from('orders')
    .select('id, quantity, reference_id')
    .in('id', orderIds);

  const refIds = Array.from(
    new Set((ordersRaw || []).map((o: any) => o.reference_id).filter(Boolean)),
  );

  let sheetMap = new Map<string, any>();
  if (refIds.length > 0) {
    const { data: sheets } = await supabase
      .from('technical_sheets')
      .select(
        // costura_capacity_per_day incluído (auditoria 2026-06-14): sem ele o
        // setor Costura mapeava p/ coluna ausente → cap=0 → nunca era gargalo.
        'id, cutting_capacity_per_day, sewing_capacity_per_day, mesa_daily_capacity, silk_capacity_per_day, gluing_capacity_per_day, soling_capacity_per_day, assembly_capacity_per_day, finishing_capacity_per_day, expedition_capacity_per_day, costura_capacity_per_day',
      )
      .in('id', refIds);
    (sheets || []).forEach((s: any) => sheetMap.set(s.id, s));
  }

  const { data: stages } = await supabase
    .from('order_stages')
    .select('order_id, stage_name, status, started_at, stage_order')
    .in('order_id', orderIds)
    .order('stage_order', { ascending: true });

  const orderMap = new Map<string, any>();
  (ordersRaw || []).forEach((o: any) => orderMap.set(o.id, o));

  // Para cada OP, encontra o stage atual (primeiro não concluído)
  const byOrder = new Map<string, any[]>();
  for (const st of stages || []) {
    const arr = byOrder.get((st as any).order_id) || [];
    arr.push(st);
    byOrder.set((st as any).order_id, arr);
  }

  // ============= AGREGAÇÃO DE FILA POR SETOR =============
  // Para cada setor, soma os pares que ainda chegarão (OPs cujo stage atual
  // tem stage_order <= o setor alvo e não está concluído).
  // Isto nos permite estimar o tempo até a OP começar a ser processada lá.
  const sectorQueuedPairs = new Map<string, number>(); // stage_name → pares enfileirados
  for (const orderId of orderIds) {
    const ord = orderMap.get(orderId);
    if (!ord) continue;
    const qty = Number(ord.quantity || 0);
    if (qty <= 0) continue;
    const stagesOfOrder = byOrder.get(orderId) || [];
    const current = stagesOfOrder.find((s: any) => s.status !== 'concluido');
    if (!current) continue;
    // A OP contribuirá com `qty` para a fila de TODOS os setores ainda pendentes
    // (stage atual incluso e seguintes não concluídos).
    for (const st of stagesOfOrder) {
      if (st.status === 'concluido') continue;
      if (st.stage_order < current.stage_order) continue;
      const prev = sectorQueuedPairs.get(st.stage_name) || 0;
      sectorQueuedPairs.set(st.stage_name, prev + qty);
    }
  }

  for (const orderId of orderIds) {
    const ord = orderMap.get(orderId);
    if (!ord) continue;
    const sheet = sheetMap.get(ord.reference_id);
    if (!sheet) continue;
    const stagesOfOrder = byOrder.get(orderId) || [];
    const current = stagesOfOrder.find((s: any) => s.status !== 'concluido');
    if (!current) continue;
    // Antes: `if (!current.started_at) continue;` — a OP sumia de QUALQUER alerta,
    // deixando o KPI "OPs atrasadas" cego (todas as OPs sem apontamento contavam
    // como no prazo). Agora marcamos `unstarted` (severidade 'ok', não infla
    // atraso) pra UI poder cobrar o apontamento. Some assim que o operador clica
    // "Iniciar" (started_at) ou o backfill estima a data.
    if (!current.started_at) {
      out.set(orderId, {
        severity: 'ok',
        unstarted: true,
        daysOver: 0,
        expectedDays: 0,
        elapsedDays: 0,
        capacityPerDay: 0,
        reason: `${current.stage_name}: em produção sem início apontado`,
        nextStage: null,
      });
      continue;
    }

    const capCol = SECTOR_TO_CAPACITY_COLUMN[current.stage_name as string];
    let cap = capCol ? Number(sheet[capCol] || 0) : 0;
    // Expedição: cai pra finishing_capacity_per_day quando não tem capacidade própria.
    if (cap === 0 && current.stage_name === 'Expedição') cap = Number(sheet.finishing_capacity_per_day || 0);
    const qty = Number(ord.quantity || 0);

    const info: BottleneckInfo =
      cap > 0
        ? computeBottleneck({
            orderId,
            quantity: qty,
            currentSector: current.stage_name,
            startedAt: current.started_at,
            capacityPerDay: cap,
          })
        : {
            severity: 'ok',
            daysOver: 0,
            expectedDays: 0,
            elapsedDays: 0,
            capacityPerDay: 0,
            reason: '',
            nextStage: null,
          };

    // ===== Estimativa para a PRÓXIMA etapa =====
    const sortedStages = [...stagesOfOrder].sort((a: any, b: any) => a.stage_order - b.stage_order);
    const currentIdx = sortedStages.findIndex((s: any) => s.stage_name === current.stage_name);
    const next = sortedStages.slice(currentIdx + 1).find((s: any) => s.status !== 'concluido');

    if (next) {
      const nextCapCol = SECTOR_TO_CAPACITY_COLUMN[next.stage_name as string];
      let nextCap = nextCapCol ? Number(sheet[nextCapCol] || 0) : 0;
      if (nextCap === 0 && next.stage_name === 'Expedição') nextCap = Number(sheet.finishing_capacity_per_day || 0);
      if (nextCap > 0) {
        const queuedPairs = sectorQueuedPairs.get(next.stage_name) || qty;
        const queueDays = Math.ceil(queuedPairs / nextCap);
        const ownProcessingDays = Math.max(1, Math.ceil(qty / nextCap));

        // Heurística: gargalo se a fila ocupa > 5 dias úteis (warning) ou > 10 (critical)
        let nextSeverity: BottleneckSeverity = 'ok';
        if (queueDays >= 10) nextSeverity = 'critical';
        else if (queueDays >= 5) nextSeverity = 'warning';

        const nextReason =
          nextSeverity === 'ok'
            ? `${next.stage_name}: fila de ${queuedPairs}p (~${queueDays}d úteis)`
            : `${next.stage_name}: ${queuedPairs}p enfileirados, ~${queueDays}d úteis para iniciar (capacity ${nextCap}p/d)`;

        info.nextStage = {
          sectorName: next.stage_name,
          capacityPerDay: nextCap,
          queuedPairs,
          ownPairs: qty,
          queueDays,
          ownProcessingDays,
          severity: nextSeverity,
          reason: nextReason,
        };
      }
    }

    // Inclui no Map se houver gargalo (atual OU próximo) ou se há próxima etapa estimada
    if (
      info.severity !== 'ok' ||
      (info.nextStage && info.nextStage.severity !== 'ok')
    ) {
      out.set(orderId, info);
    }
  }

  return out;
}