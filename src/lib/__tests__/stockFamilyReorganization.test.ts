import { describe, expect, it } from 'vitest';
import type { ProductGroup } from '@/hooks/useGroups';
import { buildStockFamilyReorganizationPlan, finishedWidthFromGroupName } from '@/lib/stockFamilyReorganization';

const group = (value: Partial<ProductGroup> & Pick<ProductGroup, 'id' | 'name'>): ProductGroup => ({
  sector: 'Material Base',
  parent_group_id: null,
  is_family: false,
  dimensions_width: 0,
  ...value,
} as ProductGroup);

describe('proposta de reorganização Família → Subgrupo', () => {
  it('propõe FORRAÇÃO e TIRAS sem aplicar nada, preservando o setor de cada subgrupo', () => {
    const tira = group({ id: 'fam-tira', name: 'TIRA', is_family: true, sector: 'Material Base' });
    const chata = group({ id: 'chata8', name: 'TIRA CHATA 8MM', parent_group_id: 'fam-tira', dimensions_width: 0 });
    const overlock = group({ id: 'ov', name: 'TIRA OVERLOCK 5MM', dimensions_width: 0 });
    const strass = group({ id: 'st', name: 'TIRA STRASS 6MM', sector: 'Componente', parent_group_id: 'comp', dimensions_width: 6 });
    const componentes = group({ id: 'comp', name: 'COMPONENTES', is_family: true, sector: 'Componente' });
    const soft = group({ id: 'soft', name: 'NAPA SOFT', sector: 'Forração da Palmilha' });
    const titanium = group({ id: 'ti', name: 'NAPA TITANIUM', sector: 'Cabedal' });
    const chata25 = group({ id: 'c25', name: 'Tira chata 25mm', parent_group_id: 'fam-tira' });

    const plan = buildStockFamilyReorganizationPlan(
      [tira, chata, overlock, strass, componentes, soft, titanium, chata25],
      new Map([['ov', 43], ['st', 4], ['soft', 43], ['ti', 3]]),
    );

    expect(plan.some((action) => action.kind === 'create_family' && action.name === 'FORRAÇÃO')).toBe(true);
    expect(plan).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'rename_group', from: 'TIRA', to: 'TIRAS' }),
      expect.objectContaining({ kind: 'rename_group', from: 'Tira chata 25mm', to: 'TIRA CHATA 25MM' }),
      expect.objectContaining({ kind: 'move_to_family', name: 'TIRA OVERLOCK 5MM', toFamily: 'TIRAS', fromFamily: null, skuCount: 43 }),
      expect.objectContaining({ kind: 'move_to_family', name: 'TIRA STRASS 6MM', toFamily: 'TIRAS', fromFamily: 'COMPONENTES', sectorStays: 'Componente' }),
      expect.objectContaining({ kind: 'move_to_family', name: 'NAPA SOFT', toFamily: 'FORRAÇÃO', sectorStays: 'Forração da Palmilha' }),
      expect.objectContaining({ kind: 'move_to_family', name: 'NAPA TITANIUM', toFamily: 'FORRAÇÃO', sectorStays: 'Cabedal' }),
      expect.objectContaining({ kind: 'fill_width', name: 'TIRA OVERLOCK 5MM', from: 0, to: 5 }),
      expect.objectContaining({ kind: 'fill_width', name: 'TIRA CHATA 8MM', from: 0, to: 8 }),
    ]));
    expect(plan.some((action) => action.kind === 'move_to_family' && action.name === 'TIRA CHATA 8MM')).toBe(false);
    expect(plan.some((action) => action.kind === 'fill_width' && action.name === 'TIRA STRASS 6MM')).toBe(false);
  });

  it('lê a largura acabada do nome, não da bitola de corte', () => {
    expect(finishedWidthFromGroupName('TIRA OVERLOCK 5MM')).toBe(5);
    expect(finishedWidthFromGroupName('ELÁSTICO FORRADO 7MM')).toBe(7);
    expect(finishedWidthFromGroupName('NAPA SOFT')).toBeNull();
  });
});
