/**
 * Agrupa linhas de list_material_commitments_by_product em árvore PV → OPs.
 * sale_order_id nulo cai em "Sem PV" pra a soma bater com reserved_stock.
 */

export interface CommitmentRow {
  reservation_id: string;
  sale_order_id: string | null;
  sale_order_number: string | null;
  client_name: string | null;
  quantity_reserved: number;
  quantity_consumed: number;
  open_qty: number;
  status: string | null;
  kind: string | null;
  order_id: string | null;
  order_number: string | null;
  priority_score: number | null;
  billing_week: string | null;
}

export interface ReservationOpLine {
  reservationId: string;
  orderId: string | null;
  orderNumber: string | null;
  status: string | null;
  kind: string | null;
  openQty: number;
}

export interface ReservationPvGroup {
  key: string;
  saleOrderId: string | null;
  saleOrderNumber: string | null;
  clientName: string | null;
  billingWeek: string | null;
  openQty: number;
  ops: ReservationOpLine[];
}

const ORPHAN_KEY = '__sem_pv__';

export function groupCommitmentsByPv(rows: CommitmentRow[]): ReservationPvGroup[] {
  const map = new Map<string, ReservationPvGroup>();

  for (const row of rows) {
    const openQty = Math.max(0, Number(row.open_qty) || 0);
    const key = row.sale_order_id ?? ORPHAN_KEY;
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        saleOrderId: row.sale_order_id,
        saleOrderNumber: row.sale_order_number,
        clientName: row.client_name,
        billingWeek: row.billing_week,
        openQty: 0,
        ops: [],
      };
      map.set(key, group);
    }
    group.openQty += openQty;
    group.ops.push({
      reservationId: row.reservation_id,
      orderId: row.order_id,
      orderNumber: row.order_number,
      status: row.status,
      kind: row.kind,
      openQty,
    });
  }

  return Array.from(map.values());
}

export function sumOpenQty(groups: ReservationPvGroup[]): number {
  return groups.reduce((acc, g) => acc + g.openQty, 0);
}
