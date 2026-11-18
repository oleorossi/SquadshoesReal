import { describe, expect, it } from 'vitest';
import { stockCommandFailure } from '@/lib/stockCommand';

const fk = {
  code: '23503',
  message: 'insert or update on table "stock_movements" violates foreign key constraint "stock_movements_lot_id_fkey"',
  details: 'Key (lot_id)=(47018852-5295-42bd-834d-53ddbf7a235c) is not present in table "lot_tracking".',
};

describe('stockCommandFailure', () => {
  it('PostgrestError vira Error com message, details e code', () => {
    const error = stockCommandFailure(fk);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('stock_movements_lot_id_fkey');
    expect(error.message).toContain('47018852-5295-42bd-834d-53ddbf7a235c');
    expect((error as { code?: string }).code).toBe('23503');
    expect((error as { details?: string }).details).toContain('lot_tracking');
  });
});
