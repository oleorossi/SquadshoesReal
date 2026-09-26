import { describe, it, expect } from 'vitest';
import {
  normalizeOrderCode,
  parseOrderCodeList,
  looksLikeOrderCodeList,
  orderCodeExactMatch,
  matchesOrderSearch,
  findIdsMatchingOrderCodes,
} from '../orderCodeSearch';

describe('normalizeOrderCode', () => {
  it('strip OP-/PV- e pontuação', () => {
    expect(normalizeOrderCode('OP-2026-04362')).toBe('op202604362');
    expect(normalizeOrderCode('PV 00151')).toBe('pv00151');
  });
});

describe('parseOrderCodeList', () => {
  it('exige separador de lista e ≥2 códigos', () => {
    expect(parseOrderCodeList('OP-1,OP-2')).toEqual(['op1', 'op2']);
    expect(parseOrderCodeList('OP-1\nOP-2\nOP-3')).toEqual(['op1', 'op2', 'op3']);
    expect(parseOrderCodeList('OP-1;OP-2')).toEqual(['op1', 'op2']);
    expect(parseOrderCodeList('OP-1/OP-2')).toEqual(['op1', 'op2']);
  });

  it('espaço sozinho NÃO abre modo lista (AND de texto)', () => {
    expect(parseOrderCodeList('stx alcineu')).toEqual([]);
    expect(looksLikeOrderCodeList('stx alcineu')).toBe(false);
  });

  it('termo único não vira lista', () => {
    expect(parseOrderCodeList('OP-04362')).toEqual([]);
    expect(parseOrderCodeList('OP-1,')).toEqual([]);
  });

  it('deduplica', () => {
    expect(parseOrderCodeList('OP-1,OP-1,OP-2')).toEqual(['op1', 'op2']);
  });
});

describe('orderCodeExactMatch', () => {
  it('casa número exato normalizado', () => {
    expect(orderCodeExactMatch('op202604362', 'OP-2026-04362')).toBe(true);
    expect(orderCodeExactMatch('op4362', 'OP-2026-04362')).toBe(false);
  });
});

describe('matchesOrderSearch', () => {
  const fields = {
    orderNumber: 'OP-2026-04362',
    saleOrderNumber: 'PV-00151',
    clientName: 'ALINE CALÇADOS',
    referenceName: 'G03',
    color: 'OFF WHITE',
  };

  it('modo lista: OR exato em OP/PV', () => {
    expect(matchesOrderSearch('OP-2026-04362,OP-999', fields)).toBe(true);
    expect(matchesOrderSearch('OP-999,OP-888', fields)).toBe(false);
    expect(matchesOrderSearch('PV-00151,PV-00001', fields)).toBe(true);
  });

  it('modo texto: AND nos campos', () => {
    expect(matchesOrderSearch('g03 aline', fields)).toBe(true);
    expect(matchesOrderSearch('g03 xyz', fields)).toBe(false);
  });
});

describe('findIdsMatchingOrderCodes', () => {
  const items = [
    { id: 'a', order_number: 'OP-1', sale_orders: { order_number: 'PV-10' } },
    { id: 'b', order_number: 'OP-2', sale_orders: { order_number: 'PV-20' } },
    { id: 'c', order_number: 'OP-3', sale_orders: { order_number: 'PV-10' } },
  ];

  it('retorna ids que casam OP ou PV', () => {
    const ids = findIdsMatchingOrderCodes(
      items,
      ['op1', 'pv20'],
      (r) => ({
        id: r.id,
        orderNumber: r.order_number,
        saleOrderNumber: r.sale_orders.order_number,
      }),
    );
    expect(ids.sort()).toEqual(['a', 'b']);
  });
});
