import { describe, expect, it } from 'vitest';
import type { ProductGroup } from '@/hooks/useGroups';
import type { GroupStockRollup } from '@/hooks/useGroupOrganization';
import { organizationSectorOptions } from '@/lib/categoryFromGroup';
import { buildFamilyTree, buildGroupMetrics, buildSectorTree } from '@/lib/groupRollup';

const ORG_SECTORS = organizationSectorOptions().length;

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
    expect(tree.map((s) => s.sector)).not.toContain('Embalagem');
    expect(tree.map((s) => s.sector)).toContain('Material Base');
    expect(tree).toHaveLength(ORG_SECTORS);
  });

  it('não força o setor Embalagem quando não há grupos nele', () => {
    const tree = buildSectorTree([]);
    expect(tree.find((sector) => sector.sector === 'Embalagem')).toBeUndefined();
    expect(tree).toHaveLength(ORG_SECTORS);
  });

  it('ainda mostra um grupo legado de Embalagem', () => {
    const leftover = group({ id: 'cx', name: 'CAIXAS', sector: 'Embalagem', is_family: true });
    const tree = buildSectorTree([leftover]);
    const embalagem = tree.find((sector) => sector.sector === 'Embalagem');
    expect(embalagem?.families).toEqual([{ family: leftover, children: [] }]);
    expect(tree).toHaveLength(ORG_SECTORS + 1);
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


describe('árvore Família → Subgrupo', () => {
  it('junta subgrupos de setores diferentes na mesma família', () => {
    const family = group({ id: 'tiras', name: 'TIRAS', is_family: true, sector: 'Material Base' });
    const overlock = group({ id: 'ov', name: 'TIRA OVERLOCK 5MM', parent_group_id: 'tiras', sector: 'Material Base' });
    const strass = group({ id: 'st', name: 'TIRA STRASS 6MM', parent_group_id: 'tiras', sector: 'Componente' });
    const tree = buildFamilyTree([family, overlock, strass]);

    expect(tree.families).toHaveLength(1);
    expect(tree.families[0].family).toEqual(family);
    expect(tree.families[0].children.map((child) => child.name)).toEqual([
      'TIRA OVERLOCK 5MM',
      'TIRA STRASS 6MM',
    ]);
    expect(tree.looseBySector).toEqual([]);
  });

  it('mantém família vazia e agrupa soltos pelo setor só para leitura', () => {
    const family = group({ id: 'forro', name: 'FORRAÇÃO', is_family: true, sector: 'Forração da Palmilha' });
    const soft = group({ id: 'soft', name: 'NAPA SOFT', sector: 'Forração da Palmilha' });
    const tree = buildFamilyTree([family, soft]);

    expect(tree.families).toEqual([{ family, children: [] }]);
    expect(tree.looseBySector).toEqual([
      { sector: 'Forração da Palmilha', leaves: [soft] },
    ]);
  });
});
