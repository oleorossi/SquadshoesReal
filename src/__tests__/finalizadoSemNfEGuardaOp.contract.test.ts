/**
 * PV-00236 e PV-2026-00083 estavam Em Produção com deleted_at.
 * O #710 não os achou. A entrada em Em Produção sem OP tem de falhar
 * na função do #707 e também em qualquer gravação de status.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(
  __dirname,
  '../../supabase/migrations/20270101052100_finalizado_sem_nf_e_guarda_op.sql',
), 'utf8');

const promote = readFileSync(resolve(
  __dirname,
  '../../supabase/migrations/20270101050600_promote_sem_op_falha.sql',
), 'utf8');

describe('finalizado sem NF dos legados apagados e guarda de OP', () => {
  it('grava só os dois pedidos, mesmo com deleted_at, e compara os efeitos', () => {
    expect(migration).toContain("so.order_number IN ('PV-00236', 'PV-2026-00083')");
    expect(migration).toContain("status = 'Finalizado s/ NF'");
    expect(migration).toContain('contagem_antes');
    expect(migration).toContain('contagem_depois');
    expect(migration).toContain('Efeito colateral detectado');
    expect(migration).toContain('financial_entries');
    expect(migration).toContain('accounts_receivable');
    expect(migration).toContain('stock_movements');
    expect(migration).toContain('sale_order_command_outbox');
    expect(migration).toContain('commission_value');
    expect(migration).toContain("so.order_number IN ('PV-00236', 'PV-2026-00083', 'PV-00142', 'PV-00249', 'PV-00250')");
    expect(migration).toContain("AND so.order_number IN ('PV-00236', 'PV-2026-00083')");
    expect(migration).not.toContain("SET deleted_at");
    expect(migration).not.toContain('auto_motor_enabled = true');
  });

  it('a promoção falha de forma visível sem OP, na função e no gatilho', () => {
    expect(promote).toContain('promocao_sem_op_20270101050600');
    expect(promote).toContain('Promoção para Em Produção não gerou OP do item');
    expect(promote).toContain('Promoção recusada: item produzível ficou sem OP');
    expect(migration).toContain('promocao_sem_op_20270101050600');
    expect(migration).toContain('trg_block_em_producao_sem_op');
    expect(migration).toContain('Promoção recusada: o item % / % ficou sem OP');
    expect(migration).toContain("USING ERRCODE = 'PZ108'");
    expect(migration).toContain('command_error');
  });
});
