import { supabase } from '@/integrations/supabase/client';

/**
 * Onda B: débito de estoque só roda se a OP/PV tiver referência e ficha.
 * Sem ficha a baixa vira saída avulsa — o estoque mente.
 *
 * NÃO trava produção nem faturamento. Só recusa o RPC de baixa
 * (commit_picking, consume_all_reservations, convert_reservation_to_out).
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

type IdRow = { id?: string | null; reference_id?: string | null; sale_order_id?: string | null };

type SheetLookup = {
  select: (cols: string) => {
    in: (col: string, values: string[]) => Promise<{ data: IdRow[] | null }>;
  };
};

function sheetsTable(): SheetLookup {
  return supabase.from('technical_sheets') as unknown as SheetLookup;
}

async function sheetIdsForRefs(refs: string[]): Promise<Set<string>> {
  const sheetIds = new Set<string>();
  if (refs.length === 0) return sheetIds;
  const { data: byId } = await sheetsTable().select('id').in('id', refs);
  for (const s of byId || []) if (s?.id) sheetIds.add(s.id);

  const missing = refs.filter((id) => !sheetIds.has(id));
  if (missing.length > 0) {
    const { data: byRef } = await sheetsTable().select('id, reference_id').in('reference_id', missing);
    for (const s of byRef || []) {
      if (s?.id) sheetIds.add(s.id);
      if (s?.reference_id) sheetIds.add(s.reference_id);
    }
  }
  return sheetIds;
}

export async function guardDebitForSaleOrder(saleOrderId: string): Promise<FichaDebitGuardResult> {
  const { data, error } = await supabase
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

  const rows = (data || []) as IdRow[];
  const refs = [...new Set(rows.map((r) => r.reference_id).filter((id): id is string => Boolean(id)))];
  const sheetIds = await sheetIdsForRefs(refs);

  return evaluateFichaDebitGuard(
    rows.map((row) => ({
      id: row.id ?? undefined,
      reference_id: row.reference_id,
      has_sheet: Boolean(row.reference_id && sheetIds.has(row.reference_id)),
    })),
  );
}

/** Mesma régua do PV, a partir de uma OP (picking / convert no faturamento). */
export async function guardDebitForOrder(orderId: string): Promise<FichaDebitGuardResult> {
  const { data, error } = await supabase
    .from('orders')
    .select('id, reference_id, sale_order_id')
    .eq('id', orderId)
    .maybeSingle();

  if (error) {
    return {
      allowed: false,
      reason: `Não deu pra checar ficha: ${error.message}`,
      orderCount: 0,
      missingSheet: 0,
    };
  }
  if (!data) {
    return { allowed: false, reason: 'OP não encontrada pra checar ficha.', orderCount: 0, missingSheet: 0 };
  }

  const row = data as IdRow;
  if (row.sale_order_id) return guardDebitForSaleOrder(row.sale_order_id);

  const refs = row.reference_id ? [row.reference_id] : [];
  const sheetIds = await sheetIdsForRefs(refs);
  return evaluateFichaDebitGuard([
    {
      id: row.id ?? undefined,
      reference_id: row.reference_id,
      has_sheet: Boolean(row.reference_id && sheetIds.has(row.reference_id)),
    },
  ]);
}
