import { describe, expect, it } from 'vitest';
import { referenceStrapBaseGroups } from '@/lib/referenceStrapBaseGroups';

const groups = [
  { id: 'g-madrid', name: 'NAPA MADRID' },
  { id: 'g-soft', name: 'NAPA SOFT' },
  { id: 'g-glow', name: 'GLOW METALIC' },
];

const products = [
  { id: 'p-soft', group_id: 'g-soft' },
  { id: 'p-glow', group_id: 'g-glow' },
];

describe('referenceStrapBaseGroups', () => {
  it('mostra a napa padrão e todas as napas possíveis das variantes da referência', () => {
    const result = referenceStrapBaseGroups({
      sheet: {
        id: 'ref-1',
        upper_material_product_id: 'p-soft',
      },
      groups,
      products,
      variants: [
        {
          reference_id: 'ref-1',
          material_name: 'Madrid',
          active: true,
          main_material_group_id: 'g-madrid',
        },
      ],
    });

    expect(result.map((group) => group.name)).toEqual(['NAPA MADRID', 'NAPA SOFT']);
    expect(result.find((group) => group.id === 'g-madrid')?.origins).toEqual(['Variante Madrid']);
  });

  it('respeita a precedência operacional: grupo de cabedal vence o grupo principal', () => {
    const result = referenceStrapBaseGroups({
      sheet: { id: 'ref-1', upper_material_product_id: 'p-soft' },
      groups,
      products,
      variants: [
        {
          reference_id: 'ref-1',
          material_name: 'Especial',
          active: true,
          upper_material_group_id: 'g-glow',
          main_material_group_id: 'g-madrid',
        },
      ],
    });

    expect(result.map((group) => group.name)).toEqual(['GLOW METALIC', 'NAPA SOFT']);
  });

  it('ignora variantes inativas ou pertencentes a outra referência', () => {
    const result = referenceStrapBaseGroups({
      sheet: { id: 'ref-1', upper_material_product_id: 'p-soft' },
      groups,
      products,
      variants: [
        { reference_id: 'ref-1', active: false, main_material_group_id: 'g-madrid' },
        { reference_id: 'ref-2', active: true, main_material_group_id: 'g-glow' },
      ],
    });

    expect(result.map((group) => group.name)).toEqual(['NAPA SOFT']);
  });

  it('exibe o nome legado da ficha sem tratá-lo como identidade canônica', () => {
    const result = referenceStrapBaseGroups({
      sheet: { id: 'ref-1', lining_material: ' napa soft ' },
      groups,
      products,
      variants: [],
    });

    expect(result).toEqual([{
      id: 'g-soft',
      name: 'NAPA SOFT',
      origins: ['Nome legado da ficha'],
      canonical: false,
    }]);
  });

  it('em tiras sem cabedal, usa a Forração e ignora o principal da variante sem cascata', () => {
    const result = referenceStrapBaseGroups({
      sheet: {
        id: 'ref-1',
        has_straps: true,
        upper_material: '',
        lining_material: 'NAPA SOFT',
        strap_base_group_id: 'g-soft',
        variant_drives_lining: false,
      },
      groups,
      products,
      variants: [{
        reference_id: 'ref-1',
        active: true,
        material_name: 'Glow',
        main_material_group_id: 'g-glow',
      }],
    });

    expect(result.map((group) => group.name)).toEqual(['NAPA SOFT']);
    expect(result[0].canonical).toBe(true);
  });

  it('em tiras sem cabedal, o principal da variante acompanha a Forração quando a cascata está ligada', () => {
    const result = referenceStrapBaseGroups({
      sheet: {
        id: 'ref-1',
        has_straps: true,
        upper_material: '',
        lining_material: 'NAPA SOFT',
        strap_base_group_id: 'g-soft',
        variant_drives_lining: true,
      },
      groups,
      products,
      variants: [{
        reference_id: 'ref-1',
        active: true,
        material_name: 'Glow',
        main_material_group_id: 'g-glow',
      }],
    });

    expect(result.map((group) => group.name)).toEqual(['GLOW METALIC', 'NAPA SOFT']);
  });
});
