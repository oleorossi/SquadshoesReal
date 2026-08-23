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
    .select('id, reference_id, technical_sheets(id)')
    .eq('sale_order_id', saleOrderId);

  if (error) {
    return {
      allowed: false,
      reason: `Não deu pra checar ficha: ${error.message}`,
      orderCount: 0,
      missingSheet: 0,
    };
  }

  const rows = (data || []) as Array<{ id: string; reference_id: string | null; technical_sheets?: { id: string } | { id: string }[] | null }>;
  return evaluateFichaDebitGuard(
    rows.map((row) => {
      const sheets = row.technical_sheets;
      const hasSheet = Array.isArray(sheets) ? sheets.length > 0 : Boolean(sheets && (sheets as { id: string }).id);
      return { id: row.id, reference_id: row.reference_id, has_sheet: Boolean(row.reference_id) && hasSheet };
    }),
  );
}
