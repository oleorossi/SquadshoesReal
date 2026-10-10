import { describe, expect, it } from 'vitest';
import { shortageCandidatesFromVariance } from './fichaShortagePO';
import { buildVarianceLines } from './fichaVariance';

describe('shortageCandidatesFromVariance', () => {
  it('ignora artesanal e linha sem productId', () => {
    const lines = buildVarianceLines([
      { productId: null, name: 'ghost', theoretical: 1, actual: 4 },
      { productId: 'art', name: 'Tira', theoretical: 1, actual: 4 },
      { productId: 'napa', name: 'Napa', theoretical: 10, actual: 13 },
    ]);
    const cands = shortageCandidatesFromVariance(lines, {
      art: { stock: 0, isArtisanal: true },
      napa: { stock: 1 },
    });
    expect(cands).toHaveLength(1);
    expect(cands[0].productId).toBe('napa');
    expect(cands[0].reason).toBe('shortage');
    // só a falta da ficha (10 − 1), sem parcela de estoque mínimo
    expect(cands[0].qty).toBe(9);
  });

  it('compra ruptura da ficha mesmo sem overage', () => {
    const lines = buildVarianceLines([
      { productId: 'solado', name: 'Solado', theoretical: 36, actual: 0 },
    ]);
    const cands = shortageCandidatesFromVariance(lines, {
      solado: { stock: 10 },
    });
    expect(cands).toHaveLength(1);
    expect(cands[0].reason).toBe('shortage');
    expect(cands[0].qty).toBe(26);
  });

  it('estoque cobrindo a ficha não gera compra (não há piso a recompor)', () => {
    const lines = buildVarianceLines([
      { productId: 'napa', name: 'Napa', theoretical: 10, actual: 10 },
    ]);
    expect(shortageCandidatesFromVariance(lines, { napa: { stock: 10 } })).toHaveLength(0);
  });
});
