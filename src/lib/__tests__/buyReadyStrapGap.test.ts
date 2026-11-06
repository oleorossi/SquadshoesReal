import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  listBuyReadyStrapGaps,
  listOrderBuyReadyStrapGaps,
  purchasedReadyStrapProductForColor,
  strapLineNeedsBuyReadyHubCadastro,
  strapLineWantsBuyReady,
  type BuyReadyStrapGapCatalog,
} from '@/lib/buyReadyStrapGap';

const MEASURE = '00f07325-347b-4e65-90e6-fed33f70eacc';
const GROUP = 'c45ff936-5ac5-49b5-98c4-4aed5e10e82d';
const COLOR = '2528a440-d82d-43fe-8879-957737577912';
const OTHER_COLOR = 'dbeac393-08da-4547-80c9-c10d1d468ea8';
const PRODUCT = 'aefd6b27-aae9-448b-918e-7d6bd3dcd5d5';
const LINE = '3050c21b-d4ad-482d-a1da-7a951b880341';

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

describe('strapLineNeedsBuyReadyHubCadastro — D4/45600', () => {
  it('nunca trava o save por variante Hub (strass nem napa)', () => {
    expect(strapLineNeedsBuyReadyHubCadastro(buyReadyLine())).toBe(false);
    expect(strapLineNeedsBuyReadyHubCadastro(buyReadyLine({
      identity_basis: 'reference_base',
      identity_group_id: null,
      pv_origem: 'sku_acabado',
      group_id: GROUP,
    }))).toBe(false);
    expect(strapLineNeedsBuyReadyHubCadastro(null)).toBe(false);
  });

  it('strapLineWantsBuyReady ainda identifica strass na ficha', () => {
    expect(strapLineWantsBuyReady(buyReadyLine())).toBe(true);
    expect(strapLineWantsBuyReady(buyReadyLine({ identity_basis: 'reference_base' }))).toBe(false);
  });
});

describe('listBuyReadyStrapGaps', () => {
  it('strass sem variante Hub NÃO é lacuna (45600: prepare cria/acha SKU)', () => {
    expect(listBuyReadyStrapGaps([buyReadyLine()], catalog())).toEqual([]);
  });

  it('sku_acabado de napa NÃO é lacuna Hub (45300 so-registra)', () => {
    const gaps = listBuyReadyStrapGaps(
      [buyReadyLine({
        identity_basis: 'reference_base',
        identity_group_id: null,
        group_id: GROUP,
        pv_origem: 'sku_acabado',
      })],
      catalog(),
    );
    expect(gaps).toEqual([]);
  });
});

describe('purchasedReadyStrapProductForColor', () => {
  it('resolve produto único ativo em m no grupo/cor', () => {
    expect(purchasedReadyStrapProductForColor(catalog(), GROUP, COLOR)?.id).toBe(PRODUCT);
  });

  it('devolve nulo quando a cor não identifica um único acabado ativo', () => {
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

describe('listOrderBuyReadyStrapGaps', () => {
  it('não agrega lacunas Hub após 45600', () => {
    const gaps = listOrderBuyReadyStrapGaps(
      [
        {
          color: 'ROCHA',
          reference_id: 'ref-1',
          strap_colors: [buyReadyLine({ label: 'STRASS' })],
        },
      ],
      catalog(),
      null,
      new Map([['ref-1', 'DS20']]),
    );
    expect(gaps).toEqual([]);
  });
});

/**
 * A lacuna Hub deixou de bloquear o save (D4), mas o formulário ainda tem
 * o caminho de editor pra diagnóstico legado — o typecheck pega símbolo
 * indefinido; estes asserts travam que o CTA continua montável se algum
 * fluxo setar buyReadyGapTarget manualmente.
 */
describe('SaleOrderItemForm — caminho de cadastro Hub permanece montável', () => {
  const form = readFileSync(
    resolve(__dirname, '../../components/sale-orders/SaleOrderItemForm.tsx'),
    'utf8',
  );

  it('resolve a lacuna da própria linha técnica pelo UUID congelado', () => {
    expect(form).toMatch(
      /const buyReadyGap = lineId \? buyReadyGapByLineId\.get\(lineId\) : undefined;/,
    );
  });

  it('oferece o cadastro na própria linha quando houver gap', () => {
    expect(form).toContain('onClick={() => setBuyReadyGapTarget(buyReadyGap)}');
    expect(form).toMatch(/\{buyReadyGap && !hasBuyReadyVariant && \(/);
  });

  it('Comprar pronto do PV congela buy_ready sem abrir cadastro Hub', () => {
    expect(form).toContain('strapLineWantsBuyReady');
    expect(form).toContain("next === 'sku_acabado'");
    expect(form).toContain('Comprar pronto');
    expect(form).toContain('buyReadyStrapSourcing(strap, strapLineByKey.get(lineKey))');
    const lib = readFileSync(resolve(__dirname, '../strapSourcing.ts'), 'utf8');
    const body = lib.slice(lib.indexOf('export function buyReadyStrapSourcingFromPreview'));
    expect(body).toContain('strap_variant_id: null');
    expect(body).toContain('finished_product_id: null');
  });
});
