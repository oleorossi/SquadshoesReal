import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const MIGRATION = readFileSync(
  resolve(
    ROOT,
    'supabase/migrations/20270101012900_fix_deferred_strap_purchase_origin_final_state.sql',
  ),
  'utf8',
);

function sqlFunction(name: string): string {
  const start = MIGRATION.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `${name} ausente`).toBeGreaterThanOrEqual(0);
  const tail = MIGRATION.slice(start);
  const end = tail.indexOf('\n$function$;');
  expect(end, `${name} sem terminador`).toBeGreaterThan(0);
  return tail.slice(0, end + '\n$function$;'.length);
}

describe('origem canônica diferida usa o estado final do item', () => {
  const guard = sqlFunction('tg_assert_strap_purchase_order_item_origin');

  it('ignora apenas o tombstone de item removido depois do evento diferido', () => {
    expect(guard).toContain('FROM public.purchase_order_items current_item');
    expect(guard).toContain(
      'current_order.id = current_item.purchase_order_id',
    );
    expect(guard).toContain('current_item.id = NEW.id');
    expect(guard).not.toContain('NEW.purchase_order_id');
    expect(guard.indexOf('FROM public.purchase_order_items current_item')).toBeLessThan(
      guard.indexOf('strap_purchase_item_has_canonical_origin(current_item.id)'),
    );
  });

  it('continua fail-closed para todo item vivo de OC de tira sem origem', () => {
    expect(guard).toContain("current_order.source_type = 'strap_demand'");
    expect(guard).toContain(
      'AND NOT public.strap_purchase_item_has_canonical_origin(current_item.id)',
    );
    expect(guard).toContain(
      'Item de OC de tira sem contribuicao canonica estrutural',
    );
  });

  it('instala self-test read-only para tombstone, item vivo e trigger diferido', () => {
    expect(MIGRATION).toContain('tombstone_event_is_ignored');
    expect(MIGRATION).toContain('live_invalid_item_stays_fail_closed');
    expect(MIGRATION).toContain('constraint_remains_deferred');
    expect(MIGRATION).toContain('guard_is_read_only');
    expect(MIGRATION).toContain(
      'run_strap_purchase_origin_final_state_contract_tests_129()',
    );
    expect(guard).not.toMatch(/\bINSERT\s+INTO\s+public\./i);
    expect(guard).not.toMatch(/\bUPDATE\s+public\./i);
    expect(guard).not.toMatch(/\bDELETE\s+FROM\s+public\./i);
  });
});
