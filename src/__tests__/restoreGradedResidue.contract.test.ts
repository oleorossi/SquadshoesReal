import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Spec resync-estorno-unificado: produto com grade real NÃO recebe crédito
 * escalar sem numeração rastreável. A migration 17100 reescreve
 * restore_product_stocks_for_order e cria op_restore_consistency_report.
 */
const ROOT = resolve(__dirname, '../..');
const MIG = readFileSync(
  resolve(ROOT, 'supabase/migrations/20270101017100_sole-audit-restore-parity-inspection.sql'),
  'utf8',
);
const SPEC = readFileSync(resolve(ROOT, 'specs/resync-estorno-unificado.md'), 'utf8');

describe('Restore graduado — decisão de produto fechada', () => {
  it('spec manda não inventar numeração nem creditar só o escalar', () => {
    expect(SPEC).toMatch(/não estorna.*resíduo|Nunca inventa numeração/i);
    expect(SPEC).toContain('op_restore_consistency_report()');
  });

  it('migration implementa WARNING + skip do crédito escalar cego', () => {
    expect(MIG).toContain('CREATE OR REPLACE FUNCTION public.restore_product_stocks_for_order');
    expect(MIG).toContain('nao credita residuo escalar');
    expect(MIG).toContain('op_restore_pending');
    // A mensagem antiga do crédito cego NÃO pode voltar no ramo graduado.
    expect(MIG).not.toContain(
      'Estorno de debitos da OP (restore - residuo escalar de produto com grade; numeracao intacta)',
    );
  });

  it('cria o relatório de pendências', () => {
    expect(MIG).toContain('CREATE OR REPLACE FUNCTION public.op_restore_consistency_report()');
    expect(MIG).toContain('qtd_sem_grade');
  });
});
