import { describe, expect, it } from 'vitest';
import {
  atelierReportRows,
  groupAtelierLotsByReference,
  type AtelierLotForGrouping,
} from '@/lib/atelier';

const lot = (p: Partial<AtelierLotForGrouping> & { reference_id: string }): AtelierLotForGrouping => ({
  reference_code: 'I90',
  reference_name: 'INFANTIL 90',
  color: 'PRETO',
  pairs: 10,
  min_delivery_deadline: '2026-10-20',
  ...p,
});

describe('groupAtelierLotsByReference', () => {
  it('junta as cores da mesma referência num grupo', () => {
    const groups = groupAtelierLotsByReference([
      lot({ reference_id: 'r1', color: 'PRETO', pairs: 10 }),
      lot({ reference_id: 'r1', color: 'OFF WHITE', pairs: 24 }),
      lot({ reference_id: 'r2', reference_code: 'SR01', color: 'ROSADO', pairs: 6 }),
    ]);
    expect(groups.map((g) => [g.label, g.lots.length, g.pairs])).toEqual([
      ['I90', 2, 34],
      ['SR01', 1, 6],
    ]);
  });

  it('posiciona o grupo pelo prazo mais próximo que ele carrega', () => {
    const groups = groupAtelierLotsByReference([
      lot({ reference_id: 'r1', reference_code: 'ZZZ', min_delivery_deadline: '2026-11-30' }),
      lot({ reference_id: 'r2', reference_code: 'AAA', min_delivery_deadline: '2026-12-31' }),
      // a 2ª cor de ZZZ é a mais urgente de todas → ZZZ vem primeiro
      lot({ reference_id: 'r1', reference_code: 'ZZZ', color: 'AZUL', min_delivery_deadline: '2026-10-15' }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['ZZZ', 'AAA']);
    expect(groups[0].earliestDeadline).toBe('2026-10-15');
  });

  it('lote sem prazo vai pro fim, dentro e entre grupos', () => {
    const groups = groupAtelierLotsByReference([
      lot({ reference_id: 'r1', reference_code: 'AAA', min_delivery_deadline: null }),
      lot({ reference_id: 'r2', reference_code: 'BBB', min_delivery_deadline: '2026-12-31' }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['BBB', 'AAA']);
    expect(groups[1].earliestDeadline).toBeNull();
  });

  it('dentro do grupo ordena por prazo e depois por cor', () => {
    const groups = groupAtelierLotsByReference([
      lot({ reference_id: 'r1', color: 'ZEBRA', min_delivery_deadline: '2026-10-20' }),
      lot({ reference_id: 'r1', color: 'ABACATE', min_delivery_deadline: '2026-10-20' }),
      lot({ reference_id: 'r1', color: 'URGENTE', min_delivery_deadline: '2026-10-01' }),
    ]);
    expect(groups[0].lots.map((l) => l.color)).toEqual(['URGENTE', 'ABACATE', 'ZEBRA']);
  });

  it('sem código cai no nome, e sem os dois num rótulo neutro', () => {
    const groups = groupAtelierLotsByReference([
      lot({ reference_id: 'r1', reference_code: null }),
      lot({ reference_id: 'r2', reference_code: null, reference_name: null }),
    ]);
    expect(groups.map((g) => g.label).sort()).toEqual(['INFANTIL 90', 'Sem referência']);
  });

  it('pares negativo não baixa o total do grupo', () => {
    const groups = groupAtelierLotsByReference([
      lot({ reference_id: 'r1', pairs: 10 }),
      lot({ reference_id: 'r1', color: 'X', pairs: -4 }),
    ]);
    expect(groups[0].pairs).toBe(10);
  });
});

describe('atelierReportRows', () => {
  it('os pares são os DO PEDIDO, nunca o total do lote', () => {
    // O lote tem 100 pares somando dois PVs (60 + 40). Usar `lot.pairs` em cada
    // linha daria 200 — somaria o pedido do outro.
    const lots = [
      {
        id: 'lote-1',
        pairs: 100,
        orders: [
          { sale_order_id: 'pv-a', order_number: 'PV-00151', pairs: 60 },
          { sale_order_id: 'pv-b', order_number: 'PV-00148', pairs: 40 },
        ],
      },
    ];
    const rows = atelierReportRows(lots);
    expect(rows).toHaveLength(2);
    expect(rows.reduce((sum, r) => sum + r.order.pairs, 0)).toBe(100);
    // o tipo do pedido é o REAL, não a restrição genérica
    expect(rows.map((r) => r.order.order_number)).toEqual(['PV-00151', 'PV-00148']);
  });

  it('o mesmo lote aparece uma vez por pedido que o alimenta', () => {
    const lots = [
      { id: 'lote-1', orders: [{ sale_order_id: 'pv-a', pairs: 10 }, { sale_order_id: 'pv-b', pairs: 5 }] },
      { id: 'lote-2', orders: [{ sale_order_id: 'pv-a', pairs: 7 }] },
    ];
    const rows = atelierReportRows(lots);
    expect(rows.map((r) => [r.lot.id, r.order.sale_order_id])).toEqual([
      ['lote-1', 'pv-a'],
      ['lote-1', 'pv-b'],
      ['lote-2', 'pv-a'],
    ]);
  });

  it('lote sem pedido não gera linha nem estoura', () => {
    expect(atelierReportRows([{ id: 'x', orders: [] }])).toEqual([]);
  });
});
