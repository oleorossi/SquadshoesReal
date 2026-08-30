import { describe, expect, it } from 'vitest';
import {
  buildExtraItemColumns,
  filterProductionSaleOrderItems,
  withoutProductionExclusionMetadata,
  listarTirasSemCor,
  type SaleOrderItemFormData,
} from '@/hooks/useSaleOrders';

describe('buildExtraItemColumns · origem canônica de tiras', () => {
  it('envia objeto vazio para item sem tiras/origem em vez de NULL', () => {
    const payload = buildExtraItemColumns({
      strap_colors: [],
      strap_sourcing: undefined,
    } as unknown as SaleOrderItemFormData);

    expect(payload.strap_sourcing).toEqual({});
  });

  it('deriva a cor de reference_base do item sem exigir snapshot client-side', () => {
    expect(listarTirasSemCor([{
      color: 'OFF WHITE',
      strap_colors: [{
        identity_basis: 'reference_base',
        technical_strap_line_id: '11111111-1111-4111-8111-111111111111',
        color: '',
        color_id: null,
      }],
    }])).toEqual([]);
  });

  it('continua exigindo texto e UUID de cor no finished_product_group', () => {
    const base = {
      color: 'OFF WHITE',
      strap_colors: [{
        identity_basis: 'finished_product_group',
        technical_strap_line_id: '22222222-2222-4222-8222-222222222222',
        label: 'STRASS',
        color: 'PRATA',
        color_id: null,
      }],
    };
    expect(listarTirasSemCor([base])).toEqual(['STRASS (OFF WHITE)']);
    expect(listarTirasSemCor([{
      ...base,
      strap_colors: [{
        ...base.strap_colors[0],
        color_id: '33333333-3333-4333-8333-333333333333',
      }],
    }])).toEqual([]);
  });
});

describe('payload comum de item', () => {
  it('remove os metadados internos de retirada produtiva', () => {
    const payload = withoutProductionExclusionMetadata({
      id: 'item-1',
      reference_id: 'ref-1',
      color: 'PRETO',
      grade: { '37': 10 },
      unit_price: 100,
      quantity: 10,
      production_excluded_at: '2026-08-30T12:00:00Z',
      production_exclusion_reason: 'Ficha aposentada pelo administrador',
      production_exclusion_request_id: '11111111-1111-4111-8111-111111111111',
    });

    expect(payload).toMatchObject({ id: 'item-1', reference_id: 'ref-1' });
    expect(payload).not.toHaveProperty('production_excluded_at');
    expect(payload).not.toHaveProperty('production_exclusion_reason');
    expect(payload).not.toHaveProperty('production_exclusion_request_id');
  });

  it('mantém a linha comercial, mas a exclui do conjunto produtivo', () => {
    const active = {
      reference_id: 'ref-ativa',
      color: 'PRETO',
      grade: { '37': 10 },
      unit_price: 100,
      quantity: 10,
    } satisfies SaleOrderItemFormData;
    const retired = {
      ...active,
      reference_id: 'ref-aposentada',
      production_excluded_at: '2026-08-30T12:00:00Z',
      production_exclusion_reason: 'Ficha aposentada pelo administrador',
      production_exclusion_request_id: '11111111-1111-4111-8111-111111111111',
    } satisfies SaleOrderItemFormData;

    const persistedItems = [active, retired];
    expect(filterProductionSaleOrderItems(persistedItems)).toEqual([active]);
    expect(persistedItems).toEqual([active, retired]);
  });
});
