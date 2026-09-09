import { describe, expect, it } from 'vitest';
import {
  EMPTY_VARIANT_CASCADE,
  evaluateUpperMaterialStructureCompatibility,
  hasVariantComponentPin,
  listVariantCascadeSlots,
  nonColorSourceLayerSignature,
  resolvePinnedMaterialGroupId,
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
  const products: never[] = [];

  it('acusa o no-op: material principal sem componente liberado', () => {
    expect(variantDrivesNoComponent({ variant: {}, sheet: sr02, cascade, products })).toBe(true);
  });

  it('não acusa quando o componente foi liberado', () => {
    expect(variantDrivesNoComponent({
      variant: {}, sheet: sr02, cascade: { ...cascade, lining: true }, products,
    })).toBe(false);
  });

  it('trava ligada em componente que a ficha não consome continua sendo no-op', () => {
    expect(variantDrivesNoComponent({
      variant: {}, sheet: sr02, cascade: { ...cascade, upper: true }, products,
    })).toBe(true);
  });

  it('exceção por componente resolve sozinha — vence a trava da ficha', () => {
    expect(variantDrivesNoComponent({
      variant: { lining_material_group_id: 'glow' }, sheet: sr02, cascade, products,
    })).toBe(false);
    expect(variantDrivesNoComponent({
      variant: { insole_material_group_id: 'eva' }, sheet: sr02, cascade, products,
    })).toBe(false);
  });

  // ⚠ Regressão do PR #146: `variant_drives_fachete` gravado na ficha liberava
  // o save mesmo com cabedal e forração desmarcados, porque o guard saía cedo.
  // A caixa independente da aba Materiais tornava esse estado alcançável.
  it('fachete gravado na ficha NÃO libera o save por si só', () => {
    expect(variantDrivesNoComponent({
      variant: {}, sheet: { ...sr02, variant_drives_fachete: true }, cascade, products,
    })).toBe(true);
  });

  it('fachete SELECIONADO em solado fachetado libera, como qualquer slot', () => {
    expect(variantDrivesNoComponent({
      variant: {}, sheet: sr02, sole: fachetado, cascade: { ...cascade, fachete: true }, products,
    })).toBe(false);
  });

  it('fachete selecionado sem solado fachetado não conta — o slot nem existe', () => {
    expect(variantDrivesNoComponent({
      variant: {}, sheet: sr02, cascade: { ...cascade, fachete: true }, products,
    })).toBe(true);
  });

  it('pin inativo sozinho continua sendo no-op', () => {
    expect(variantDrivesNoComponent({
      variant: { upper_material_product_id: 'p-inativo' },
      sheet: sr02,
      cascade,
      products: [{ id: 'p-inativo', group_id: 'grupo-antigo', active: false }],
    })).toBe(true);
  });
});

describe('hasVariantComponentPin', () => {
  it('reconhece pin de produto legado e pin de grupo', () => {
    const catalog = [{ id: 'p1', group_id: 'g-pin', active: true }];
    expect(hasVariantComponentPin({ upper_material_product_id: 'p1' }, catalog)).toBe(true);
    expect(hasVariantComponentPin({ lining_material_group_id: 'g1' }, catalog)).toBe(true);
    expect(hasVariantComponentPin({ main_material_group_id: 'g1' } as never, catalog)).toBe(false);
    expect(hasVariantComponentPin(null, catalog)).toBe(false);
  });

  it('ignora pin de produto inativo quando o catálogo foi carregado', () => {
    const catalog = [{ id: 'p1', group_id: 'antigo', active: false }];
    expect(hasVariantComponentPin({ upper_material_product_id: 'p1' }, catalog)).toBe(false);
    expect(hasVariantComponentPin({
      upper_material_product_id: 'p1',
      upper_material_group_id: 'grupo-ativo',
    }, catalog)).toBe(true);
  });
});

describe('compatibilidade estrutural do Cabedal da variante', () => {
  const baseComposto = [
    {
      component_group_id: 'napa-soft',
      component_label: 'Napa Soft',
      role: 'cabedal',
      is_color_source: true,
    },
    {
      component_group_id: 'massabox',
      component_label: 'Massa Box',
      role: 'estrutura',
      is_color_source: false,
    },
  ];

  it('aceita composto que troca a fonte de cor e preserva as camadas fixas', () => {
    const result = evaluateUpperMaterialStructureCompatibility({
      baseLayers: baseComposto,
      overrideLayers: [
        {
          component_group_id: 'glow-metalic',
          component_label: 'Glow Metalic',
          role: 'cabedal',
          is_color_source: true,
        },
        {
          component_group_id: 'massabox',
          component_label: 'outro rótulo não governa a identidade',
          role: 'outro papel também não governa quando há UUID',
          is_color_source: false,
        },
      ],
      hasExplicitOverride: true,
    });

    expect(result).toMatchObject({ baseIsComposite: true, compatible: true });
    expect(result.baseSignature).toEqual(['group:massabox']);
    expect(result.overrideSignature).toEqual(['group:massabox']);
  });

  it('rejeita composto que perde ou troca uma camada fixa', () => {
    expect(evaluateUpperMaterialStructureCompatibility({
      baseLayers: baseComposto,
      overrideLayers: [{
        component_group_id: 'glow-metalic',
        component_label: 'Glow Metalic',
        role: 'cabedal',
        is_color_source: true,
      }],
      hasExplicitOverride: true,
    })).toMatchObject({ baseIsComposite: true, compatible: false });

    expect(evaluateUpperMaterialStructureCompatibility({
      baseLayers: baseComposto,
      overrideLayers: [{
        component_group_id: 'espuma',
        component_label: 'Espuma',
        role: 'estrutura',
        is_color_source: false,
      }],
      hasExplicitOverride: true,
    })).toMatchObject({ baseIsComposite: true, compatible: false });
  });

  it('rejeita grupo puro mesmo quando a assinatura fixa vazia pareceria coincidir', () => {
    expect(evaluateUpperMaterialStructureCompatibility({
      baseLayers: baseComposto,
      overrideLayers: [],
      hasExplicitOverride: true,
    })).toMatchObject({
      baseIsComposite: true,
      overrideIsComposite: false,
      compatible: false,
    });
  });

  it('mantém ficha simples livre para qualquer override explícito', () => {
    expect(evaluateUpperMaterialStructureCompatibility({
      baseLayers: [],
      overrideLayers: [],
      hasExplicitOverride: true,
    })).toMatchObject({ baseIsComposite: false, compatible: true });
  });

  it('usa label normalizado + role somente como fallback sem component_group_id', () => {
    expect(nonColorSourceLayerSignature([{
      component_group_id: null,
      component_label: '  MASSA   BÓX ',
      role: ' Estrutura ',
      is_color_source: false,
    }])).toEqual(['fallback:massa box|estrutura']);

    expect(evaluateUpperMaterialStructureCompatibility({
      baseLayers: [{
        component_group_id: null,
        component_label: 'Massa Bóx',
        role: 'Estrutura',
        is_color_source: false,
      }],
      overrideLayers: [{
        component_group_id: null,
        component_label: ' massa box ',
        role: 'estrutura',
        is_color_source: false,
      }],
      hasExplicitOverride: true,
    })).toMatchObject({ baseIsComposite: true, compatible: true });
  });

  it('resolve o grupo do produto pinado antes do grupo selecionado', () => {
    expect(resolvePinnedMaterialGroupId({
      productId: 'produto-composto',
      groupId: 'grupo-puro',
      products: [{ id: 'produto-composto', group_id: 'grupo-composto', active: true }],
    })).toBe('grupo-composto');
  });

  it('ignora produto pinado inativo e continua pelo grupo selecionado', () => {
    expect(resolvePinnedMaterialGroupId({
      productId: 'produto-inativo',
      groupId: 'grupo-fallback',
      products: [{ id: 'produto-inativo', group_id: 'grupo-antigo', active: false }],
    })).toBe('grupo-fallback');
  });
});
