import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const MIGRATION = read(
  'supabase/migrations/20270101042300_soft-delete-libera-todas-reservas.sql',
);
const USE_SALE_ORDERS = read('src/hooks/useSaleOrders.ts');

function sqlFunction(name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}(`;
  const start = MIGRATION.indexOf(marker);
  expect(start, `${name} ausente`).toBeGreaterThanOrEqual(0);
  const tail = MIGRATION.slice(start);
  const end = tail.search(/\n\$function\$;\n|\n\$\$;\n/);
  expect(end, `${name} sem terminador`).toBeGreaterThanOrEqual(0);
  return tail.slice(0, end);
}

describe('soft-delete libera TODAS as reservas (não só solado)', () => {
  const helper = sqlFunction('release_and_restore_stock_for_soft_delete_order');
  const softDelete = sqlFunction('soft_delete_sale_order_internal_108');
  const restore = sqlFunction('restore_sale_order_command');

  it('helper cancela reserved/partially_consumed/pending_reconciliation sem mudar status da OP', () => {
    expect(helper).toContain("'reserved', 'partially_consumed', 'pending_reconciliation'");
    expect(helper).toContain('restore_sole_grade_for_order');
    expect(helper).toContain('restore_product_stocks_for_order');
    expect(helper).not.toContain("status = 'Cancelada'");
    expect(helper).toContain('app.sale_order_command_internal');
  });

  it('soft_delete chama o helper em cada OP antes de setar deleted_at', () => {
    expect(softDelete).toContain('release_and_restore_stock_for_soft_delete_order');
    const releaseAt = softDelete.indexOf('release_and_restore_stock_for_soft_delete_order');
    const hideAt = softDelete.indexOf('SET deleted_at = now()');
    expect(releaseAt).toBeGreaterThanOrEqual(0);
    expect(hideAt).toBeGreaterThan(releaseAt);
    expect(softDelete).toContain('ops_released');
  });

  it('restore re-empenha soft quando não há reserva ativa', () => {
    expect(restore).toContain('initialize_order_material_reservations');
    expect(restore).toContain('ops_re_reserved');
    expect(restore).toContain("'reserved', 'partially_consumed'");
  });

  it('migration faz backfill dos PVs já soft-deleted', () => {
    expect(MIGRATION).toContain('soft-delete backfill');
    expect(MIGRATION).toContain('so.deleted_at IS NOT NULL');
    expect(MIGRATION).toContain('release_and_restore_stock_for_soft_delete_order(v_op.id)');
  });

  it('hook documenta a liberação de reservas no soft-delete', () => {
    expect(USE_SALE_ORDERS).toContain('soft-delete LIBERA todas as reservas');
    expect(USE_SALE_ORDERS).toContain("'soft_delete_sale_order_command'");
  });
});
