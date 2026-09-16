import { describe, expect, it, vi } from 'vitest';
import {
  buildCartaoCaixaCards,
  CAIXA_TRANSPORTE_PER_PAGE,
  chunkCaixaPages,
} from '@/lib/cartaoCaixaTransporte';
import {
  getCaixaTransporteConfig,
  isCaixaTransporteSector,
} from '@/lib/caixaTransporteConfig';

/** Curva-base Σ=12 — corrugado canônico 12. */
const BASE_12 = { '35': 2, '36': 2, '37': 2, '38': 2, '39': 2, '40': 2 };

describe('caixaTransporteConfig', () => {
  it('Forração = 10 → Palmilha; Costura Cabedal = 30 → Aviamento', () => {
    expect(getCaixaTransporteConfig('Corte Forração')).toEqual({
      fichasPorCaixa: 10,
      destinoLabel: 'Palmilha',
    });
    expect(getCaixaTransporteConfig('Costura Cabedal')).toEqual({
      fichasPorCaixa: 30,
      destinoLabel: 'Aviamento',
    });
    expect(getCaixaTransporteConfig('Montagem')).toBeNull();
    expect(isCaixaTransporteSector('Corte Forração')).toBe(true);
    expect(isCaixaTransporteSector('Silk')).toBe(false);
  });
});

describe('buildCartaoCaixaCards', () => {
  it('23 corrugados Forração → 3 caixas (10, 10, 3) com labels 1/3…3/3', () => {
    const cards = buildCartaoCaixaCards({
      sectorName: 'Corte Forração',
      orders: [{
        opNumber: 'OP-01001',
        pvLabel: 'PV-00160',
        referenceLabel: 'DS20',
        color: 'OFF WHITE',
        materialLabel: 'NAPA SUDANI',
        totalPairs: 23 * 12,
        grid: BASE_12,
      }],
    });
    expect(cards).toHaveLength(3);
    expect(cards.map((c) => c.fichasNaCaixa)).toEqual([10, 10, 3]);
    expect(cards.map((c) => c.capacidade)).toEqual([10, 10, 10]);
    expect(cards.map((c) => c.parcial)).toEqual([false, false, true]);
    expect(cards.map((c) => c.lotCode)).toEqual(['1/3', '2/3', '3/3']);
    expect(cards.map((c) => c.lotLabel)).toEqual(['1 de 3', '2 de 3', '3 de 3']);
    expect(cards.every((c) => c.destinoLabel === 'Palmilha')).toBe(true);
    expect(cards.every((c) => c.opNumber === 'OP-01001')).toBe(true);
    expect(cards[0].totalPairs).toBe(10 * 12);
    expect(cards[2].totalPairs).toBe(3 * 12);
    expect(cards[0].title).toContain('OFF WHITE');
    expect(cards[0].title).toContain('NAPA SUDANI');
  });

  it('OP com 5 corrugados → 1 parcial', () => {
    const cards = buildCartaoCaixaCards({
      sectorName: 'Corte Forração',
      orders: [{
        opNumber: 'OP-5',
        color: 'PRETO',
        totalPairs: 5 * 12,
        grid: BASE_12,
      }],
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].fichasNaCaixa).toBe(5);
    expect(cards[0].capacidade).toBe(10);
    expect(cards[0].parcial).toBe(true);
    expect(cards[0].lotCode).toBe('1/1');
    expect(cards[0].totalPairs).toBe(60);
  });

  it('OPs distintas → caixas separadas (nunca misturar)', () => {
    const cards = buildCartaoCaixaCards({
      sectorName: 'Corte Forração',
      orders: [
        {
          opNumber: 'OP-A',
          color: 'OFF WHITE',
          totalPairs: 12 * 12, // 12 corrugados → 2 caixas (10+2)
          grid: BASE_12,
        },
        {
          opNumber: 'OP-B',
          color: 'OFF WHITE',
          totalPairs: 3 * 12, // 1 parcial
          grid: BASE_12,
        },
      ],
    });
    expect(cards).toHaveLength(3);
    expect(cards.filter((c) => c.opNumber === 'OP-A')).toHaveLength(2);
    expect(cards.filter((c) => c.opNumber === 'OP-B')).toHaveLength(1);
    expect(cards.every((c) => !c.opNumber.includes('·'))).toBe(true);
  });

  it('Costura Cabedal usa capacidade 30', () => {
    const cards = buildCartaoCaixaCards({
      sectorName: 'Costura Cabedal',
      orders: [{
        opNumber: 'OP-CAB',
        color: 'PRETO',
        totalPairs: 35 * 12, // 35 corrugados → 2 caixas (30+5)
        grid: BASE_12,
      }],
    });
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.fichasNaCaixa)).toEqual([30, 5]);
    expect(cards.every((c) => c.capacidade === 30)).toBe(true);
    expect(cards.every((c) => c.destinoLabel === 'Aviamento')).toBe(true);
    expect(cards[0].parcial).toBe(false);
    expect(cards[1].parcial).toBe(true);
  });

  it('setor sem config / N=0 / eligible=false → zero caixas', () => {
    expect(buildCartaoCaixaCards({
      sectorName: 'Montagem',
      orders: [{ opNumber: 'OP-1', totalPairs: 120, grid: BASE_12 }],
    })).toHaveLength(0);

    expect(buildCartaoCaixaCards({
      sectorName: 'Corte Forração',
      orders: [{ opNumber: 'OP-1', totalPairs: 11, grid: BASE_12 }], // < 1 corrugado
    })).toHaveLength(0);

    expect(buildCartaoCaixaCards({
      sectorName: 'Corte Forração',
      orders: [{
        opNumber: 'OP-1',
        totalPairs: 120,
        grid: BASE_12,
        eligible: false,
      }],
    })).toHaveLength(0);
  });

  it('capacidade e destino vêm só de getCaixaTransporteConfig', async () => {
    const configMod = await import('@/lib/caixaTransporteConfig');
    const spy = vi.spyOn(configMod, 'getCaixaTransporteConfig');
    buildCartaoCaixaCards({
      sectorName: 'Corte Forração',
      orders: [{ opNumber: 'OP-1', totalPairs: 24, grid: BASE_12 }],
    });
    expect(spy).toHaveBeenCalledWith('Corte Forração');
    spy.mockRestore();
  });

  it('chunkCaixaPages: 2 por folha', () => {
    expect(CAIXA_TRANSPORTE_PER_PAGE).toBe(2);
    const items = [1, 2, 3, 4, 5];
    expect(chunkCaixaPages(items)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
