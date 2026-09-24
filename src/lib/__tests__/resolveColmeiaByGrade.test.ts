import { describe, expect, it } from 'vitest';
import { resolveColmeiaByGrade } from '@/lib/resolveColmeiaByGrade';

const catalog = [
  { id: 'box-12', nome: 'CAIXA COLMEIA 11', tipo: 'colmeia', pairs_per_box_default: 12, active: true },
  { id: 'box-15', nome: 'COLMEIA 11', tipo: 'colmeia', pairs_per_box_default: 15, active: true },
];

describe('resolveColmeiaByGrade', () => {
  it('casa Σgrade 15 com a colmeia de 15 do catálogo mesmo com pin em 12', () => {
    const r = resolveColmeiaByGrade({
      gradePairsPerSheet: 15,
      solePinBoxId: 'box-12',
      solePinPairs: 12,
      catalog,
    });
    expect(r).toMatchObject({
      boxTypeId: 'box-15',
      pairsPerBox: 15,
      source: 'grade_catalog',
      matchedName: 'COLMEIA 11',
    });
  });

  it('preferir o pin do solado quando ele também casa a capacidade', () => {
    const r = resolveColmeiaByGrade({
      gradePairsPerSheet: 12,
      solePinBoxId: 'box-12',
      solePinPairs: 12,
      catalog,
    });
    expect(r.boxTypeId).toBe('box-12');
    expect(r.source).toBe('grade_catalog');
  });

  it('sem match de grade cai no pin do solado', () => {
    const r = resolveColmeiaByGrade({
      gradePairsPerSheet: 14,
      solePinBoxId: 'box-12',
      solePinPairs: 12,
      catalog,
    });
    expect(r).toMatchObject({
      boxTypeId: 'box-12',
      pairsPerBox: 12,
      source: 'sole_pin',
    });
  });
});
