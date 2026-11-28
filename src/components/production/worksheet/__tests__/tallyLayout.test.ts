import { describe, expect, it } from 'vitest';
import {
  CABEDAL_TALLY_INSET_PX,
  TALLY_MIN_BOX_PX,
  fitTallyBoxLayout,
  tallyAvailableWidthPx,
  tallyDesiredBoxPx,
  tallyRowOccupiedPx,
  tallyGapPx,
} from '../tallyLayout';

describe('fitTallyBoxLayout — auto-fit pra não vazar a faixa', () => {
  it('com poucas fichas (24) mantém a caixa sm de 20px', () => {
    const availableWidthPx = tallyAvailableWidthPx(CABEDAL_TALLY_INSET_PX);
    const layout = fitTallyBoxLayout({
      size: 'sm',
      count: 24,
      lastNumber: 24,
      availableWidthPx,
    });
    expect(layout.boxPx).toBe(tallyDesiredBoxPx('sm'));
    expect(layout.occupiedPx).toBeLessThanOrEqual(availableWidthPx);
  });

  it('com 80 fichas na faixa do Cabedal encolhe a caixa e a linha cheia cabe', () => {
    const availableWidthPx = tallyAvailableWidthPx(CABEDAL_TALLY_INSET_PX);
    const layout = fitTallyBoxLayout({
      size: 'sm',
      count: 80,
      lastNumber: 80,
      availableWidthPx,
    });
    expect(layout.boxPx).toBeLessThan(tallyDesiredBoxPx('sm'));
    expect(layout.boxPx).toBeGreaterThanOrEqual(TALLY_MIN_BOX_PX.sm);
    expect(layout.cols).toBe(30);
    expect(layout.occupiedPx).toBeLessThanOrEqual(availableWidthPx);
    const fullRow = tallyRowOccupiedPx(
      30,
      layout.boxPx,
      tallyGapPx('sm'),
      '← 80',
      'sm',
    );
    expect(fullRow).toBeLessThanOrEqual(availableWidthPx);
  });
});
