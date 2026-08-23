import { describe, it, expect } from 'vitest';
import {
  BARCODE_CENTER_SHIFT_MM,
  barcodeOriginXMm,
  barcodeQuietZonesMm,
} from '@/lib/babyBarcodeShift';

describe('centramento oficial do CODE128', () => {
  it('desloca 1,5 mm para a direita', () => {
    expect(BARCODE_CENTER_SHIFT_MM).toBe(1.5);
  });

  it('parte do centro da arte e soma o shift', () => {
    expect(barcodeOriginXMm(1, 48, 36.408)).toBeCloseTo(1 + (48 - 36.408) / 2 + 1.5, 6);
  });

  it('mantém zona de silêncio mínima nos dois lados no EAN de 13 dígitos', () => {
    const { leftMm, rightMm } = barcodeQuietZonesMm(48, 36.408);
    expect(leftMm).toBeCloseTo((48 - 36.408) / 2 + 1.5, 6);
    expect(rightMm).toBeCloseTo((48 - 36.408) / 2 - 1.5, 6);
    expect(rightMm).toBeGreaterThanOrEqual(3.1);
    expect(leftMm).toBeGreaterThan(rightMm);
  });
});
