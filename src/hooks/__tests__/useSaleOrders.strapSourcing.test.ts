import { describe, expect, it } from 'vitest';
import {
  buildExtraItemColumns,
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
