import { describe, expect, it } from 'vitest';
import type { ProductGroup } from '@/hooks/useGroups';
import type { GroupStockRollup } from '@/hooks/useGroupOrganization';
import { buildGroupMetrics, buildSectorTree } from '@/lib/groupRollup';

const group = (value: Partial<ProductGroup> & Pick<ProductGroup, 'id' | 'name'>): ProductGroup => ({
  sector: 'Cabedal',
  parent_group_id: null,
  ...value,
} as ProductGroup);

describe('famílias técnicas explícitas', () => {
  it('mantém uma família vazia no nível de família da árvore', () => {
    const family = group({ id: 'family', name: 'LAMINADOS SINTÉTICOS', is_family: true });
    const tree = buildSectorTree([family]);

    const cabedal = tree.find((sector) => sector.sector === 'Cabedal');
    expect(cabedal?.families).toEqual([{ family, children: [] }]);
    expect(cabedal?.looseLeaves).toEqual([]);
    expect(tree).toHaveLength(9);
  });

  it('não trata família vazia como grupo-folha de estoque', () => {
    const family = group({ id: 'family', name: 'COUROS', is_family: true });
    const line = group({ id: 'line', name: 'COURO NOBUCK' });
    const rollups = new Map<string, GroupStockRollup>([
      ['family', { group_id: 'family', item_count: 9, stock_value: 900, reserved: 0, available: 9, below_min_count: 0, unit_count: 1, stock_unit: 'm' }],
      ['line', { group_id: 'line', item_count: 2, stock_value: 120, reserved: 1, available: 7, below_min_count: 1, unit_count: 1, stock_unit: 'm' }],
    ]);

    const metrics = buildGroupMetrics([family, line], rollups);

    expect(metrics.isLeaf('family')).toBe(false);
    expect(metrics.byGroup.get('family')?.itemCount).toBe(0);
    expect(metrics.bySector.get('Cabedal')?.itemCount).toBe(2);
  });
});
