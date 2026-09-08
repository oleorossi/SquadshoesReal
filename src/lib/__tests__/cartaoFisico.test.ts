import { describe, expect, it } from 'vitest';
import {
  buildCartaoFisicoCards,
  CARTAO_FISICO_EMITTERS,
  countFullCorrugados,
  gradeForOneCorrugado,
  isCartaoFisicoEmitter,
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
});
