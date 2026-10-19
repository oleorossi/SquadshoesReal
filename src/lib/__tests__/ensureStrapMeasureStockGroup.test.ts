import { describe, expect, it } from 'vitest';
import { strapStockGroupName } from '@/lib/ensureStrapMeasureStockGroup';

describe('strapStockGroupName', () => {
  it('monta TIPO NMM em caixa alta (grill Q2)', () => {
    expect(strapStockGroupName('TIRA CHATA', 20)).toBe('TIRA CHATA 20MM');
    expect(strapStockGroupName('tira chata', 8)).toBe('TIRA CHATA 8MM');
    expect(strapStockGroupName('  TIRA   CHATA  ', 15)).toBe('TIRA CHATA 15MM');
  });

  it('aceita medida com decimal sem trailing .0', () => {
    expect(strapStockGroupName('TIRA CHATA', 12.5)).toBe('TIRA CHATA 12.5MM');
  });

  it('recusa tipo vazio ou medida inválida', () => {
    expect(() => strapStockGroupName('', 20)).toThrow(/tipo/i);
    expect(() => strapStockGroupName('TIRA', 0)).toThrow(/medida/i);
    expect(() => strapStockGroupName('TIRA', -1)).toThrow(/medida/i);
  });
});
