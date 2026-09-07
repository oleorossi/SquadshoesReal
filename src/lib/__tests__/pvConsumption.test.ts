import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  fetchCanonicalConsumptionReport: vi.fn(),
  materializeCanonicalConsumptionReport: vi.fn(),
  saleOrdersError: { current: null as { message: string } | null },
  itemsError: { current: null as { message: string } | null },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: mocks.from },
}));

vi.mock('@/lib/canonicalConsumptionReport', () => ({
  fetchCanonicalConsumptionReport: mocks.fetchCanonicalConsumptionReport,
  materializeCanonicalConsumptionReport: mocks.materializeCanonicalConsumptionReport,
}));

import {
  loadPvConsumption,
  materializePvConsumptionScope,
  pvConsumptionItemLabel,
  pvConsumptionPath,
} from '@/lib/pvConsumption';

const report = {
  version: 1,
  engine: 'calculate_order_consumption_by_grade',
  lines: [
    {
      scope_key: 'item-1',
      scope_type: 'sale_order_item' as const,
      sale_order_id: 'pv-1',
      sale_order_item_id: 'item-1',
    },
  ],
  strap_previews: [],
};

describe('loadPvConsumption — fronteira do motor canônico', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.saleOrdersError.current = null;
    mocks.itemsError.current = null;
    mocks.from.mockImplementation((table: string) => ({
      select: vi.fn(() => {
        if (table === 'sale_orders') {
          return {
            in: vi.fn(async () => ({
              data: [{
                id: 'pv-1', order_number: 'PV-1', client_order_number: null,
                packaging_mode: 'individual',
              }],
              error: mocks.saleOrdersError.current,
            })),
          };
        }
        if (table === 'sale_order_items') {
          return {
            in: vi.fn(() => ({
              order: vi.fn(async () => ({
                data: [
                  {
                    id: 'item-2',
                    sale_order_id: 'pv-1',
                    color: 'OFF WHITE',
                    quantity: 120,
                    created_at: '2026-09-01T12:00:00Z',
                    technical_sheets: { code: 'I90', name: 'INFANTIL 90' },
                  },
                  {
                    id: 'item-1',
                    sale_order_id: 'pv-1',
                    color: 'PRETO',
                    quantity: 180,
                    created_at: '2026-09-01T10:00:00Z',
                    technical_sheets: { code: 'I90', name: 'INFANTIL 90' },
                  },
                ],
                error: mocks.itemsError.current,
              })),
            })),
          };
        }
        throw new Error(`consulta TS indevida: ${table}`);
      }),
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
    expect(result.report).toBe(report);
  });

  it('expõe catálogo de itens na ordem created_at com índice 1-based', async () => {
    const result = await loadPvConsumption(['pv-1']);

    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'item-1', index: 1, referenceCode: 'I90', color: 'PRETO', quantity: 180,
      }),
      expect.objectContaining({
        id: 'item-2', index: 2, referenceCode: 'I90', color: 'OFF WHITE', quantity: 120,
      }),
    ]);
    expect(pvConsumptionItemLabel(result.items[0])).toBe('Item 1 · I90 · PRETO');
    expect(pvConsumptionItemLabel(result.items[1], { multiPv: true }))
      .toBe('PV-1 · Item 2 · I90 · OFF WHITE');
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

  it('falha fechado quando os itens do PV não podem ser carregados', async () => {
    mocks.itemsError.current = { message: 'sale_order_items indisponível' };

    await expect(loadPvConsumption(['pv-1'])).rejects.toEqual({
      message: 'sale_order_items indisponível',
    });
    expect(mocks.materializeCanonicalConsumptionReport).not.toHaveBeenCalled();
  });
});

describe('materializePvConsumptionScope / path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.materializeCanonicalConsumptionReport.mockResolvedValue({
      rows: [], artisanalStrapRows: [],
    });
  });

  it('sem item materializa o report inteiro', async () => {
    await materializePvConsumptionScope(report as never, null);
    expect(mocks.materializeCanonicalConsumptionReport).toHaveBeenCalledWith(report);
  });

  it('com item passa scopeKeys = Set([itemId])', async () => {
    await materializePvConsumptionScope(report as never, 'item-1');
    expect(mocks.materializeCanonicalConsumptionReport).toHaveBeenCalledWith(
      report,
      new Set(['item-1']),
    );
  });

  it('monta a URL da tela cheia com ids e item opcional', () => {
    expect(pvConsumptionPath(['pv-1', 'pv-1'])).toBe('/sales?view=consumo&ids=pv-1');
    expect(pvConsumptionPath(['pv-1'], 'item-1'))
      .toBe('/sales?view=consumo&ids=pv-1&item=item-1');
  });
});
