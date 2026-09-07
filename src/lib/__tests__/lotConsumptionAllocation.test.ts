import { describe, expect, it } from 'vitest';
import {
  addAllocatedPairs,
  aggregateConsumptionByAllocatedPairs,
  cloneAllocatedPairs,
  lotPartitionKey,
  mergeAllocatedPairs,
} from '@/lib/lotConsumptionAllocation';

interface Row {
  product: string;
  required: number;
  available: number;
  stock_ok: boolean;
}

const row = (product: string, required: number, available = 1_000): Row => ({
  product,
  required,
  available,
  stock_ok: available >= required,
});

describe('aggregateConsumptionByAllocatedPairs', () => {
  it('rateia cada OP antes de agregar quando o mesmo lote usa frações diferentes', () => {
    const opARows = [row('material-a', 72), row('compartilhado', 144)];
    const opBRows = [row('material-b', 48), row('compartilhado', 96)];

    const result = aggregateConsumptionByAllocatedPairs([
      { rows: opARows, fullPairs: 720, allocatedPairs: 360 },
      { rows: opBRows, fullPairs: 480, allocatedPairs: 360 },
    ], (item) => item.product);

    expect(result.find(item => item.product === 'material-a')?.required).toBe(36);
    expect(result.find(item => item.product === 'material-b')?.required).toBe(36);
    expect(result.find(item => item.product === 'compartilhado')?.required).toBe(144);
    expect(opARows.map(item => item.required)).toEqual([72, 144]);
    expect(opBRows.map(item => item.required)).toEqual([48, 96]);
  });

  it('mantém a disponibilidade global e recalcula o status após somar', () => {
    const result = aggregateConsumptionByAllocatedPairs([
      { rows: [row('napa', 80, 70)], fullPairs: 100, allocatedPairs: 50 },
      { rows: [row('napa', 60, 90)], fullPairs: 100, allocatedPairs: 100 },
    ], (item) => item.product);

    expect(result).toEqual([
      { product: 'napa', required: 100, available: 90, stock_ok: false },
    ]);
  });
});

describe('allocated-pairs metadata', () => {
  it('soma pares por OP ao combinar grupos sem compartilhar o Map original', () => {
    const source = new Map([['OP-1', 360], ['OP-2', 240]]);
    const copy = cloneAllocatedPairs(source);
    addAllocatedPairs(copy, 'OP-1', 120);
    mergeAllocatedPairs(copy, new Map([['OP-3', 80]]));

    expect(Array.from(copy.entries())).toEqual([
      ['OP-1', 480],
      ['OP-2', 240],
      ['OP-3', 80],
    ]);
    expect(source.get('OP-1')).toBe(360);
  });

  it('distingue lotes inclusive quando o ordinal coincide mas o total difere', () => {
    expect(lotPartitionKey({ number: 1, total: 2 })).not.toBe(
      lotPartitionKey({ number: 2, total: 2 }),
    );
    expect(lotPartitionKey({ number: 1, total: 2 })).not.toBe(
      lotPartitionKey({ number: 1, total: 3 }),
    );
    expect(lotPartitionKey(undefined)).toBe('lot:none');
  });
});
