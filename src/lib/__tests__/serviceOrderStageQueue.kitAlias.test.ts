import { describe, expect, it } from 'vitest';
import type { ConsumptionRow } from '@/lib/consumptionRows';
import {
  assessStageKitStock,
  filterRowsToStageKit,
} from '@/lib/serviceOrderStageQueue';

function row(partial: Partial<ConsumptionRow> & Pick<ConsumptionRow, 'componentType' | 'groupName'>): ConsumptionRow {
  return {
    materialName: partial.groupName,
    color: 'PRETO',
    productUnit: 'un',
    totalQuantity: 10,
    available: 10,
    productIds: [`p-${partial.groupName}`],
    ...partial,
  } as ConsumptionRow;
}

describe('serviceOrderStageQueue kit alias', () => {
  it('fivela/Outros entra no kit do Aviamento como BOM', () => {
    const kit = filterRowsToStageKit([
      row({ componentType: 'Outros', groupName: 'FIVELA 20MM' }),
      row({ componentType: 'Solado', groupName: 'TR' }),
    ], 'mesa');
    expect(kit.map((item) => item.groupName)).toEqual(['FIVELA 20MM']);
    expect(assessStageKitStock(kit, 'mesa').status).toBe('ready');
  });

  it('Outros genérico também entra no Aviamento como BOM; forração continua fora da Costura', () => {
    const aviamento = filterRowsToStageKit([
      row({ componentType: 'Outros', groupName: 'REBITE 6MM' }),
      row({ componentType: 'Cabedal', groupName: 'NAPA' }),
    ], 'mesa');
    expect(aviamento.map((item) => item.groupName)).toEqual(['REBITE 6MM']);

    const costura = filterRowsToStageKit([
      row({ componentType: 'Cabedal', groupName: 'NAPA' }),
      row({ componentType: 'Forração', groupName: 'FORRO' }),
      row({ componentType: 'Outros', groupName: 'FIVELA 20MM' }),
    ], 'costura');
    expect(costura.map((item) => item.groupName)).toEqual(['NAPA', 'FIVELA 20MM']);
  });
});
