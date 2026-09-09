import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const SQL = readFileSync(
  resolve(
    ROOT,
    'supabase/migrations/20270101012000_unificar_diagnosticos_integridade_faturamento.sql',
  ),
  'utf8',
);
const UI = readFileSync(resolve(ROOT, 'src/pages/SystemDiagnostics.tsx'), 'utf8');

const NEW_CHECKS = [
  'billing_health_aggregate_drift',
  'authorized_nfe_unlinked_strong_match',
  'faturado_without_authorized_nfe',
  'faturado_ar_reconciliation_queue',
  'faturado_op_integrity',
  'finalized_consumption_zero_without_pending',
  'op_stock_movement_without_reservation_trace',
  'strap_migration_review_required',
  'strap_napa_width_inverted',
  'strap_executor_calendar_missing',
  'strap_executor_capacity_missing',
  'strap_demand_capacity_suspended',
  'strap_identity_dead_letter',
  'strap_batch_unscheduled_balance',
  'strap_legacy_billed_service_order_open',
  'strap_production_receipt_stock_ledger_gap',
] as const;

describe('composição central dos diagnósticos do PV', () => {
  it('renomeia o diagnóstico legado para core de forma tolerante a replay', () => {
    expect(SQL).toContain('DO $rename_command_diagnostics_core$');
    expect(SQL).toContain(
      "to_regprocedure(\n       'public.get_sale_order_command_diagnostics_core(uuid)'",
    );
    expect(SQL).toContain(
      'ALTER FUNCTION public.get_sale_order_command_diagnostics(uuid)\n      RENAME TO get_sale_order_command_diagnostics_core',
    );
    expect(SQL.indexOf('RENAME TO get_sale_order_command_diagnostics_core')).toBeLessThan(
      SQL.indexOf('CREATE OR REPLACE FUNCTION public.get_sale_order_command_diagnostics('),
    );
  });

  it('preserva assinatura pública e compõe os quatro rowsets', () => {
    expect(SQL).toContain('RETURNS TABLE(\n  check_name text,');
    for (const functionName of [
      'get_sale_order_command_diagnostics_core',
      'get_sale_order_billing_integrity_diagnostics',
      'get_op_stock_integrity_diagnostics',
      'get_strap_flow_integrity_diagnostics',
    ]) {
      expect(SQL).toContain(`FROM public.${functionName}(p_sale_order_id)`);
    }
    const wrapper = SQL.slice(
      SQL.indexOf('CREATE OR REPLACE FUNCTION public.get_sale_order_command_diagnostics('),
      SQL.indexOf(
        'REVOKE ALL ON FUNCTION public.get_sale_order_command_diagnostics(uuid)',
      ),
    );
    expect(wrapper.match(/RETURN QUERY/g)).toHaveLength(4);
    expect(wrapper).toContain('SECURITY DEFINER');
    expect(wrapper).toContain("SET search_path = ''");
    expect(wrapper).toMatch(
      /IF coalesce\([\s\S]*?OR public\.user_has_any_role\(ARRAY\['admin', 'gerente'\]\) THEN[\s\S]*?get_sale_order_billing_integrity_diagnostics\(p_sale_order_id\)[\s\S]*?END IF;/,
    );
    expect(wrapper).not.toContain("'producao'");

    const billingEnd = wrapper.indexOf('END IF;');
    expect(wrapper.indexOf('get_op_stock_integrity_diagnostics', billingEnd)).toBeGreaterThan(
      billingEnd,
    );
    expect(wrapper.indexOf('get_strap_flow_integrity_diagnostics', billingEnd)).toBeGreaterThan(
      billingEnd,
    );
  });

  it('mantém o wrapper autenticado e torna o core inacessível diretamente', () => {
    expect(SQL).toMatch(
      /REVOKE ALL ON FUNCTION public\.get_sale_order_command_diagnostics_core\(uuid\)[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/,
    );
    expect(SQL).toMatch(
      /REVOKE ALL ON FUNCTION public\.get_sale_order_command_diagnostics\(uuid\)[\s\S]*?FROM PUBLIC, anon, authenticated, service_role[\s\S]*?GRANT EXECUTE ON FUNCTION public\.get_sale_order_command_diagnostics\(uuid\)[\s\S]*?TO authenticated, service_role/,
    );
  });

  it('executa self-test read-only de existência, composição e ACL antes do commit', () => {
    const contract = SQL.slice(
      SQL.indexOf(
        'CREATE OR REPLACE FUNCTION public.run_sale_order_integrity_composition_contract_tests()',
      ),
      SQL.indexOf('REVOKE ALL ON FUNCTION public.run_sale_order_integrity_composition_contract_tests()'),
    );
    for (const caseName of ['DIAG1', 'DIAG2', 'DIAG3']) {
      expect(contract).toContain(`'${caseName}`);
    }
    expect(contract).toContain('pg_get_function_result');
    expect(contract).toContain('pg_get_functiondef');
    expect(contract).toContain('has_function_privilege');
    expect(contract).toContain('NOT public.is_approved_user()');
    expect(contract).toContain("public.user_has_any_role(ARRAY['admin', 'gerente'])");
    expect(contract).toContain(
      'Contratos do diagnostico consolidado exigem Administracao/Gerencia',
    );
    expect(contract).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
    expect(SQL.indexOf('DO $self_test$')).toBeLessThan(SQL.lastIndexOf('COMMIT;'));
    expect(SQL.slice(SQL.indexOf('DO $self_test$'))).toContain(
      'run_sale_order_integrity_composition_contract_tests()',
    );
  });

  it('torna todos os sinais novos obrigatórios e traduz seus rótulos na UI', () => {
    const required = UI.slice(
      UI.indexOf('const REQUIRED_PV_SYSTEM_SIGNALS'),
      UI.indexOf('const PV_SYSTEM_SIGNAL_LABELS'),
    );
    const labels = UI.slice(
      UI.indexOf('const PV_SYSTEM_SIGNAL_LABELS'),
      UI.indexOf('/** Linha do debit_consistency_report()'),
    );
    for (const checkName of NEW_CHECKS) {
      expect(required).toContain(`'${checkName}'`);
      expect(labels).toMatch(new RegExp(`\\b${checkName}: '[^']+'`));
    }
    expect(UI).toContain('integridade fiscal/financeira');
    expect(UI).toContain('cobertura OP↔estoque');
    expect(UI).toContain('fluxo canônico de Tiras');
  });
});
