import { describe, expect, it } from 'vitest';
import {
  addDaysIso,
  buildReceiveReceipts,
  filterAlmostDelivered,
  isAlmostDelivered,
  matchNfItemToProduct,
  pickDefaultPurchaseOrder,
  overlappingOpenPos,
} from '@/lib/nfPoReceipt';

describe('isAlmostDelivered', () => {
  it('aceita enviada com prazo em 7 dias', () => {
    expect(isAlmostDelivered(
      { id: '1', order_number: 'OC-1', status: 'sent', promised_date: '2026-09-10' },
      '2026-09-04',
    )).toBe(true);
  });

  it('aceita atrasada ainda aberta', () => {
    expect(isAlmostDelivered(
      { id: '1', order_number: 'OC-1', status: 'parcial', promised_date: '2026-09-01' },
      '2026-09-04',
    )).toBe(true);
  });

  it('recusa prazo além da janela e OC recebida', () => {
    expect(isAlmostDelivered(
      { id: '1', order_number: 'OC-1', status: 'sent', promised_date: '2026-09-20' },
      '2026-09-04',
    )).toBe(false);
    expect(isAlmostDelivered(
      { id: '1', order_number: 'OC-1', status: 'received', promised_date: '2026-09-05' },
      '2026-09-04',
    )).toBe(false);
  });

  it('recusa sem prazo', () => {
    expect(isAlmostDelivered(
      { id: '1', order_number: 'OC-1', status: 'sent', promised_date: null },
      '2026-09-04',
    )).toBe(false);
  });
});

describe('addDaysIso', () => {
  it('cruza mês', () => {
    expect(addDaysIso('2026-09-28', 7)).toBe('2026-10-05');
  });
});

describe('filterAlmostDelivered', () => {
  it('ordena pelo prazo', () => {
    const list = filterAlmostDelivered([
      { id: 'b', order_number: 'OC-B', status: 'sent', promised_date: '2026-09-08' },
      { id: 'a', order_number: 'OC-A', status: 'sent', promised_date: '2026-09-05' },
      { id: 'c', order_number: 'OC-C', status: 'pending', promised_date: '2026-10-01' },
    ], '2026-09-04');
    expect(list.map((o) => o.id)).toEqual(['a', 'b']);
  });
});

describe('matchNfItemToProduct', () => {
  const products = [
    { id: 'off', name: 'NAPA TITANIUM', sku: 'NT-OFF', color: 'OFF WHITE' },
    { id: 'preto', name: 'NAPA TITANIUM', sku: 'NT-PT', color: 'PRETO' },
    { id: 'cola', name: 'ADESIVO CONTATO', sku: 'AD-1', color: null },
  ];

  it('casa SKU exato', () => {
    expect(matchNfItemToProduct(products, 'qualquer', 'NT-PT')?.id).toBe('preto');
  });

  it('não chuta cor quando o nome da NF não traz a cor', () => {
    expect(matchNfItemToProduct(products, 'NAPA TITANIUM', null)).toBeUndefined();
  });

  it('desambigua pela cor no nome da NF', () => {
    expect(matchNfItemToProduct(products, 'NAPA TITANIUM PRETO', null)?.id).toBe('preto');
  });
});

describe('pickDefaultPurchaseOrder + receipts', () => {
  const itemsA = [
    { id: 'ia', product_id: 'preto', quantity: 10, received_quantity: 2, received_at: null },
  ];
  const itemsB = [
    { id: 'ib', product_id: 'cola', quantity: 5, received_quantity: 0, received_at: null },
  ];
  const orders = [
    { id: 'late', order_number: 'OC-L', status: 'sent', promised_date: '2026-10-01', items: itemsA },
    { id: 'soon', order_number: 'OC-S', status: 'sent', promised_date: '2026-09-06', items: itemsA },
    { id: 'other', order_number: 'OC-O', status: 'sent', promised_date: '2026-09-05', items: itemsB },
  ];

  it('prefere overlap quase entregue', () => {
    const picked = pickDefaultPurchaseOrder(orders, new Set(['preto']), '2026-09-04');
    expect(picked?.id).toBe('soon');
  });

  it('lista overlap sem chutar produto errado', () => {
    expect(overlappingOpenPos(orders, new Set(['cola'])).map((o) => o.id)).toEqual(['other']);
  });

  it('recibo usa o saldo em aberto', () => {
    expect(buildReceiveReceipts(itemsA, new Set(['preto']))).toEqual([
      { item_id: 'ia', quantity: 8, expected_received_quantity: 2 },
    ]);
    expect(buildReceiveReceipts(itemsA, new Set(['cola']))).toEqual([]);
  });
});
