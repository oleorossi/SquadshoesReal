import { describe, expect, it } from 'vitest';
import {
  EMPTY_VARIANT_CASCADE,
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
/** Solado fachetado com grupo próprio de fachete cadastrado. */
const fachetado = { soleIsFachetado: true, facheteGroupName: 'NAPA SUDANI' };

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

  // ── Fachete ───────────────────────────────────────────────────────────────
  it('só emite o fachete quando o SOLADO é fachetado', () => {
    expect(listVariantCascadeSlots(sr02).map(s => s.key)).toEqual(['lining']);
    expect(listVariantCascadeSlots(sr02, { soleIsFachetado: false }).map(s => s.key)).toEqual(['lining']);
    expect(listVariantCascadeSlots(sr02, fachetado).map(s => s.key)).toEqual(['lining', 'fachete']);
  });

  it('fachete sem grupo próprio cai no forro da ficha', () => {
    const [, fachete] = listVariantCascadeSlots(sr02, { soleIsFachetado: true });
    expect(fachete).toMatchObject({
      key: 'fachete', sheetMaterial: 'NAPA SOFT', drivesField: 'variant_drives_fachete',
    });
  });

  it('fachete sem grupo próprio E sem forro na ficha não vira slot fantasma', () => {
    expect(listVariantCascadeSlots(
      { upper_material: 'PALHA', lining_material: '' },
      { soleIsFachetado: true },
    ).map(s => s.key)).toEqual(['upper']);
  });
});

describe('seedVariantCascade', () => {
  it('liga o único componente possível quando a ficha nunca foi configurada', () => {
    expect(seedVariantCascade(sr02)).toEqual({ upper: false, lining: true, fachete: false });
  });

  it('não escolhe por conta própria quando há dois componentes', () => {
    expect(seedVariantCascade(doisSlots)).toEqual(EMPTY_VARIANT_CASCADE);
  });

  it('solado fachetado transforma ficha de 1 slot em 2 — e aí não decide sozinho', () => {
    // Sem o fachete a SR02 seria auto-marcada; com ele passam a ser duas
    // decisões, e nenhuma pode ser tomada por palpite.
    expect(seedVariantCascade(sr02, fachetado)).toEqual(EMPTY_VARIANT_CASCADE);
  });

  it('preserva o que a ficha já tem gravado', () => {
    expect(seedVariantCascade({ ...doisSlots, variant_drives_upper: true }))
      .toEqual({ upper: true, lining: false, fachete: false });
    expect(seedVariantCascade({ ...sr02, variant_drives_fachete: true }, fachetado))
      .toEqual({ upper: false, lining: false, fachete: true });
  });
});

describe('variantDrivesNoComponent', () => {
  const cascade = EMPTY_VARIANT_CASCADE;

  it('acusa o no-op: material principal sem componente liberado', () => {
    expect(variantDrivesNoComponent({ variant: {}, sheet: sr02, cascade })).toBe(true);
  });

  it('não acusa quando o componente foi liberado', () => {
    expect(variantDrivesNoComponent({
      variant: {}, sheet: sr02, cascade: { ...cascade, lining: true },
    })).toBe(false);
  });

  it('trava ligada em componente que a ficha não consome continua sendo no-op', () => {
    expect(variantDrivesNoComponent({
      variant: {}, sheet: sr02, cascade: { ...cascade, upper: true },
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

  // ⚠ Regressão do PR #146: `variant_drives_fachete` gravado na ficha liberava
  // o save mesmo com cabedal e forração desmarcados, porque o guard saía cedo.
  // A caixa independente da aba Materiais tornava esse estado alcançável.
  it('fachete gravado na ficha NÃO libera o save por si só', () => {
    expect(variantDrivesNoComponent({
      variant: {}, sheet: { ...sr02, variant_drives_fachete: true }, cascade,
    })).toBe(true);
  });

  it('fachete SELECIONADO em solado fachetado libera, como qualquer slot', () => {
    expect(variantDrivesNoComponent({
      variant: {}, sheet: sr02, sole: fachetado, cascade: { ...cascade, fachete: true },
    })).toBe(false);
  });

  it('fachete selecionado sem solado fachetado não conta — o slot nem existe', () => {
    expect(variantDrivesNoComponent({
      variant: {}, sheet: sr02, cascade: { ...cascade, fachete: true },
    })).toBe(true);
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
