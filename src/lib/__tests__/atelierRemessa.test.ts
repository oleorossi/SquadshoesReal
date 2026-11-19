import { describe, expect, it } from 'vitest';
import { gradeTotal } from '@/lib/atelierSplit';
import { remessaGradeError, suggestRemessaGrade, sumGrades } from '@/lib/atelierRemessa';

describe('remessa parcial', () => {
  const remaining = { '34': 20, '35': 40, '36': 20 };

  it('sugere uma grade proporcional que soma a quantidade e não passa do saldo', () => {
    const grade = suggestRemessaGrade(remaining, 48);
    expect(gradeTotal(grade)).toBe(48);
    expect(remessaGradeError(remaining, grade)).toBeNull();
    expect(grade['35']).toBeGreaterThan(grade['34']);
  });

  it('recusa quantidade acima do saldo', () => {
    expect(gradeTotal(suggestRemessaGrade(remaining, 200))).toBe(80);
    expect(remessaGradeError(remaining, { '35': 41 })).toMatch(/passa do saldo/);
  });

  it('soma as grades dos jobs do lote', () => {
    expect(sumGrades([{ '34': 10 }, { '34': 5, '35': 2 }])).toEqual({ '34': 15, '35': 2 });
  });
});
