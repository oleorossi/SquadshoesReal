import { describe, expect, it } from 'vitest';
import {
  addDaysIso,
  buildReceiveReceipts,
  DRAFT_RECEIVE_CONFIRMATION,
  filterAlmostDelivered,
  isAlmostDelivered,
  isDraftLikePoStatus,
  isReceivablePoStatus,
  matchNfItemToProduct,
  OPEN_PO_STATUSES,
  parseNfProductName,
  pickDefaultPurchaseOrder,
  overlappingOpenPos,
  resolveEffectivePurchaseOrderId,
  RECEIVABLE_PO_STATUSES,
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

  it('prefere OC ligada aos PVs do contexto do relatório', () => {
    const withPv = [
      { ...orders[0], source_pv_ids: ['pv-x'] },
      { ...orders[1], source_pv_ids: ['pv-target'] },
      { ...orders[2], source_pv_ids: [] as string[] },
    ];
    const picked = pickDefaultPurchaseOrder(
      withPv,
      new Set(['preto']),
      '2026-09-04',
      ['pv-target'],
    );
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

describe('resolveEffectivePurchaseOrderId', () => {
  it('sem toque no seletor usa a OC sugerida', () => {
    expect(resolveEffectivePurchaseOrderId(undefined, 'po-sug')).toBe('po-sug');
    expect(resolveEffectivePurchaseOrderId(undefined, null)).toBeNull();
  });

  it('Nenhuma não cai de volta na sugestão', () => {
    expect(resolveEffectivePurchaseOrderId(null, 'po-sug')).toBeNull();
  });

  it('OC explícita ganha da sugestão', () => {
    expect(resolveEffectivePurchaseOrderId('po-b', 'po-sug')).toBe('po-b');
  });
});


describe('recebimento de OC em rascunho/sugerida/pending', () => {
  it('inclui draft, suggested e pending na lista recebível', () => {
    expect(RECEIVABLE_PO_STATUSES).toEqual(expect.arrayContaining([
      'draft', 'suggested', 'pending', 'approved', 'sent', 'parcial',
    ]));
    expect(OPEN_PO_STATUSES).toEqual(RECEIVABLE_PO_STATUSES);
  });

  it('marca rascunho e sugerida como confirmação especial', () => {
    expect(isDraftLikePoStatus('draft')).toBe(true);
    expect(isDraftLikePoStatus('suggested')).toBe(true);
    expect(isDraftLikePoStatus('pending')).toBe(false);
    expect(isDraftLikePoStatus('sent')).toBe(false);
    expect(DRAFT_RECEIVE_CONFIRMATION).toMatch(/Gerar OC/);
  });

  it('aceita todos os status abertos e recusa recebida/cancelada', () => {
    for (const s of RECEIVABLE_PO_STATUSES) {
      expect(isReceivablePoStatus(s)).toBe(true);
    }
    expect(isReceivablePoStatus('received')).toBe(false);
    expect(isReceivablePoStatus('cancelled')).toBe(false);
  });

  it('casa OC draft com overlap', () => {
    const draft = [{
      id: 'd1',
      order_number: 'OC-DRAFT',
      status: 'draft',
      promised_date: '2026-12-04',
      items: [{ id: 'i1', product_id: 'preto', quantity: 10, received_quantity: 0, received_at: null }],
    }];
    expect(overlappingOpenPos(draft, new Set(['preto'])).map((o) => o.id)).toEqual(['d1']);
    expect(pickDefaultPurchaseOrder(draft, new Set(['preto']), '2026-11-25')?.id).toBe('d1');
  });
});

describe('parseNfProductName', () => {
  it('separa nome e cor por dois-pontos ou travessão', () => {
    expect(parseNfProductName('NAPA TITANIUM: OFF WHITE')).toEqual({
      baseName: 'NAPA TITANIUM',
      color: 'OFF WHITE',
    });
    expect(parseNfProductName('NAPA TITANIUM - PRETO')).toEqual({
      baseName: 'NAPA TITANIUM',
      color: 'PRETO',
    });
    expect(parseNfProductName('ADESIVO 14 KG')).toEqual({
      baseName: 'ADESIVO 14 KG',
      color: null,
    });
  });
});
