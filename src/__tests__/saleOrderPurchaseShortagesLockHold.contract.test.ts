import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const MIGRATION = readFileSync(resolve(
  ROOT,
  'supabase/migrations/20270101024700_purchase_shortages_compute_before_row_locks.sql',
), 'utf8');

describe('worker de compras não segura row lock durante o compute', () => {
  it('calcula necessidades antes da época e só então trava PV/produtos', () => {
    expect(MIGRATION).toContain("set_config('statement_timeout', '90s', true)");
    expect(MIGRATION).toContain('v_compute_version := v_order_version;');
    expect(MIGRATION).toContain('v_unallocated_pos < v_alloc_pos');
    expect(MIGRATION).toContain('v_alloc_pos < v_product_pos');
    expect(MIGRATION).toContain('PERFORM public.lock_sale_order_purchase_allocation();');
    expect(MIGRATION).toContain('PERFORM public.lock_sale_order_purchase_products(v_purchase_product_ids);');
  });

  it('baixa de reserva no faturamento não espera 30s por lock de produto', () => {
    expect(MIGRATION).toContain("set_config('lock_timeout', '8s', true)");
    expect(MIGRATION).toContain('convert_reservation_to_out_legacy_202701');
  });
});
