import { describe, it, expect } from 'vitest';
import { shoelaceArea, mmPerPixel, pxToMm, polygonAreaDm2, totalAreaDm2 } from '../cadGeometry';

const rect = (w: number, h: number) => [
  { x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h },
];

describe('shoelaceArea', () => {
  it('retângulo w×h', () => {
    expect(shoelaceArea(rect(100, 50))).toBe(5000);
  });
  it('menos de 3 pontos → 0', () => {
    expect(shoelaceArea([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(0);
  });
});

describe('mmPerPixel', () => {
  it('300 DPI → 25,4/300 mm/px', () => {
    expect(mmPerPixel(300)).toBeCloseTo(25.4 / 300, 8);
  });
  it('DPI inválido → 0', () => {
    expect(mmPerPixel(0)).toBe(0);
  });
});

describe('pxToMm', () => {
  it('converte e inverte Y quando pedido', () => {
    const p = pxToMm({ x: 300, y: 100 }, 300, 1000); // 300px=25.4mm; y flip de 1000
    expect(p.x).toBeCloseTo(25.4, 6);
    expect(p.y).toBeCloseTo((1000 - 100) * 25.4 / 300, 6);
  });
});

describe('polygonAreaDm2', () => {
  it('retângulo de 100mm × 50mm a 300 DPI → 0,5 dm²', () => {
    const pxPerMm = 300 / 25.4;
    const poly = rect(100 * pxPerMm, 50 * pxPerMm);
    expect(polygonAreaDm2(poly, 300)).toBeCloseTo(0.5, 4);
  });
  it('escala com o quadrado do DPI inverso (mesmos px, DPI 2× → área /4)', () => {
    const poly = rect(600, 300);
    const a300 = polygonAreaDm2(poly, 300);
    const a600 = polygonAreaDm2(poly, 600);
    expect(a300 / a600).toBeCloseTo(4, 6);
  });
});

describe('totalAreaDm2', () => {
  it('soma as peças', () => {
    const pxPerMm = 300 / 25.4;
    const a = rect(100 * pxPerMm, 50 * pxPerMm); // 0,5 dm²
    const b = rect(100 * pxPerMm, 100 * pxPerMm); // 1,0 dm²
    expect(totalAreaDm2([a, b], 300)).toBeCloseTo(1.5, 3);
  });
});
