import { describe, expect, it } from 'vitest';
import { isStrapServiceOrder } from '@/lib/strapServiceOrderIdentity';

describe('isStrapServiceOrder', () => {
  it('reconhece tanto a linha canônica quanto os cabeçalhos legados', () => {
    expect(isStrapServiceOrder({ service_order_domain: 'strap' })).toBe(true);
    expect(isStrapServiceOrder({ is_canonical_strap: true })).toBe(true);
    expect(isStrapServiceOrder({ canonical_strap_recipe_id: 'recipe' })).toBe(true);
    expect(isStrapServiceOrder({ artisanal_recipe_id: 'legacy' })).toBe(true);
    expect(isStrapServiceOrder({ artisanal_output_meters: 12 })).toBe(true);
    expect(isStrapServiceOrder({ artisanal_output_color: ' PRETO ' })).toBe(true);
  });

  it('não classifica uma OS comum por campos vazios ou zeros', () => {
    expect(isStrapServiceOrder(undefined)).toBe(false);
    expect(isStrapServiceOrder({})).toBe(false);
    expect(isStrapServiceOrder({ service_order_domain: 'generic' })).toBe(false);
    expect(isStrapServiceOrder({
      artisanal_output_name: ' ',
      artisanal_output_color: '',
      artisanal_output_meters: 0,
      artisanal_for_order_meters: null,
      artisanal_stock_entry_done: false,
    })).toBe(false);
  });
});
