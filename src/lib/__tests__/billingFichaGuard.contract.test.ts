import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('faturamento × guard da ficha', () => {
  const src = readFileSync(
    resolve(__dirname, '../../hooks/useSaleOrders.ts'),
    'utf8',
  );

  it('usa convertReservadoOpsOnBilling em vez do RPC cru', () => {
    expect(src).toContain("from '@/lib/billingReservationConvert'");
    expect(src).toContain('convertReservadoOpsOnBilling');
    expect(src).not.toMatch(/rpc\(\s*['\"]convert_reservation_to_out['\"]/);
  });
});
