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

const op = (over: Partial<{ id: string; qty: number; color: string; due: string; so: string }>) => ({
  order_id: over.id ?? 'op-1',
  order_number: over.id ?? 'OP-1',
  reference_id: 'ref-5001',
  reference_name: '5001',
  photo_url: null,
  color: over.color ?? 'Preto',
  quantity: over.qty ?? 200,
  planned_delivery: over.due ?? '2026-09-30',
  sale_order_id: over.so ?? 'so-1',
  sale_order_number: 'PV-1',
});

describe('buildEarlyReleaseBoard', () => {
  it('agrega pares da mesma referência e antecipa Aviamento/Cabedal na cascata', () => {
    const board = buildEarlyReleaseBoard({
      ops: [op({ id: 'a', qty: 200 }), op({ id: 'b', qty: 400, color: 'Nude', so: 'so-2' })],
      schedule: [],
      sheetMap: new Map([['ref-5001', sheet]]),
      offsets: { mesa: 5, costura_cabedal: 5 },
    });
    expect(board.rows).toHaveLength(1);
    const row = board.rows[0];
    expect(row.pairs).toBe(600);
    expect(row.opCount).toBe(2);
    expect(row.pvCount).toBe(2);
    expect(row.colors).toEqual(['Preto', 'Nude']);
    expect(row.source).toBe('cascata');
    expect(row.daysAhead).toBeGreaterThan(0);
    const avi = row.lanes.find((l) => l.key === 'aviamento')!;
    const cortes = row.lanes.find((l) => l.key === 'cortes')!;
    expect(avi.start).toBeTruthy();
    expect(cortes.start).toBeTruthy();
    expect(avi.start! < cortes.start!).toBe(true);
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
