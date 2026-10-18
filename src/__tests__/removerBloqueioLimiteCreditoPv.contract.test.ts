import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const MIGRATION =
  'supabase/migrations/20270101042900_remover-bloqueio-limite-credito-pv.sql';
const SALE_ORDER_FORM = 'src/pages/SaleOrderForm.tsx';
const FORM_PANEL = 'src/components/sale-orders/SaleOrderFormPanel.tsx';

describe('Remover bloqueio de limite de crédito do PV — contratos', () => {
  it('migration remove o blocker do preflight do PV de forma idempotente', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain('preflight_sale_order_command(uuid,text,bigint,uuid,jsonb)');
    expect(sql).toContain("'code', 'credit_limit_exceeded'");
    expect(sql).toContain("position('credit_limit_exceeded' IN v_definition) = 0");
    expect(sql).toContain('v_old_block');
    expect(sql).toContain("replace(v_definition, v_old_block, '')");
    // Não mexe na NF-e avulsa.
    expect(sql).toContain('preflight_standalone_nfe_emission');
    expect(sql).toContain('Definição inesperada: preflight do PV não deve citar NF-e avulsa');
  });

  it('formulário do PV não checa mais limite de crédito no submit', () => {
    const form = readFileSync(SALE_ORDER_FORM, 'utf8');
    expect(form).not.toContain('fetchClientCreditExposure');
    expect(form).not.toContain('skipCreditCheck');
    expect(form).not.toContain('creditLimitConfirm');
    expect(form).not.toContain('Limite de crédito ultrapassado');
    expect(form).not.toContain("select('credit_limit, name')");
    // Dialog genérico de falha de checagem permanece (estoque/capacidade).
    expect(form).toContain('unverifiedConfirm');
  });

  it('painel do PV não mostra badge de exposição de crédito', () => {
    const panel = readFileSync(FORM_PANEL, 'utf8');
    expect(panel).not.toContain('fetchClientCreditExposure');
    expect(panel).not.toContain('client_credit_exposure');
    expect(panel).not.toContain('Crédito:');
    // Bloqueio comercial (outro conceito) permanece.
    expect(panel).toContain('block_new_orders');
  });
});
