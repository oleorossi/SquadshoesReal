import { beforeEach, describe, expect, it, vi } from 'vitest';

const stock = vi.hoisted(() => ({
  fail: null as unknown,
}));

vi.mock('@/lib/stockCommand', () => ({
  adjustProductsStock: vi.fn(async () => {
    if (stock.fail) throw stock.fail;
    return { success: true };
  }),
}));

import { adjustStockSafe } from '@/lib/stockAdjustments';

describe('adjustStockSafe mostra o erro do PostgREST', () => {
  beforeEach(() => {
    stock.fail = null;
  });

  it('message e details de um objeto que não é Error', async () => {
    stock.fail = {
      code: '23503',
      message: 'insert or update on table "stock_movements" violates foreign key constraint "stock_movements_lot_id_fkey"',
      details: 'Key (lot_id)=(47018852-5295-42bd-834d-53ddbf7a235c) is not present in table "lot_tracking".',
    };
    const result = await adjustStockSafe({
      productId: '657aa32d-e665-4972-8e60-d19ad7841c2b',
      expectedPrevious: 0,
      newQty: 0.24,
      reason: 'entrada',
    });
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('stock_movements_lot_id_fkey');
    expect(result.errorMessage).toContain('lot_tracking');
    expect(result.errorMessage).not.toBe('Falha ao executar comando de estoque');
  });
});