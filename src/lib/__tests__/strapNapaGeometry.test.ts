import { describe, expect, it } from 'vitest';
import {
  formatStrapNapaGeometryLabel,
  normalizeStrapNapaGeometry,
  strapGeometryYieldCeiling,
  strapNapaGeometriesMatch,
  strapNapaGeometryKeyLabel,
} from '@/lib/strapNapaGeometry';

describe('strapNapaGeometry', () => {
  it('1000×1370 e 1370×1000 normalizam para a mesma chave', () => {
    const a = normalizeStrapNapaGeometry(1000, 1370);
    const b = normalizeStrapNapaGeometry(1370, 1000);
    expect(a).toEqual({ minMm: 1000, maxMm: 1370 });
    expect(b).toEqual({ minMm: 1000, maxMm: 1370 });
    expect(strapNapaGeometriesMatch(a, b)).toBe(true);
    expect(strapNapaGeometryKeyLabel(a)).toBe('1000x1370');
  });

  it('ficha só com 1370 casa com Soft 1000×1370', () => {
    const soft = normalizeStrapNapaGeometry(1370, 1000);
    const palha = normalizeStrapNapaGeometry(1370, 0);
    expect(strapNapaGeometriesMatch(soft, palha)).toBe(true);
  });

  it('Santorine 1000×1500 NÃO casa com Soft 1000×1370', () => {
    const soft = normalizeStrapNapaGeometry(1370, 1000);
    const santorine = normalizeStrapNapaGeometry(1000, 1500);
    expect(strapNapaGeometriesMatch(soft, santorine)).toBe(false);
  });

  it('teto teórico OVERLOCK 5 mm: floor(1370/18) = 76', () => {
    const geom = normalizeStrapNapaGeometry(1370, 1000);
    expect(strapGeometryYieldCeiling(geom, 18)).toBe(76);
  });

  it('rótulo humano coloca o maior lado primeiro', () => {
    expect(formatStrapNapaGeometryLabel(normalizeStrapNapaGeometry(1000, 1370)))
      .toBe('1.370 × 1.000 mm');
  });
});
