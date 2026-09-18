import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const SQL = readFileSync(
  resolve(ROOT, 'supabase/migrations/20270101025500_execute_sale_order_raise_timeout.sql'),
  'utf8',
);
const HOOKS = readFileSync(resolve(ROOT, 'src/hooks/useSaleOrders.ts'), 'utf8');
const COMMAND = readFileSync(resolve(ROOT, 'src/lib/saleOrderCommand.ts'), 'utf8');

describe('execute_sale_order_command eleva timeout (20270101025500)', () => {
  it('patch injeta statement_timeout 90s e lock_timeout 30s antes do lock global', () => {
    expect(SQL).toContain('execute_sale_order_raise_timeout_20270101025500');
    expect(SQL).toContain("set_config('statement_timeout', '90s', true)");
    expect(SQL).toContain("set_config('lock_timeout', '30s', true)");
    expect(SQL).toContain('PERFORM public.lock_sale_order_purchase_allocation()');
    // Ordem: eleva GUCs, depois pega o lock (não o contrário).
    const timeoutPos = SQL.indexOf("set_config('statement_timeout', '90s', true)");
    const lockPos = SQL.indexOf(
      'PERFORM public.lock_sale_order_purchase_allocation();',
      timeoutPos,
    );
    expect(timeoutPos).toBeGreaterThanOrEqual(0);
    expect(lockPos).toBeGreaterThan(timeoutPos);
  });

  it('update do PV faz 1 retry em busy/timeout (igual transição de status)', () => {
    const updateStart = HOOKS.indexOf('export function useUpdateSaleOrder()');
    const nextExport = HOOKS.indexOf('\nexport ', updateStart + 1);
    expect(updateStart).toBeGreaterThanOrEqual(0);
    const updateBody = HOOKS.slice(updateStart, nextExport > 0 ? nextExport : undefined);
    expect(updateBody).toContain('isPostgresBusyError(firstErr)');
    expect(updateBody).toContain('const idempotencyKey = `pv:${id}:update:');
  });

  it('detecção de timeout lê PostgREST plain object via describePostgrestError', () => {
    expect(COMMAND).toContain('postgresErrorHaystack');
    expect(COMMAND).toContain('describePostgrestError(error');
  });
});
