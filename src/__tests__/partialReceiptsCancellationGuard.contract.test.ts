import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const MIGRATION = read(
  'supabase/migrations/20270101015800_preservar_baixas_parciais_no_cancelamento.sql',
);
const E2E = read('supabase/tests/preserve_partial_receipts_on_cancel_e2e.sql');

describe('preservacao de baixas de AR no cancelamento fiscal', () => {
  it('centraliza status e valor recebido em um helper interno fail-closed', () => {
    expect(MIGRATION).toContain(
      'CREATE OR REPLACE FUNCTION private.ar_has_recorded_receipt(',
    );
    for (const status of ['received', 'recebido', 'partial', 'parcial']) {
      expect(MIGRATION).toContain(`'${status}'`);
    }
    expect(MIGRATION).toContain('COALESCE(p_amount_received, 0) > 0');
    expect(MIGRATION).toMatch(
      /REVOKE ALL ON FUNCTION private\.ar_has_recorded_receipt\(text, numeric\)[\s\S]*FROM PUBLIC, anon, authenticated, service_role/,
    );
    expect(MIGRATION).not.toContain('pg_catalog.coalesce');
  });

  it('injeta o mesmo guard nos tres writers vivos com anchor unico', () => {
    for (const signature of [
      'public.complete_nfe_cancellation_command_impl_126(uuid,text,text)',
      'public.tg_reverse_revenue_on_untracked_cancel()',
      'public.revert_invoiced_sale_order_internal_108(uuid,text)',
    ]) {
      expect(MIGRATION).toContain(signature);
    }
    expect(MIGRATION.match(/NOT private\.ar_has_recorded_receipt/g)).toHaveLength(3);
    expect(MIGRATION.match(/v_old_occurrences <> 1 OR v_new_occurrences <> 0/g)).toHaveLength(3);
    expect(MIGRATION.match(/EXECUTE pg_catalog\.replace\(v_definition, v_old, v_new\)/g)).toHaveLength(3);
    expect(MIGRATION.match(/IF v_old_occurrences = 0 AND v_new_occurrences = 1/g)).toHaveLength(3);
  });

  it('nao faz backfill nem muda politica de AP, factoring ou CMV', () => {
    expect(MIGRATION).not.toMatch(/\b(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\./i);
    expect(MIGRATION).not.toContain('accounts_payable');
    expect(MIGRATION).not.toContain('factoring');
    expect(MIGRATION).not.toContain('sale_order_cmv');
  });

  it('prova os tres caminhos apenas com PVs, NF-e e AR sinteticos', () => {
    expect(E2E).toMatch(/^--[\s\S]*\nBEGIN;\n/);
    expect(E2E.trimEnd()).toMatch(/ROLLBACK;$/);
    expect(E2E).toContain('SET LOCAL plpgsql.check_asserts = on;');
    expect(E2E).toContain('SET CONSTRAINTS ALL IMMEDIATE;');
    expect(E2E).toContain('INSERT INTO public.sale_orders');
    expect(E2E).toContain('INSERT INTO public.nfe_emitidas');
    expect(E2E).toContain("'E2E158-COMPLETE-' || v_suffix");
    expect(E2E).toContain("'E2E158-REVERT-' || v_suffix");
    expect(E2E).toContain("'E2E158-TRIGGER-' || v_suffix");
    expect(E2E).toContain('public.complete_nfe_cancellation_command_impl_126(');
    expect(E2E).toContain('public.revert_invoiced_sale_order_command(');
    expect(E2E).toMatch(
      /UPDATE public\.nfe_emitidas[\s\S]*SET status = 'cancelada'/,
    );
    expect(E2E).not.toContain('begin_nfe_cancellation_command(');
    expect(E2E).not.toContain('FROM public.nfe_devolucoes');
  });

  it('mantem exatamente 18 AR e cancela somente as tres sem caixa', () => {
    expect(E2E).toContain('SELECT pg_catalog.count(*) = 18');
    expect(E2E).toContain('SELECT pg_catalog.count(*) = 3');
    expect(E2E).toContain("ar.status = 'cancelled'");
    expect(E2E).toContain('ar.amount_received = 0');
    expect(E2E).toContain('ar.payment_date IS NULL');
    for (const fixture of [
      "'pending-cash', 'pending', 25::numeric",
      "'partial-status', 'partial', 0::numeric",
      "'parcial-status', 'parcial', 0::numeric",
      "'received-status', 'received', 100::numeric",
      "'recebido-status', 'recebido', 0::numeric",
    ]) {
      expect(E2E).toContain(fixture);
    }
  });
});
