import { describe, expect, it } from 'vitest';
import { CABEDAL_VIZ, CABEDAL_VIZ_CLASS, isCabedalVizSector } from '../cabedalSheetViz';

describe('cabedalSheetViz', () => {
  it('vale só pra Corte/Costura Cabedal e Aviamento', () => {
    expect(isCabedalVizSector('Corte Cabedal')).toBe(true);
    expect(isCabedalVizSector('Costura Cabedal')).toBe(true);
    expect(isCabedalVizSector('Aviamento')).toBe(true);
    expect(isCabedalVizSector('Corte Forração')).toBe(false);
    expect(isCabedalVizSector('Silk')).toBe(false);
    expect(isCabedalVizSector('Montagem')).toBe(false);
  });

  it('tokens de linha e fundo continuam escuros o bastante pra P&B', () => {
    expect(CABEDAL_VIZ.card).toContain('#000');
    expect(CABEDAL_VIZ.hair).toMatch(/#6e6e6e|#000/);
    expect(CABEDAL_VIZ.muted).toBe('#3a3a3a');
    expect(CABEDAL_VIZ_CLASS).toBe('ficha-viz-cabedal');
  });
});
