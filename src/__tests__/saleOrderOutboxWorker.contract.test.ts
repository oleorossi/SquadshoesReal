import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const MIGRATION = readFileSync(resolve(
  ROOT,
  'supabase/migrations/20270101010900_sale_order_outbox_worker.sql',
), 'utf8');
const WORKER = readFileSync(resolve(
  ROOT,
  'supabase/functions/process-sale-order-outbox/index.ts',
), 'utf8');
const CONFIG = readFileSync(resolve(ROOT, 'supabase/config.toml'), 'utf8');

describe('sale-order outbox worker — contrato', () => {
  it('faz claim exclusivo, ordenado por agregado e com lock expirável', () => {
    expect(MIGRATION).toContain('CREATE OR REPLACE FUNCTION public.claim_sale_order_outbox');
    expect(MIGRATION).toContain('FOR UPDATE OF o SKIP LOCKED');
    expect(MIGRATION).toContain('earlier.aggregate_key = o.aggregate_key');
    expect(MIGRATION).toContain("earlier.status IN (\n              'pending', 'failed', 'processing', 'dead_letter'");
    expect(MIGRATION).toContain('make_interval(secs => p_lease_seconds)');
    expect(MIGRATION).toContain("SET status = 'processing'");
    expect(MIGRATION).toContain('lock_token = gen_random_uuid()');
    expect(MIGRATION).toContain('attempts = o.attempts + 1');
  });

  it('tem ack, retry exponencial, dead-letter e heartbeat', () => {
    expect(MIGRATION).toContain('CREATE OR REPLACE FUNCTION public.complete_sale_order_outbox');
    expect(MIGRATION).toContain('CREATE OR REPLACE FUNCTION public.fail_sale_order_outbox');
    expect(MIGRATION).toContain("THEN 'dead_letter'");
    expect(MIGRATION).toContain('power(2, GREATEST(v_attempts - 1, 0))');
    expect(MIGRATION).toContain('AND lock_token = p_lock_token');
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS public.sale_order_outbox_runs');
    expect(WORKER).toContain('record_sale_order_outbox_run');
  });

  it('reconcilia financeiro e contribuição versionada de compra no servidor', () => {
    expect(WORKER).toContain('syncFinancialRecordsCore(admin, event.sale_order_id)');
    expect(WORKER).toContain('process_sale_order_purchase_shortages');
    expect(MIGRATION).toContain('public.compute_materials_per_pv(ARRAY[p_sale_order_id])');
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS public.sale_order_purchase_shortage_effects');
    expect(MIGRATION).toContain("v_po.status IN ('suggested', 'draft')");
    expect(MIGRATION).toContain('v_current_digest = v_effect.applied_digest');
    for (const protectedField of [
      'source_pv_ids',
      'linked_sale_order_ids',
      'approval_preflight_token',
      'approval_preflight_by',
      'approval_preflight_actor_name',
      'approval_preflight_at',
      'approval_preflight_revision',
      'approval_preflight_digest',
    ]) {
      expect(MIGRATION).toContain(`'${protectedField}', po.${protectedField}`);
    }
    expect(MIGRATION).toContain("'oc_nao_editavel_exige_reconciliacao_manual'");
    expect(MIGRATION).toContain("'auto_pv:outbox:'");
    expect(MIGRATION).not.toContain('public.upsert_open_purchase_order(');
    expect(MIGRATION).toContain("'sale_order.purchase_attention_required'");
    expect(MIGRATION).toMatch(
      /REVOKE ALL ON FUNCTION public\.process_sale_order_purchase_shortages\(uuid\)[\s\S]*?FROM PUBLIC, anon, authenticated/,
    );
  });

  it('expõe uma única API de consumo e não permite que atenção humana seja drenada', () => {
    expect(MIGRATION).toContain(
      'REVOKE ALL ON FUNCTION public.claim_sale_order_command_outbox(text, integer, integer)',
    );
    expect(MIGRATION).toContain(
      "o.event_type NOT IN (\n         'sale_order.material_plan_commit_failed'",
    );
    expect(MIGRATION).toContain("'sale_order.purchase_attention_required'");
    expect(WORKER).toContain('p_lock_token: event.lock_token');
  });

  it('faz sweep seguro de holds standalone sem impedir o worker', () => {
    expect(WORKER).toContain('release_stale_standalone_nfe_stock_holds');
    expect(WORKER).toContain('p_before: new Date().toISOString()');
    expect(WORKER).toContain('maintenance.standalone_nfe_stock_holds');
    expect(WORKER).toContain('console.warn');
    expect(WORKER).toContain('p_maintenance_result: maintenance');
  });

  it('autentica o cron dentro do handler e registra o agendamento', () => {
    expect(CONFIG).toMatch(
      /\[functions\.process-sale-order-outbox\]\s*\nverify_jwt = false/,
    );
    expect(WORKER).toContain('get_nfe_sync_cron_secret');
    expect(WORKER).toContain('cronSecretHeader === storedSecret');
    const createSecretFunctionAt = MIGRATION.indexOf(
      'CREATE OR REPLACE FUNCTION public.get_nfe_sync_cron_secret()',
    );
    const revokeSecretFunctionAt = MIGRATION.indexOf(
      'REVOKE ALL ON FUNCTION public.get_nfe_sync_cron_secret()',
    );
    expect(createSecretFunctionAt).toBeGreaterThanOrEqual(0);
    expect(revokeSecretFunctionAt).toBeGreaterThan(createSecretFunctionAt);
    expect(MIGRATION).toContain("get_nfe_sync_cron_secret exige service_role");
    expect(MIGRATION).toContain("WHERE name = 'nfe_sync_cron_secret'");
    expect(MIGRATION).toMatch(
      /REVOKE ALL ON FUNCTION public\.get_nfe_sync_cron_secret\(\)[\s\S]*?FROM PUBLIC, anon, authenticated/,
    );
    expect(MIGRATION).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_nfe_sync_cron_secret\(\)[\s\S]*?TO service_role/,
    );
    expect(MIGRATION).toContain("'sale-order-outbox'");
    expect(MIGRATION).toContain("'* * * * *'");
  });
});
