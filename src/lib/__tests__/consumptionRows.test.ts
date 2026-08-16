import { describe, expect, it } from 'vitest';
import { rowKnown, rowShortfall } from '@/lib/consumptionAvailability';
import {
  attachUnresolvedStrapQuantityPreview,
  type ConsumptionRow,
} from '@/lib/consumptionRows';
import type { MaterialConsumptionRow } from '@/lib/orderConsumption';

const calculatedStrap: MaterialConsumptionRow = {
  componentType: 'Tiras',
  groupName: 'TIRA CHATA 8MM',
  materialName: 'Tira 1',
  productUnit: 'm',
  color: 'CAPUCCINO',
  totalQuantity: 17.25,
  materialFamily: 'NAPA SOFT',
};

const unresolved: ConsumptionRow = {
  componentType: 'Tiras',
  groupName: 'Demanda de tira não resolvida',
  materialName: 'Revisar ficha e origem no Hub de Tiras',
  productUnit: 'm',
  color: '—',
  totalQuantity: 0,
  productIds: [],
  warning: 'A tira permanece bloqueada até resolver variante, base, cor e receita por ID.',
};

describe('attachUnresolvedStrapQuantityPreview', () => {
  it('exibe a metragem da ficha sem liberar estoque ou compra', () => {
    const [row] = attachUnresolvedStrapQuantityPreview(
      [unresolved],
      [calculatedStrap],
      false,
    );

    expect(row).toMatchObject({
      groupName: 'TIRA CHATA 8MM',
      color: 'CAPUCCINO',
      totalQuantity: 0,
      previewQuantity: 17.25,
      productIds: [],
    });
    expect(row.warning).toContain('somente uma prévia');
    expect(rowKnown(row)).toBe(false);
    expect(rowShortfall(row)).toBe(0);
  });

  it('não altera a linha quando existe preview canônica', () => {
    expect(attachUnresolvedStrapQuantityPreview(
      [unresolved],
      [calculatedStrap],
      true,
    )).toEqual([unresolved]);
  });
});
