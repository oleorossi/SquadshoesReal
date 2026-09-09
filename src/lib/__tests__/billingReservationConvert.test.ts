import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('faturamento — baixa com guard da ficha', () => {
  it('browser não executa baixa; transição e liquidação pertencem ao banco', () => {
    const source = readFileSync(resolve('src/hooks/useSaleOrders.ts'), 'utf8');
    const boundary = readFileSync(
      resolve('supabase/migrations/20270101010800_production_order_command_boundary.sql'),
      'utf8',
    );
    const settlement = readFileSync(
      resolve('supabase/migrations/20261231120200_finalizar-op-debita-o-disponivel-em-vez-de-cancelar.sql'),
      'utf8',
    );

    expect(source).not.toContain('convertReservadoOpsOnBilling');
    expect(source).not.toMatch(/rpc\(\s*['"]convert_reservation_to_out['"]/);
    expect(boundary).toContain('public.apply_sale_order_stage_transition_internal(');
    expect(boundary).toContain("'auto_bill_sale_order'");
    expect(boundary).toContain("'app.sale_order_command_internal', '1'");
    expect(settlement).toContain('public.settle_open_reservations_for_order(NEW.id,');
    expect(settlement).toContain('CREATE TRIGGER trg_aa_settle_reservations_on_finalize');
  });
});
