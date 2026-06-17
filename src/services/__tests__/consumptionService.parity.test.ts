/**
 * Guard de harmonização TS↔SQL (lado SQL).
 *
 * Por padrão é SKIP (não roda no CI sem env). Para executar localmente:
 *   RUN_DB_INTEGRATION=1 PGHOST=... bunx vitest run \
 *     src/services/__tests__/consumptionService.parity.test.ts
 *
 * Invoca `run_consumption_parity_tests()` (migration
 * 20260722120000_consumption-consistency-and-parity-guards.sql), que TRAVA o
 * contrato entre `calculate_order_consumption` (escalar) e
 * `..._by_grade`: palmilha pronta unificada (insole_ready_made +
 * sole_classification, sem o legado insole_mode), conversão dm²→unidade nos
 * dois, e fachete no graded. Se alguém redeployar uma versão divergente de
 * qualquer função, o case correspondente falha.
 *
 * A paridade do lado TS (motor canônico do frontend) é travada por
 * src/lib/__tests__/orderConsumption.test.ts. Juntos, os dois suites impedem
 * que os motores de display e de custeio/MRP voltem a divergir.
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

const ENABLED = process.env.RUN_DB_INTEGRATION === '1';

(ENABLED ? describe : describe.skip)(
  'consumo — guard de harmonização SQL (escalar ↔ by_grade)',
  () => {
    it('todos os cases de run_consumption_parity_tests() passam', () => {
      const out = execSync(
        `psql -t -A -F '|' -c "SELECT case_name, ok, message FROM run_consumption_parity_tests();"`,
        { encoding: 'utf8' },
      );
      const rows = out.trim().split('\n').filter(Boolean).map((l) => {
        const [name, ok, message] = l.split('|');
        return { name, ok: ok === 't', message };
      });
      const failures = rows.filter((r) => !r.ok);
      expect(failures, JSON.stringify(failures, null, 2)).toHaveLength(0);
      // 2 de existência + 8 de contrato.
      expect(rows.length).toBeGreaterThanOrEqual(10);
    });
  },
);
