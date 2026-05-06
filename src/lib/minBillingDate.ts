import { supabase } from '@/integrations/supabase/client';
import { checkSectorCapacity, CapacityCheckInput } from '@/lib/sectorCapacity';

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

/**
 * Calcula a data mínima de faturamento para um pedido AINDA NÃO PERSISTIDO,
 * a partir dos itens em memória (referência + quantidade).
 *
 * Estratégia: itera datas de faturamento candidatas a partir de hoje + lead time
 * mínimo, e retorna a primeira em que `checkSectorCapacity` reporta `hasOverload === false`.
 * Limitado a 60 dias úteis para evitar loop infinito em sistemas saturados.
 */
export async function computeMinBillingForNewOrder(
  items: CapacityCheckInput[],
): Promise<{ minDateISO: string; minWeekISO: string } | null> {
  if (!items || items.length === 0) return null;

  // Ponto de partida: hoje + 7 dias úteis (margem mínima de produção)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let candidate = addBusinessDaysISO(today.toISOString().slice(0, 10), 7);

  // Limita a 20 tentativas (4 semanas úteis) — suficiente para a maioria dos casos
  for (let i = 0; i < 20; i++) {
    try {
      const result = await checkSectorCapacity(items, candidate);
      if (!result.hasOverload) {
        return { minDateISO: candidate, minWeekISO: toISOWeek(candidate) };
      }
    } catch {
      return { minDateISO: candidate, minWeekISO: toISOWeek(candidate) };
    }
    // Avança em saltos de 2 dias úteis para reduzir o número de queries
    candidate = addBusinessDaysISO(candidate, 2);
  }

  return { minDateISO: candidate, minWeekISO: toISOWeek(candidate) };
}