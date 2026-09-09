/**
 * Guard de harmonização vivo do domínio solado.
 *
 * Skip sem RUN_DB_INTEGRATION — igual aos outros parity. Invoca
 * run_sole_live_parity_guards() (migration 20270101019000), que lê
 * pg_get_functiondef do banco.
 */
import { describe, it, expect } from 'vitest';
import { DB_TESTS_ENABLED, describeFailures, runGuardSuite } from '@/test/dbGuards';

(DB_TESTS_ENABLED ? describe : describe.skip)(
  'solado — guards vivos (débito+variante, COALESCE, cobertura, restore)',
  () => {
    it('todos os cases de run_sole_live_parity_guards() passam', async () => {
      const rows = await runGuardSuite('run_sole_live_parity_guards');
      expect(rows.filter((r) => !r.ok), describeFailures(rows)).toHaveLength(0);
      expect(rows.length).toBeGreaterThanOrEqual(7);
    });
  },
);
