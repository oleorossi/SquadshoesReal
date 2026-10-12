import { describe, it, expect } from 'vitest';
import { buildNapaRollup } from './napaRollup';
import type { BaseMaterialInput } from './baseMaterialTotal';
import { computeBaseMaterialTotal } from './baseMaterialTotal';
import { PV00195_ROWS } from './__tests__/fixtures/pv00195Consumption';

/** PV-00147 COGUMELO — forração direta + tiras convertidas pra NAPA SOFT. */
const COGUMELO: BaseMaterialInput[] = [
  {
    componentType: 'Forração Palmilha', groupName: 'NAPA SUDANI', color: 'COGUMELO',
    productUnit: 'm', totalQuantity: 20.27,
  },
  {
    componentType: 'Tiras', groupName: 'Tira chata 8mm', productUnit: 'm', color: 'COGUMELO',
    totalQuantity: 169.20,
    artisanal: { baseName: 'NAPA SOFT', baseQty: 169.20 / 60, yieldPerMeter: 60 },
  },
  {
    componentType: 'Tiras', groupName: 'Tira chata 8mm', productUnit: 'm', color: 'COGUMELO',
    totalQuantity: 126.00,
    artisanal: { baseName: 'NAPA SOFT', baseQty: 126.00 / 60, yieldPerMeter: 60 },
  },
  ...[1, 2, 3].map(() => ({
    componentType: 'Tiras', groupName: 'TIRA OVERLOCK 5MM', productUnit: 'm', color: 'COGUMELO',
    totalQuantity: 234.72,
    artisanal: { baseName: 'NAPA SOFT', baseQty: 234.72 / 61, yieldPerMeter: 61 },
  })),
];

const COGUMELO_STRAP_NAPA = 169.20 / 60 + 126.00 / 60 + 3 * (234.72 / 61);

const PENDENTE: BaseMaterialInput[] = [
  {
    componentType: 'Cabedal', groupName: 'NAPA SOFT', color: 'PRETO',
    productUnit: 'm', totalQuantity: 10,
  },
  {
    componentType: 'Tiras', groupName: 'TIRA NOVA 12MM', color: 'PRETO',
    productUnit: 'm', totalQuantity: 100,
    artisanal: { baseName: 'NAPA SOFT', baseQty: 0, yieldPerMeter: 0, pending: true },
  },
];

// Decisão do dono (11/10/2026): na tela/PDF de consumo a napa das tiras não
// entra no rollup — fica só no Setor de Tiras. Revoga a de 27/09/2026.
describe('buildNapaRollup — tela/PDF de consumo (padrão)', () => {
  it('soma só napa direta: tira convertida fica de fora', () => {
    const r = buildNapaRollup(COGUMELO)!;
    expect(r.total).toBeCloseTo(20.27, 6);
    expect(r.includesStrapNapa).toBe(false);
    expect(r.parts).toEqual([{ name: 'NAPA SUDANI', qty: 20.27 }]);
    // NAPA SOFT só existia pelas tiras → nem aparece como família.
    expect(r.byFamilyColor.map((b) => b.family)).toEqual(['NAPA SUDANI']);
    expect(r.byFamilyColor.flatMap((b) => b.destinations).some((d) => d.kind === 'Tira')).toBe(false);
  });

  it('tira pendente também fica de fora — nem destino, nem pendência, nem skipped', () => {
    const r = buildNapaRollup(PENDENTE)!;
    expect(r.total).toBeCloseTo(10, 6);
    expect(r.pendingCount).toBe(0);
    expect(r.skipped).toBe(0);
    const soft = r.byFamilyColor.find((b) => b.family === 'NAPA SOFT')!;
    expect(soft.destinations).toEqual([
      expect.objectContaining({ kind: 'Cabedal', napaMeters: 10 }),
    ]);
  });

  it('computeBaseMaterialTotal espelha o total do rollup (sem tiras)', () => {
    const rollup = buildNapaRollup(COGUMELO)!;
    const base = computeBaseMaterialTotal(COGUMELO)!;
    expect(base.total).toBeCloseTo(rollup.total, 6);
    expect(base.parts).toEqual(rollup.parts);
  });

  it('PV-00195: painel de napa da tela mostra 55,57 m (era 78,09)', () => {
    const r = buildNapaRollup(PV00195_ROWS)!;
    expect(r.total).toBeCloseTo(55.57, 2);
    const total = (family: string, color: string) =>
      r.byFamilyColor.find((b) => b.family === family && b.color === color)!.total;
    expect(total('GLOW METALIC', 'CHAMPAGNE')).toBeCloseTo(14.06, 2);
    expect(total('GLOW METALIC', 'COBRE')).toBeCloseTo(14.06, 2);
    expect(total('NAPA SOFT', 'OFF WHITE')).toBeCloseTo(14.06, 2);
    expect(computeBaseMaterialTotal(PV00195_ROWS)!.total).toBeCloseTo(r.total, 6);
  });
});

// A geração de OC ainda compra a napa das tiras até a virada "tira = material
// de estoque": com `includeStrapNapa` o rollup é o MESMO de antes da decisão.
describe('buildNapaRollup — geração de OC (includeStrapNapa)', () => {
  it('soma napa direta + convertida de tiras por família+cor', () => {
    const r = buildNapaRollup(COGUMELO, { includeStrapNapa: true })!;
    expect(r.includesStrapNapa).toBe(true);
    expect(r.total).toBeCloseTo(20.27 + COGUMELO_STRAP_NAPA, 2);
    expect(r.parts.map((p) => p.name).sort()).toEqual(['NAPA SOFT', 'NAPA SUDANI'].sort());
  });

  it('lista destinos: forração e cada tipo de tira', () => {
    const r = buildNapaRollup(COGUMELO, { includeStrapNapa: true })!;
    const soft = r.byFamilyColor.find((b) => b.family === 'NAPA SOFT')!;
    expect(soft.color).toBe('COGUMELO');
    expect(soft.destinations.some((d) => d.kind === 'Tira' && d.label === 'Tira chata 8mm')).toBe(true);
    expect(soft.destinations.some((d) => d.kind === 'Tira' && d.label === 'TIRA OVERLOCK 5MM')).toBe(true);
    const sudani = r.byFamilyColor.find((b) => b.family === 'NAPA SUDANI')!;
    expect(sudani.destinations).toEqual([
      expect.objectContaining({ kind: 'Forração Palmilha', napaMeters: 20.27 }),
    ]);
  });

  it('tira pendente entra no rollup sem metros de napa e conta skipped', () => {
    const r = buildNapaRollup(PENDENTE, { includeStrapNapa: true })!;
    expect(r.total).toBeCloseTo(10, 2);
    expect(r.pendingCount).toBe(1);
    expect(r.skipped).toBe(1);
    const soft = r.byFamilyColor.find((b) => b.family === 'NAPA SOFT')!;
    expect(soft.destinations.some((d) => d.pending && d.label === 'TIRA NOVA 12MM')).toBe(true);
  });

  it('PV-00195: a OC continua com os 78,09 m (inalterada nesta entrega)', () => {
    const r = buildNapaRollup(PV00195_ROWS, { includeStrapNapa: true })!;
    expect(r.total).toBeCloseTo(78.09, 2);
    const total = (family: string, color: string) =>
      r.byFamilyColor.find((b) => b.family === family && b.color === color)!.total;
    expect(total('GLOW METALIC', 'CHAMPAGNE')).toBeCloseTo(32.74, 2);
    expect(total('GLOW METALIC', 'COBRE')).toBeCloseTo(16.70, 2);
    expect(total('NAPA SOFT', 'OFF WHITE')).toBeCloseTo(15.26, 2);
  });
});
