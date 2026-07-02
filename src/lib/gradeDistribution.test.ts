import { describe, it, expect } from 'vitest';
import { rateGradeToTotal } from './gradeDistribution';

const sum = (g: Record<string, number> | null) =>
  g ? Object.values(g).reduce((s, v) => s + v, 0) : 0;

describe('rateGradeToTotal', () => {
  it('soma exatamente o alvo quando o alvo < soma dos pesos (estoque parcial)', () => {
    // size_breakdown soma 120 (demanda total), compra só a falta líquida = 40.
    const out = rateGradeToTotal({ '34': 40, '35': 40, '36': 40 }, 40);
    expect(sum(out)).toBe(40);
  });

  it('soma exatamente o alvo quando o alvo > soma dos pesos (MOQ)', () => {
    // demanda 6, mas MOQ arredonda a compra pra 10.
    const out = rateGradeToTotal({ '35': 2, '36': 4 }, 10);
    expect(sum(out)).toBe(10);
  });

  it('preserva a proporção do maior peso (maior resto)', () => {
    const out = rateGradeToTotal({ '35': 10, '36': 90 }, 10)!;
    // 36 domina → recebe a maior fatia.
    expect((out['36'] ?? 0)).toBeGreaterThan(out['35'] ?? 0);
    expect(sum(out)).toBe(10);
  });

  it('ignora chaves de metadados (prefixo _) e valores não-positivos', () => {
    const out = rateGradeToTotal({ _total: 999, '35': 5, '36': 0 } as any, 5);
    expect(out).toEqual({ '35': 5 });
  });

  it('retorna null quando não há pesos válidos ou alvo <= 0', () => {
    expect(rateGradeToTotal(null, 10)).toBeNull();
    expect(rateGradeToTotal({}, 10)).toBeNull();
    expect(rateGradeToTotal({ '35': 10 }, 0)).toBeNull();
    expect(rateGradeToTotal({ _x: 5 } as any, 10)).toBeNull();
  });

  it('nunca produz valores negativos', () => {
    const out = rateGradeToTotal({ '34': 1, '35': 1, '36': 1, '37': 1 }, 3)!;
    expect(Object.values(out).every(v => v >= 0)).toBe(true);
    expect(sum(out)).toBe(3);
  });
});
