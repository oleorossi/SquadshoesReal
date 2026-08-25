import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  fetchCanonicalConsumptionReport: vi.fn(),
  materializeCanonicalConsumptionReport: vi.fn(),
  saleOrdersError: { current: null as { message: string } | null },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: mocks.from },
}));

vi.mock('@/lib/canonicalConsumptionReport', () => ({
  fetchCanonicalConsumptionReport: mocks.fetchCanonicalConsumptionReport,
  materializeCanonicalConsumptionReport: mocks.materializeCanonicalConsumptionReport,
}));

import { loadPvConsumption } from '@/lib/pvConsumption';

const report = {
  version: 1,
  engine: 'calculate_order_consumption_by_grade',
  lines: [],
  strap_previews: [],
};

describe('loadPvConsumption — fronteira do motor canônico', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.saleOrdersError.current = null;
    mocks.from.mockImplementation((table: string) => ({
      select: vi.fn(() => ({
        in: vi.fn(async () => {
          if (table !== 'sale_orders') throw new Error(`consulta TS indevida: ${table}`);
          return {
            data: [{
              id: 'pv-1', order_number: 'PV-1', client_order_number: null,
              packaging_mode: 'individual',
            }],
            error: mocks.saleOrdersError.current,
          };
        }),
      })),
    }));
    mocks.fetchCanonicalConsumptionReport.mockResolvedValue(report);
    mocks.materializeCanonicalConsumptionReport.mockResolvedValue({
      rows: [{
        componentType: 'Cabedal', groupName: 'NAPA', materialName: 'NAPA PRETA',
        productUnit: 'm', color: 'PRETO', totalQuantity: 12.5,
      }],
      artisanalStrapRows: [],
    });
  });

  it('usa o payload SQL como fato e só materializa apresentação/estoque', async () => {
    const result = await loadPvConsumption(['pv-1']);

    expect(mocks.fetchCanonicalConsumptionReport).toHaveBeenCalledWith({
      saleOrderIds: ['pv-1'],
    });
    expect(mocks.materializeCanonicalConsumptionReport).toHaveBeenCalledWith(report);
    expect(result.rows[0]).toMatchObject({ totalQuantity: 12.5, groupName: 'NAPA' });
    expect(result.orderHeaders).toEqual([{
      order_number: 'PV-1', client_order_number: null,
    }]);
  });

  it('deduplica IDs antes de uma única chamada batch', async () => {
    await loadPvConsumption(['pv-1', 'pv-1', '  pv-1  ']);

    expect(mocks.fetchCanonicalConsumptionReport).toHaveBeenCalledTimes(1);
    expect(mocks.fetchCanonicalConsumptionReport).toHaveBeenCalledWith({
      saleOrderIds: ['pv-1'],
    });
  });

  it('falha fechado quando o cabeçalho do PV não pode ser carregado', async () => {
    mocks.saleOrdersError.current = { message: 'sale_orders indisponível' };

    await expect(loadPvConsumption(['pv-1'])).rejects.toEqual({
      message: 'sale_orders indisponível',
    });
    expect(mocks.materializeCanonicalConsumptionReport).not.toHaveBeenCalled();
  });
});
