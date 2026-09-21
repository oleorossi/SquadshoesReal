import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const MIGRATION = readFileSync(
  resolve(
    ROOT,
    'supabase/migrations/20270101026200_compensatory_cancel_tolerates_orphan_resync_credit.sql',
  ),
  'utf8',
);

function sqlFunction(name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}(`;
  const start = MIGRATION.indexOf(marker);
  expect(start, `${name} ausente`).toBeGreaterThanOrEqual(0);
  const tail = MIGRATION.slice(start);
  const end = tail.indexOf('\n$$;');
  expect(end, `${name} sem terminador`).toBeGreaterThanOrEqual(0);
  return tail.slice(0, end + 4);
}

describe('compensatory cancel tolera crédito órfão de resync (mig 26200)', () => {
  const cancel = sqlFunction('cancel_production_order_internal');
  const blockers = sqlFunction('sale_order_physical_fact_blockers');

  it('separates bad qty from over-restore and only auto-path raises PZ212 on credit', () => {
    expect(cancel).toContain('v_has_bad_qty');
    expect(cancel).toContain('v_has_over_restore');
    expect(cancel).toContain('v_compensatory');
    expect(cancel).toContain("app.sale_order_command_compensatory_cancel");
    expect(cancel).toContain('v_has_over_restore AND NOT v_compensatory');
    expect(cancel).toContain('credito liquido sem debito');
    expect(cancel).toContain("USING ERRCODE = 'PZ212'");
    expect(cancel).toContain('over_restored_left_in_place');
    // Mensagem usa nº da OP, não UUID cru.
    expect(cancel).toContain('v_order.order_number');
    expect(cancel).not.toMatch(
      /Ledger da OP % e invalido; reconciliacao manual obrigatoria',\s*\n\s*v_order\.id/,
    );
  });

  it('preflight lists invalid_ledger as overridable over_restored fact', () => {
    expect(blockers).toContain("'invalid_ledger'");
    expect(blockers).toContain("'over_restored'");
    expect(blockers).toContain("'overridable', true");
    expect(blockers).toContain('crédito líquido órfão');
  });
});
