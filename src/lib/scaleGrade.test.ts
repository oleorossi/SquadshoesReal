import { describe, expect, it } from 'vitest';
import { isUsableGrade, scaleGradeToTotal } from './scaleGrade';

describe('scaleGradeToTotal — espelho de public.scale_grade_to_total', () => {
  it('devolve intacta quando a soma já é o total (grade absoluta)', () => {
    const grade = { '36': 200, '37': 400, '38': 504 };
    expect(scaleGradeToTotal(grade, 1104)).toEqual(grade);
  });

  it('escala grade BASE/ratio até o total (largest remainder)', () => {
    const grade = { '35': 1, '36': 2, '37': 3, '38': 3, '39': 2, '40': 1 };
    const scaled = scaleGradeToTotal(grade, 1104);
    const sum = Object.values(scaled).reduce((a, b) => a + b, 0);
    expect(sum).toBe(1104);
    expect(scaled).toEqual({
      '35': 92,
      '36': 184,
      '37': 276,
      '38': 276,
      '39': 184,
      '40': 92,
    });
  });

  it('é no-op para total inválido', () => {
    const grade = { '37': 12 };
    expect(scaleGradeToTotal(grade, 0)).toEqual(grade);
  });

  it('reparte o resto pelo maior resto fracionário (Hamilton)', () => {
    const grade = { '36': 1, '37': 1, '38': 1 };
    const scaled = scaleGradeToTotal(grade, 10);
    const sum = Object.values(scaled).reduce((a, b) => a + b, 0);
    expect(sum).toBe(10);
    expect(Math.max(...Object.values(scaled)) - Math.min(...Object.values(scaled))).toBeLessThanOrEqual(1);
  });
});

describe('isUsableGrade', () => {
  it('recusa null, array e objeto sem tamanho positivo', () => {
    expect(isUsableGrade(null)).toBe(false);
    expect(isUsableGrade([])).toBe(false);
    expect(isUsableGrade({})).toBe(false);
    expect(isUsableGrade({ _meta: 1 })).toBe(false);
  });

  it('aceita grade com ao menos um tamanho > 0', () => {
    expect(isUsableGrade({ '37': 12 })).toBe(true);
    expect(isUsableGrade({ '33/34': 4, '35': 0 })).toBe(true);
  });
});
