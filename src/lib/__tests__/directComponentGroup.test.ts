import { describe, expect, it } from 'vitest';
import {
  directComponentGroupIds,
  emptyDirectComponentLine,
  isGroupOnlyDirectComponent,
} from '@/lib/directComponentGroup';

describe('directComponentGroup', () => {
  it('empty line is group-ready without product pin', () => {
    const line = emptyDirectComponentLine();
    expect(line.product_id).toBeNull();
    expect(line.group_id).toBeNull();
    expect(line.consumption_sector).toBe('Aviamento');
  });

  it('isGroupOnlyDirectComponent requires group and no product', () => {
    expect(isGroupOnlyDirectComponent({ group_id: 'g1', product_id: null })).toBe(true);
    expect(isGroupOnlyDirectComponent({ group_id: 'g1', product_id: 'p1' })).toBe(false);
    expect(isGroupOnlyDirectComponent({ product_id: 'p1' })).toBe(false);
  });

  it('directComponentGroupIds usa group_id ou mapa de produto', () => {
    const map = new Map([['p1', 'g-from-prod']]);
    expect(
      directComponentGroupIds(
        [
          { group_id: 'g1', quantity: 2 },
          { product_id: 'p1', quantity: 1 },
          { product_id: 'orphan', quantity: 1 },
        ],
        map,
      ),
    ).toEqual(['g1', 'g-from-prod']);
  });
});
