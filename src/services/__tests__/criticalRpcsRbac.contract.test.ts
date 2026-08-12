import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  'supabase/migrations/20261231120500_rbac-rpcs-operacionais-criticas.sql',
  'utf8',
);

describe('RBAC das RPCs operacionais críticas', () => {
  it('não deixa RPCs de saldo, picking ou débito dependerem apenas de aprovação', () => {
    for (const fn of [
      'adjust_stock',
      'move_stock_delta',
      'pick_item_increment',
      'hybrid_debit_stock_for_order',
      'debit_sole_stock_by_grade',
      'debit_strap_stock',
      'process_order_stock_out',
      'convert_reservation_to_out',
      'debit_packaging_for_order',
    ]) {
      expect(migration).toContain(`'public.${fn}`);
    }
    expect(migration).toContain("public.user_has_any_role");
    expect(migration).toContain("FROM PUBLIC, anon");
  });

  it('mantém almoxarifado no estoque manual e produção no débito de OP', () => {
    expect(migration).toContain("ARRAY['admin','gerente','almoxarifado']");
    expect(migration).toContain("ARRAY['admin','gerente','producao']");
  });
});
