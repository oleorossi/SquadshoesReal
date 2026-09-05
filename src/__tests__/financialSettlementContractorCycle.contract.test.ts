import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const proof = readFileSync(resolve(root, 'supabase/tests/financial_settlement_contractor_cycle_e2e.sql'), 'utf8');
const migration = readFileSync(resolve(root, 'supabase/migrations/20270101015900_financial_settlement_ledger.sql'), 'utf8');
const writer = migration.split('CREATE OR REPLACE FUNCTION public.mark_contractor_payment_cycle_paid(')[1]
  .split('$function$;')[0];

// Prova estatica da presenca dos cenarios. Nao substitui executar o SQL:
// hashes legados/metodo explicito sao regressões que o dry-run deve verificar.
describe('ciclo terceirizado no ledger — prova transacional isolada', () => {
  it('mantem assinatura e fecha somente o saldo usando o core antes do ciclo/auditoria', () => {
    expect(writer).toContain('p_payment_method text DEFAULT NULL');
    expect(writer).toContain('p_correlation_id uuid DEFAULT pg_catalog.gen_random_uuid()');
    expect(writer).toContain('v_outstanding := v_payable.amount - v_settled');
    expect(writer).toContain("'contractor_cycle'");
    const core = writer.indexOf('private.execute_financial_settlement_core_159');
    const paid = writer.indexOf('UPDATE public.contractor_payment_cycles');
    const audit = writer.indexOf('INSERT INTO public.artisanal_strap_operational_audit_log');
    expect(core).toBeGreaterThan(0);
    expect(paid).toBeGreaterThan(core);
    expect(audit).toBeGreaterThan(paid);
  });

  it('mantem fixture com rollback, sem desativar triggers nem mudar usuarios reais', () => {
    expect(proof).toContain('BEGIN;');
    expect(proof.trim()).toMatch(/ROLLBACK;$/);
    expect(proof).toContain("SET LOCAL plpgsql.check_asserts = on;");
    expect(proof).toContain("SET LOCAL ROLE authenticated;");
    expect(proof).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+(?:public\.)?(?:profiles|user_roles)\b/i);
    expect(proof).not.toMatch(/DISABLE\s+TRIGGER|session_replication_role|\bCOMMIT\s*;/i);
    expect(proof).not.toMatch(/SET\s+amount_paid\s*=/i);
  });

  it('trava parcial, replay com outro UUID e rollback depois de entrar no core', () => {
    expect(proof).toContain('event.amount = 60');
    expect(proof).toContain("amount_signed) FROM public.financial_cash_movements");
    expect(proof).toContain("v_today, 'pix', v_other_command");
    expect(proof).toContain('contractor_payment_cycles_paid_by_fkey');
    expect(proof).toContain('WHERE command_id = v_command');
    expect(proof).toContain('Replay criou novo receipt financeiro');
    expect(proof).toContain('Baixa alterou competencia congelada');
  });

  it('inclui hash literal pre-159 e não tolera fallback silencioso de TED', () => {
    expect(proof).toContain("'legacy_pix', 'legacy_null'");
    expect(proof).toContain("THEN 'PIX' ELSE NULL END");
    expect(proof).toContain('Replay reescreveu hash legado');
    expect(proof).toContain('Pagamento pre-159 identico deve continuar sendo replay');
    expect(proof).toContain("v_today, 'TED', v_command");
    expect(proof).toContain('EXCEPTION WHEN invalid_parameter_value');
    expect(proof).toContain("AND method = 'transferencia'");
    expect(writer).toContain('v_cycle.payment_payload_hash IN (v_hash, v_legacy_hash)');
    expect(writer).toContain('Metodo de pagamento explicito invalido');
    expect(writer.indexOf("IF v_cycle.status = 'paid'")).toBeLessThan(
      writer.indexOf("IF p_payment_method IS NOT NULL"),
    );
  });
});
