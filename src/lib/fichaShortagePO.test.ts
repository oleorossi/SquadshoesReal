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
      art: { stock: 0, minStock: 0, isArtisanal: true },
      napa: { stock: 1, minStock: 2 },
    });
    expect(cands).toHaveLength(1);
    expect(cands[0].productId).toBe('napa');
    expect(cands[0].reason).toBe('both');
    expect(cands[0].qty).toBe(4);
  });
});
