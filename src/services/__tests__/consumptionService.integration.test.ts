/**
 * Teste de integração TS → SQL real.
 *
 * Por padrão é SKIP. No CI, roda apenas no job semanal contra o projeto
 * Supabase isolado; localmente, use `bun run test:db` em ambiente descartável.
 *
 * Invoca a função PL/pgSQL `run_consumption_integration_tests()` (criada via
 * migration), que valida a hierarquia per-size → sole_spec → escalar diretamente
 * no banco e retorna {case_name, ok, message} por caso.
 *
 * ⚠ Esta suíte esteve VERMELHA por tempo indeterminado, escondida atrás do skip:
 * o fixture gravava os dm² direto em `sole_technical_specs`, que virou tabela
 * ESPELHO de `sole_group_standard_items` (cadastro por MODELO). O gatilho
 * `tg_sole_specs_freeze_consumption` é assimétrico — no UPDATE ele dá RAISE, mas
 * no INSERT apenas SOBRESCREVE —, então os valores viravam NULL em silêncio e os
 * 3 casos do CASO 2 caíam em `fallback_average`. Corrigido na migration
 * 20261231121100. Não era regressão do motor: produção foi verificada antes.
 */
import { describe, it, expect } from 'vitest';
import { DB_TESTS_ENABLED, describeFailures, runGuardSuite } from '@/test/dbGuards';

(DB_TESTS_ENABLED ? describe : describe.skip)(
  'consumptionService — integração SQL real (RPC + hierarquia)',
  () => {
    it('todos os cases de run_consumption_integration_tests() passam', async () => {
      const rows = await runGuardSuite('run_consumption_integration_tests');
      expect(rows.filter((r) => !r.ok), describeFailures(rows)).toHaveLength(0);
      // 13 casos vivos, medidos em 11/08/2026 (CASO 1/1b/2/2c/3 + avisos).
      // Piso no valor real: serve pra pegar case apagado.
      expect(rows.length).toBeGreaterThanOrEqual(13);
    });
  },
);
