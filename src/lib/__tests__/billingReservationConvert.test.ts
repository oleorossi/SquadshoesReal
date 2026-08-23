import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('faturamento — baixa com guard da ficha', () => {
  it('useSaleOrders não chama convert_reservation_to_out cru', () => {
    const source = readFileSync(resolve('src/hooks/useSaleOrders.ts'), 'utf8');
    expect(source).toContain('convertReservadoOpsOnBilling');
    expect(source).not.toMatch(/rpc\(\s*['"]convert_reservation_to_out['"]/);
  });
});
