/**
 * Saldo que uma OC aberta já cobre de um material do pedido.
 * Gerar OC nova só pede o que ainda não está comprado nem recebido.
 */
export interface OpenPurchasePending {
  saleOrderId: string;
  productId: string;
  pending: number;
}

export interface PurchaseLineLike {
  saleOrderId: string;
  productId: string;
  quantity: number;
}

export function openPurchaseKey(saleOrderId: string, productId: string): string {
  return `${saleOrderId}:${productId}`;
}

export function pendingByOrderProduct(rows: OpenPurchasePending[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = openPurchaseKey(row.saleOrderId, row.productId);
    map.set(key, (map.get(key) ?? 0) + Math.max(0, row.pending));
  }
  return map;
}

/** Abate o pendente de recebimento. Quantidade zerada sai da sugestão. */
export function subtractOpenPurchasePending<T extends PurchaseLineLike>(
  lines: T[],
  pending: Map<string, number>,
): T[] {
  const left = new Map(pending);
  const out: T[] = [];
  for (const line of lines) {
    const key = openPurchaseKey(line.saleOrderId, line.productId);
    const covered = left.get(key) ?? 0;
    const quantity = Math.max(0, line.quantity - covered);
    left.set(key, Math.max(0, covered - line.quantity));
    if (quantity <= 0) continue;
    out.push({ ...line, quantity });
  }
  return out;
}

export type MaterialCoverageStatus = 'falta' | 'comprado' | 'recebido' | 'reservado';

export function materialCoverageStatus(input: {
  required: number;
  reserved: number;
  short: number;
  openPending: number;
  received: number;
}): MaterialCoverageStatus {
  const need = Math.max(0, input.required);
  if (need <= 0) return 'reservado';
  if (input.received >= need) return 'recebido';
  if (input.short <= 0 && input.reserved > 0) return 'reservado';
  if (input.openPending + input.received >= input.short && input.short > 0) return 'comprado';
  return 'falta';
}

export function orderReadyForProduction(rows: Array<{ status: MaterialCoverageStatus }>): boolean {
  return rows.length > 0 && rows.every((row) => row.status === 'reservado' || row.status === 'recebido');
}
