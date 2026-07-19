/**
 * Guard SQL da auditoria débito ficha×grade (specs/auditoria-debito-ficha-grade.md).
 *
 * Por padrão é SKIP (não roda no CI sem env). Para executar localmente:
 *   RUN_DB_INTEGRATION=1 PGHOST=... bunx vitest run \
 *     src/services/__tests__/debitGuards.integration.test.ts
 *
 * Invoca `run_debit_guard_tests()` (migration
 * 20260915110000_audit-debito-ficha-grade-fixes.sql), que TRAVA os fixes da
 * auditoria 2026-07-19 nas definições VIVAS do banco: grade base escalada no
 * record_order_consumption (DEB-3), ledger honesto no convert_reservation_to_out
 * (DEB-1), variant_sole adiado no hybrid_debit (DEB-2), lock+dedup no
 * debit_sole (RES-7), falha de reserva visível no tg_sync_item (AUD-1), débito
 * clampado + [os:id] na OS artesanal (DEB-6), release após record (RES-3) e a
 * existência do debit_consistency_report() (R8). Se alguém redeployar uma
 * função sem o fix, o case correspondente falha.
 *
 * O lado TS é travado por src/lib/__tests__/orderConsumption.test.ts
 * (guards BOM-1/BOM-3/TS-1/TEST-1).
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

const ENABLED = process.env.RUN_DB_INTEGRATION === '1';

(ENABLED ? describe : describe.skip)(
  'débito — guards da auditoria ficha×grade (SQL vivo)',
  () => {
    it('todos os cases de run_debit_guard_tests() passam', () => {
      const out = execSync(
        `psql -t -A -F '|' -c "SELECT case_name, ok, message FROM run_debit_guard_tests();"`,
        { encoding: 'utf8' },
      );
      const rows = out.trim().split('\n').filter(Boolean).map((l) => {
        const [name, ok, message] = l.split('|');
        return { name, ok: ok === 't', message };
      });
      const failures = rows.filter((r) => !r.ok);
      expect(failures, JSON.stringify(failures, null, 2)).toHaveLength(0);
      // G1..G10 na migration 20260915110000 — se diminuir, alguém apagou case.
      expect(rows.length).toBeGreaterThanOrEqual(10);
    });
  },
);
