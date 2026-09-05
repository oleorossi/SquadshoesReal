import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');
const MIGRATION = read(
  'supabase/migrations/20270101015900_financial_settlement_ledger.sql',
);
const LEGACY_SETUP = read(
  'supabase/tests/setup_financial_settlement_ledger_legacy.sql',
);
const E2E = read('supabase/tests/financial_settlement_ledger_e2e.sql');

// Contrato estatico de CI. A prova comportamental continua sendo setup ->
// migration -> E2E numa unica transacao, sempre encerrada por ROLLBACK.
describe('ledger financeiro imutavel AP/AR — contrato 15900', () => {
  it('separa recibo, saldo legado, eventos e CMV por evento', () => {
    expect(MIGRATION).toContain(
      'CREATE TABLE public.financial_settlement_command_receipts',
    );
    expect(MIGRATION).toContain(
      'CREATE TABLE public.financial_settlement_account_heads',
    );
    expect(MIGRATION).toContain(
      'CREATE TABLE public.financial_settlement_events',
    );
    expect(MIGRATION).toContain(
      'CREATE TABLE public.financial_settlement_cmv_events',
    );
    expect(MIGRATION).toContain('opening_cmv_amount numeric');
    expect(MIGRATION).toContain('opening_cmv_total_snapshot numeric');
    expect(MIGRATION).toContain('quality_issue text');
    expect(MIGRATION).toContain('ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED');
    expect(MIGRATION).not.toMatch(
      /UPDATE\s+public\.financial_settlement_(?:events|account_heads|command_receipts)/i,
    );
  });

  it('aceita somente dinheiro em centavos, datas passadas e metodos canonicos', () => {
    expect(MIGRATION).toContain(
      "amount::text NOT IN ('NaN', 'Infinity', '-Infinity')",
    );
    expect(MIGRATION).toContain('amount = pg_catalog.round(amount, 2)');
    expect(MIGRATION).toContain("('pix', 'transferencia', 'boleto', 'dinheiro', 'cheque', 'cartao', 'outro')");
    expect(MIGRATION).toContain('v_effective_on > v_today');
    expect(MIGRATION).toContain("!~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'");
    expect(MIGRATION).toContain('pg_catalog.length(COALESCE(v_reference, \'\')) > 500');
    expect(MIGRATION).toContain('pg_catalog.length(COALESCE(v_notes, \'\')) > 4000');
    expect(MIGRATION).toContain('pg_catalog.length(v_reason) > 4000');
  });

  it('fecha lote com hash, advisory lock, locks ordenados e replay integral', () => {
    expect(MIGRATION).toContain(
      'CREATE OR REPLACE FUNCTION private.execute_financial_settlement_core_159(',
    );
    expect(MIGRATION).toContain('pg_catalog.pg_advisory_xact_lock(');
    expect(MIGRATION).toContain('FOR UPDATE;');
    expect(MIGRATION).toContain("ORDER BY event.account_kind, account_id");
    expect(MIGRATION).toContain('Replay divergente para command_id');
    expect(MIGRATION).toContain("'replayed', true");
    expect(MIGRATION).toContain('v_entry_count > 200');
  });

  it('nao permite que cliente forje origem nem estorne origem de outro canal', () => {
    expect(MIGRATION).toMatch(
      /p_payload \? 'source_type'[\s\S]*?IS DISTINCT FROM 'manual'/,
    );
    expect(MIGRATION).toContain(
      'v_original_event.source_type IS DISTINCT FROM p_source_type',
    );
    expect(MIGRATION).toContain(
      'v_original_event.source_reference IS DISTINCT FROM p_source_reference',
    );
    expect(MIGRATION).toContain(
      'Cliente manual nao pode declarar source_line_key',
    );
    expect(MIGRATION).toContain(
      'financial_settlement_events_external_source_uq',
    );
  });

  it('protege projecoes legadas sem GUC forjavel e mantem current_balance fora', () => {
    expect(MIGRATION).toContain(
      'CREATE OR REPLACE FUNCTION private.tg_assert_financial_account_projection_159()',
    );
    expect(MIGRATION).toContain(
      'Campos de caixa legados sao imutaveis; use execute_financial_settlement',
    );
    expect(MIGRATION).toContain(
      'Titulo com historico de liquidacao nao pode ser excluido',
    );
    expect(MIGRATION).toContain(
      'Vinculo do recebivel com PV e imutavel apos iniciar o historico de liquidacao',
    );
    expect(MIGRATION).toMatch(
      /UPDATE OF\s+amount, amount_received, status, payment_date, payment_method, sale_order_id/,
    );
    expect(MIGRATION).not.toMatch(/(?:NEW|OLD)\.amount_(?:paid|received)/);
    expect(MIGRATION).not.toMatch(/set_config\('app\.financial_settlement/i);
    expect(MIGRATION).not.toMatch(
      /UPDATE\s+public\.bank_accounts[\s\S]{0,200}current_balance/i,
    );
  });

  it('expoe caixa e CMV por evento com legado e pendencia explicitos', () => {
    expect(MIGRATION).toContain(
      'CREATE OR REPLACE VIEW public.financial_cash_movements',
    );
    expect(MIGRATION).toContain(
      'CREATE OR REPLACE VIEW public.financial_cash_cmv_movements',
    );
    expect(MIGRATION).toContain(
      'CREATE OR REPLACE VIEW public.financial_settlement_cmv_pending',
    );
    expect(MIGRATION.match(/WITH \(security_invoker = true\)/g)).toHaveLength(3);
    expect(MIGRATION).toContain("'rounding_adjustment'");
    expect(MIGRATION).toContain(
      'v_recognized_target - v_recognized_before',
    );
    expect(MIGRATION).toContain("'cmv_complete'");
    expect(MIGRATION).toContain(
      'Saldo acumulado anterior sem discriminação individual; não representa um movimento novo.',
    );
    expect(MIGRATION).toContain('cmv_basis_changed_since_original');
    expect(MIGRATION).toContain(
      "'reversal', -v_original_cmv.recognized_amount",
    );
    expect(MIGRATION).toMatch(
      /financial_settlement_cmv_pending[\s\S]*?opening_cmv_amount IS NULL[\s\S]*?NOT EXISTS \([\s\S]*?sale_order_cmv_recognized/,
    );
  });

  it('integra ciclo terceirizado ao core e fecha ACL/search_path', () => {
    expect(MIGRATION).toMatch(
      /CREATE OR REPLACE FUNCTION public\.mark_contractor_payment_cycle_paid[\s\S]*?private\.execute_financial_settlement_core_159/,
    );
    expect(MIGRATION).toContain(
      "private.execute_financial_settlement_core_159(\n  uuid,text,jsonb,text,text\n) FROM PUBLIC, anon, authenticated, service_role",
    );
    expect(MIGRATION).toMatch(
      /CREATE OR REPLACE FUNCTION public\.execute_financial_settlement[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = ''[\s\S]*?user_has_any_role/,
    );
    expect(MIGRATION).toContain(
      "GRANT EXECUTE ON FUNCTION public.execute_financial_settlement(uuid,text,jsonb)",
    );
    expect(MIGRATION).toMatch(
      /REVOKE ALL ON TABLE public\.financial_settlement_events\s+FROM PUBLIC, anon, authenticated, service_role/,
    );
    expect(MIGRATION).toContain(
      "'service_role', relation_name.name, privilege_name.name",
    );
  });

  it('mantem fixture e E2E transacionais sem desabilitar protecoes', () => {
    expect(LEGACY_SETUP).toContain(
      'CREATE TEMP TABLE e2e_financial159_legacy_fixture',
    );
    expect(LEGACY_SETUP).toContain(
      'Setup legado 15900 deve rodar antes da migration do ledger',
    );
    expect(E2E).toContain('SET LOCAL plpgsql.check_asserts = on');
    expect(E2E).toContain('Reset direto apagou baixa legada sem head');
    expect(E2E).toContain('Wrapper manual estornou evento OFX');
    expect(E2E).toContain("event_type = 'rounding_adjustment'");
    expect(E2E).toContain('Cancelamento posterior apagou CMV de abertura');
    expect(E2E).toContain('Mudanca material de base virou falso ajuste de centavos');
    expect(E2E).toContain(
      'Estorno posterior apagou pendencia da competencia original',
    );
    expect(E2E).toContain(
      'Mudanca de PV apagaria a evidencia temporal do recebimento/estorno',
    );
    expect(E2E).toContain(
      'AR legada sem head/CMV nao ficou visivel como pendencia historica',
    );
    expect(E2E).toContain(
      'Aprovado financeiro nao conseguiu executar a RPC',
    );
    expect(E2E).toContain(
      'Perfil aprovado sem papel financeiro conseguiu executar a RPC',
    );
    expect(E2E).toContain('SET LOCAL ROLE authenticated;');
    expect(E2E).toContain('SET CONSTRAINTS ALL IMMEDIATE;');
    expect(E2E.trimStart()).toContain('BEGIN;');
    expect(E2E.trimEnd()).toMatch(/ROLLBACK;$/);
    const sql = `${LEGACY_SETUP}\n${E2E}`;
    expect(sql).not.toMatch(/session_replication_role/i);
    expect(sql).not.toMatch(/(?:DISABLE|ENABLE)\s+TRIGGER/i);
  });
});
