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
    expect(MIGRATION).toContain('PARTITION BY o.aggregate_key');
    expect(MIGRATION).toContain("locked_at < now() - interval '5 minutes'");
    expect(MIGRATION).toContain('attempts = o.attempts + 1');
  });

  it('tem ack, retry exponencial, dead-letter e heartbeat', () => {
    expect(MIGRATION).toContain('CREATE OR REPLACE FUNCTION public.complete_sale_order_outbox');
    expect(MIGRATION).toContain('CREATE OR REPLACE FUNCTION public.fail_sale_order_outbox');
    expect(MIGRATION).toContain("THEN 'dead_letter'");
    expect(MIGRATION).toContain('power(2, GREATEST(v_attempts - 1, 0))');
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS public.sale_order_outbox_runs');
    expect(WORKER).toContain('record_sale_order_outbox_run');
  });

  it('reconcilia financeiro e compra somente no servidor', () => {
    expect(WORKER).toContain('syncFinancialRecordsCore(admin, event.sale_order_id)');
    expect(WORKER).toContain('process_sale_order_purchase_shortages');
    expect(MIGRATION).toContain('public.compute_materials_per_pv(ARRAY[p_sale_order_id])');
    expect(MIGRATION).toContain('public.upsert_open_purchase_order');
    expect(MIGRATION).toContain("'sale_order.purchase_attention_required'");
    expect(MIGRATION).toMatch(
      /REVOKE ALL ON FUNCTION public\.process_sale_order_purchase_shortages\(uuid\)[\s\S]*?FROM PUBLIC, anon, authenticated/,
    );
  });

  it('autentica o cron dentro do handler e registra o agendamento', () => {
    expect(CONFIG).toMatch(
      /\[functions\.process-sale-order-outbox\]\s*\nverify_jwt = false/,
    );
    expect(WORKER).toContain('get_nfe_sync_cron_secret');
    expect(WORKER).toContain('cronSecretHeader === storedSecret');
    expect(MIGRATION).toContain("'sale-order-outbox'");
    expect(MIGRATION).toContain("'* * * * *'");
  });
});
