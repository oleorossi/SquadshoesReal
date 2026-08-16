import { describe, it, expect } from 'vitest';
import { calculateGradeCoverage, getGradeQuantityForKey, getGradeTotal, rateGradeToTotal } from './gradeDistribution';

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

describe('calculateGradeCoverage', () => {
  it('não usa sobra de outra numeração para esconder uma falta', () => {
    const result = calculateGradeCoverage(
      { '36': 10, '40': 10 },
      { '36': 0, '40': 100 },
    );

    expect(result.totalCoveredOnHand).toBe(10);
    expect(result.totalShortage).toBe(10);
    expect(result.shortageBySize).toEqual({ '36': 10 });
  });

  it('desconta OC em trânsito somente na numeração correspondente', () => {
    const result = calculateGradeCoverage(
      { '36': 10, '37': 10 },
      { '36': 4, '37': 10 },
      { '36': 3, '40': 50 },
    );

    expect(result.totalCoveredOnHand).toBe(14);
    expect(result.totalCoveredIncoming).toBe(3);
    expect(result.shortageBySize).toEqual({ '36': 3 });
  });

  it('usa chave conjugada canônica sem somar baldes individuais novamente', () => {
    expect(getGradeQuantityForKey({ '33/34': 8, '33': 8, '34': 8 }, '33/34')).toBe(8);
    expect(getGradeQuantityForKey({ '33': 3, '34': 4 }, '33/34')).toBe(7);
    expect(getGradeTotal({ '33/34': 8, '33': 8, '34': 8, '35': 2 })).toBe(10);

    const result = calculateGradeCoverage({ '33/34': 10 }, { '33/34': 8, '33': 8, '34': 8 });
    expect(result.totalCoveredOnHand).toBe(8);
    expect(result.totalShortage).toBe(2);
  });

  it('ignora metadados da grade', () => {
    const result = calculateGradeCoverage(
      { _size_from: 33, _size_to: 40, '36': 5 },
      { _size_from: 33, _size_to: 40, '36': 5 },
    );
    expect(result.totalRequired).toBe(5);
    expect(result.totalShortage).toBe(0);
  });
});
