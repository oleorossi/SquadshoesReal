import { describe, it, expect } from 'vitest';
import {
  normalizeOrderCode,
  parseOrderCodeList,
  looksLikeOrderCodeList,
  looksLikeOrderCodeToken,
  orderCodeExactMatch,
  matchesOrderSearch,
  classifyOrderSearch,
  findIdsMatchingOrderCodes,
} from '../orderCodeSearch';

describe('normalizeOrderCode', () => {
  it('strip OP-/PV- e pontuação', () => {
    expect(normalizeOrderCode('OP-2026-04362')).toBe('op202604362');
    expect(normalizeOrderCode('PV 00151')).toBe('pv00151');
  });
});

describe('looksLikeOrderCodeToken', () => {
  it('reconhece OP/PV e só dígitos', () => {
    expect(looksLikeOrderCodeToken('OP-1')).toBe(true);
    expect(looksLikeOrderCodeToken('PV-00151')).toBe(true);
    expect(looksLikeOrderCodeToken('00151')).toBe(true);
  });

  it('recusa ref/cor curtas', () => {
    expect(looksLikeOrderCodeToken('g03')).toBe(false);
    expect(looksLikeOrderCodeToken('prata')).toBe(false);
    expect(looksLikeOrderCodeToken('off')).toBe(false);
  });
});

describe('parseOrderCodeList', () => {
  it('exige separador de lista, ≥2 códigos e heurística', () => {
    expect(parseOrderCodeList('OP-1,OP-2')).toEqual(['op1', 'op2']);
    expect(parseOrderCodeList('OP-1\nOP-2\nOP-3')).toEqual(['op1', 'op2', 'op3']);
    expect(parseOrderCodeList('OP-1;OP-2')).toEqual(['op1', 'op2']);
    expect(parseOrderCodeList('OP-1/OP-2')).toEqual(['op1', 'op2']);
  });

  it('espaço sozinho NÃO abre modo lista (AND de texto)', () => {
    expect(parseOrderCodeList('stx alcineu')).toEqual([]);
    expect(looksLikeOrderCodeList('stx alcineu')).toBe(false);
  });

  it('ref/cor NÃO vira lista', () => {
    expect(parseOrderCodeList('g03;off')).toEqual([]);
    expect(parseOrderCodeList('g03/prata')).toEqual([]);
    expect(looksLikeOrderCodeList('g03/prata')).toBe(false);
  });

  it('knownCodes permite lista sem prefixo OP/PV', () => {
    expect(parseOrderCodeList('abc;def')).toEqual([]);
    expect(parseOrderCodeList('abc;def', ['ABC', 'DEF'])).toEqual(['abc', 'def']);
  });

  it('termo único não vira lista', () => {
    expect(parseOrderCodeList('OP-04362')).toEqual([]);
    expect(parseOrderCodeList('OP-1,')).toEqual([]);
  });

  it('deduplica', () => {
    expect(parseOrderCodeList('OP-1,OP-1,OP-2')).toEqual(['op1', 'op2']);
  });
});

describe('classifyOrderSearch', () => {
  it('lista vs ref/cor vs livre', () => {
    expect(classifyOrderSearch('OP-1;OP-2').mode).toBe('list');
    expect(classifyOrderSearch('g03/prata')).toEqual({
      mode: 'refColor',
      ref: 'g03',
      color: 'prata',
      rest: [],
    });
    expect(classifyOrderSearch('g03;off;aline')).toEqual({
      mode: 'refColor',
      ref: 'g03',
      color: 'off',
      rest: ['aline'],
    });
    expect(classifyOrderSearch('g03 prata').mode).toBe('free');
    expect(classifyOrderSearch('/lng').mode).toBe('free');
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
    referenceCode: 'G03',
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

  it('modo ref/cor: contains na ref e na cor', () => {
    expect(matchesOrderSearch('g03/off', fields)).toBe(true);
    expect(matchesOrderSearch('g03;prata', fields)).toBe(false);
    expect(matchesOrderSearch('g03/off/aline', fields)).toBe(true);
    expect(matchesOrderSearch('g03/off/xyz', fields)).toBe(false);
  });

  it('modo ref/cor exige o mesmo item', () => {
    const multi = {
      orderNumber: 'OP-1',
      saleOrderNumber: 'PV-1',
      clientName: 'CLIENTE',
    };
    const items = [
      { referenceCode: 'G03', referenceName: 'G03', color: 'PRETO' },
      { referenceCode: 'G01', referenceName: 'G01', color: 'OFF WHITE' },
    ];
    expect(matchesOrderSearch('g03/off', multi, { items })).toBe(false);
    expect(matchesOrderSearch('g03/preto', multi, { items })).toBe(true);
    expect(matchesOrderSearch('g01/off', multi, { items })).toBe(true);
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
