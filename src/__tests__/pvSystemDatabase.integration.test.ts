import { describe, expect, it } from 'vitest';
import {
  DB_TESTS_ENABLED,
  dbTestClient,
  describeFailures,
  runGuardSuite,
} from '@/test/dbGuards';

type DiagnosticRow = {
  check_name: string;
  category: string;
  severity: string;
  item_count: number;
  sample: string | null;
};

const REQUIRED_DIAGNOSTICS = [
  'command_receipts_in_progress_stale',
  'material_plan_readiness_blocked',
  'active_ops_outdated_plan',
  'debit_delta_missing',
  'unsafe_stock_debit_overloads',
  'partial_promotion_enabled',
  'sale_order_outbox_pending',
  'material_plan_commit_failures',
] as const;

const REQUIRED_CASE_DOMAINS = [
  'pendencias_delta',
  'resync_safe_overload',
  'grants_hardened',
  'promotion_single_engine',
  'readiness_gate',
  'command_receipts',
  'command_coverage',
  'granular_permissions',
] as const;

const REQUIRED_CONSUMPTION_CASE_DOMAINS = [
  'insole_explicit_pin_precedence',
  'insole_active_area_preference',
  'insole_linear_only_fallback',
  'packaging_discrete_ceil_per_item',
  'packaging_continuous_units_preserve_fraction',
  'consumption_canonical_overloads_only',
  'consumption_scalar_delegates_by_grade',
] as const;

(DB_TESTS_ENABLED ? describe : describe.skip)('PV System — contratos vivos do Supabase', () => {
  it('executa todos os guards obrigatórios sem zero casos', async () => {
    const rows = await runGuardSuite('run_sale_order_command_contract_tests');

    expect(rows.filter((row) => !row.ok), describeFailures(rows)).toHaveLength(0);
    expect(rows.length).toBeGreaterThanOrEqual(REQUIRED_CASE_DOMAINS.length);

    const caseNames = rows.map((row) => row.case_name.toLowerCase());
    for (const domain of REQUIRED_CASE_DOMAINS) {
      expect(
        caseNames.some((caseName) => caseName.includes(domain)),
        `Guard vivo ausente para ${domain}: ${caseNames.join(', ')}`,
      ).toBe(true);
    }
  });

  it('executa os guards de identidade da palmilha e embalagem discreta', async () => {
    const rows = await runGuardSuite(
      'run_sale_order_consumption_identity_parity_tests',
    );

    expect(rows.filter((row) => !row.ok), describeFailures(rows)).toHaveLength(0);
    expect(rows.length).toBeGreaterThanOrEqual(
      REQUIRED_CONSUMPTION_CASE_DOMAINS.length,
    );

    const caseNames = rows.map((row) => row.case_name.toLowerCase());
    for (const domain of REQUIRED_CONSUMPTION_CASE_DOMAINS) {
      expect(caseNames).toContain(domain);
    }
  });

  it('expõe todos os sinais operacionais do diagnóstico global', async () => {
    const { data, error } = await dbTestClient().rpc('get_sale_order_command_diagnostics', {
      p_sale_order_id: null,
    });
    if (error) throw error;

    const rows = (data ?? []) as DiagnosticRow[];
    expect(rows.length, '0 sinais não é diagnóstico verde').toBeGreaterThanOrEqual(
      REQUIRED_DIAGNOSTICS.length,
    );

    const byName = new Map(rows.map((row) => [row.check_name, row]));
    for (const checkName of REQUIRED_DIAGNOSTICS) {
      const row = byName.get(checkName);
      expect(row, `Sinal obrigatório ausente: ${checkName}`).toBeDefined();
      expect(row?.category).toBeTruthy();
      expect(row?.severity).toBeTruthy();
      expect(Number.isFinite(Number(row?.item_count))).toBe(true);
      expect(Number(row?.item_count)).toBeGreaterThanOrEqual(0);
    }
  });
});
