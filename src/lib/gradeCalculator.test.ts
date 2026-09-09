import { describe, expect, it } from 'vitest';
import {
  buildGradeSizes,
  calculateGrade,
  normalizeSheetCount,
  sanitizeQuantityMap,
  validateGradeRange,
} from './gradeCalculator';

describe('gradeCalculator', () => {
  it('multiplica a necessidade por ficha antes de descontar as palmilhas prontas', () => {
    const calculation = calculateGrade([34], 10, { 34: 1 }, { 34: 4 });

    expect(calculation.rows[0]).toMatchObject({
      size: 34,
      needPerSheet: 1,
      need: 10,
      ready: 4,
      used: 4,
      final: 6,
      surplus: 0,
    });
    expect(calculation.totals).toMatchObject({ needPerSheet: 1, need: 10, final: 6 });
  });

  it('mantém a sobra na própria numeração sem compensar a falta de outra', () => {
    const calculation = calculateGrade(
      [34, 35],
      10,
      { 34: 1, 35: 1 },
      { 34: 12, 35: 4 },
    );

    expect(calculation.rows[0]).toMatchObject({ final: 0, surplus: 2 });
    expect(calculation.rows[1]).toMatchObject({ final: 6, surplus: 0 });
    expect(calculation.totals).toMatchObject({ used: 14, final: 6, surplus: 2 });
  });

  it('normaliza fichas, quantidades e faixas inválidas', () => {
    expect(normalizeSheetCount(0)).toBe(1);
    expect(normalizeSheetCount(1_500)).toBe(999);
    expect(sanitizeQuantityMap({ 34: '2.9', 35: -1, x: 10, 100: 3 })).toEqual({ 34: 2 });
    expect(validateGradeRange(14, 40)).toContain('entre 15 e 50');
    expect(validateGradeRange(40, 34)).toContain('menor ou igual');
    expect(buildGradeSizes(33, 35)).toEqual([33, 34, 35]);
  });
});
