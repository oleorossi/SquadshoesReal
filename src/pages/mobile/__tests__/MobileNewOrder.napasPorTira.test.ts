import { describe, expect, it } from 'vitest';
import { resetMobileStrapsForMaterialChange, selectMobileStrapNapaColor } from '../MobileNewOrder';
import type { MobileStrapManifestReference } from '@/lib/mobile/strapOfflineManifest';

// Napas por tira no PV mobile (dono, grill de 11/10/2026). OB01: napa-base
// NAPA SOFT + variante GLOW METALIC; o manifesto de cada material traz as duas
// napas em `material_options`, a do material primeiro.
const LINE_A = '11111111-1111-4111-8111-111111111111';
const LINE_B = '22222222-2222-4222-8222-222222222222';
const GLOW = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SOFT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const COBRE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PRATA = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PRETO = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const VARIANT_GLOW = '99999999-9999-4999-8999-999999999999';

const shared = {
  identity_basis: 'reference_base' as const,
  identity_group_id: null,
  strap_type_id: '33333333-3333-4333-8333-333333333333',
  measure_id: '44444444-4444-4444-8444-444444444444',
  color_mode: 'select_on_order' as const,
  material_mode: 'follow_reference' as const,
  material_group_id: null,
  allowed_material_group_ids: [],
  consumption: 28,
};
const glowOption = { base_group_id: GLOW, base_group_name: 'GLOW METALIC', allowed_colors: [{ id: COBRE, name: 'COBRE' }, { id: PRATA, name: 'PRATA' }] };
const softOption = { base_group_id: SOFT, base_group_name: 'NAPA SOFT', allowed_colors: [{ id: PRETO, name: 'PRETO' }, { id: COBRE, name: 'COBRE' }] };
const manifestFor = (variantId: string | null): MobileStrapManifestReference => {
  const options = variantId ? [glowOption, softOption] : [softOption, glowOption];
  return {
    reference_id: 'ref-ob01',
    material_variant_id: variantId,
    lines: [LINE_A, LINE_B].map((id, index) => ({
      ...shared,
      technical_strap_line_id: id,
      label: `TIRA ${index + 1}`,
      position: index + 1,
      base_group_id: options[0].base_group_id,
      base_group_name: options[0].base_group_name,
      allowed_colors: options[0].allowed_colors,
      material_options: options,
    })),
  };
};
const draft = (straps: Array<{ base: string | null; color: string; colorId: string | null }>) => ({
  reference_id: 'ref-ob01', reference_name: 'OB01', color: 'COBRE', grade: { '36': 2 }, unit_price: 19.7,
  material_variant_id: VARIANT_GLOW,
  strap_colors: [LINE_A, LINE_B].map((id, index) => ({
    ...shared,
    id,
    technical_strap_line_id: id,
    label: `TIRA ${index + 1}`,
    base_group_id: straps[index].base,
    base_group_name: straps[index].base === SOFT ? 'NAPA SOFT' : straps[index].base === GLOW ? 'GLOW METALIC' : null,
    color: straps[index].color,
    color_id: straps[index].colorId,
  })),
  strap_sourcing: {},
});

describe('PV mobile — napa escolhida por tira', () => {
  it('grava napa e cor juntas, só entre as napas do manifesto', () => {
    const item = draft([{ base: null, color: 'COBRE', colorId: COBRE }, { base: null, color: 'COBRE', colorId: COBRE }]);
    const next = selectMobileStrapNapaColor(item, LINE_B, SOFT, PRETO, manifestFor(VARIANT_GLOW));
    expect(next.strap_colors[1]).toMatchObject({ base_group_id: SOFT, base_group_name: 'NAPA SOFT', color: 'PRETO', color_id: PRETO });
    expect(next.strap_colors[0]).toBe(item.strap_colors[0]);
    // Cor que não existe na napa escolhida, ou napa fora da lista: não mexe.
    expect(selectMobileStrapNapaColor(item, LINE_B, GLOW, PRETO, manifestFor(VARIANT_GLOW))).toBe(item);
    expect(selectMobileStrapNapaColor(item, LINE_B, PRETO, PRETO, manifestFor(VARIANT_GLOW))).toBe(item);
  });

  it('troca de material: a tira na napa antiga acompanha, a trocada à mão fica (Q5)', () => {
    const item = draft([
      { base: GLOW, color: 'COBRE', colorId: COBRE },
      { base: SOFT, color: 'PRETO', colorId: PRETO },
    ]);
    const reset = resetMobileStrapsForMaterialChange(item, '', {
      previous: manifestFor(VARIANT_GLOW),
      next: manifestFor(null),
    });
    // TIRA 1 estava no GLOW (material antigo): passa a seguir o item e mantém
    // COBRE porque a cor existe na NAPA SOFT.
    expect(reset.strap_colors[0]).toMatchObject({ base_group_id: null, color: 'COBRE', color_id: COBRE });
    // TIRA 2 foi trocada à mão para NAPA SOFT: fica.
    expect(reset.strap_colors[1]).toMatchObject({ base_group_id: SOFT, color: 'PRETO', color_id: PRETO });
    expect(reset.keptNapas).toBe(1);
  });

  it('troca de material: a cor que não existe na napa nova esvazia', () => {
    const item = draft([
      { base: GLOW, color: 'PRATA', colorId: PRATA },
      { base: null, color: 'COBRE', colorId: COBRE },
    ]);
    const reset = resetMobileStrapsForMaterialChange(item, '', {
      previous: manifestFor(VARIANT_GLOW),
      next: manifestFor(null),
    });
    expect(reset.strap_colors[0]).toMatchObject({ base_group_id: null, color: '', color_id: null });
    expect(reset.strap_colors[1]).toMatchObject({ base_group_id: null, color: 'COBRE', color_id: COBRE });
    expect(reset.keptNapas).toBe(0);
  });
});
