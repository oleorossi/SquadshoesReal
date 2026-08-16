import { describe, expect, it } from 'vitest';
import { buildExtraItemColumns, type SaleOrderItemFormData } from '@/hooks/useSaleOrders';

describe('buildExtraItemColumns · origem canônica de tiras', () => {
  it('envia objeto vazio para item sem tiras/origem em vez de NULL', () => {
    const payload = buildExtraItemColumns({
      strap_colors: [],
      strap_sourcing: undefined,
    } as unknown as SaleOrderItemFormData);

    expect(payload.strap_sourcing).toEqual({});
  });
});
