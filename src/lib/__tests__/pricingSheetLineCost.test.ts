import { describe, expect, it } from 'vitest';
import {
  allowsDraftMaterials,
  isUnlinkedDraftMaterial,
  pricingLineCostPerPair,
  sumActivePricingLines,
} from '@/lib/pricingSheetLineCost';

describe('pricingSheetLineCost', () => {
  it('allows draft materials only in rascunho and em_revisao', () => {
    expect(allowsDraftMaterials('rascunho')).toBe(true);
    expect(allowsDraftMaterials('em_revisao')).toBe(true);
    expect(allowsDraftMaterials('validada')).toBe(false);
    expect(allowsDraftMaterials('publicada')).toBe(false);
  });

  it('uses fixed_per_pair for kit / ajuste lines', () => {
    expect(pricingLineCostPerPair({
      cost_mode: 'fixed_per_pair',
      cost_per_pair: 1.07,
      quantity_per_unit: 1,
      is_active: true,
    })).toBe(1.07);

    expect(pricingLineCostPerPair({
      line_kind: 'ajuste',
      cost_per_pair: 0.6,
      is_active: true,
    })).toBe(0.6);
  });

  it('uses consumo × preço do estoque ou estimado', () => {
    expect(pricingLineCostPerPair({
      cost_mode: 'consumo_x_preco',
      quantity_per_unit: 2,
      product_id: 'p1',
      products: { unit_price: 0.39 },
      is_active: true,
    })).toBeCloseTo(0.78);

    expect(pricingLineCostPerPair({
      cost_mode: 'consumo_x_preco',
      quantity_per_unit: 0.5,
      estimated_unit_price: 10,
      is_active: true,
    })).toBe(5);
  });

  it('ignores inactive lines in totals and publish gate', () => {
    expect(pricingLineCostPerPair({ cost_per_pair: 9, cost_mode: 'fixed_per_pair', is_active: false })).toBe(0);
    expect(isUnlinkedDraftMaterial({ line_kind: 'material', product_id: null, is_active: false })).toBe(false);
    expect(isUnlinkedDraftMaterial({ line_kind: 'ajuste', product_id: null, is_active: true })).toBe(false);
    expect(isUnlinkedDraftMaterial({ line_kind: 'material', product_id: null, is_active: true })).toBe(true);
  });

  it('sums active lines like TOTAL CUSTO M.P.', () => {
    const total = sumActivePricingLines([
      { cost_mode: 'fixed_per_pair', cost_per_pair: 1.07, is_active: true },
      { cost_mode: 'fixed_per_pair', cost_per_pair: 1.9, is_active: true },
      { line_kind: 'ajuste', cost_per_pair: 0.6, is_active: true },
      { cost_mode: 'fixed_per_pair', cost_per_pair: 99, is_active: false },
    ]);
    expect(total).toBeCloseTo(3.57);
  });
});
