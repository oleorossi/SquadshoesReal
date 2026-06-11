import { supabase } from '@/integrations/supabase/client';
import { checkSectorCapacity, CapacityCheckInput } from '@/lib/sectorCapacity';
import { nextDOW } from '@/lib/isoWeek';

/**
 * Retorna a data mínima de faturamento (ISO yyyy-mm-dd) para um pedido de venda,
 * calculada a partir de hoje somando: lead time fornecedor + buffer material +
 * corte + costura + montagem + acabamento.
 *
 * Usa a função SQL `compute_min_billing_date` para garantir paridade com o backend.
 */
export async function fetchMinBillingDate(saleOrderId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('compute_min_billing_date' as any, {
    p_sale_order_id: saleOrderId,
  });
  if (error) {
    console.error('[minBillingDate] erro:', error);
    return null;
  }
  return (data as string) || null;
}

/**
 * Versão em lote — retorna um Map<sale_order_id, min_date>.
 */
export async function fetchMinBillingDates(saleOrderIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (saleOrderIds.length === 0) return out;
  const { data, error } = await supabase
    .from('sale_order_min_billing' as any)
    .select('sale_order_id, min_billing_date')
    .in('sale_order_id', saleOrderIds);
  if (error) {
    console.error('[minBillingDates] erro:', error);
    return out;
  }
  for (const row of (data || []) as any[]) {
    if (row.sale_order_id && row.min_billing_date) {
      out.set(row.sale_order_id, row.min_billing_date);
    }
  }
  return out;
}

/** Verifica se uma data ISO está abaixo da data mínima (sem horário). */
export function isBeforeMinDate(targetISO: string, minISO: string): boolean {
  if (!targetISO || !minISO) return false;
  return targetISO < minISO; // ISO yyyy-mm-dd ordena lexicograficamente
}

export function formatBR(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Converte uma data ISO (yyyy-mm-dd) na chave de semana ISO 8601 — formato `YYYY-Www`.
 * Ex: 2026-04-29 → 2026-W18.
 */
export function toISOWeek(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function addBusinessDaysISO(startISO: string, days: number): string {
  const d = new Date(startISO + 'T00:00:00');
  let added = 0;
  while (added < days) {
    // setDate() handles DST transitions (BR fall-back/spring-forward) correctly.
    // Adding a fixed 86_400_000 ms drifts by ±1h on transition days.
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d.toISOString().slice(0, 10);
}

export interface MaterialShortfall {
  product_id: string;
  product_name: string;
  color: string | null;
  needed: number;
  available: number;
  shortage: number;
  lead_time_days: number;
}

export interface MinBillingResult {
  minDateISO: string;
  minWeekISO: string;
  bottleneck: 'capacidade' | 'material' | 'nenhum';
  capacityReadyDateISO: string;
  materialReadyDateISO: string;
  materialShortfalls: MaterialShortfall[];
}

/**
 * Calcula a data mínima de faturamento pra um PV ainda NÃO persistido,
 * combinando 2 dimensões:
 *
 *   1) CAPACIDADE — itera datas candidatas e usa checkSectorCapacity pra
 *      detectar overload em setores. Resultado: capacityReadyDate.
 *
 *   2) MATERIAL — chama RPC compute_material_ready_date que consulta stock
 *      vs consumo via sheet_materials e soma supplier_lead_time DOS materiais
 *      com shortage (não soma cego). Resultado: materialReadyDate.
 *
 * Data final = MAX(capacity, material), snappada pra próxima janela de pickup
 * (Terça/Sexta). `bottleneck` indica qual restrição venceu, pra UI explicar
 * ao usuário ("Material X chega em N dias" vs "Setor Y lotado em semana W").
 */
export async function computeMinBillingForNewOrder(
  items: CapacityCheckInput[],
): Promise<MinBillingResult | null> {
  if (!items || items.length === 0) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString().slice(0, 10);

  // ── (1) Material ready date — RPC stock-aware ──────────────────────────
  let materialReadyDateISO = todayISO;
  let materialShortfalls: MaterialShortfall[] = [];
  try {
    const rpcItems = items
      .filter(i => i.reference_id && (i.quantity ?? 0) > 0)
      .map(i => ({ reference_id: i.reference_id, quantity: i.quantity ?? 0 }));
    if (rpcItems.length > 0) {
      const { data, error } = await (supabase as any).rpc('compute_material_ready_date', {
        p_items: rpcItems,
      });
      if (!error && data) {
        materialReadyDateISO = data.ready_date || todayISO;
        materialShortfalls = (data.shortfall_materials as MaterialShortfall[]) || [];
      }
    }
  } catch (err) {
    console.warn('[computeMinBillingForNewOrder] compute_material_ready_date falhou:', err);
  }

  // ── (2) Capacity ready date — itera procurando primeira data sem overload
  let capacityReadyDateISO = addBusinessDaysISO(todayISO, 7);
  for (let i = 0; i < 20; i++) {
    try {
      const result = await checkSectorCapacity(items, capacityReadyDateISO);
      if (!result.hasOverload) break;
    } catch {
      break;
    }
    capacityReadyDateISO = addBusinessDaysISO(capacityReadyDateISO, 2);
  }

  // ── (3) Combina: a data final é o maior entre os dois gargalos ─────────
  const finalCandidate = capacityReadyDateISO > materialReadyDateISO
    ? capacityReadyDateISO
    : materialReadyDateISO;

  const bottleneck: MinBillingResult['bottleneck'] =
    capacityReadyDateISO === materialReadyDateISO
      ? 'nenhum'
      : capacityReadyDateISO > materialReadyDateISO
        ? 'capacidade'
        : 'material';

  const snapped = snapToNextPickup(finalCandidate);

  return {
    minDateISO: snapped,
    minWeekISO: toISOWeek(snapped),
    bottleneck,
    capacityReadyDateISO,
    materialReadyDateISO,
    materialShortfalls,
  };
}

/**
 * Arredonda uma data ISO pra próxima janela de pickup viável (Terça=2 ou Sexta=5).
 * Retorna a primeira janela >= dataBase. Espelha a lógica de
 * compute_min_billing_date no DB pra garantir paridade entre PVs salvos
 * (que usam SQL) e PVs em criação (que usam esta função client-side).
 */
function snapToNextPickup(iso: string): string {
  const tue = nextDOW(iso, 2);
  const fri = nextDOW(iso, 5);
  return tue < fri ? tue : fri;
}