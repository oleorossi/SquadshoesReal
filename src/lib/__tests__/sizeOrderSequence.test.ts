import { describe, expect, it } from 'vitest';
import { expandGradeToSizeOrder } from '@/lib/sizeOrderSequence';

describe('expandGradeToSizeOrder', () => {
  it('repete cada numeração pela quantidade de pares, na ordem das chaves', () => {
    expect(expandGradeToSizeOrder(
      ['34', '35', '36', '37', '38', '39', '40'],
      { '34': 1, '35': 1, '36': 2, '37': 3, '38': 2, '39': 2, '40': 1 },
    )).toEqual(['34', '35', '36', '36', '37', '37', '37', '38', '38', '39', '39', '40']);
  });

  it('ignora numeração zerada, negativa ou ausente', () => {
    expect(expandGradeToSizeOrder(['34', '35', '36'], { '34': 2, '35': 0, '36': -1 })).toEqual(['34', '34']);
    expect(expandGradeToSizeOrder(['34'], undefined)).toEqual([]);
    expect(expandGradeToSizeOrder([], { '34': 3 })).toEqual([]);
  });
});
