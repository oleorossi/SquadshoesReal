import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import {
  computeParallelWindows,
  computeForwardSchedule,
  computeSectorDailyLoad,
  offsetsFromSettings,
  setHolidayCache,
  addBusinessDays,
  type DailyOpInput,
} from '@/lib/sectorCapacity';

beforeAll(() => setHolidayCache([]));

const sheet = {
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

const QTY = 600;
const OFFSET = { mesa: 5, costura_cabedal: 5 } as const;

describe('offsetsFromSettings', () => {
  it('mapeia Aviamento → mesa e ignora offset 0', () => {
    const out = offsetsFromSettings([
      { sector: 'Aviamento', start_offset_days: 5 },
      { sector: 'Costura Cabedal', start_offset_days: 5 },
      { sector: 'Costura Palmilha', start_offset_days: 0 },
      { sector: 'Corte Fibra', start_offset_days: null },
    ]);
    expect(out.mesa).toBe(5);
    expect(out.costura_cabedal).toBe(5);
    expect(out.costura_palmilha).toBeUndefined();
    expect(out.corte_palmilha).toBeUndefined();
  });
});

describe('early-release na cascata reversa', () => {
  const deadline = new Date('2026-09-30T00:00:00');

  it('sem offset o contrato antigo se mantém (Aviamento encosta no Silk)', () => {
    const back = computeParallelWindows(sheet, QTY, deadline);
    expect(back.mesa.end.getTime()).toBe(back.silk.start.getTime());
    expect(back.costura_cabedal.end.getTime()).toBe(back.silk.start.getTime());
    const bloco2Start = Math.min(
      back.costura_palmilha.start.getTime(),
      back.costura_cabedal.start.getTime(),
      back.mesa.start.getTime(),
    );
    expect(back.corte_palmilha.end.getTime()).toBe(bloco2Start);
  });

  it('com offset, Aviamento e Costura Cabedal recuam N dias e NÃO puxam os cortes', () => {
    const natural = computeParallelWindows(sheet, QTY, deadline);
    const early = computeParallelWindows(sheet, QTY, deadline, null, OFFSET);

    expect(early.mesa.start.getTime()).toBe(addBusinessDays(natural.mesa.start, -5).getTime());
    expect(early.mesa.end.getTime()).toBe(addBusinessDays(natural.mesa.end, -5).getTime());
    expect(early.costura_cabedal.start.getTime()).toBe(addBusinessDays(natural.costura_cabedal.start, -5).getTime());

    // Costura Palmilha (offset 0) não mexe — é a âncora do bloco 2.
    expect(early.costura_palmilha.start.getTime()).toBe(natural.costura_palmilha.start.getTime());
    expect(early.costura_palmilha.end.getTime()).toBe(natural.costura_palmilha.end.getTime());

    // Cortes encostam na palmilha, não no Aviamento antecipado.
    expect(early.corte_palmilha.end.getTime()).toBe(early.costura_palmilha.start.getTime());
    expect(early.corte_palmilha.end.getTime()).toBeGreaterThan(early.mesa.start.getTime());
  });
});

describe('early-release na cascata direta', () => {
  const start = new Date('2026-07-06T00:00:00'); // segunda

  it('sem offset o bloco 2 inteiro arranca no fim dos cortes', () => {
    const fwd = computeForwardSchedule(sheet, QTY, start);
    const fimDosCortes = fwd.steps
      .filter((s) => ['corte_palmilha', 'corte_forracao'].includes(s.key))
      .map((s) => s.endISO).sort().at(-1)!;
    for (const k of ['costura_palmilha', 'costura_cabedal', 'mesa'] as const) {
      expect(fwd.steps.find((s) => s.key === k)!.startISO).toBe(fimDosCortes);
    }
  });

  it('com offset, Aviamento e Cabedal arrancam ANTES da data de produção', () => {
    const fwd = computeForwardSchedule(sheet, QTY, start, {}, null, OFFSET);
    const expectedStart = addBusinessDays(start, -5);
    const iso = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    };
    expect(fwd.steps.find((s) => s.key === 'mesa')!.startISO).toBe(iso(expectedStart));
    expect(fwd.steps.find((s) => s.key === 'costura_cabedal')!.startISO).toBe(iso(expectedStart));
    const fimDosCortes = fwd.steps
      .filter((s) => ['corte_palmilha', 'corte_forracao'].includes(s.key))
      .map((s) => s.endISO).sort().at(-1)!;
    expect(fwd.steps.find((s) => s.key === 'costura_palmilha')!.startISO).toBe(fimDosCortes);
    expect(fwd.steps.find((s) => s.key === 'mesa')!.startISO < fimDosCortes).toBe(true);
  });
});

describe('demanda agregada por referência', () => {
  const ops: DailyOpInput[] = [
    { order_id: 'a', order_number: 'OP-1', reference_id: 'ref-1', color: 'PRETO', quantity: 200, planned_delivery: '2026-09-30', sheet_name: 'Rasteirinha' },
    { order_id: 'b', order_number: 'OP-2', reference_id: 'ref-1', color: 'BEGE', quantity: 200, planned_delivery: '2026-09-30', sheet_name: 'Rasteirinha' },
    { order_id: 'c', order_number: 'OP-3', reference_id: 'ref-1', color: 'DOURADO', quantity: 200, planned_delivery: '2026-09-30', sheet_name: 'Rasteirinha' },
  ];
  const sheetMap = new Map([['ref-1', sheet]]);

  it('sem offset, 3 OPs da mesma ref sobrepõem a janela curta (carga alta)', () => {
    const natural = computeParallelWindows(sheet, 200, new Date('2026-09-30T00:00:00'));
    const dayISO = natural.mesa.start.toISOString().slice(0, 10);
    const load = computeSectorDailyLoad(dayISO, ops, sheetMap);
    const mesa = load.find((s) => s.sector === 'mesa')!;
    expect(mesa.opsCount).toBe(3);
    expect(mesa.plannedPairs).toBeGreaterThan(90);
  });

  it('com offset, a janela usa a soma dos pares da ref e a carga diária cabe na cap', () => {
    const early = computeParallelWindows(sheet, 600, new Date('2026-09-30T00:00:00'), null, OFFSET);
    const dayISO = `${early.mesa.start.getFullYear()}-${String(early.mesa.start.getMonth() + 1).padStart(2, '0')}-${String(early.mesa.start.getDate()).padStart(2, '0')}`;
    const load = computeSectorDailyLoad(dayISO, ops, sheetMap, null, OFFSET);
    const mesa = load.find((s) => s.sector === 'mesa')!;
    expect(mesa.opsCount).toBe(3);
    // 600 pares / lead(ceil 600/90=7) ≈ 86 pares/dia ≤ cap 90.
    expect(mesa.plannedPairs).toBeLessThanOrEqual(90);
  });
});

describe('migration 14100', () => {
  const sql = readFileSync('supabase/migrations/20270101014100_sector_start_offset_days.sql', 'utf8');

  it('cria a coluna e sementeia Aviamento + Costura Cabedal', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS start_offset_days');
    expect(sql).toContain("sector IN ('Aviamento', 'Costura Cabedal')");
    expect(sql).toContain('resyncOPs / STAGE_DAG intactos');
  });

  it('o recompute libera o setor com offset sem esperar o nível anterior', () => {
    expect(sql).toContain('COALESCE(v_row.start_offset_days, 0) > 0');
    expect(sql).toContain('ss.start_offset_days');
  });
});
