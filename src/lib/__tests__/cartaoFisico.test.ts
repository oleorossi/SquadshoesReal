import { describe, expect, it } from 'vitest';
import {
  buildCartaoFisicoCards,
  CARTAO_FISICO_EMITTERS,
  CARTAO_FISICO_PER_PAGE,
  countFullCorrugados,
  gradeForOneCorrugado,
  isCartaoFisicoEmitter,
  layoutCutStack,
  layoutCutStackPages,
} from '@/lib/cartaoFisico';

describe('cartaoFisico', () => {
  it('allow-list dos 6 emissores', () => {
    expect(CARTAO_FISICO_EMITTERS).toEqual([
      'Corte Palmilha',
      'Corte Forração',
      'Corte Cabedal',
      'Costura Cabedal',
      'Aviamento',
      'Montagem',
    ]);
    expect(isCartaoFisicoEmitter('Montagem')).toBe(true);
    expect(isCartaoFisicoEmitter('Silk')).toBe(false);
    expect(isCartaoFisicoEmitter('Colagem')).toBe(false);
    expect(isCartaoFisicoEmitter('Costura Palmilha')).toBe(false);
    expect(isCartaoFisicoEmitter('Solagem')).toBe(false);
    expect(isCartaoFisicoEmitter('Expedição')).toBe(false);
  });

  it('countFullCorrugados = floor(pares / corrugado) — sobra sem cartão', () => {
    expect(countFullCorrugados(26, 12)).toBe(2);
    expect(countFullCorrugados(24, 12)).toBe(2);
    expect(countFullCorrugados(11, 12)).toBe(0);
    expect(countFullCorrugados(36, 18)).toBe(2);
    expect(countFullCorrugados(0, 12)).toBe(0);
  });

  it('OP 26 pares / curva 12 → 2 cartões (não 3)', () => {
    const base = { '35': 2, '36': 2, '37': 2, '38': 2, '39': 2, '40': 2 }; // Σ=12
    const cards = buildCartaoFisicoCards({
      sectorName: 'Montagem',
      orders: [{
        opNumber: 'OP-01001',
        pvLabel: 'PV-00160',
        referenceLabel: 'DS20',
        color: 'OFF WHITE',
        totalPairs: 26,
        grid: base,
      }],
    });
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.lotCode)).toEqual(['1/2', '2/2']);
    expect(cards.every((c) => c.opNumber === 'OP-01001')).toBe(true);
    expect(cards.every((c) => c.totalPairs === 12)).toBe(true);
    expect(cards[0].grade).toEqual(base);
  });

  it('duas OPs mesma ref+cor → cartões separados, sem misturar OP', () => {
    const base = { '35': 2, '36': 2, '37': 2, '38': 2, '39': 2, '40': 2 };
    const cards = buildCartaoFisicoCards({
      sectorName: 'Corte Forração',
      orders: [
        {
          opNumber: 'OP-01001',
          referenceLabel: 'DS20',
          color: 'OFF WHITE',
          materialLabel: 'NAPA SUDANI',
          totalPairs: 24,
          grid: base,
        },
        {
          opNumber: 'OP-01002',
          referenceLabel: 'DS20',
          color: 'OFF WHITE',
          materialLabel: 'NAPA SUDANI',
          totalPairs: 12,
          grid: base,
        },
      ],
    });
    expect(cards).toHaveLength(3);
    expect(cards.filter((c) => c.opNumber === 'OP-01001')).toHaveLength(2);
    expect(cards.filter((c) => c.opNumber === 'OP-01002')).toHaveLength(1);
    expect(cards.every((c) => !c.opNumber.includes('·'))).toBe(true);
    expect(cards[0].title).toContain('OFF WHITE');
    expect(cards[0].title).toContain('NAPA SUDANI');
  });

  it('setor não emissor → zero cartões', () => {
    const cards = buildCartaoFisicoCards({
      sectorName: 'Silk',
      orders: [{
        opNumber: 'OP-1',
        totalPairs: 24,
        grid: { '35': 12, '36': 12 },
      }],
    });
    expect(cards).toHaveLength(0);
  });

  it('eligible=false ignora a OP', () => {
    const cards = buildCartaoFisicoCards({
      sectorName: 'Corte Cabedal',
      orders: [{
        opNumber: 'OP-1',
        totalPairs: 24,
        grid: { '35': 12, '36': 12 },
        eligible: false,
      }],
    });
    expect(cards).toHaveLength(0);
  });

  it('gradeForOneCorrugado prefer baseCurve; senão escala a grade total', () => {
    const base = { '35': 2, '36': 2, '37': 2, '38': 2, '39': 2, '40': 2 };
    expect(gradeForOneCorrugado(24, { '35': 4, '36': 4, '37': 4, '38': 4, '39': 4, '40': 4 }, 12, base))
      .toEqual(base);

    const fromTotal = gradeForOneCorrugado(
      24,
      { '35': 4, '36': 4, '37': 4, '38': 4, '39': 4, '40': 4 },
      12,
      null,
    );
    expect(Object.values(fromTotal).reduce((s, v) => s + v, 0)).toBe(12);
  });

  describe('layoutCutStack', () => {
    it('capacidade canônica = 12 (3×4 A4 paisagem)', () => {
      expect(CARTAO_FISICO_PER_PAGE).toBe(12);
    });

    it('N ≤ capacity → identidade (uma página)', () => {
      const items = Array.from({ length: 10 }, (_, i) => i);
      expect(layoutCutStackPages(items, 12)).toEqual([items]);
      expect(layoutCutStack(items, 12)).toEqual(items);
      expect(layoutCutStackPages([], 12)).toEqual([]);
    });

    it('N = 24 / C = 12 → slot 0 das duas páginas = itens 0 e 1', () => {
      const items = Array.from({ length: 24 }, (_, i) => i);
      const pages = layoutCutStackPages(items, 12);
      expect(pages).toHaveLength(2);
      expect(pages[0]).toHaveLength(12);
      expect(pages[1]).toHaveLength(12);
      // Empilhar e cortar a posição 0 entrega a sequência 0,1
      expect(pages[0][0]).toBe(0);
      expect(pages[1][0]).toBe(1);
      // Posição 1 → 2,3; última posição → 22,23
      expect(pages.map((p) => p[1])).toEqual([2, 3]);
      expect(pages.map((p) => p[11])).toEqual([22, 23]);
      // Página 1 (0-based) = pares; página 2 = ímpares (1-based do plano)
      expect(pages[0]).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]);
      expect(pages[1]).toEqual([1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23]);
    });

    it('N = 13 / C = 12 → 2 páginas; slot 0 = 0,1; sem inventar card', () => {
      const items = Array.from({ length: 13 }, (_, i) => i);
      const pages = layoutCutStackPages(items, 12);
      expect(pages).toHaveLength(2);
      expect(pages[0][0]).toBe(0);
      expect(pages[1][0]).toBe(1);
      expect(pages[0]).toHaveLength(7);
      expect(pages[1]).toHaveLength(6);
      expect(pages.flat()).toHaveLength(13);
    });

    it('round-trip: emitidos = permutação dos originais (sem perda/duplicata)', () => {
      for (const n of [1, 11, 12, 13, 24, 25, 36, 40, 260]) {
        const items = Array.from({ length: n }, (_, i) => `c${i}`);
        const laid = layoutCutStack(items, CARTAO_FISICO_PER_PAGE);
        expect(laid).toHaveLength(n);
        expect([...laid].sort()).toEqual([...items].sort());
        expect(new Set(laid).size).toBe(n);
      }
    });
  });
});
