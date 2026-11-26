import { describe, expect, it } from 'vitest';
import {
  applyStockStrapGroupToLine,
  hasTechnicalStrapLineIdentity,
  isStrapInventorySelectableGroup,
  resolveHubMeasureForStockGroup,
} from '@/lib/strapInventorySelection';
import type { StrapInventoryCatalogLike } from '@/lib/strapInventorySelection';

const ELASTICO_TYPE = 'type-elastico';
const ELASTICO_MEASURE = 'measure-25';
const LEAF_25 = 'a25b0000-7c52-4776-958f-fb49e7835925';
const LINE_ID = '0198f35c-7f4d-7000-8000-000000000001';

const catalog: StrapInventoryCatalogLike = {
  types: [{ id: ELASTICO_TYPE, name: 'ELÁSTICO ESPECIAL G', active: true }],
  measures: [{
    id: ELASTICO_MEASURE,
    strap_type_id: ELASTICO_TYPE,
    active: true,
    finished_width_mm: 25,
    origem_padrao: 'sempre_sku_acabado',
    display_name: '25 mm',
  }],
};

describe('strapInventorySelection', () => {
  it('aceita folha estreita linear mesmo sem flag is_artisanal_strap', () => {
    expect(isStrapInventorySelectableGroup({
      id: LEAF_25,
      name: '25MM',
      dimensions_width: 25,
      consumption_unit: 'm',
    }, new Set())).toBe(true);
  });

  it('rejeita bobina de napa (>= 400 mm)', () => {
    expect(isStrapInventorySelectableGroup({
      id: 'napa',
      name: 'NAPA SOFT',
      dimensions_width: 1370,
      consumption_unit: 'm',
    }, new Set())).toBe(false);
  });

  it('casa medida Hub pela família + bitola', () => {
    const measure = resolveHubMeasureForStockGroup(
      { id: LEAF_25, name: '25MM', dimensions_width: 25 },
      'ELÁSTICO ESPECIAL G',
      catalog,
    );
    expect(measure?.id).toBe(ELASTICO_MEASURE);
  });

  it('aplica grupo de estoque como buy-ready e preenche measure_id', () => {
    const line = applyStockStrapGroupToLine(
      { technical_strap_line_id: LINE_ID, id: LINE_ID, label: 'TIRA 2' },
      { id: LEAF_25, name: '25MM', dimensions_width: 25, consumption_unit: 'm' },
      'ELÁSTICO ESPECIAL G › 25MM',
      catalog,
      'ELÁSTICO ESPECIAL G',
    );
    expect(line).toMatchObject({
      group_id: LEAF_25,
      group_name: 'ELÁSTICO ESPECIAL G › 25MM',
      identity_basis: 'finished_product_group',
      identity_group_id: LEAF_25,
      measure_id: ELASTICO_MEASURE,
      strap_type_id: ELASTICO_TYPE,
      color_mode: 'select_on_order',
      internal_production_enabled: false,
    });
    expect(hasTechnicalStrapLineIdentity(
      line,
      [...catalog.measures],
      [...catalog.types],
    )).toBe(true);
  });

  it('aceita buy-ready só com grupo de estoque, sem Hub', () => {
    const line = applyStockStrapGroupToLine(
      { technical_strap_line_id: LINE_ID, id: LINE_ID, label: 'TIRA 2' },
      { id: LEAF_25, name: '25MM', dimensions_width: 25, consumption_unit: 'm' },
      'ELÁSTICO ESPECIAL G › 25MM',
      null,
      'ELÁSTICO ESPECIAL G',
    );
    expect(line).toMatchObject({
      measure_id: null,
      identity_group_id: LEAF_25,
    });
    expect(hasTechnicalStrapLineIdentity(line, [], [])).toBe(true);
  });

  it('Strass sem largura no cadastro, origem comprar_pronto, casa a medida pelo nome', () => {
    const strassType = 'type-strass';
    const strassMeasure = 'measure-15';
    const groupId = '6e43bbda-0f1f-412c-8d4a-ec009114530d';
    const strassCatalog: StrapInventoryCatalogLike = {
      types: [{ id: strassType, name: 'TIRA STRASS', active: true }],
      measures: [{
        id: strassMeasure,
        strap_type_id: strassType,
        active: true,
        finished_width_mm: 15,
        origem_padrao: 'sempre_sku_acabado',
        display_name: '15 mm',
      }],
    };
    const group = {
      id: groupId,
      name: 'TIRA STRASS 15MM',
      dimensions_width: 0,
      strap_origin: 'comprar_pronto' as const,
      strap_uses_napa: false,
      is_artisanal_strap: true,
    };
    expect(isStrapInventorySelectableGroup(group, new Set())).toBe(true);
    expect(resolveHubMeasureForStockGroup(group, null, strassCatalog)?.id).toBe(strassMeasure);
    const line = applyStockStrapGroupToLine(
      { technical_strap_line_id: LINE_ID, id: LINE_ID, label: 'TIRA 1' },
      group,
      'COMPONENTES › TIRA STRASS 15MM',
      strassCatalog,
      'COMPONENTES',
    );
    expect(line).toMatchObject({
      group_id: groupId,
      identity_basis: 'finished_product_group',
      identity_group_id: groupId,
      measure_id: strassMeasure,
      strap_type_id: strassType,
      color_mode: 'select_on_order',
      internal_production_enabled: false,
    });
  });

  it('strap_uses_napa=false força tira pronta mesmo sem origem no grupo', () => {
    const groupId = 'c45ff936-5ac5-49b5-98c4-4aed5e10e82d';
    const line = applyStockStrapGroupToLine(
      { technical_strap_line_id: LINE_ID, id: LINE_ID, label: 'TIRA 1' },
      { id: groupId, name: 'TIRA STRASS 6MM', dimensions_width: 0, strap_uses_napa: false },
      'TIRA STRASS 6MM',
      null,
    );
    expect(line).toMatchObject({
      identity_basis: 'finished_product_group',
      identity_group_id: groupId,
      measure_id: null,
      internal_production_enabled: false,
    });
  });
});
