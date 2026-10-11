import { describe, expect, it } from 'vitest';
import {
  buildSaleOrderMaterialOptions,
  listVariantSlotsKeptOnSheet,
} from '@/lib/materialVariantColorGroup';

// Fonte única do seletor "Material" do item do PV — e da prévia que a aba
// Variantes da ficha mostra. Os casos usam o cadastro real de 11/10/2026.

const NAPA_SOFT = { id: 'grp-napa-soft', name: 'NAPA SOFT' };
const GLOW = { id: 'grp-glow', name: 'GLOW METALIC' };
const GROUPS = [NAPA_SOFT, GLOW];

const PRODUCTS = [
  { id: 'soft-preto', group_id: NAPA_SOFT.id, color: 'PRETO', active: true },
  { id: 'soft-rosado', group_id: NAPA_SOFT.id, color: 'ROSADO', active: true },
  { id: 'soft-inativo', group_id: NAPA_SOFT.id, color: 'VERDE', active: false },
  { id: 'glow-prata', group_id: GLOW.id, color: 'PRATA', active: true },
];

// S300: cabedal e forro em NAPA SOFT, as duas travas ligadas, uma variante
// GLOW METALIC só com o material principal.
const S300_SHEET = {
  upper_material_group_id: NAPA_SOFT.id,
  upper_material: 'NAPA SOFT',
  lining_material: 'NAPA SOFT',
  has_straps: false,
  variant_drives_upper: true,
  variant_drives_lining: true,
  variant_drives_fachete: false,
};
const GLOW_VARIANT = {
  id: 'var-glow',
  material_name: 'GLOW METALIC',
  active: true,
  main_material_group_id: GLOW.id,
};

describe('buildSaleOrderMaterialOptions', () => {
  it('S300: oferece o material da ficha primeiro, como padrão, e depois a variante', () => {
    const result = buildSaleOrderMaterialOptions({
      sheet: S300_SHEET, variants: [GLOW_VARIANT], products: PRODUCTS, groups: GROUPS,
    });
    expect(result.sheetBaseGroup).toEqual(NAPA_SOFT);
    expect(result.baseCoveredByVariant).toBe(false);
    expect(result.sheetMaterialSelectable).toBe(true);
    expect(result.options.map(o => [o.variantId, o.label])).toEqual([
      [null, 'NAPA SOFT'],
      ['var-glow', 'GLOW METALIC'],
    ]);
    // Só produto ATIVO conta como cor vendável.
    expect(result.options[0].colors).toEqual(['PRETO', 'ROSADO']);
    expect(result.options[1].colors).toEqual(['PRATA']);
  });

  it('variante que repete o material da ficha COBRE a base — sem entrada duplicada', () => {
    const repete = { id: 'var-soft', material_name: 'NAPA SOFT', active: true, main_material_group_id: NAPA_SOFT.id };
    const result = buildSaleOrderMaterialOptions({
      sheet: S300_SHEET, variants: [repete, GLOW_VARIANT], products: PRODUCTS, groups: GROUPS,
    });
    expect(result.baseCoveredByVariant).toBe(true);
    expect(result.sheetMaterialSelectable).toBe(false);
    expect(result.options.map(o => o.variantId)).toEqual(['var-soft', 'var-glow']);
  });

  it('compara por GRUPO, não por nome: variante chamada "NAPA SOFT" que aponta GLOW não cobre', () => {
    const enganosa = { id: 'var-x', material_name: 'NAPA SOFT', active: true, main_material_group_id: GLOW.id };
    const result = buildSaleOrderMaterialOptions({
      sheet: S300_SHEET, variants: [enganosa], products: PRODUCTS, groups: GROUPS,
    });
    expect(result.baseCoveredByVariant).toBe(false);
    expect(result.options[0].variantId).toBeNull();
  });

  it('variante inativa não aparece no PV, então não entra nem cobre a base', () => {
    const inativa = { id: 'var-soft', material_name: 'NAPA SOFT', active: false, main_material_group_id: NAPA_SOFT.id };
    const result = buildSaleOrderMaterialOptions({
      sheet: S300_SHEET, variants: [inativa, GLOW_VARIANT], products: PRODUCTS, groups: GROUPS,
    });
    expect(result.baseCoveredByVariant).toBe(false);
    expect(result.options.map(o => o.variantId)).toEqual([null, 'var-glow']);
  });

  it('ficha sem grupo de material: só as variantes, sem padrão', () => {
    const result = buildSaleOrderMaterialOptions({
      sheet: { upper_material: '', lining_material: '' }, variants: [GLOW_VARIANT], products: PRODUCTS, groups: GROUPS,
    });
    expect(result.sheetBaseGroup).toBeNull();
    expect(result.sheetMaterialSelectable).toBe(false);
    expect(result.options.map(o => o.variantId)).toEqual(['var-glow']);
  });

  it('variante que não troca componente nenhum fica sem grupo e sem cores', () => {
    const result = buildSaleOrderMaterialOptions({
      sheet: { ...S300_SHEET, variant_drives_upper: false, variant_drives_lining: false },
      variants: [GLOW_VARIANT], products: PRODUCTS, groups: GROUPS,
    });
    const glow = result.options.find(o => o.variantId === 'var-glow');
    expect(glow?.group).toBeNull();
    expect(glow?.colors).toEqual([]);
  });
});

describe('listVariantSlotsKeptOnSheet', () => {
  it('S300 com as duas travas ligadas: a GLOW troca tudo, nada continua na ficha', () => {
    expect(listVariantSlotsKeptOnSheet({
      variant: GLOW_VARIANT, sheet: S300_SHEET, products: PRODUCTS,
    })).toEqual([]);
  });

  it('trava do forro desligada: a forração continua no material da ficha', () => {
    const kept = listVariantSlotsKeptOnSheet({
      variant: GLOW_VARIANT,
      sheet: { ...S300_SHEET, variant_drives_lining: false },
      products: PRODUCTS,
    });
    expect(kept.map(slot => [slot.key, slot.sheetMaterial])).toEqual([['lining', 'NAPA SOFT']]);
  });

  it('grupo próprio do slot troca mesmo com a trava desligada', () => {
    const kept = listVariantSlotsKeptOnSheet({
      variant: { ...GLOW_VARIANT, lining_material_group_id: GLOW.id },
      sheet: { ...S300_SHEET, variant_drives_lining: false },
      products: PRODUCTS,
    });
    expect(kept).toEqual([]);
  });

  it('pino em produto INATIVO não troca o slot (mesma regra dos motores)', () => {
    const kept = listVariantSlotsKeptOnSheet({
      variant: { main_material_group_id: null, upper_material_product_id: 'soft-inativo' },
      sheet: S300_SHEET,
      products: PRODUCTS,
    });
    expect(kept.map(slot => slot.key)).toEqual(['upper', 'lining']);
  });

  it('fachete só entra com solado fachetado, e só troca pela trava do fachete', () => {
    const sole = { soleIsFachetado: true, facheteGroupName: 'NAPA SOFT' };
    expect(listVariantSlotsKeptOnSheet({
      variant: GLOW_VARIANT, sheet: S300_SHEET, sole, products: PRODUCTS,
    }).map(slot => slot.key)).toEqual(['fachete']);
    expect(listVariantSlotsKeptOnSheet({
      variant: GLOW_VARIANT, sheet: { ...S300_SHEET, variant_drives_fachete: true }, sole, products: PRODUCTS,
    })).toEqual([]);
  });
});
