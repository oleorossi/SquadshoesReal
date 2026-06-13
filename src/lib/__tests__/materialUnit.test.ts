import { describe, it, expect } from 'vitest';
import { resolveGroupUnit, isAreaUnit } from '../materialUnit';

const groups = [
  { id: 'g1', name: 'NAPA SOFT', dimensions_width: 140 },        // área de bobina
  { id: 'g2', name: 'ELÁSTICO', dimensions_width: 0, consumption_unit: 'm' },
  { id: 'g3', name: 'ILHÓS', dimensions_width: 0 },
];
const products = [
  { group_id: 'g1', active: true, unit: 'm' },   // linear + largura → dm²
  { group_id: 'g2', active: true, unit: 'un' },   // produto manda (un), não o consumption_unit
  { group_id: 'g3', active: true, unit: 'un' },
];

describe('resolveGroupUnit', () => {
  it('área de bobina (linear + largura) → dm²', () => {
    expect(resolveGroupUnit('NAPA SOFT', groups, products)).toBe('dm²');
  });
  it('unidade vem do produto ativo (un), não do consumption_unit do grupo', () => {
    expect(resolveGroupUnit('ELÁSTICO', groups, products)).toBe('un');
  });
  it('grupo desconhecido → storedUnit ou un', () => {
    expect(resolveGroupUnit('XPTO', groups, products)).toBe('un');
    expect(resolveGroupUnit('', groups, products, 'cm')).toBe('cm');
  });
});

describe('isAreaUnit', () => {
  it('dm²/m²/cm² (e variações) são área', () => {
    expect(isAreaUnit('dm²')).toBe(true);
    expect(isAreaUnit('dm2')).toBe(true);
    expect(isAreaUnit('m²')).toBe(true);
  });
  it('lineares/contagem não são área', () => {
    expect(isAreaUnit('m')).toBe(false);
    expect(isAreaUnit('un')).toBe(false);
    expect(isAreaUnit('')).toBe(false);
  });
});
