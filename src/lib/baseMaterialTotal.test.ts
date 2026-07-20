import { describe, it, expect } from 'vitest';
import { computeBaseMaterialTotal, type BaseMaterialInput } from './baseMaterialTotal';

/** Linhas reais do PV-00147, seção COGUMELO (print do dono, 20/07/2026).
 *  Total conferido por ele na mão: 36,74 m de napa. */
const COGUMELO: BaseMaterialInput[] = [
  {
    componentType: 'Forração Palmilha', groupName: 'NAPA SUDANI',
    productUnit: 'm', totalQuantity: 20.27,
  },
  {
    componentType: 'Tiras', groupName: 'Tira chata 8mm', productUnit: 'm',
    totalQuantity: 169.20,
    artisanal: { baseName: 'NAPA SOFT', baseQty: 169.20 / 60, yieldPerMeter: 60 },
  },
  {
    componentType: 'Tiras', groupName: 'Tira chata 8mm', productUnit: 'm',
    totalQuantity: 126.00,
    artisanal: { baseName: 'NAPA SOFT', baseQty: 126.00 / 60, yieldPerMeter: 60 },
  },
  ...[1, 2, 3].map(() => ({
    componentType: 'Tiras', groupName: 'TIRA OVERLOCK 5MM', productUnit: 'm',
    totalQuantity: 234.72,
    artisanal: { baseName: 'NAPA SOFT', baseQty: 234.72 / 61, yieldPerMeter: 61 },
  })),
];

describe('computeBaseMaterialTotal', () => {
  it('soma tiras convertidas + napa direta (PV-00147 COGUMELO = 36,74 m)', () => {
    const r = computeBaseMaterialTotal(COGUMELO)!;
    expect(r.total).toBeCloseTo(36.74, 2);
    expect(r.skipped).toBe(0);
  });

  it('quebra por material, maior primeiro', () => {
    const r = computeBaseMaterialTotal(COGUMELO)!;
    expect(r.parts.map(p => p.name)).toEqual(['NAPA SUDANI', 'NAPA SOFT']);
    expect(r.parts[0].qty).toBeCloseTo(20.27, 2);
    expect(r.parts[1].qty).toBeCloseTo(16.47, 2);
  });

  it('conta o equivalente em napa da tira, nunca os metros de tira', () => {
    // 169,20 m de tira = 2,82 m de napa. Somar os metros de tira daria 169,20.
    const r = computeBaseMaterialTotal([COGUMELO[1]])!;
    expect(r.total).toBeCloseTo(2.82, 2);
  });

  it('ignora o que não é napa (solado em par, linha em kg, rebite em un)', () => {
    const r = computeBaseMaterialTotal([
      { componentType: 'Solado', groupName: 'SOLADO 01', productUnit: 'par', totalQuantity: 2304 },
      { componentType: 'Químicos', groupName: 'LINHANYL', productUnit: 'kg', totalQuantity: 2.07 },
      { componentType: 'Outros', groupName: 'Rebite', productUnit: 'un', totalQuantity: 2592 },
    ]);
    expect(r).toBeNull();
  });

  it('deixa de fora a linha com largura faltando (entraria ~100× inflada) e avisa', () => {
    const r = computeBaseMaterialTotal([
      { componentType: 'Cabedal', groupName: 'NAPA X', productUnit: 'm', totalQuantity: 5700, widthMissing: true },
      { componentType: 'Forração', groupName: 'NAPA SOFT', productUnit: 'm', totalQuantity: 12.5 },
    ])!;
    expect(r.total).toBeCloseTo(12.5, 2);
    expect(r.skipped).toBe(1);
  });

  it('deixa de fora consumo não calculado (fachete sem specs)', () => {
    const r = computeBaseMaterialTotal([
      { componentType: 'Fachete', groupName: 'NAPA SOFT', productUnit: 'm', totalQuantity: 0, warning: 'sem consumo de fachete' },
    ]);
    expect(r).toBeNull();
  });

  it('não soma napa medida em dm² junto com metro', () => {
    const r = computeBaseMaterialTotal([
      { componentType: 'Cabedal', groupName: 'NAPA SOFT', productUnit: 'dm²', totalQuantity: 5.83 },
    ]);
    expect(r).toBeNull();
  });
});
