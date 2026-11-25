import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const MIGRATION = read('supabase/migrations/20270101054600_reverter_faturamento_reabre_producao.sql');
const BUTTON = read('src/components/sale-orders/RevertInvoiceButton.tsx');
const ENSAIO = read('scripts/teste-reverter-faturamento.sql');

describe('Reverter Faturamento reabre a produção', () => {
  it('reabre as OPs antes de mudar o PV (sem PZ108)', () => {
    const ops = MIGRATION.indexOf("SET status = 'Em Produção', updated_at = NOW()");
    const pv = MIGRATION.indexOf('UPDATE public.sale_orders SET status = v_target');
    expect(ops).toBeGreaterThan(0);
    expect(pv).toBeGreaterThan(ops);
  });

  it('respeita o retorno do Ateliê: sem retorno, volta para Aprovado', () => {
    expect(MIGRATION).toContain('public.sale_order_atelier_production_block_message(p_sale_order_id)');
    expect(MIGRATION).toMatch(/WHEN v_atelier_block IS NULL AND v_item_sem_op IS NULL THEN 'Em Produção'\s+ELSE 'Aprovado'/);
  });

  it('reabre etapas automáticas, preparos e reservas pelo caminho oficial', () => {
    expect(MIGRATION).toContain('AND st.completed_by IS NULL');
    expect(MIGRATION).toContain("SET pipeline_status = 'awaiting_cut'");
    expect(MIGRATION).toContain('public.restore_order_stock_for_safe_resync(v_op.id, v_receipt)');
    expect(MIGRATION).toContain('public.resync_op_atomic(v_op.id)');
    expect(MIGRATION).toContain("'app.sale_order_command_parent_receipt_id', v_receipt::text");
  });

  it('não cancela o título nem estorna lançamentos com NF autorizada', () => {
    expect(MIGRATION).toContain('v_keep_fiscal := v_nfe_authorized > 0;');
    expect(MIGRATION).toMatch(/IF NOT v_keep_fiscal THEN\s+UPDATE public\.accounts_receivable/);
    expect(MIGRATION).toContain('NOT private.ar_has_recorded_receipt(status, amount_received)');
    expect(MIGRATION).not.toContain('Cancele a NF na SEFAZ antes de reverter');
  });

  it('a tela explica o destino e o título mantido', () => {
    expect(BUTTON).toContain('<strong>Aprovado</strong>');
    expect(BUTTON).toContain('Com NF autorizada vinculada, o título a receber');
    expect(BUTTON).not.toContain('A operação será bloqueada');
  });

  it('o ensaio termina em rollback', () => {
    expect(ENSAIO).toContain("RAISE EXCEPTION 'ENSAIO_ROLLBACK %'");
    expect(ENSAIO).not.toMatch(/'PV-00249'|'PV-00250'|'PV-00251'|'LOTE-00004'/);
  });
});
