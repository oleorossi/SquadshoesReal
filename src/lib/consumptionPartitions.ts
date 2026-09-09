import type { ConsumptionRow } from '@/lib/consumptionRows';

/** Fatia PV → modelo para o modo estendido (tela + PDF). */
export type OrderReferencePartition = {
  orderNumber: string;
  saleOrderId: string | null;
  models: Array<{
    referenceLabel: string;
    referenceId: string | null;
    rows: ConsumptionRow[];
  }>;
};

export function buildOrderReferencePartitions(rows: ConsumptionRow[]): OrderReferencePartition[] {
  const byOrder = new Map<string, {
    orderNumber: string;
    saleOrderId: string | null;
    models: Map<string, { referenceLabel: string; referenceId: string | null; rows: ConsumptionRow[] }>;
  }>();

  for (const row of rows) {
    const orderNumber = (row.orderNumber || '').trim() || 'PV';
    const saleOrderId = row.saleOrderId || null;
    const orderKey = saleOrderId || orderNumber;
    const referenceLabel = (row.referenceCode || row.referenceName || 'SEM REF').trim() || 'SEM REF';
    const referenceId = row.referenceId || null;
    const modelKey = referenceId || referenceLabel;

    if (!byOrder.has(orderKey)) {
      byOrder.set(orderKey, { orderNumber, saleOrderId, models: new Map() });
    }
    const order = byOrder.get(orderKey)!;
    if (!order.models.has(modelKey)) {
      order.models.set(modelKey, { referenceLabel, referenceId, rows: [] });
    }
    order.models.get(modelKey)!.rows.push(row);
  }

  return Array.from(byOrder.values())
    .sort((a, b) => a.orderNumber.localeCompare(b.orderNumber, 'pt-BR'))
    .map((order) => ({
      orderNumber: order.orderNumber,
      saleOrderId: order.saleOrderId,
      models: Array.from(order.models.values())
        .sort((a, b) => a.referenceLabel.localeCompare(b.referenceLabel, 'pt-BR')),
    }));
}
