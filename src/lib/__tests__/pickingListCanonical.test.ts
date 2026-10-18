import { describe, expect, it } from 'vitest';
import { toPickingConsumptionRows } from '@/lib/pickingListCanonical';
import type { ConsumptionRow } from '@/lib/consumptionRows';

describe('toPickingConsumptionRows', () => {
  it('exclui Solado e linhas zeradas sem aviso', () => {
    const rows = toPickingConsumptionRows([
      {
        componentType: 'Cabedal',
        groupName: 'NAPA SOFT',
        materialName: 'NAPA SOFT PRETO',
        productUnit: 'm',
        color: 'PRETO',
        totalQuantity: 12.5,
      },
      {
        componentType: 'Solado',
        groupName: 'SOLADO 01',
        materialName: 'SOLADO 01 PRETO',
        productUnit: 'par',
        color: 'PRETO',
        totalQuantity: 100,
      },
      {
        componentType: 'Palmilha',
        groupName: 'PLACA EVA',
        materialName: 'PL01',
        productUnit: 'dm2',
        color: '—',
        totalQuantity: 0,
      },
    ] as ConsumptionRow[]);

    expect(rows).toHaveLength(1);
    expect(rows[0].componentType).toBe('Cabedal');
    expect(rows[0].totalQuantity).toBe(12.5);
  });

  it('mantém linha com warning mesmo com qtd 0', () => {
    const rows = toPickingConsumptionRows([
      {
        componentType: 'Fachete',
        groupName: 'FACHETE',
        materialName: 'FACHETE',
        productUnit: 'un',
        color: '—',
        totalQuantity: 0,
        warning: 'sem specs',
      },
    ] as ConsumptionRow[]);
    expect(rows).toHaveLength(1);
    expect(rows[0].warning).toBe('sem specs');
  });
});
