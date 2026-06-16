import { describe, it, expect } from 'vitest';
import {
  scaleConsumptionBySize,
  standardScaleFactor,
  isNonFlatProgression,
  expandSizeRange,
} from '../gradeScaling';

describe('standardScaleFactor (ponto francês)', () => {
  it('linear = size/base', () => {
    expect(standardScaleFactor(37, 37, 'linear')).toBe(1);
    expect(standardScaleFactor(40, 37, 'linear')).toBeCloseTo(40 / 37, 6);
  });
  it('area = (size/base)²', () => {
    expect(standardScaleFactor(40, 37, 'area')).toBeCloseTo((40 / 37) ** 2, 6);
  });
});

describe('isNonFlatProgression', () => {
  const sizes = [34, 35, 36, 37];
  it('chapado → false', () => {
    expect(isNonFlatProgression({ 34: 4.68, 35: 4.68, 36: 4.68, 37: 4.68 }, sizes)).toBe(false);
  });
  it('com progressão → true', () => {
    expect(isNonFlatProgression({ 34: 4.5, 35: 4.7, 36: 4.9, 37: 5.1 }, sizes)).toBe(true);
  });
  it('menos de 2 valores → false', () => {
    expect(isNonFlatProgression({ 34: 4.68 }, sizes)).toBe(false);
    expect(isNonFlatProgression(null, sizes)).toBe(false);
  });
});

describe('scaleConsumptionBySize', () => {
  const sizes = [35, 36, 37, 38, 39];

  it('base no tamanho base é preservado', () => {
    const out = scaleConsumptionBySize({ base: 5.0, baseSize: 37, sizes, mode: 'linear' });
    expect(out['37']).toBe(5.0);
  });

  it('linear escala por size/base e NÃO fica chapado', () => {
    const out = scaleConsumptionBySize({ base: 10, baseSize: 37, sizes, mode: 'linear', decimals: 4 });
    expect(out['39']).toBeCloseTo(10 * (39 / 37), 4);
    expect(out['35']).toBeCloseTo(10 * (35 / 37), 4);
    expect(out['35']).toBeLessThan(out['39']); // cresce com o número
  });

  it('area escala por (size/base)²', () => {
    const out = scaleConsumptionBySize({ base: 10, baseSize: 37, sizes, mode: 'area' });
    expect(out['39']).toBeCloseTo(10 * (39 / 37) ** 2, 4);
  });

  it('usa a razão real do solado quando NÃO chapada', () => {
    const sole = { 35: 4.0, 36: 4.5, 37: 5.0, 38: 5.5, 39: 6.0 };
    const out = scaleConsumptionBySize({ base: 10, baseSize: 37, sizes, mode: 'area', soleMetricPerSize: sole });
    // fator = metric(s)/metric(37); 39 → 6.0/5.0 = 1.2 → 12
    expect(out['39']).toBeCloseTo(12, 4);
    expect(out['35']).toBeCloseTo(8, 4); // 4.0/5.0 = 0.8 → 8
  });

  it('solado chapado → ignora e cai na grade padrão', () => {
    const flat = { 35: 4.68, 36: 4.68, 37: 4.68, 38: 4.68, 39: 4.68 };
    const out = scaleConsumptionBySize({ base: 10, baseSize: 37, sizes, mode: 'linear', soleMetricPerSize: flat });
    expect(out['39']).toBeCloseTo(10 * (39 / 37), 4); // grade padrão, não chapado
    expect(out['39']).not.toBe(out['35']);
  });

  it('base ≤ 0 ou faixa vazia → {}', () => {
    expect(scaleConsumptionBySize({ base: 0, baseSize: 37, sizes })).toEqual({});
    expect(scaleConsumptionBySize({ base: 5, baseSize: 37, sizes: [] })).toEqual({});
  });
});

describe('expandSizeRange', () => {
  it('faixa "34-41"', () => {
    expect(expandSizeRange('34-41')).toEqual([34, 35, 36, 37, 38, 39, 40, 41]);
  });
  it('faixa com vírgula "34-36,40"', () => {
    expect(expandSizeRange('34-36,40')).toEqual([34, 35, 36, 40]);
  });
  it('array passa direto; nulo → []', () => {
    expect(expandSizeRange([34, 35])).toEqual([34, 35]);
    expect(expandSizeRange(null)).toEqual([]);
  });
});
