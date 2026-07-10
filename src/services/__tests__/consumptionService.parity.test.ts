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
      // 2 de existência + 7 de contrato (versão VIVA no banco, pós-unificação
      // escalar→by_grade: escalar_delega_ao_bygrade + escalar_nao_duplica_conversao
      // substituíram os cases escalar_* da migration 20260722120000) + 2 de
      // componentes-por-cor no by_grade (migration 20260910140000) + 4 da
      // reserva (migration 20260910150000: try_reserve_materials deriva a
      // demanda do motor unificado — delegação ao by_grade, sem explosão
      // própria de BOM/specs, e pula color_mismatch) + 3 de blindagem 22P02
      // (migration 20260910170000: enum_sem_coercao_texto varre funções vivas
      // atrás de COALESCE/= '' sobre coluna enum, e 2 smokes que EXECUTAM o
      // motor de consumo e a resolução de solado — quebra de RUNTIME que os
      // cases estruturais não pegam). Total vivo: 18.
      expect(rows.length).toBeGreaterThanOrEqual(13);
    });
  },
);
