/**
 * Guard de harmonização TS↔SQL (lado SQL).
 *
 * Por padrão é SKIP (não roda no CI — as suítes de banco escrevem em produção).
 * Para executar: `bun run test:db` (ver src/test/dbGuards.ts).
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
import { DB_TESTS_ENABLED, describeFailures, runGuardSuite } from '@/test/dbGuards';

(DB_TESTS_ENABLED ? describe : describe.skip)(
  'consumo — guard de harmonização SQL (escalar ↔ by_grade)',
  () => {
    it('todos os cases de run_consumption_parity_tests() passam', async () => {
      const rows = await runGuardSuite('run_consumption_parity_tests');
      expect(rows.filter((r) => !r.ok), describeFailures(rows)).toHaveLength(0);
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
      // cases estruturais não pegam) + 2 de padrão GLOBAL por cor no by_grade
      // (migration 20260928121000: component_color_defaults aplicado no
      // fallback de direct_components, com lookup normalizado via
      // extensions.unaccent). Total vivo: 22 (reconferido no banco em
      // 11/08/2026, todos ok — a base pré-padrão-global tinha 20).
      //
      // O piso era 13 e contradizia o próprio comentário acima. Subiu pro valor
      // medido: o objetivo declarado é pegar case APAGADO, e um piso 9 abaixo
      // do real deixava passar quase metade da suíte sumindo sem ninguém notar.
      expect(rows.length).toBeGreaterThanOrEqual(22);
    });
  },
);
