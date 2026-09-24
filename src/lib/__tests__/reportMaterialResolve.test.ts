import { describe, expect, it } from 'vitest';
import { resolveReportItemMaterial, resolveReportMaterials } from '@/lib/reportMaterialResolve';

describe('resolveReportMaterials', () => {
  const groups = new Map([
    ['g-soft', 'NAPA SOFT'],
    ['g-sudani', 'NAPA SUDANI'],
    ['g-madrid', 'NAPA MADRID'],
    ['g-main', 'NAPA SANTORINE'],
    ['g-soft-mass', 'NAPA SOFT + MASSABOX'],
    ['g-glow', 'GLOW METALIC'],
  ]);

  it('sem variante: usa texto da ficha', () => {
    const r = resolveReportMaterials({
      sheet: { lining_material: 'NAPA SOFT', upper_material: 'NAPA SOFT' },
      variant: null,
      groupsById: groups,
    });
    expect(r.lining).toBe('NAPA SOFT');
    expect(r.liningFromVariant).toBe(false);
  });

  it('variante com lining_material_group_id vence a ficha', () => {
    const r = resolveReportMaterials({
      sheet: {
        lining_material: 'NAPA SOFT',
        variant_drives_lining: true,
      },
      variant: {
        id: 'v1',
        lining_material_group_id: 'g-madrid',
      },
      groupsById: groups,
    });
    expect(r.lining).toBe('NAPA MADRID');
    expect(r.liningFromVariant).toBe(true);
  });

  it('variante só com main + variant_drives_lining usa material principal', () => {
    const r = resolveReportMaterials({
      sheet: {
        lining_material: 'NAPA SOFT',
        variant_drives_lining: true,
      },
      variant: {
        id: 'v2',
        main_material_group_id: 'g-sudani',
      },
      groupsById: groups,
    });
    expect(r.lining).toBe('NAPA SUDANI');
    expect(r.liningFromVariant).toBe(true);
  });

  it('sem variant_drives_lining e sem slot: permanece ficha', () => {
    const r = resolveReportMaterials({
      sheet: {
        lining_material: 'NAPA SOFT',
        variant_drives_lining: false,
      },
      variant: {
        id: 'v3',
        main_material_group_id: 'g-sudani',
      },
      groupsById: groups,
    });
    expect(r.lining).toBe('NAPA SOFT');
    expect(r.liningFromVariant).toBe(false);
  });
});

describe('resolveReportItemMaterial (campo Material do PV)', () => {
  const groups = new Map([
    ['g-soft', 'NAPA SOFT'],
    ['g-sudani', 'NAPA SUDANI'],
    ['g-soft-mass', 'NAPA SOFT + MASSABOX'],
    ['g-glow', 'GLOW METALIC'],
  ]);

  it('sem variante: cabedal vence forração (LA01)', () => {
    expect(resolveReportItemMaterial({
      sheet: {
        upper_material: 'NAPA SUDANI',
        upper_material_group_id: 'g-sudani',
        lining_material: 'NAPA SOFT',
      },
      variant: null,
      groupsById: groups,
    })).toBe('NAPA SUDANI');
  });

  it('sem variante: upper textual NAPA SOFT + MASSABOX (SP201)', () => {
    expect(resolveReportItemMaterial({
      sheet: {
        upper_material: 'NAPA SOFT + MASSABOX',
        upper_material_group_id: 'g-soft-mass',
        lining_material: 'NAPA SOFT',
      },
      variant: null,
      groupsById: groups,
    })).toBe('NAPA SOFT + MASSABOX');
  });

  it('com variante: material_name comercial (DS53 GLOW)', () => {
    expect(resolveReportItemMaterial({
      sheet: {
        lining_material: 'NAPA SOFT',
        variant_drives_lining: true,
      },
      variant: {
        id: 'v-glow',
        material_name: 'GLOW METALIC',
        lining_material_group_id: 'g-glow',
        main_material_group_id: 'g-glow',
      },
      groupsById: groups,
    })).toBe('GLOW METALIC');
  });
});
