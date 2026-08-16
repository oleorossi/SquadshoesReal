import { describe, expect, it } from 'vitest';
import {
  activeProductColorsForGroup,
  resolveMaterialVariantColorGroup,
} from '@/lib/materialVariantColorGroup';

const groups = [
  { id: 'upper-pin-group', name: 'Cabedal pinado' },
  { id: 'upper-group', name: 'Cabedal por grupo' },
  { id: 'lining-pin-group', name: 'Forro pinado' },
  { id: 'lining-group', name: 'Forro por grupo' },
  { id: 'main-group', name: 'Material principal' },
];
const products = [
  { id: 'upper-pin', group_id: 'upper-pin-group', color: ' Preto ', active: true },
  { id: 'lining-pin', group_id: 'lining-pin-group', color: 'Caramelo', active: true },
];

describe('resolveMaterialVariantColorGroup', () => {
  it('prioriza pino e grupo de cabedal antes de qualquer identidade de forro', () => {
    expect(resolveMaterialVariantColorGroup({
      variant: {
        upper_material_product_id: 'upper-pin',
        upper_material_group_id: 'upper-group',
        lining_material_product_id: 'lining-pin',
        lining_material_group_id: 'lining-group',
        main_material_group_id: 'main-group',
      },
      sheet: { variant_drives_upper: true, variant_drives_lining: true },
      products,
      groups,
    })?.id).toBe('upper-pin-group');
  });

  it('usa o grupo principal no slot de cabedal somente quando a ficha delega cabedal', () => {
    expect(resolveMaterialVariantColorGroup({
      variant: { main_material_group_id: 'main-group', lining_material_group_id: 'lining-group' },
      sheet: { variant_drives_upper: true, variant_drives_lining: true },
      products,
      groups,
    })?.id).toBe('main-group');
  });

  it('cai para pino/grupo de forro quando cabedal não é dirigido pela variante', () => {
    expect(resolveMaterialVariantColorGroup({
      variant: {
        lining_material_product_id: 'lining-pin',
        lining_material_group_id: 'lining-group',
        main_material_group_id: 'main-group',
      },
      sheet: { variant_drives_upper: false, variant_drives_lining: true },
      products,
      groups,
    })?.id).toBe('lining-pin-group');
  });

  it('usa o grupo principal como forro quando somente o forro é dirigido', () => {
    expect(resolveMaterialVariantColorGroup({
      variant: { main_material_group_id: 'main-group' },
      sheet: { variant_drives_upper: false, variant_drives_lining: true },
      products,
      groups,
    })?.id).toBe('main-group');
  });
});

describe('activeProductColorsForGroup', () => {
  it('deriva somente products.color ativos do grupo exato, sem inferir pelo nome', () => {
    expect(activeProductColorsForGroup([
      { id: '1', group_id: 'g', color: ' preto ', active: true },
      { id: '2', group_id: 'g', color: 'PRETO', active: true },
      { id: '3', group_id: 'g', color: null, active: true },
      { id: '4', group_id: 'g', color: 'BRANCO', active: false },
      { id: '5', group_id: 'other', color: 'AZUL', active: true },
    ], 'g')).toEqual(['PRETO']);
  });
});
