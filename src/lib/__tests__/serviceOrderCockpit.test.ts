import { describe, expect, it } from 'vitest';
import {
  buildDispatchMaterialKit,
  resolveOsCycleBalance,
  resolveOsReceiptState,
  summarizeMaterialsSent,
  summarizeOsCycle,
  toPersistedMaterialsSent,
} from '@/lib/serviceOrderCockpit';

describe('buildDispatchMaterialKit', () => {
  it('reusa a remessa já gravada e não inventa segunda lista', () => {
    const kit = buildDispatchMaterialKit({
      requirements: {
        version: 1,
        items: [{ material: 'NAPA SOFT', color: 'PRETO', quantity: 12, unit: 'm' }],
      },
      existingSent: [{ material: 'NAPA SOFT', color: 'PRETO', meters: 6 }],
      dispatchQty: 60,
      orderQty: 120,
    });
    expect(kit).toEqual([{ material: 'NAPA SOFT', color: 'PRETO', meters: 6 }]);
  });

  it('escala o snapshot da ficha pelos pares desta remessa', () => {
    const kit = buildDispatchMaterialKit({
      requirements: {
        version: 1,
        items: [
          { material: 'NAPA SOFT', color: 'PRETO', quantity: 12.4, unit: 'm' },
          { material: 'FORRO', color: 'BEGE', quantity: 4, unit: 'm' },
        ],
      },
      existingSent: [],
      dispatchQty: 60,
      orderQty: 120,
    });
    expect(kit).toEqual([
      { material: 'NAPA SOFT', color: 'PRETO', quantity: 6.2, unit: 'm', meters: 6.2 },
      { material: 'FORRO', color: 'BEGE', quantity: 2, unit: 'm', meters: 2 },
    ]);
  });

  it('ignora snapshot vazio', () => {
    expect(buildDispatchMaterialKit({
      requirements: { version: 1, items: [] },
      dispatchQty: 40,
      orderQty: 40,
    })).toEqual([]);
  });
});

describe('summarizeMaterialsSent / persistência', () => {
  it('resume quantidade e unidade homogênea', () => {
    expect(summarizeMaterialsSent([
      { material: 'NAPA', meters: 6.2, unit: 'm' },
      { material: 'FORRO', quantity: 2, unit: 'm' },
      { material: '', meters: 9 },
    ])).toEqual({
      count: 2,
      totalQty: 8.2,
      label: '2 itens · 8,2 m',
    });
  });

  it('grava meters + quantity pra o papel aceitar as duas formas', () => {
    expect(toPersistedMaterialsSent([
      { material: 'NAPA SOFT', color: 'PRETO', quantity: 6.2, unit: 'm' },
    ])).toEqual([
      { material: 'NAPA SOFT', color: 'PRETO', meters: 6.2, quantity: 6.2, unit: 'm' },
    ]);
  });
});

describe('ciclo físico e recibo', () => {
  it('mostra enviado/voltou mesmo sem retorno parcial', () => {
    expect(resolveOsCycleBalance({
      quantity: 120,
      dispatchTracked: true,
      qtyDispatched: 120,
      qtyInField: 120,
      qtyToDispatch: 0,
    })).toEqual({ sent: 120, returned: 0, inField: 120, toDispatch: 0 });
  });

  it('recibo fica pendente depois do envio e assinado com a foto', () => {
    expect(resolveOsReceiptState({ signedPhotoUrl: null, sentPairs: 80 })).toBe('unsigned');
    expect(resolveOsReceiptState({ signedPhotoUrl: 'https://img/recibo.jpg', sentPairs: 80 })).toBe('signed');
    expect(resolveOsReceiptState({ signedPhotoUrl: null, sentPairs: 0 })).toBe('none');
  });
});

describe('summarizeOsCycle', () => {
  it('agrega OS, valor, cobrança, itens, peças, enviado, voltou e recibo', () => {
    const totals = summarizeOsCycle([
      {
        quantity: 120,
        totalValue: 480,
        dispatchTracked: true,
        selectedItemIds: ['a', 'b'],
        materialsSent: [{ material: 'NAPA', meters: 6.2, unit: 'm' }],
        overview: {
          qty_dispatched: 120,
          qty_in_field: 40,
          qty_returned_good: 80,
          has_payable: true,
          payment_status: 'pending',
          payable_open_amount: 320,
        },
      },
      {
        quantity: 60,
        totalValue: 180,
        dispatchTracked: true,
        signedPhotoUrl: null,
        overview: {
          qty_dispatched: 60,
          qty_in_field: 60,
        },
      },
      {
        archivedAt: '2026-08-01',
        quantity: 999,
        totalValue: 999,
      },
    ]);

    expect(totals.osCount).toBe(2);
    expect(totals.generatedValue).toBe(660);
    expect(totals.itemCount).toBe(3);
    expect(totals.pairCount).toBe(180);
    expect(totals.sentPairs).toBe(180);
    expect(totals.returnedPairs).toBe(80);
    expect(totals.billingCount).toBe(1);
    expect(totals.billingValue).toBe(320);
    expect(totals.materialLines).toBe(1);
    expect(totals.unsignedReceipts).toBe(2);
  });
});
