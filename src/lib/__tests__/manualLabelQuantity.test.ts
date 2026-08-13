import { describe, expect, it } from 'vitest';
import { expandManualGrade } from '../manualLabelQuantity';

describe('expandManualGrade', () => {
  it('respeita quantidade por numeração e multiplicador', () => {
    const result = expandManualGrade([{ size: '35', qty: 2 }, { size: '36', qty: 3 }], 2);
    expect(result).toHaveLength(10);
    expect(result.filter(size => size === '35')).toHaveLength(4);
    expect(result.filter(size => size === '36')).toHaveLength(6);
  });

  it('sem grade gera apenas o multiplicador informado', () => {
    expect(expandManualGrade([], 3)).toEqual(['', '', '']);
  });
});
