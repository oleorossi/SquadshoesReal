import { describe, expect, it } from 'vitest';
import {
  listBuyReadyStrapGaps,
  purchasedReadyStrapProductForColor,
  type BuyReadyStrapGapCatalog,
} from '@/lib/buyReadyStrapGap';

const MEASURE = '00f07325-347b-4e65-90e6-fed33f70eacc';
const GROUP = 'c45ff936-5ac5-49b5-98c4-4aed5e10e82d';
const COLOR = '2528a440-d82d-43fe-8879-957737577912';
const OTHER_COLOR = 'dbeac393-08da-4547-80c9-c10d1d468ea8';
const PRODUCT = 'aefd6b27-aae9-448b-918e-7d6bd3dcd5d5';
const LINE = '3050c21b-d4ad-482d-a1da-7a951b880341';
const REVIEW = 'dfc04be1-8892-4ac9-812d-ffa3769808ec';

const catalog = (overrides: Partial<BuyReadyStrapGapCatalog> = {}): BuyReadyStrapGapCatalog => ({
  colors: [
    { id: COLOR, name: 'PRETO COM FUNDO PRETO', active: true },
    { id: OTHER_COLOR, name: 'CRISTAL COM FUNDO BRANCO', active: true },
  ],
  aliases: [],
  official_products: [],
  products: [{
    id: PRODUCT,
    name: 'Tira Strass 6mm Preto com fundo preto',
    group_id: GROUP,
    color: 'PRETO COM FUNDO PRETO',
    unit: 'm',
    active: true,
  }],
  variants: [],
  ...overrides,
});

const buyReadyLine = (overrides: Record<string, unknown> = {}) => ({
  technical_strap_line_id: LINE,
  identity_basis: 'finished_product_group' as const,
  identity_group_id: GROUP,
  measure_id: MEASURE,
  color_id: COLOR,
  label: 'TIRA 1',
  group_name: 'TIRA STRASS 6MM',
  ...overrides,
});

const activeVariant = (overrides: Record<string, unknown> = {}) => ({
  measure_id: MEASURE,
  base_group_id: GROUP,
  identity_basis: 'finished_product_group' as const,
  internal_production_enabled: false,
  color_id: COLOR,
  purchase_enabled: true,
  status: 'active',
  ...overrides,
});

describe('listBuyReadyStrapGaps', () => {
  it('aponta a linha comprada pronta sem variante comercial ativa', () => {
    const gaps = listBuyReadyStrapGaps([buyReadyLine()], catalog());
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      lineId: LINE,
      label: 'TIRA 1',
      measureId: MEASURE,
      identityGroupId: GROUP,
      colorId: COLOR,
      colorName: 'PRETO COM FUNDO PRETO',
      finishedProductId: PRODUCT,
      reviewId: null,
    });
  });

  it('não aponta lacuna quando a variante exata já está ativa', () => {
    const gaps = listBuyReadyStrapGaps(
      [buyReadyLine()],
      catalog({ variants: [activeVariant()] }),
    );
    expect(gaps).toEqual([]);
  });

  it.each([
    ['status não ativo', activeVariant({ status: 'review_required' })],
    ['outra medida', activeVariant({ measure_id: '11111111-1111-4111-8111-111111111111' })],
    ['outro grupo', activeVariant({ base_group_id: '22222222-2222-4222-8222-222222222222' })],
    ['outra cor', activeVariant({ color_id: OTHER_COLOR })],
    ['compra desabilitada', activeVariant({ purchase_enabled: false })],
    ['produção interna habilitada', activeVariant({ internal_production_enabled: true })],
    ['identidade por napa da referência', activeVariant({ identity_basis: 'reference_base' })],
  ])('variante com %s não satisfaz a exigência do PV', (_label, variant) => {
    const gaps = listBuyReadyStrapGaps([buyReadyLine()], catalog({ variants: [variant] }));
    expect(gaps).toHaveLength(1);
  });

  it('ignora a linha artesanal por napa da referência', () => {
    const gaps = listBuyReadyStrapGaps(
      [buyReadyLine({ identity_basis: 'reference_base', identity_group_id: null })],
      catalog(),
    );
    expect(gaps).toEqual([]);
  });

  it.each([
    ['sem UUID técnico', { technical_strap_line_id: null }],
    ['sem medida', { measure_id: null }],
    ['sem grupo acabado', { identity_group_id: null }],
    ['sem cor canônica', { color_id: null }],
  ])('%s tem mensagem própria na tela e não vira lacuna comercial', (_label, patch) => {
    const gaps = listBuyReadyStrapGaps([buyReadyLine(patch)], catalog());
    expect(gaps).toEqual([]);
  });

  it('anexa o review de migração do produto exato', () => {
    const gaps = listBuyReadyStrapGaps([buyReadyLine()], catalog(), [{
      issue_code: 'migration_review_item_required',
      entity_id: REVIEW,
      details: {
        entity_type: 'buy_ready_strap_product',
        action_required: 'create_variant_with_bundle',
        review_id: REVIEW,
        required_finished_product_id: PRODUCT,
      },
    }]);
    expect(gaps[0].reviewId).toBe(REVIEW);
  });

  it('não reaproveita o review de outro produto', () => {
    const gaps = listBuyReadyStrapGaps([buyReadyLine()], catalog(), [{
      issue_code: 'migration_review_item_required',
      entity_id: REVIEW,
      details: {
        entity_type: 'buy_ready_strap_product',
        action_required: 'create_variant_with_bundle',
        review_id: REVIEW,
        required_finished_product_id: '9962fc0e-e95c-4e0a-8162-1a21c79f64dc',
      },
    }]);
    expect(gaps[0].reviewId).toBeNull();
  });

  it('devolve produto nulo quando a cor não identifica um único acabado ativo', () => {
    const ambiguous = catalog({
      products: [
        {
          id: PRODUCT,
          name: 'A',
          group_id: GROUP,
          color: 'PRETO COM FUNDO PRETO',
          unit: 'm',
          active: true,
        },
        {
          id: '9028a544-5de5-4798-a37b-edc3b51e82f3',
          name: 'B',
          group_id: GROUP,
          color: 'PRETO COM FUNDO PRETO',
          unit: 'm',
          active: true,
        },
      ],
    });
    expect(purchasedReadyStrapProductForColor(ambiguous, GROUP, COLOR)).toBeNull();
    expect(listBuyReadyStrapGaps([buyReadyLine()], ambiguous)[0].finishedProductId).toBeNull();
  });

  it('exige unidade-base m no produto acabado', () => {
    const wrongUnit = catalog({
      products: [{
        id: PRODUCT,
        name: 'Tira em unidade errada',
        group_id: GROUP,
        color: 'PRETO COM FUNDO PRETO',
        unit: 'un',
        active: true,
      }],
    });
    expect(purchasedReadyStrapProductForColor(wrongUnit, GROUP, COLOR)).toBeNull();
  });

  it('resolve a cor do produto por alias aprovado', () => {
    const aliased = catalog({
      products: [{
        id: PRODUCT,
        name: 'Preto fundo preto',
        group_id: GROUP,
        color: 'PRETO C/ FUNDO PRETO',
        unit: 'm',
        active: true,
      }],
      aliases: [{
        canonical_color_id: COLOR,
        alias: 'PRETO C/ FUNDO PRETO',
        status: 'approved',
      }],
    });
    expect(purchasedReadyStrapProductForColor(aliased, GROUP, COLOR)?.id).toBe(PRODUCT);
  });
});
