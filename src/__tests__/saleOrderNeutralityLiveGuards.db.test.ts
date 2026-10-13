/**
 * Guards do corpo VIVO da neutralidade de PV.
 *
 * Existe porque o contrato que DEVERIA ter pego o incidente do PV-00195 lia o
 * ARQUIVO da migration, não a função do banco. Arquivo certo no repo + função
 * viva regredida = teste verde e dono travado. Durante a investigação foi
 * preciso consultar pg_proc à mão para descobrir que, desta vez, a função viva
 * estava certa — e o culpado era outro.
 *
 * Diferente dos outros testes de `test:db`, estes são SOMENTE LEITURA: não
 * criam fixture, não escrevem nada. Podem rodar contra produção. Seguem
 * gateados por RUN_DB_INTEGRATION só porque exigem credencial.
 */
import { describe, expect, it } from 'vitest';
import { DB_TESTS_ENABLED, describeFailures, runGuardSuite } from '@/test/dbGuards';

describe.skipIf(!DB_TESTS_ENABLED)('neutralidade de PV — função VIVA', () => {
  it('run_sale_order_neutrality_live_guards() passa em todos os casos', async () => {
    const rows = await runGuardSuite('run_sale_order_neutrality_live_guards');

    // Piso no valor MEDIDO em 13/10/2026. Sem isto, apagar casos da função SQL
    // encolheria a suíte sem nenhum teste ficar vermelho.
    expect(rows.length, 'a suíte encolheu — algum caso foi apagado da função')
      .toBeGreaterThanOrEqual(12);

    expect(rows.filter((r) => !r.ok), describeFailures(rows)).toEqual([]);
  });
});
