import { describe, it, expect } from 'vitest';
import { buildNapaRollup } from './napaRollup';
import type { BaseMaterialInput } from './baseMaterialTotal';
import { computeBaseMaterialTotal } from './baseMaterialTotal';

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

describe('buildNapaRollup', () => {
  it('soma napa direta + convertida de tiras por família+cor', () => {
    const r = buildNapaRollup(COGUMELO)!;
    const soft = 169.20 / 60 + 126.00 / 60 + 3 * (234.72 / 61);
    expect(r.total).toBeCloseTo(20.27 + soft, 2);
    expect(r.parts.map((p) => p.name).sort()).toEqual(['NAPA SOFT', 'NAPA SUDANI'].sort());
  });

  it('lista destinos: forração e cada tipo de tira', () => {
    const r = buildNapaRollup(COGUMELO)!;
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
    const r = buildNapaRollup([
      {
        componentType: 'Cabedal', groupName: 'NAPA SOFT', color: 'PRETO',
        productUnit: 'm', totalQuantity: 10,
      },
      {
        componentType: 'Tiras', groupName: 'TIRA NOVA 12MM', color: 'PRETO',
        productUnit: 'm', totalQuantity: 100,
        artisanal: { baseName: 'NAPA SOFT', baseQty: 0, yieldPerMeter: 0, pending: true },
      },
    ])!;
    expect(r.total).toBeCloseTo(10, 2);
    expect(r.pendingCount).toBe(1);
    expect(r.skipped).toBe(1);
    const soft = r.byFamilyColor.find((b) => b.family === 'NAPA SOFT')!;
    expect(soft.destinations.some((d) => d.pending && d.label === 'TIRA NOVA 12MM')).toBe(true);
  });

  it('computeBaseMaterialTotal espelha o total do rollup (inclui tiras)', () => {
    const rollup = buildNapaRollup(COGUMELO)!;
    const base = computeBaseMaterialTotal(COGUMELO)!;
    expect(base.total).toBeCloseTo(rollup.total, 6);
    expect(base.parts).toEqual(rollup.parts);
  });
});
