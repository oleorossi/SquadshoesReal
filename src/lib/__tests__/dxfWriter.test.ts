import { describe, it, expect } from 'vitest';
import { polygonsToDxf } from '../dxfWriter';
import { computeDxfAreas } from '../dxfArea';

const rectMm = (w: number, h: number) => ({
  points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }],
  layer: 'CABEDAL',
});

describe('polygonsToDxf', () => {
  it('gera DXF com header mm e LWPOLYLINE', () => {
    const dxf = polygonsToDxf([rectMm(100, 50)]);
    expect(dxf).toContain('$INSUNITS');
    expect(dxf).toContain('LWPOLYLINE');
    expect(dxf).toContain('CABEDAL');
    expect(dxf.trim().endsWith('EOF')).toBe(true);
  });

  it('ignora polígono com menos de 3 pontos', () => {
    const dxf = polygonsToDxf([{ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }]);
    expect(dxf).not.toContain('LWPOLYLINE');
  });

  // PROVA DE UNIDADE: escreve e relê com o mesmo leitor → área idêntica.
  it('round-trip: 100×50 mm → relê 0,5 dm²', () => {
    const dxf = polygonsToDxf([rectMm(100, 50)]);
    const res = computeDxfAreas(dxf);
    expect(res.unit).toBe('mm');
    expect(res.pieces).toHaveLength(1);
    expect(res.totalDm2).toBeCloseTo(0.5, 4); // 100×50 mm² = 5000 mm² = 0,5 dm²
  });

  it('emite as coordenadas dos vértices (não só área)', () => {
    const dxf = polygonsToDxf([{ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }] }]);
    const lines = dxf.split('\n');
    // grupo 10 (x) seguido do valor; confere que 100 e 50 aparecem como coordenada
    const coords = lines.filter((l, i) => (lines[i - 1] === '10' || lines[i - 1] === '20')).map(Number);
    expect(coords).toContain(100);
    expect(coords).toContain(50);
  });

  it('round-trip: duas peças somam', () => {
    const dxf = polygonsToDxf([rectMm(100, 50), rectMm(100, 100)]);
    const res = computeDxfAreas(dxf);
    expect(res.pieces).toHaveLength(2);
    expect(res.totalDm2).toBeCloseTo(1.5, 4);
  });
});
