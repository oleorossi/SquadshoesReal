import { supabase } from '@/integrations/supabase/client';

/**
 * Onda B: débito de estoque na liberação só roda se o PV tiver OP com referência
 * e ficha técnica. Sem ficha a baixa vira saída avulsa — o estoque mente.
 *
 * NÃO trava a liberação da produção (regra load-bearing em releaseConsumption).
 * Só recusa o commit_picking. Faturamento continua como rede.
 */

export interface FichaDebitGuardResult {
  allowed: boolean;
  reason?: string;
  orderCount: number;
  missingSheet: number;
}

export function evaluateFichaDebitGuard(orders: Array<{
  id?: string;
  reference_id?: string | null;
  has_sheet?: boolean;
}>): FichaDebitGuardResult {
  const orderCount = orders.length;
  if (orderCount === 0) {
    return { allowed: false, reason: 'PV sem OP — não há ficha pra explodir.', orderCount: 0, missingSheet: 0 };
  }
  const missingSheet = orders.filter((o) => !o.reference_id || o.has_sheet === false).length;
  if (missingSheet > 0) {
    return {
      allowed: false,
      reason: `${missingSheet} ${missingSheet === 1 ? 'OP sem ficha técnica' : 'OPs sem ficha técnica'} — baixa bloqueada.`,
      orderCount,
      missingSheet,
    };
  }
  return { allowed: true, orderCount, missingSheet: 0 };
}

export async function guardDebitForSaleOrder(saleOrderId: string): Promise<FichaDebitGuardResult> {
  const { data, error } = await (supabase as any)
    .from('orders')
    .select('id, reference_id')
    .eq('sale_order_id', saleOrderId);

  if (error) {
    return {
      allowed: false,
      reason: `Não deu pra checar ficha: ${error.message}`,
      orderCount: 0,
      missingSheet: 0,
    };
  }

  const rows = (data || []) as Array<{ id: string; reference_id: string | null }>;
  const refs = [...new Set(rows.map((r) => r.reference_id).filter((id): id is string => Boolean(id)))];

  const sheetIds = new Set<string>();
  if (refs.length > 0) {
    const { data: byId } = await (supabase as any)
      .from('technical_sheets')
      .select('id')
      .in('id', refs);
    for (const s of byId || []) if (s?.id) sheetIds.add(s.id);

    const missing = refs.filter((id) => !sheetIds.has(id));
    if (missing.length > 0) {
      const { data: byRef } = await (supabase as any)
        .from('technical_sheets')
        .select('id, reference_id')
        .in('reference_id', missing);
      for (const s of byRef || []) {
        if (s?.id) sheetIds.add(s.id);
        if (s?.reference_id) sheetIds.add(s.reference_id);
      }
    }
  }

  return evaluateFichaDebitGuard(
    rows.map((row) => ({
      id: row.id,
      reference_id: row.reference_id,
      has_sheet: Boolean(row.reference_id && sheetIds.has(row.reference_id)),
    })),
  );
}
