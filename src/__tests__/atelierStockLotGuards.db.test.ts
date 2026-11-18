/**
 * Guarda viva de apply_atelier_inbound / atelier_confirm_lot_release.
 *
 * Só leitura: run_atelier_stock_lot_guards() olha catálogo e corpo das funções.
 * Não dá entrada, não libera lote e não mexe em PV. Skip sem RUN_DB_INTEGRATION
 * — o contrato do arquivo SQL roda em todo `bun run test`.
 */
import { describe, expect, it } from 'vitest';
import { DB_TESTS_ENABLED, describeFailures, runGuardSuite } from '@/test/dbGuards';

const CASES = [
  'coluna_atelier_lot_id',
  'fk_on_delete_set_null',
  'indice_atelier_lot_id',
  'entrada_grava_atelier_lot_id',
  'entrada_nao_grava_lot_tracking',
  'entrada_quita_sem_reserva_aberta',
  'entrada_movimento_antes_de_zerar_pending',
  'liberacao_grava_atelier_lot_id',
  'liberacao_nao_grava_lot_tracking',
  'gatilho_entrada_quita_corte_antes_do_rateio',
  'rateio_prioriza_corte_na_quinzena',
];

(DB_TESTS_ENABLED ? describe : describe.skip)(
  'Ateliê — lote do movimento e prioridade da entrada (banco)',
  () => {
    it('run_atelier_stock_lot_guards() cobre entrada, liberação e quinzena', async () => {
      const rows = await runGuardSuite('run_atelier_stock_lot_guards');
      expect(rows.map((row) => row.case_name).sort()).toEqual([...CASES].sort());
      expect(rows.filter((row) => !row.ok), describeFailures(rows)).toHaveLength(0);
    });
  },
);
