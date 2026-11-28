import { describe, expect, it } from 'vitest';
import {
  CABEDAL_TALLY_INSET_PX,
  TALLY_MIN_BOX_PX,
  fitTallyBoxLayout,
  fitCabedalTalliesSideBySide,
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

describe('fitCabedalTalliesSideBySide', () => {
  it('com 10–20 fichas junta Frente e Traseiro (altura não aumenta)', () => {
    for (const count of [10, 12, 20]) {
      const fit = fitCabedalTalliesSideBySide({ count, size: 'sm' });
      expect(fit.sideBySide, `${count} fichas`).toBe(true);
      expect(fit.layout.boxPx).toBeGreaterThanOrEqual(TALLY_MIN_BOX_PX.sm);
      expect(fit.sideRows).toBeLessThanOrEqual(2 * fit.stackedRows);
    }
  });

  it('com 24+ fichas (máx. 30 colunas na faixa cheia) empilha — 80 ficaria mais alto', () => {
    for (const count of [24, 30, 60, 80]) {
      const fit = fitCabedalTalliesSideBySide({ count, size: 'sm' });
      expect(fit.sideBySide, `${count} fichas`).toBe(false);
      expect(fit.availableWidthPx).toBe(tallyAvailableWidthPx(CABEDAL_TALLY_INSET_PX));
    }
    const eighty = fitCabedalTalliesSideBySide({ count: 80, size: 'sm' });
    expect(eighty.sideRows).toBeGreaterThan(2 * eighty.stackedRows - 0); // 8 > 6
    expect(eighty.layout.cols).toBe(30);
  });

  it('com 40 fichas (2+2 empilhadas = 4 lado a lado) junta sem crescer', () => {
    const fit = fitCabedalTalliesSideBySide({ count: 40, size: 'sm' });
    expect(fit.sideBySide).toBe(true);
    expect(fit.sideRows).toBe(4);
    expect(fit.stackedRows).toBe(2);
  });
});

