import { describe, expect, it } from 'vitest';
import {
  hasVariantComponentPin,
  listVariantCascadeSlots,
  seedVariantCascade,
  variantDrivesNoComponent,
} from '@/lib/materialVariantColorGroup';

/** SR02 (20/08/2026): modelo de tiras, sem cabedal, forração NAPA SOFT. Foi a
 *  ficha em que a variante GLOW METALIC virou no-op silencioso. */
const sr02 = { upper_material: '', lining_material: 'NAPA SOFT' };
/** Ficha com os dois componentes — a decisão é do dono (protege identidade). */
const doisSlots = { upper_material: 'PALHA', lining_material: 'NAPA SOFT' };

describe('listVariantCascadeSlots', () => {
  it('lista só os componentes que a ficha realmente consome', () => {
    expect(listVariantCascadeSlots(sr02).map(s => s.key)).toEqual(['lining']);
    expect(listVariantCascadeSlots(doisSlots).map(s => s.key)).toEqual(['upper', 'lining']);
  });

  it('devolve o material atual do componente pra tela mostrar de→para', () => {
    expect(listVariantCascadeSlots(sr02)[0]).toMatchObject({
      label: 'Forração', sheetMaterial: 'NAPA SOFT', drivesField: 'variant_drives_lining',
    });
  });

  it('ignora material só com espaços e ficha ausente', () => {
    expect(listVariantCascadeSlots({ upper_material: '   ', lining_material: null })).toEqual([]);
    expect(listVariantCascadeSlots(null)).toEqual([]);
  });
});

describe('seedVariantCascade', () => {
  it('liga o único componente possível quando a ficha nunca foi configurada', () => {
    expect(seedVariantCascade(sr02)).toEqual({ upper: false, lining: true });
  });

  it('não escolhe por conta própria quando há dois componentes', () => {
    expect(seedVariantCascade(doisSlots)).toEqual({ upper: false, lining: false });
  });

  it('preserva o que a ficha já tem gravado', () => {
    expect(seedVariantCascade({ ...doisSlots, variant_drives_upper: true }))
      .toEqual({ upper: true, lining: false });
  });

  it('fachete ligado já conta como ficha configurada — não liga slot nenhum', () => {
    expect(seedVariantCascade({ ...sr02, variant_drives_fachete: true }))
      .toEqual({ upper: false, lining: false });
  });
});

describe('variantDrivesNoComponent', () => {
  const cascade = { upper: false, lining: false };

  it('acusa o no-op: material principal sem componente liberado', () => {
    expect(variantDrivesNoComponent({ variant: {}, sheet: sr02, cascade })).toBe(true);
  });

  it('não acusa quando o componente foi liberado', () => {
    expect(variantDrivesNoComponent({
      variant: {}, sheet: sr02, cascade: { upper: false, lining: true },
    })).toBe(false);
  });

  it('trava ligada em componente que a ficha não consome continua sendo no-op', () => {
    expect(variantDrivesNoComponent({
      variant: {}, sheet: sr02, cascade: { upper: true, lining: false },
    })).toBe(true);
  });

  it('exceção por componente resolve sozinha — vence a trava da ficha', () => {
    expect(variantDrivesNoComponent({
      variant: { lining_material_group_id: 'glow' }, sheet: sr02, cascade,
    })).toBe(false);
    expect(variantDrivesNoComponent({
      variant: { insole_material_group_id: 'eva' }, sheet: sr02, cascade,
    })).toBe(false);
  });

  it('fachete dirigido pela variante também troca material', () => {
    expect(variantDrivesNoComponent({
      variant: {}, sheet: { ...sr02, variant_drives_fachete: true }, cascade,
    })).toBe(false);
  });
});

describe('hasVariantComponentPin', () => {
  it('reconhece pin de produto legado e pin de grupo', () => {
    expect(hasVariantComponentPin({ upper_material_product_id: 'p1' })).toBe(true);
    expect(hasVariantComponentPin({ lining_material_group_id: 'g1' })).toBe(true);
    expect(hasVariantComponentPin({ main_material_group_id: 'g1' } as never)).toBe(false);
    expect(hasVariantComponentPin(null)).toBe(false);
  });
});
