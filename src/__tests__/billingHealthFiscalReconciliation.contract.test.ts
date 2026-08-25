import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const MIGRATION = read(
  'supabase/migrations/20270101011700_corrigir_billing_health_e_reconciliar_nfe.sql',
);
const FINANCIAL_SYNC = read('supabase/functions/sync-ar/financialSync.ts');
const NFE_HEALTH_CARD = read('src/components/nfe/NfeBillingHealthCard.tsx');
const MISSING_AR_HOOK = read('src/hooks/useReconcileMissingAR.ts');

function section(startMarker: string, endMarker: string): string {
  const start = MIGRATION.indexOf(startMarker);
  expect(start, `${startMarker} ausente`).toBeGreaterThanOrEqual(0);
  const end = MIGRATION.indexOf(endMarker, start + startMarker.length);
  expect(end, `${endMarker} ausente`).toBeGreaterThan(start);
  return MIGRATION.slice(start, end);
}

const BACKFILL = section(
  'DO $reconcile_confirmed_fiscal_links$',
  '-- ---------------------------------------------------------------------------\n-- 2.',
);
const BILLING_HEALTH = section(
  'CREATE OR REPLACE VIEW public.v_sale_order_billing_health',
  '-- ---------------------------------------------------------------------------\n-- 3.',
);
const MISSING_AR = section(
  'CREATE OR REPLACE VIEW public.v_faturado_sem_ar',
  '-- ---------------------------------------------------------------------------\n-- 4.',
);
const AR_QUEUE = section(
  'CREATE OR REPLACE VIEW public.v_faturado_ar_reconciliation_queue',
  '-- ---------------------------------------------------------------------------\n-- 5.',
);

describe('Saude fiscal e reconciliacao historica', () => {
  it('repara somente os tres pares confirmados com prova fiscal fail-closed', () => {
    for (const tuple of [
      "('PV-00116'::text, '258'::text, '08381155001875'::text, 14328.00::numeric)",
      "('PV-00151'::text, '287'::text, '32168100000118'::text, 13446.00::numeric)",
      "('PV-00157'::text, '289'::text, '08381155001875'::text, 18921.60::numeric)",
    ]) {
      expect(BACKFILL).toContain(tuple);
    }
    expect(BACKFILL.match(/\('PV-00\d{3}'::text/g)).toHaveLength(3);
    expect(BACKFILL).toContain("v_so.status <> 'Faturado'");
    expect(BACKFILL).toContain("= 'autorizada'");
    expect(BACKFILL).toContain('v_nfe.cnpj_destinatario');
    expect(BACKFILL).toContain('v_nfe.valor_total');
    expect(BACKFILL).toContain('v_nfe.chave_acesso');
    expect(BACKFILL).toContain('v_candidate_count <> 1');
    expect(BACKFILL).toContain('v_sale_order_count <> 1');
    expect(BACKFILL).toContain('v_nfe_count <> 1');
    expect(BACKFILL).toContain('other_nfe.sale_order_id = v_so.id');
    expect(BACKFILL).toContain("USING ERRCODE = '23514'");
  });

  it('segue a ordem de lock NF-e -> advisory do PV -> PV e aceita replay exato', () => {
    const nfeLock = BACKFILL.indexOf('FROM public.nfe_emitidas n\n     WHERE n.id = v_nfe_id\n     FOR UPDATE');
    const aggregateLock = BACKFILL.indexOf('pg_catalog.pg_advisory_xact_lock');
    const saleOrderLock = BACKFILL.indexOf('FROM public.sale_orders so\n     WHERE so.id = v_sale_order_id\n     FOR UPDATE');
    expect(nfeLock).toBeGreaterThanOrEqual(0);
    expect(aggregateLock).toBeGreaterThan(nfeLock);
    expect(saleOrderLock).toBeGreaterThan(aggregateLock);
    expect(BACKFILL).toContain('v_nfe.sale_order_id IS NOT NULL');
    expect(BACKFILL).toContain('AND n.sale_order_id IS NULL');
    expect(BACKFILL).toContain(
      'v_changed = 0 AND v_nfe.sale_order_id IS DISTINCT FROM v_so.id',
    );
    expect(BACKFILL).toContain(
      'v_sale_order_count = 0 AND v_nfe_count = 0',
    );
    expect(BACKFILL).toContain('CONTINUE;');
  });

  it('nao cria nem reativa parcela: solicita sync pelo worker idempotente', () => {
    expect(BACKFILL).not.toMatch(/INSERT INTO\s+public\.accounts_receivable/i);
    expect(BACKFILL).not.toMatch(/UPDATE\s+public\.accounts_receivable/i);
    expect(BACKFILL).not.toMatch(/INSERT INTO\s+public\.financial_entries/i);
    expect(BACKFILL).toContain('INSERT INTO public.sale_order_command_outbox');
    expect(BACKFILL).toContain("'sale_order.fiscal_link_reconciled'");
    expect(BACKFILL).toContain("'fiscal-link-backfill:nfe:'");
    expect(BACKFILL).toContain('ON CONFLICT (event_type, aggregate_key, idempotency_key) DO NOTHING');
    expect(BACKFILL).toContain("'request_financial_sync', true");
    expect(FINANCIAL_SYNC).toContain("if (ar.status === 'cancelled') continue;");
    expect(FINANCIAL_SYNC).toContain("status: 'pending'");
    expect(FINANCIAL_SYNC).not.toMatch(
      /accounts_receivable['"]\)\.update\(\{\s*status:\s*['"]pending['"]/,
    );
  });

  it('elimina o fanout ao agregar NF-e e AR em laterais independentes', () => {
    expect(BILLING_HEALTH).toContain('WITH (security_invoker = true)');
    expect(BILLING_HEALTH.match(/LEFT JOIN LATERAL/g)).toHaveLength(2);
    expect(BILLING_HEALTH).toContain('FROM public.nfe_emitidas n');
    expect(BILLING_HEALTH).toContain('FROM public.accounts_receivable a');
    expect(BILLING_HEALTH).not.toMatch(
      /LEFT JOIN public\.nfe_emitidas[\s\S]*LEFT JOIN public\.accounts_receivable[\s\S]*GROUP BY so\.id/,
    );
    for (const column of [
      'nfes_autorizadas',
      'nfes_rejeitadas',
      'nfes_canceladas',
      'nfes_ativas',
      'ar_pendente',
      'ar_count',
      'health',
    ]) {
      expect(BILLING_HEALTH).toContain(column);
    }
    expect(BILLING_HEALTH).toContain('COALESCE(a.amount, 0) - COALESCE(a.amount_received, 0)');
    expect(BILLING_HEALTH).toContain('COALESCE(ar.ar_ativas, 0) < COALESCE(ar.parcelas_esperadas, 1)');
  });

  it('neutraliza NF emitida antecipadamente, como no PV-00148', () => {
    expect(BILLING_HEALTH).toContain(
      'A autorizacao fiscal nao promove o PV por',
    );
    expect(BILLING_HEALTH).not.toContain("THEN 'nf_emitida_status_atrasado'");
    expect(BILLING_HEALTH).not.toContain("THEN 'nf_emitida_aguardando_faturamento'");
    expect(BILLING_HEALTH).not.toMatch(
      /WHEN COALESCE\(nf\.nfes_autorizadas, 0\) > 0[\s\S]*so\.status NOT IN/,
    );
  });

  it('mantem as views internas e entrega saude role-aware sem vazar AR ao operador fiscal', () => {
    for (const viewName of [
      'v_sale_order_billing_health',
      'v_faturado_sem_ar',
      'v_faturado_ar_reconciliation_queue',
    ]) {
      expect(MIGRATION).toMatch(
        new RegExp(
          `REVOKE ALL ON public\\.${viewName}[\\s\\S]*?FROM PUBLIC, anon, authenticated, service_role[\\s\\S]*?GRANT SELECT ON public\\.${viewName}[\\s\\S]*?TO service_role`,
        ),
      );
    }

    expect(BILLING_HEALTH).toContain(
      'CREATE OR REPLACE FUNCTION public.get_sale_order_billing_health_for_current_user(',
    );
    expect(BILLING_HEALTH).toContain(
      "ARRAY['admin', 'gerente', 'nfe_operator']",
    );
    expect(BILLING_HEALTH).toContain(
      "public.user_has_any_role(ARRAY['admin', 'gerente'])",
    );
    expect(BILLING_HEALTH).toContain(
      'THEN h.ar_pendente ELSE NULL::numeric END AS ar_pendente',
    );
    expect(BILLING_HEALTH).toContain(
      'THEN h.ar_count ELSE NULL::bigint END AS ar_count',
    );
    expect(BILLING_HEALTH).toContain(
      'AND coalesce(h.nfes_autorizadas, 0) = 0',
    );
    expect(BILLING_HEALTH).not.toMatch(
      /CASE WHEN v_can_see_ar THEN h\.health ELSE[\s\S]*?THEN 'faturado_sem_ar'/,
    );
    expect(MIGRATION).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_sale_order_billing_health_for_current_user\(boolean\)[\s\S]*?TO authenticated, service_role/,
    );
    expect(NFE_HEALTH_CARD).toContain(
      "'get_sale_order_billing_health_for_current_user'",
    );
    expect(NFE_HEALTH_CARD).not.toContain(".from('v_sale_order_billing_health')");
  });

  it('reconhece sale_orders.nfe apenas com status, CNPJ, valor e unicidade', () => {
    expect(MISSING_AR).toContain('WITH (security_invoker = true)');
    expect(MISSING_AR).toContain("btrim(COALESCE(so.nfe, '')) <> ''");
    expect(MISSING_AR).toContain('numbered_nfe.sale_order_id IS NULL');
    expect(MISSING_AR).toContain("= 'autorizada'");
    expect(MISSING_AR).toContain('numbered_nfe.cnpj_destinatario');
    expect(MISSING_AR).toContain('numbered_nfe.valor_total');
    expect(MISSING_AR.match(/AND 1 = \(/g)).toHaveLength(2);
    expect(MISSING_AR).toContain("THEN 'nf_autorizada'");
    expect(MISSING_AR).toContain('COALESCE(so.nfe_external, false)');
    expect(MISSING_AR).toContain('so.external_nfe_number');
    const externalBranch = MISSING_AR.slice(
      MISSING_AR.indexOf('WHEN COALESCE(so.nfe_external, false)'),
      MISSING_AR.indexOf("ELSE 'sem_nf'"),
    );
    expect(externalBranch).not.toContain('so.nfe,');
    expect(MISSING_AR).toContain('CREATE OR REPLACE FUNCTION public.list_faturado_sem_ar()');
    expect(MISSING_AR).toContain("ARRAY['admin', 'gerente']");
    expect(MIGRATION).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.list_faturado_sem_ar\(\)[\s\S]*?TO authenticated, service_role/,
    );
    expect(MISSING_AR_HOOK).toContain("rpc('list_faturado_sem_ar')");
    expect(MISSING_AR_HOOK).not.toContain(".from('v_faturado_sem_ar'");
  });

  it('expoe fila somente-leitura com acao segura e historico cancelado separado', () => {
    expect(AR_QUEUE).toContain('WITH (security_invoker = true)');
    expect(AR_QUEUE).toContain('ar_canceladas');
    expect(AR_QUEUE).toContain('valor_ar_cancelado');
    expect(AR_QUEUE).toContain('automaticamente_reconciliavel');
    expect(AR_QUEUE).toContain("'processar_outbox_sync_financeiro_sem_reativar_canceladas'");
    expect(AR_QUEUE).toContain("'revisar_documento_fiscal_antes_de_criar_ar'");
    expect(AR_QUEUE).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/i);
    expect(MIGRATION).toMatch(
      /REVOKE ALL ON public\.v_faturado_ar_reconciliation_queue[\s\S]*FROM PUBLIC, anon, authenticated, service_role/,
    );
  });

  it('publica helper fiscal normalizado e protegido para composicao central', () => {
    expect(MIGRATION).toContain(
      'CREATE OR REPLACE FUNCTION public.get_sale_order_billing_integrity_diagnostics(',
    );
    for (const check of [
      'billing_health_aggregate_drift',
      'authorized_nfe_unlinked_strong_match',
      'faturado_without_authorized_nfe',
      'faturado_ar_reconciliation_queue',
    ]) {
      expect(MIGRATION).toContain(`'${check}'`);
    }
    const helper = MIGRATION.slice(
      MIGRATION.indexOf(
        'CREATE OR REPLACE FUNCTION public.get_sale_order_billing_integrity_diagnostics(',
      ),
      MIGRATION.indexOf('COMMIT;'),
    );
    expect(helper).toContain("ARRAY['admin', 'gerente']");
    expect(helper).not.toContain("'producao'");
    expect(helper).toContain(
      "pg_catalog.current_setting('request.jwt.claim.role', true)",
    );
    expect(helper).toContain(
      'Diagnostico fiscal de PV exige Administracao/Gerencia e can_edit em /sales',
    );
    expect(MIGRATION).toMatch(
      /REVOKE ALL ON FUNCTION public\.get_sale_order_billing_integrity_diagnostics\(uuid\)[\s\S]*FROM PUBLIC, anon/,
    );
    expect(MIGRATION).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_sale_order_billing_integrity_diagnostics\(uuid\)[\s\S]*TO authenticated, service_role/,
    );
    expect(MIGRATION).not.toContain(
      'CREATE OR REPLACE FUNCTION public.get_sale_order_command_diagnostics(',
    );
  });
});
