import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  fetchConsumptionContext: vi.fn(),
  computeConsumptionForItems: vi.fn(),
  annotateConsumptionAvailability: vi.fn(),
  saleOrdersError: { current: null as { message: string } | null },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: mocks.from,
    rpc: mocks.rpc,
  },
}));

vi.mock('@/lib/orderConsumption', () => ({
  TECHNICAL_SHEET_CONSUMPTION_COLUMNS: 'id',
  fetchConsumptionContext: mocks.fetchConsumptionContext,
  computeConsumptionForItems: mocks.computeConsumptionForItems,
}));

vi.mock('@/lib/consumptionRows', () => ({
  annotateConsumptionAvailability: mocks.annotateConsumptionAvailability,
}));

import { loadPvConsumption } from '@/lib/pvConsumption';

const resolvedPreview = {
  sale_order_item_id: 'item-1',
  technical_strap_line_id: '11111111-1111-4111-8111-111111111111',
  strap_variant_id: 'variant-1',
  source_mode: 'internal',
  gross_required_m: 10,
  blocking_reasons: [],
  resolved: { strap_product_name: 'TIRA 1', strap_color_name: 'PRETO' },
};

const unresolvedPreview = {
  sale_order_item_id: 'item-1',
  technical_strap_line_id: null,
  strap_variant_id: null,
  source_mode: null,
  gross_required_m: 0,
  blocking_reasons: [{ code: 'technical_line_missing', message: 'Linha técnica não resolvida.' }],
  resolved: {},
};

describe('loadPvConsumption — preview canônica de tiras', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.saleOrdersError.current = null;

    mocks.from.mockImplementation((table: string) => ({
      select: vi.fn(() => ({
        in: vi.fn(async () => table === 'sale_order_items'
          ? {
              data: [{
                sale_order_id: 'pv-1', reference_id: 'ref-1', color: 'PRETO',
                quantity: 1, grade: { '35': 1 }, fichas: 1, strap_colors: [],
                material_variant_id: null, technical_sheets: null,
              }],
              error: null,
            }
          : {
              data: [{
                id: 'pv-1', order_number: 'PV-1', client_order_number: null,
                packaging_mode: null,
              }],
              error: mocks.saleOrdersError.current,
            }),
      })),
    }));
    mocks.rpc.mockResolvedValue({ data: [resolvedPreview, unresolvedPreview], error: null });
    mocks.fetchConsumptionContext.mockResolvedValue({ allProducts: [], productGroups: [] });
    mocks.computeConsumptionForItems.mockReturnValue([]);
    mocks.annotateConsumptionAvailability.mockImplementation(async (_rows, _ctx, previews) => ({
      rows: previews.map((preview: { technicalStrapLineId: string; blockingReasons: string[] }) => ({
        componentType: 'Tiras',
        groupName: preview.technicalStrapLineId || 'PENDENTE',
        materialName: 'preview',
        productUnit: 'm',
        color: '—',
        totalQuantity: 0,
        warning: preview.blockingReasons.join(' · '),
      })),
      artisanalStrapRows: [],
    }));
  });

  it('mantém a pendência sem UUID ao lado de outra linha já resolvida', async () => {
    const result = await loadPvConsumption(['pv-1']);

    const previews = mocks.annotateConsumptionAvailability.mock.calls[0][2];
    expect(previews).toHaveLength(2);
    expect(previews.map((preview: { technicalStrapLineId: string }) => preview.technicalStrapLineId))
      .toEqual(['11111111-1111-4111-8111-111111111111', '']);
    expect(result.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ groupName: '11111111-1111-4111-8111-111111111111' }),
      expect.objectContaining({ groupName: 'PENDENTE', warning: 'Linha técnica não resolvida.' }),
    ]));
  });

  it('deduplica IDs na fronteira e chama a prévia de tiras uma única vez por PV', async () => {
    await loadPvConsumption(['pv-1', 'pv-1', '  pv-1  ']);

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('preview_sale_order_strap_demand', {
      p_sale_order_id: 'pv-1',
    });
    const previews = mocks.annotateConsumptionAvailability.mock.calls[0][2];
    expect(previews).toHaveLength(2);
  });

  it('falha fechado quando o cabeçalho do PV não pode ser carregado', async () => {
    mocks.saleOrdersError.current = { message: 'sale_orders indisponível' };

    await expect(loadPvConsumption(['pv-1'])).rejects.toEqual({
      message: 'sale_orders indisponível',
    });
    expect(mocks.fetchConsumptionContext).not.toHaveBeenCalled();
    expect(mocks.computeConsumptionForItems).not.toHaveBeenCalled();
  });
});
