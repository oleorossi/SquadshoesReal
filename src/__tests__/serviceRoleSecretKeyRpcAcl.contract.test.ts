import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(
  process.cwd(),
  'supabase/migrations/20270101012800_service_role_secret_key_rpc_acl.sql',
), 'utf8');

const serviceRoleSignatures = [
  'public.abort_nfe_devolucao_before_provider(uuid,text)',
  'public.begin_nfe_cancellation_command(uuid,text)',
  'public.begin_nfe_devolucao_command(uuid,uuid,jsonb,text,uuid)',
  'public.bind_standalone_nfe_stock_hold(uuid,uuid)',
  'public.claim_nfe_devolucao_provider_submission(uuid,jsonb)',
  'public.claim_sale_order_outbox(text,integer,integer)',
  'public.commit_standalone_nfe_stock_hold(uuid,uuid)',
  'public.complete_nfe_devolucao_command(uuid)',
  'public.complete_sale_order_outbox(uuid,text,uuid,jsonb)',
  'public.emit_sale_order_purchase_attention(uuid,bigint,text,jsonb)',
  'public.fail_sale_order_outbox(uuid,text,uuid,text,integer)',
  'public.get_nfe_sync_cron_secret()',
  'public.mark_nfe_devolucao_reconciliation_required(uuid,text)',
  'public.mark_standalone_nfe_stock_hold_reconciliation(uuid,text)',
  'public.observe_nfe_provider_status_126(uuid,text,jsonb,text)',
  'public.process_sale_order_purchase_shortages(uuid)',
  'public.record_nfe_devolucao_provider_creation(uuid,text,jsonb)',
  'public.record_nfe_devolucao_provider_result(uuid,text,text,text,text,text,text,timestamptz,text,jsonb)',
  'public.record_sale_order_outbox_run(text,integer,integer,integer,integer,integer,jsonb,text)',
  'public.release_stale_standalone_nfe_stock_holds(timestamptz)',
  'public.release_standalone_nfe_stock_hold(uuid,text)',
  'public.reverse_standalone_nfe_stock_for_cancel(uuid)',
];

describe('service-role RPCs — compatibilidade com sb_secret', () => {
  it('reconhece JWT legado ou SET LOCAL ROLE sem confiar no definer', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.is_service_role_request_128()',
    );
    expect(migration).toContain(
      "current_setting('request.jwt.claim.role', true)",
    );
    expect(migration).toContain("current_setting('role', true)");
    expect(migration).toContain('SECURITY INVOKER');
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.is_service_role_request_128\(\)[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.is_service_role_request_128\(\)[\s\S]*?TO service_role/,
    );
  });

  it('cobre a superfície Edge e suas dependências transitivas', () => {
    expect(serviceRoleSignatures).toHaveLength(22);
    for (const signature of serviceRoleSignatures) {
      expect(migration).toContain(`('${signature}'`);
    }
    expect(migration).toContain('pg_catalog.count(*) = 22');
    expect(migration).toContain(
      "pg_catalog.has_function_privilege(\n             'service_role', fn.oid, 'EXECUTE'",
    );
    expect(migration).toContain(
      "NOT pg_catalog.has_function_privilege(\n             'authenticated', fn.oid, 'EXECUTE'",
    );
    expect(migration).toContain(
      "NOT pg_catalog.has_function_privilege(\n             'anon', fn.oid, 'EXECUTE'",
    );
  });

  it('mantém as implementações 126 somente para os wrappers owner', () => {
    for (const signature of [
      'public.begin_nfe_cancellation_command_impl_126(uuid,text)',
      'public.abort_nfe_cancellation_command_impl_126(uuid,text)',
      'public.complete_nfe_cancellation_command_impl_126(uuid,text,text)',
    ]) {
      expect(migration).toContain(`('${signature}', false)`);
    }
    expect(migration).toContain('pg_catalog.count(*) = 3');
    expect(migration).toContain(
      "NOT pg_catalog.has_function_privilege(\n             'service_role', fn.oid, 'EXECUTE'",
    );
  });

  it('faz patch fail-closed e preserva a definição restante do catálogo', () => {
    expect(migration).toContain('pg_catalog.pg_get_functiondef(proc.oid)');
    expect(migration).toContain('v_guard_count <> 1');
    expect(migration).toContain('Formato do guard JWT divergiu');
    expect(migration).toContain(
      "v_patched_source, 'public.is_service_role_request_128()'",
    );
    expect(migration).toContain(
      'ALTER FUNCTION %s OWNER TO postgres',
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',
    );
  });

  it('corrige os triggers fiscais sem abrir EXECUTE ao cliente', () => {
    expect(migration).toContain(
      'public.tg_settle_standalone_nfe_stock()',
    );
    expect(migration).toContain(
      'public.tg_guard_standalone_nfe_active_hold_mutation()',
    );
    expect(migration).toContain(
      'public.tg_enforce_sale_order_command_boundary()',
    );
    expect(migration).toContain('v_guard_count <> 2');
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.tg_settle_standalone_nfe_stock\(\)[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.tg_guard_standalone_nfe_active_hold_mutation\(\)[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.tg_enforce_sale_order_command_boundary\(\)[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/,
    );
    expect(migration).toContain('app.sale_order_command_internal');
  });

  it('fecha PUBLIC/anon nos helpers de leitura sem remover authenticated', () => {
    for (const signature of [
      'public.compute_sale_order_nfe_volumes(uuid)',
      'public.compute_sale_order_box_breakdown(uuid)',
      'public.resolve_item_brand(uuid, text, uuid)',
    ]) {
      expect(migration).toContain(`REVOKE ALL ON FUNCTION ${signature}`);
      expect(migration).toMatch(new RegExp(
        `GRANT EXECUTE ON FUNCTION ${signature.replace(/[().]/g, '\\$&')}[\\s\\S]*?TO authenticated, service_role`,
      ));
    }
    expect(migration).toContain("SELECT 'nfe_read_helpers_acl'");
  });

  it('self-test não altera histórico e exercita contextos service/authenticated', () => {
    expect(migration).toContain(
      "set_config('request.jwt.claim.role', '', true)",
    );
    expect(migration).toContain('SET LOCAL ROLE service_role');
    expect(migration).toContain('SET LOCAL ROLE authenticated');
    expect(migration).toContain('SET LOCAL ROLE anon');
    expect(migration).toContain("claim_sale_order_outbox('', 1, 300)");
    expect(migration).toContain(
      'process_sale_order_purchase_shortages(NULL)',
    );
    expect(migration).toContain(
      'release_standalone_nfe_stock_hold(\n    NULL',
    );
    expect(migration).not.toMatch(/^\s*(INSERT|UPDATE|DELETE)\s/mi);
  });
});
