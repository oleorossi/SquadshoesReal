import { describe, expect, it } from 'vitest';
import {
  directComponentGroupIds,
  directComponentProductIds,
  emptyDirectComponentLine,
  isGroupOnlyDirectComponent,
  isValidDirectComponentProductId,
  validateDirectComponentsForSave,
} from '@/lib/directComponentGroup';

describe('directComponentGroup', () => {
  it('empty line starts without product pin (save must block)', () => {
    const line = emptyDirectComponentLine();
    expect(line.product_id).toBeNull();
    expect(line.group_id).toBeNull();
    expect(line.consumption_sector).toBe('Aviamento');
  });

  it('isValidDirectComponentProductId exige UUID', () => {
    expect(isValidDirectComponentProductId('5c7fe145-9b5a-4144-8c73-7d2b0c23466f')).toBe(true);
    expect(isValidDirectComponentProductId('')).toBe(false);
    expect(isValidDirectComponentProductId(null)).toBe(false);
    expect(isValidDirectComponentProductId('not-a-uuid')).toBe(false);
  });

  it('validateDirectComponentsForSave exige product_id em toda linha', () => {
    expect(validateDirectComponentsForSave([])).toBeNull();
    expect(validateDirectComponentsForSave([
      { product_id: '5c7fe145-9b5a-4144-8c73-7d2b0c23466f', quantity: 2 },
    ])).toBeNull();
    expect(validateDirectComponentsForSave([
      { group_id: 'g1', group_name: 'ELÁSTICO SARJA', product_id: null, quantity: 1 },
    ])).toMatch(/ELÁSTICO SARJA/);
  });

  it('directComponentProductIds lista só UUIDs', () => {
    expect(directComponentProductIds([
      { product_id: '5c7fe145-9b5a-4144-8c73-7d2b0c23466f' },
      { product_id: null },
      { product_id: 'lixo' },
    ])).toEqual(['5c7fe145-9b5a-4144-8c73-7d2b0c23466f']);
  });

  it('isGroupOnlyDirectComponent (legado) requires group and no product', () => {
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
