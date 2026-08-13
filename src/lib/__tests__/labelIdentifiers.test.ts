import { describe, expect, it } from 'vitest';
import { buildHangtagBarcode } from '../labelIdentifiers';

describe('buildHangtagBarcode', () => {
  it('não acrescenta serial quando a serialização está desligada', () => {
    expect(buildHangtagBarcode('I100', '36', false, 1, 'fallback')).toBe('I10036');
  });

  it('acrescenta serial somente quando solicitado', () => {
    expect(buildHangtagBarcode('I100', '36', true, 7, 'fallback')).toBe('I100360007');
  });
});
