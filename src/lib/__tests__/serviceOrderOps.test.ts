import { describe, it, expect } from 'vitest';
import {
  isActiveOp,
  opNumberByPvItem,
  opNumbersForServiceOrder,
  formatOpNumbers,
  type OpRef,
} from '../serviceOrderOps';

// PV-00151 com 3 cores da mesma referência — o cenário que motivou a mudança.
const PV = 'pv-151';
const OPS: OpRef[] = [
  { id: 'op1', order_number: 'OP-00231', sale_order_item_id: 'item-off-white', sale_order_id: PV, status: 'Em Produção' },
  { id: 'op2', order_number: 'OP-00232', sale_order_item_id: 'item-rosado', sale_order_id: PV, status: 'Em Produção' },
  { id: 'op3', order_number: 'OP-00233', sale_order_item_id: 'item-preto', sale_order_id: PV, status: 'Em Produção' },
];

describe('isActiveOp', () => {
  it('espelha o UNIQUE parcial do banco: só Cancelada é inativa', () => {
    expect(isActiveOp({ status: 'Em Produção' })).toBe(true);
    expect(isActiveOp({ status: 'Concluída' })).toBe(true);
    expect(isActiveOp({ status: null })).toBe(true);
    expect(isActiveOp({ status: 'Cancelada' })).toBe(false);
  });
});

describe('opNumberByPvItem', () => {
  it('mapeia item do PV → nº da OP', () => {
    const map = opNumberByPvItem(OPS);
    expect(map.get('item-off-white')).toBe('OP-00231');
    expect(map.size).toBe(3);
  });

  it('ignora OP cancelada, sem número ou sem item', () => {
    const map = opNumberByPvItem([
      ...OPS,
      { id: 'x', order_number: 'OP-00999', sale_order_item_id: 'item-morto', sale_order_id: PV, status: 'Cancelada' },
      { id: 'y', order_number: null, sale_order_item_id: 'item-sem-numero', sale_order_id: PV },
      { id: 'z', order_number: 'OP-00888', sale_order_item_id: null, sale_order_id: PV },
    ]);
    expect(map.has('item-morto')).toBe(false);
    expect(map.has('item-sem-numero')).toBe(false);
    expect(map.size).toBe(3);
  });
});

describe('opNumbersForServiceOrder', () => {
  it('OS de um item só devolve a OP daquele item', () => {
    expect(opNumbersForServiceOrder(OPS, ['item-off-white'], PV)).toEqual(['OP-00231']);
  });

  it('OS de vários itens devolve todas, ordenadas naturalmente', () => {
    expect(opNumbersForServiceOrder(OPS, ['item-preto', 'item-off-white'], PV))
      .toEqual(['OP-00231', 'OP-00233']);
  });

  it('ordena OP-00009 antes de OP-00010 (numérico, não lexicográfico)', () => {
    const ops: OpRef[] = [
      { id: 'a', order_number: 'OP-00010', sale_order_item_id: 'i1', sale_order_id: PV },
      { id: 'b', order_number: 'OP-00009', sale_order_item_id: 'i2', sale_order_id: PV },
    ];
    expect(opNumbersForServiceOrder(ops, ['i1', 'i2'], PV)).toEqual(['OP-00009', 'OP-00010']);
  });

  // ⚠ A distinção que sustenta a compatibilidade com as ~386 OS antigas.
  it('sem registro (null) cai em TODAS as OPs do pedido', () => {
    expect(opNumbersForServiceOrder(OPS, null, PV)).toEqual(['OP-00231', 'OP-00232', 'OP-00233']);
    expect(opNumbersForServiceOrder(OPS, undefined, PV)).toEqual(['OP-00231', 'OP-00232', 'OP-00233']);
  });

  it('seleção vazia registrada ([]) NÃO cai no fallback — devolve vazio', () => {
    expect(opNumbersForServiceOrder(OPS, [], PV)).toEqual([]);
  });

  it('no fallback, não vaza OP de outro pedido', () => {
    const ops = [
      ...OPS,
      { id: 'outro', order_number: 'OP-00500', sale_order_item_id: 'item-outro', sale_order_id: 'pv-999' },
    ];
    expect(opNumbersForServiceOrder(ops, null, PV)).toEqual(['OP-00231', 'OP-00232', 'OP-00233']);
  });

  it('item selecionado ainda sem OP gerada devolve vazio (não quebra)', () => {
    expect(opNumbersForServiceOrder([], ['item-off-white'], PV)).toEqual([]);
  });

  it('OP cancelada não entra nem por seleção nem por fallback', () => {
    const ops: OpRef[] = [
      { id: 'a', order_number: 'OP-00231', sale_order_item_id: 'item-off-white', sale_order_id: PV, status: 'Cancelada' },
    ];
    expect(opNumbersForServiceOrder(ops, ['item-off-white'], PV)).toEqual([]);
    expect(opNumbersForServiceOrder(ops, null, PV)).toEqual([]);
  });

  it('deduplica quando duas OPs carregam o mesmo número', () => {
    const ops: OpRef[] = [
      { id: 'a', order_number: 'OP-00231', sale_order_item_id: 'i1', sale_order_id: PV },
      { id: 'b', order_number: 'OP-00231', sale_order_item_id: 'i2', sale_order_id: PV },
    ];
    expect(opNumbersForServiceOrder(ops, ['i1', 'i2'], PV)).toEqual(['OP-00231']);
  });
});

describe('formatOpNumbers', () => {
  it('junta com vírgula e devolve null quando não há OP', () => {
    expect(formatOpNumbers(['OP-00231', 'OP-00232'])).toBe('OP-00231, OP-00232');
    expect(formatOpNumbers([])).toBeNull();
  });
});
