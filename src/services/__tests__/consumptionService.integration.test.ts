/**
 * Teste de integração TS → SQL real.
 *
 * Por padrão é SKIP (não roda no CI sem env). Para executar localmente:
 *   RUN_DB_INTEGRATION=1 PGHOST=... bunx vitest run \
 *     src/services/__tests__/consumptionService.integration.test.ts
 *
 * Invoca a função PL/pgSQL `run_consumption_integration_tests()` (criada via
 * migration), que valida a hierarquia per-size → sole_spec → escalar diretamente
 * no banco e retorna {case_name, ok, message} por caso.
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

const ENABLED = process.env.RUN_DB_INTEGRATION === '1';

(ENABLED ? describe : describe.skip)(
  'consumptionService — integração SQL real (RPC + hierarquia)',
  () => {
    it('todos os cases de run_consumption_integration_tests() passam', () => {
      const out = execSync(
        `psql -t -A -F '|' -c "SELECT case_name, ok, message FROM run_consumption_integration_tests();"`,
        { encoding: 'utf8' },
      );
      const rows = out.trim().split('\n').filter(Boolean).map((l) => {
        const [name, ok, message] = l.split('|');
        return { name, ok: ok === 't', message };
      });
      const failures = rows.filter((r) => !r.ok);
      expect(failures, JSON.stringify(failures, null, 2)).toHaveLength(0);
      expect(rows.length).toBeGreaterThanOrEqual(10);
    });
  },
);