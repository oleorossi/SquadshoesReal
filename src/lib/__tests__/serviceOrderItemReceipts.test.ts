import { describe, expect, it } from 'vitest';
import {
  buildFullServiceOrderItemReceipt,
  serviceOrderItemPhysicalTotal,
  serviceOrderItemReceiptPayload,
  summarizeServiceOrderItemReceipts,
  updateServiceOrderItemReceiptEntry,
  type ServiceOrderReceiptItem,
} from '../serviceOrderItemReceipts';

const row = (id: string, remaining: number, unallocated = 0): ServiceOrderReceiptItem => ({
  sale_order_item_id: id,
  sale_order_id: 'pv-1',
  pv_number: 'PV-00001',
  op_number: null,
  reference_code: 'I90',
  reference_name: 'I90',
  color: 'PRETO',
  contracted_qty: remaining,
  qty_good: 0,
  qty_defect: 0,
  qty_defect_scrapped: 0,
  qty_loss: 0,
  qty_settled: 0,
  qty_remaining: remaining,
  unallocated_return_qty: unallocated,
});

describe('recebimento de OS por item', () => {
  it('não conta sucata duas vezes no total físico', () => {
    expect(serviceOrderItemPhysicalTotal({
      qtyGood: 20, qtyDefect: 3, qtyDefectScrapped: 2, qtyLoss: 1,
    })).toBe(24);
  });

  it('limita a digitação ao saldo do item e mantém sucata dentro do defeito', () => {
    let entry = { qtyGood: 8, qtyDefect: 0, qtyDefectScrapped: 0, qtyLoss: 0 };
    entry = updateServiceOrderItemReceiptEntry(entry, 'qtyDefect', 5, 10);
    expect(entry.qtyDefect).toBe(2);

    entry = updateServiceOrderItemReceiptEntry(entry, 'qtyDefectScrapped', 9, 10);
    expect(entry.qtyDefectScrapped).toBe(2);

    entry = updateServiceOrderItemReceiptEntry(entry, 'qtyDefect', 1, 10);
    expect(entry.qtyDefectScrapped).toBe(1);
  });

  it('soma a conferência e envia apenas linhas movimentadas', () => {
    const entries = {
      a: { qtyGood: 12, qtyDefect: 2, qtyDefectScrapped: 1, qtyLoss: 0 },
      b: { qtyGood: 0, qtyDefect: 0, qtyDefectScrapped: 0, qtyLoss: 0 },
      c: { qtyGood: 5, qtyDefect: 0, qtyDefectScrapped: 0, qtyLoss: 1 },
    };
    expect(summarizeServiceOrderItemReceipts(entries)).toEqual({
      qtyGood: 17, qtyDefect: 2, qtyDefectScrapped: 1, qtyLoss: 1,
    });
    expect(serviceOrderItemReceiptPayload(entries).map(item => item.sale_order_item_id)).toEqual(['a', 'c']);
  });

  it('autoaloca o recebimento total somente quando itens e saldo físico fecham', () => {
    expect(buildFullServiceOrderItemReceipt([row('a', 40), row('b', 60)], 100)).toEqual([
      { sale_order_item_id: 'a', qty_good: 40, qty_defect: 0, qty_defect_scrapped: 0, qty_loss: 0 },
      { sale_order_item_id: 'b', qty_good: 60, qty_defect: 0, qty_defect_scrapped: 0, qty_loss: 0 },
    ]);
    expect(buildFullServiceOrderItemReceipt([row('a', 40), row('b', 60)], 80)).toBeNull();
    expect(buildFullServiceOrderItemReceipt([row('a', 40, 5)], 40)).toBeNull();
  });
});
