import { describe, it, expect } from 'vitest';
import { expandBaseGrade } from '@/lib/printServiceOrderReceipt';

/**
 * Invariante do canhoto: a soma por numeração TEM que fechar com o total de
 * pares impresso no cabeçalho. Se divergir, o prestador confere um número e
 * assina outro — e a divergência só aparece no papel, nunca na tela.
 *
 * `sale_order_items.grade` é a grade BASE (1 ficha, ~12 pares), não o total do
 * item — ver memória "sale_order_items.grade é grade BASE".
 */

// Grade base real do PV-00150 (NL02): soma 12 pares por ficha.
const BASE_REAL = { '34': 1, '35': 2, '36': 2, '37': 3, '38': 2, '39': 1, '40': 1 };

const sum = (o: Record<string, number>) => Object.values(o).reduce((s, v) => s + v, 0);

describe('expandBaseGrade', () => {
  it('expande a grade base pro total do item (múltiplo exato)', () => {
    // 36 pares = 3 fichas da base de 12.
    expect(expandBaseGrade(BASE_REAL, 36)).toEqual({
      '34': 3, '35': 6, '36': 6, '37': 9, '38': 6, '39': 3, '40': 3,
    });
  });

  it('bate com o caso real de 1.728 pares (144 fichas)', () => {
    const out = expandBaseGrade(BASE_REAL, 1728);
    expect(out).toEqual({
      '34': 144, '35': 288, '36': 288, '37': 432, '38': 288, '39': 144, '40': 144,
    });
    expect(sum(out)).toBe(1728);
  });

  it('fecha exatamente com o total mesmo quando não é múltiplo da base', () => {
    // 10 não é múltiplo de 12 — o resto tem que ser distribuído, não perdido.
    for (const pairs of [1, 5, 7, 10, 13, 37, 99, 100, 517, 1729]) {
      expect(sum(expandBaseGrade(BASE_REAL, pairs))).toBe(pairs);
    }
  });

  it('manda a sobra pras numerações de maior peso na base', () => {
    // base soma 12, 13 pares → 1 ficha + 1 sobra; o 37 (peso 3) leva.
    const out = expandBaseGrade(BASE_REAL, 13);
    expect(sum(out)).toBe(13);
    expect(out['37']).toBe(4);
  });

  it('nunca devolve numeração negativa', () => {
    for (const pairs of [1, 2, 3, 11, 12, 23]) {
      const out = expandBaseGrade(BASE_REAL, pairs);
      for (const v of Object.values(out)) expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('degrada pra vazio sem grade, sem pares ou com base zerada', () => {
    expect(expandBaseGrade(null, 100)).toEqual({});
    expect(expandBaseGrade(undefined, 100)).toEqual({});
    expect(expandBaseGrade({}, 100)).toEqual({});
    expect(expandBaseGrade(BASE_REAL, 0)).toEqual({});
    expect(expandBaseGrade({ '34': 0, '35': 0 }, 100)).toEqual({});
  });

  it('ignora numerações com peso zero na base', () => {
    const out = expandBaseGrade({ '34': 0, '35': 1, '36': 1 }, 10);
    expect(out['34']).toBeUndefined();
    expect(sum(out)).toBe(10);
  });

  it('arredonda o total fracionário em vez de vazar meio par', () => {
    expect(sum(expandBaseGrade(BASE_REAL, 36.4))).toBe(36);
    expect(sum(expandBaseGrade(BASE_REAL, 36.6))).toBe(37);
  });
});
