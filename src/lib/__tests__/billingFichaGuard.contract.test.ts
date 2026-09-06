import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('faturamento × guard da ficha', () => {
  it('helper encaminha para convertReservationToOutGuarded', () => {
    const src = readFileSync(
      resolve(__dirname, '../billingReservationConvert.ts'),
      'utf8',
    );
    expect(src).toContain('convertReservationToOutGuarded');
    expect(src).toContain('convertReservadoOpsOnBilling');
  });

  it('client intercepta convert_reservation_to_out com guard da ficha', () => {
    const src = readFileSync(
      resolve(__dirname, '../../integrations/supabase/client.ts'),
      'utf8',
    );
    expect(src).toContain("fn === 'convert_reservation_to_out'");
    expect(src).toContain('guardDebitForOrder');
  });
});
