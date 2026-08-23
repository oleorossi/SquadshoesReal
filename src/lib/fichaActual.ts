/**
 * Real baixado da OP: reserva consumida/convertida + movimento com order_id.
 * Não usa ILIKE na descrição — casa por chave, não por texto.
 * Se os dois caminhos registram o mesmo débito, fica o maior (evita somar 2×).
 */

export type ReservationActualRow = {
  product_id: string | null;
  quantity_consumed?: number | null;
  quantity_reserved?: number | null;
  status?: string | null;
};

export type MovementActualRow = {
  product_id: string | null;
  quantity?: number | null;
};

const CONSUMED_STATUSES = new Set(['consumed', 'converted', 'partially_consumed']);

export function qtyFromReservation(row: ReservationActualRow): number {
  const consumed = Math.max(0, Number(row.quantity_consumed) || 0);
  if (consumed > 0) return consumed;
  if (CONSUMED_STATUSES.has(String(row.status || ''))) {
    return Math.max(0, Number(row.quantity_reserved) || 0);
  }
  return 0;
}

export function mergeActualQty(params: {
  reservations: ReservationActualRow[];
  movements: MovementActualRow[];
}): Array<{ productId: string; qty: number }> {
  const fromRes = new Map<string, number>();
  for (const row of params.reservations) {
    if (!row.product_id) continue;
    const qty = qtyFromReservation(row);
    if (qty <= 0) continue;
    fromRes.set(row.product_id, (fromRes.get(row.product_id) || 0) + qty);
  }

  const fromMov = new Map<string, number>();
  for (const row of params.movements) {
    if (!row.product_id) continue;
    const qty = Math.abs(Number(row.quantity) || 0);
    if (qty <= 0) continue;
    fromMov.set(row.product_id, (fromMov.get(row.product_id) || 0) + qty);
  }

  const ids = new Set([...fromRes.keys(), ...fromMov.keys()]);
  const out: Array<{ productId: string; qty: number }> = [];
  for (const productId of ids) {
    const qty = Math.max(fromRes.get(productId) || 0, fromMov.get(productId) || 0);
    if (qty > 0) out.push({ productId, qty });
  }
  return out;
}
