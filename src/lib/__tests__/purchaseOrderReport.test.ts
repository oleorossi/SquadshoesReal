import { describe, expect, it } from 'vitest';
import { summarizePurchaseOrders } from '@/lib/purchaseOrderReport';
import type { PurchaseOrder } from '@/hooks/usePurchaseOrders';

const order = (partial: Partial<PurchaseOrder>): PurchaseOrder => ({
  id: crypto.randomUUID(), order_number: 'OC-1', status: 'pending', supplier_id: null,
  supplier_name: 'Fornecedor A', total_value: 100, notes: '', auto_generated: false,
  promised_date: null, purchase_by_date: null, received_date: null,
  created_at: '2026-08-01', updated_at: '2026-08-01', ...partial,
});

describe('summarizePurchaseOrders', () => {
  it('resume o recorte e não soma ordens canceladas', () => {
    const result = summarizePurchaseOrders([
      order({ total_value: 100, promised_date: '2026-08-10' }),
      order({ supplier_name: 'Fornecedor B', status: 'received', total_value: 300 }),
      order({ status: 'cancelled', total_value: 900 }),
    ], '2026-08-23');
    expect(result).toEqual({ count: 3, supplierCount: 2, total: 400, average: 200, openTotal: 100, overdueCount: 1 });
  });
});
