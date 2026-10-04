import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const mig = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20270101031400_pv_commitment_material_reservations_origin.sql'),
  'utf8',
);

describe('pv_commitment material_reservations origin (contract)', () => {
  it('aceita sale_order_id como origem sem order_id', () => {
    expect(mig).toContain('material_reservations_origin_ck');
    expect(mig).toContain('sale_order_id IS NOT NULL');
    expect(mig).toContain('order_id IS NOT NULL');
  });

  it('mantém o caminho de tira/dublagem (um vínculo)', () => {
    expect(mig).toContain('sale_order_strap_demand_id');
    expect(mig).toContain('dublagem_demand_id');
    expect(mig).toContain('num_nonnulls');
  });
});
