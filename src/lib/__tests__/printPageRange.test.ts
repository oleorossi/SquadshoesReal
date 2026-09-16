import { describe, expect, it } from 'vitest';
import { clampPageRange, isPageInRange } from '@/lib/printPageRange';

describe('clampPageRange', () => {
  it('total ≤ 0 → {1,1}', () => {
    expect(clampPageRange(2, 5, 0)).toEqual({ from: 1, to: 1 });
    expect(clampPageRange(1, 1, -3)).toEqual({ from: 1, to: 1 });
  });

  it('identidade quando 1 ≤ from ≤ to ≤ total', () => {
    expect(clampPageRange(3, 7, 10)).toEqual({ from: 3, to: 7 });
    expect(clampPageRange(1, 10, 10)).toEqual({ from: 1, to: 10 });
  });

  it('from < 1 sobe pra 1; to > total desce', () => {
    expect(clampPageRange(0, 99, 5)).toEqual({ from: 1, to: 5 });
    expect(clampPageRange(-2, 3, 5)).toEqual({ from: 1, to: 3 });
  });

  it('from > to → to = from (após clamp)', () => {
    expect(clampPageRange(8, 2, 10)).toEqual({ from: 8, to: 8 });
  });

  it('from > total → ambos no último', () => {
    expect(clampPageRange(20, 30, 4)).toEqual({ from: 4, to: 4 });
  });

  it('não-finito cai em defaults seguros', () => {
    expect(clampPageRange(Number.NaN, 5, 10)).toEqual({ from: 1, to: 5 });
    expect(clampPageRange(2, Number.NaN, 10)).toEqual({ from: 2, to: 10 });
  });
});

describe('isPageInRange', () => {
  it('inclusive nas bordas', () => {
    expect(isPageInRange(3, 3, 7)).toBe(true);
    expect(isPageInRange(7, 3, 7)).toBe(true);
    expect(isPageInRange(2, 3, 7)).toBe(false);
    expect(isPageInRange(8, 3, 7)).toBe(false);
  });
});
