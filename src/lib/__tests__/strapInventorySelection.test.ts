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
});
