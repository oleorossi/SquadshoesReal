import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Trava: a auditoria de status dos PVs tem que espelhar as mesmas predicados
 * de fato físico / NF-e / OP finalizada do cancel atômico — senão o relatório
 * mente em relação ao toast "OP … possui fato físico".
 */
const ROOT = resolve(import.meta.dirname, '../..');
const AUDIT = readFileSync(
  resolve(ROOT, 'sql-scripts/audit-sale-order-status-transitions.sql'),
  'utf8',
);
const CANCEL_MIG = readFileSync(
  resolve(
    ROOT,
    'supabase/migrations/20270101010400_atomic_sale_order_promotion_command.sql',
  ),
  'utf8',
);

function extractFunction(sql: string, name: string): string {
  const re = new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${name}[\\s\\S]*?^\\$\\$;`,
    'm',
  );
  const m = sql.match(re);
  if (!m) throw new Error(`função ${name} não encontrada`);
  return m[0];
}

describe('audit-sale-order-status-transitions.sql', () => {
  const cancel = extractFunction(CANCEL_MIG, 'cancel_sale_order_atomic_internal');

  it('é somente leitura (sem DML)', () => {
    expect(AUDIT).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER)\b/i);
    expect(AUDIT).toMatch(/somente leitura/i);
  });

  it('espelha o allow-list de status do cancel (PZ110)', () => {
    for (const status of [
      'Rascunho',
      'Pendente',
      'Aprovado',
      'Em Produção',
      'Faturado',
      'Cancelado',
    ]) {
      expect(cancel).toContain(`'${status}'`);
      expect(AUDIT).toContain(`'${status}'`);
    }
    expect(AUDIT).toContain('PZ110_status');
  });

  it('espelha o bloqueio de NF-e ativa (PZ112)', () => {
    for (const status of ['autorizada', 'processando', 'cancelando']) {
      expect(cancel).toContain(`'${status}'`);
      expect(AUDIT).toContain(`'${status}'`);
    }
    expect(AUDIT).toContain('PZ112');
  });

  it('espelha OP finalizada (PZ105_op_finalizada)', () => {
    for (const status of [
      'Finalizado',
      'FINALIZADO',
      'Concluído',
      'Concluido',
      'Concluída',
    ]) {
      expect(cancel).toContain(`'${status}'`);
      expect(AUDIT).toContain(`'${status}'`);
    }
    expect(AUDIT).toContain('PZ105_op_finalizada');
  });

  it('espelha os quatro predicados de fato físico do cancel', () => {
    // stages
    expect(cancel).toMatch(/order_stages[\s\S]*quantity_processed/);
    expect(AUDIT).toMatch(/order_stages[\s\S]*quantity_processed/);
    expect(AUDIT).toMatch(/started_at IS NOT NULL/);
    expect(AUDIT).toMatch(/completed_at IS NOT NULL/);
    expect(AUDIT).toMatch(/'', 'pendente', 'pending'/);

    // lots
    expect(cancel).toMatch(/order_lots/);
    expect(AUDIT).toMatch(/order_lots/);

    // reservations consumidas
    expect(cancel).toMatch(/'consumed', 'converted', 'pending_reconciliation'/);
    expect(AUDIT).toMatch(/'consumed', 'converted', 'pending_reconciliation'/);

    // production_consumptions
    expect(cancel).toMatch(/production_consumptions[\s\S]*actual_quantity/);
    expect(AUDIT).toMatch(/production_consumptions[\s\S]*actual_quantity/);
    expect(AUDIT).toContain('PZ105_fato_fisico');
  });

  it('expõe can_cancel e can_revert_aprovado_to_rascunho', () => {
    expect(AUDIT).toMatch(/can_cancel/i);
    expect(AUDIT).toMatch(/can_revert_aprovado_to_rascunho/i);
    expect(AUDIT).toMatch(/allowed_next_statuses/i);
  });
});
