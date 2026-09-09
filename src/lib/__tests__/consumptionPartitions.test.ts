import { describe, expect, it } from 'vitest';
import { buildOrderReferencePartitions } from '@/lib/consumptionPartitions';
import type { ConsumptionRow } from '@/lib/consumptionRows';

const row = (partial: Partial<ConsumptionRow> & Pick<ConsumptionRow, 'groupName' | 'materialName'>): ConsumptionRow => ({
  componentType: 'Cabedal',
  productUnit: 'm',
  color: 'PRETO',
  totalQuantity: 1,
  ...partial,
});

describe('buildOrderReferencePartitions', () => {
  it('agrupa linhas por número do PV e depois pelo modelo', () => {
    const partitions = buildOrderReferencePartitions([
      row({
        groupName: 'NAPA',
        materialName: 'Cabedal',
        orderNumber: 'PV-00194',
        saleOrderId: 'o1',
        referenceCode: 'I90',
        referenceId: 'r1',
        totalQuantity: 10,
      }),
      row({
        groupName: 'NAPA',
        materialName: 'Forração',
        orderNumber: 'PV-00194',
        saleOrderId: 'o1',
        referenceCode: 'BT01',
        referenceId: 'r2',
        totalQuantity: 4,
      }),
      row({
        groupName: 'NAPA',
        materialName: 'Cabedal',
        orderNumber: 'PV-00193',
        saleOrderId: 'o2',
        referenceCode: 'I90',
        referenceId: 'r1',
        totalQuantity: 8,
      }),
    ]);

    expect(partitions.map((p) => p.orderNumber)).toEqual(['PV-00193', 'PV-00194']);
    expect(partitions[1].models.map((m) => m.referenceLabel)).toEqual(['BT01', 'I90']);
    expect(partitions[1].models.find((m) => m.referenceLabel === 'I90')?.rows).toHaveLength(1);
    expect(partitions[0].models).toHaveLength(1);
  });
});
