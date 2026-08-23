import { describe, expect, it } from 'vitest';
import { L42_NATIVE_DPI, l42ImageFilename, l42PageDots } from '@/lib/l42CareerOutput';

describe('l42CareerOutput', () => {
  it('usa 203 dpi e página 100×30', () => {
    expect(L42_NATIVE_DPI).toBe(203);
    expect(l42PageDots()).toEqual({
      widthDots: Math.round((100 * 203) / 25.4),
      heightDots: Math.round((30 * 203) / 25.4),
    });
  });

  it('nomeia o PNG da carreira', () => {
    expect(l42ImageFilename('Exp_Etiquetas_PedCompra_303222.csv', 0))
      .toBe('L42PRO_Exp_Etiquetas_PedCompra_303222_carreira_001.png');
  });
});
