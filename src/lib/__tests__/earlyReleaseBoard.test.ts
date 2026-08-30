import { describe, it, expect, beforeAll } from 'vitest';
import { setHolidayCache } from '@/lib/sectorCapacity';
import { buildEarlyReleaseBoard, horizonPct } from '@/lib/earlyReleaseBoard';

beforeAll(() => setHolidayCache([]));

const sheet = {
  name: '5001',
  production_sectors: [
    'Corte Palmilha', 'Corte Forração', 'Costura Palmilha', 'Costura Cabedal',
    'Aviamento', 'Silk', 'Colagem', 'Montagem', 'Solagem', 'Acabamento',
  ],
  sewing_capacity_per_day: 100,
  cutting_capacity_per_day: 120,
  costura_palmilha_capacity_per_day: 150,
  costura_cabedal_capacity_per_day: 160,
  mesa_daily_capacity: 90,
  silk_capacity_per_day: 300,
  gluing_capacity_per_day: 200,
  assembly_capacity_per_day: 110,
  soling_capacity_per_day: 130,
  finishing_capacity_per_day: 140,
  requires_sewing: true,
  requires_cutting: true,
};

const op = (over: Partial<{
  id: string; qty: number; color: string; due: string; so: string;
  pv: string; client: string; ref: string; name: string;
}>) => ({
  order_id: over.id ?? 'op-1',
  order_number: over.id ?? 'OP-1',
  reference_id: over.ref ?? 'ref-5001',
  reference_name: over.name ?? '5001',
  photo_url: null,
  color: over.color ?? 'Preto',
  quantity: over.qty ?? 200,
  planned_delivery: over.due ?? '2026-09-30',
  sale_order_id: over.so ?? 'so-1',
  sale_order_number: over.pv ?? 'PV-1',
  client_order_number: over.client ?? 'OC-77',
});

describe('buildEarlyReleaseBoard', () => {
  it('agrupa por referência + cor e destaca PV e pedido do cliente', () => {
    const board = buildEarlyReleaseBoard({
      ops: [
        op({ id: 'a', qty: 200, pv: 'PV-1', client: 'OC-77' }),
        op({ id: 'b', qty: 100, so: 'so-2', pv: 'PV-2', client: 'OC-88' }),
        op({ id: 'c', qty: 400, color: 'Nude', so: 'so-3', pv: 'PV-3', client: '' }),
      ],
      schedule: [],
      sheetMap: new Map([['ref-5001', sheet]]),
      offsets: { mesa: 5, costura_cabedal: 5 },
    });
    expect(board.rows).toHaveLength(2);
    const preto = board.rows.find((r) => r.color === 'Preto')!;
    const nude = board.rows.find((r) => r.color === 'Nude')!;
    expect(preto.pairs).toBe(300);
    expect(preto.opCount).toBe(2);
    expect(preto.pvNumbers).toEqual(['PV-1', 'PV-2']);
    expect(preto.clientOrderNumbers).toEqual(['OC-77', 'OC-88']);
    expect(nude.pairs).toBe(400);
    expect(nude.pvNumbers).toEqual(['PV-3']);
    expect(nude.clientOrderNumbers).toEqual([]);
    expect(board.totals.pairs).toBe(700);
    expect(board.totals.references).toBe(1);
    expect(preto.source).toBe('cascata');
    expect(preto.daysAhead).toBeGreaterThan(0);
  });

  it('prefere a agenda do motor quando ela existe', () => {
    const board = buildEarlyReleaseBoard({
      ops: [op({ id: 'a', qty: 200 })],
      schedule: [
        { order_id: 'a', sector: 'Aviamento', date: '2026-08-25', planned_pairs: 80 },
        { order_id: 'a', sector: 'Aviamento', date: '2026-08-26', planned_pairs: 80 },
        { order_id: 'a', sector: 'Costura Cabedal', date: '2026-08-26', planned_pairs: 100 },
        { order_id: 'a', sector: 'Corte Fibra', date: '2026-09-01', planned_pairs: 200 },
        { order_id: 'a', sector: 'Corte Forração', date: '2026-09-02', planned_pairs: 200 },
      ],
      sheetMap: new Map([['ref-5001', sheet]]),
    });
    const row = board.rows[0];
    expect(row.source).toBe('agenda');
    expect(row.lanes.find((l) => l.key === 'aviamento')).toMatchObject({ start: '2026-08-25', end: '2026-08-26' });
    expect(row.lanes.find((l) => l.key === 'cortes')).toMatchObject({ start: '2026-09-01', end: '2026-09-02' });
    expect(row.daysAhead).toBe(5);
    expect(board.horizonStart).toBe('2026-08-25');
    expect(board.horizonEnd).toBe('2026-09-02');
  });

  it('ignora OP sem referência ou quantidade', () => {
    const board = buildEarlyReleaseBoard({
      ops: [
        { ...op({ id: 'z', qty: 0 }), quantity: 0 },
        { ...op({ id: 'y' }), reference_id: '' },
      ],
      schedule: [],
      sheetMap: new Map(),
    });
    expect(board.rows).toHaveLength(0);
    expect(board.totals.references).toBe(0);
  });
});

describe('horizonPct', () => {
  it('coloca o início em 0 e o fim em 100', () => {
    expect(horizonPct('2026-08-01', '2026-08-01', '2026-08-11')).toBe(0);
    expect(horizonPct('2026-08-11', '2026-08-01', '2026-08-11')).toBe(100);
    expect(horizonPct('2026-08-06', '2026-08-01', '2026-08-11')).toBe(50);
  });
});
