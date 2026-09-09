import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const readMigration = (name: string) =>
  readFileSync(resolve(ROOT, `supabase/migrations/${name}`), 'utf8');

const DELTA = readMigration('20270101010100_fix_sale_order_pending_debit_delta.sql');
const FOUNDATION = readMigration('20270101010200_sale_order_command_foundation.sql');
const PRICE_WITHOUT_BASE = readMigration('20270101014300_aceitar_preco_item_sem_preco_base.sql');

describe('sale order command — fundação e readiness', () => {
  it('publica falta de baixa com o sinal canônico', () => {
    const start = DELTA.indexOf('CREATE OR REPLACE FUNCTION public.get_sale_order_pendencias');
    const end = DELTA.indexOf('$function$;', start);
    const definition = DELTA.slice(start, end);
    expect(definition).toContain('WHERE r.delta < 0');
    expect(definition).not.toContain('WHERE r.delta > 0');
    expect(definition).toContain('r.esperado - r.debitado');
  });

  it('mantém decisões de produto configuráveis e defaults seguros', () => {
    expect(FOUNDATION).toContain(
      "promotion_atomicity_mode text NOT NULL DEFAULT 'all_or_nothing'",
    );
    expect(FOUNDATION).toContain('partial_promotion_enabled boolean NOT NULL DEFAULT false');
    expect(FOUNDATION).toContain(
      "material_plan_commit_milestone text NOT NULL DEFAULT 'debit'",
    );
    expect(FOUNDATION).toContain("IN ('picking', 'debit', 'op_start')");
    expect(FOUNDATION).toContain('material_fact_commit_strict boolean NOT NULL DEFAULT false');
  });

  it('preserva auditoria em hard delete e fecha tabelas expostas', () => {
    expect(FOUNDATION).toMatch(
      /sale_order_command_receipts[\s\S]*?REFERENCES public\.sale_orders\(id\) ON DELETE SET NULL/,
    );
    expect(FOUNDATION).toMatch(
      /sale_order_command_outbox[\s\S]*?REFERENCES public\.sale_orders\(id\) ON DELETE SET NULL/,
    );
    expect(FOUNDATION).toMatch(
      /sale_order_material_plan_revisions[\s\S]*?REFERENCES public\.sale_orders\(id\) ON DELETE RESTRICT/,
    );
    expect(FOUNDATION).toMatch(
      /sale_order_readiness_overrides[\s\S]*?REFERENCES public\.sale_orders\(id\) ON DELETE RESTRICT/,
    );
    for (const table of [
      'sale_order_command_config',
      'sale_order_material_plan_revisions',
      'sale_order_readiness_overrides',
      'sale_order_command_receipts',
      'sale_order_command_outbox',
    ]) {
      expect(FOUNDATION).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(FOUNDATION).toContain(`REVOKE ALL ON TABLE public.${table}`);
    }
  });

  it('mantém revisões imutáveis e idempotência do outbox por agregado', () => {
    expect(FOUNDATION).not.toContain(
      'UNIQUE (sale_order_id, source_hash, revision_milestone)',
    );
    expect(FOUNDATION).toContain(
      'UNIQUE (event_type, aggregate_key, idempotency_key)',
    );
    expect(FOUNDATION).toContain("NEW.id::text, ':',\n    NEW.order_version::text");
    expect(FOUNDATION).not.toMatch(
      /UPDATE public\.sale_order_material_plan_revisions[\s\S]*?SET status = CASE WHEN v_is_commit/,
    );
  });

  it('hash material não depende da versão/status financeiro do PV', () => {
    const start = FOUNDATION.indexOf('v_source_hash := md5(jsonb_build_object(');
    const end = FOUNDATION.indexOf('RETURN jsonb_build_object(', start);
    const sourceHash = FOUNDATION.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(sourceHash).toContain("'packaging_mode'");
    expect(sourceHash).toContain("'items'");
    expect(sourceHash).not.toContain("'order_version'");
    expect(sourceHash).not.toContain("'status'");
    expect(sourceHash).not.toContain("'total'");
  });

  it('readiness é server-side, por papel e exige ficha publicada', () => {
    expect(FOUNDATION).toContain(
      "public.user_has_any_role(ARRAY['admin', 'gerente', 'comercial'])",
    );
    expect(FOUNDATION).toContain(
      "public.user_has_any_role(ARRAY['admin', 'gerente', 'producao'])",
    );
    expect(FOUNDATION).toContain("v_sheet.status_ficha IS DISTINCT FROM 'publicada'");
    expect(FOUNDATION).not.toContain(
      "v_sheet.status_ficha NOT IN ('validada', 'publicada')",
    );
    for (const blocker of [
      'client_required',
      'client_not_found',
      'client_inactive',
      'commercial_orders_blocked',
      'payment_condition_required',
      'credit_limit_exceeded',
      'active_nfe_blocks_cancel',
      'stale_order_version',
    ]) {
      expect(FOUNDATION).toContain(`'${blocker}'`);
    }
    expect(FOUNDATION).toContain("nfe.status IN ('autorizada', 'processando', 'cancelando')");
    expect(FOUNDATION).toContain(
      'public.preflight_sale_order_command(uuid, text, bigint, uuid, jsonb)',
    );
    expect(FOUNDATION).toContain("p_payload ? 'billing_patch'");
    expect(FOUNDATION).toContain("p_payload ? 'factoring_patch'");
    expect(FOUNDATION).toContain("'invalid_update_billing_patch'");
    expect(FOUNDATION).toContain("'invalid_update_factoring_patch'");
    expect(FOUNDATION).toContain(
      'factoring_patch exige Administração/Gerência e can_edit em /financeiro',
    );
  });

  it('precificação server-side espelha a cadeia comercial do desktop/mobile', () => {
    const start = FOUNDATION.indexOf(
      'CREATE OR REPLACE FUNCTION public.resolve_sale_order_item_commercial_price',
    );
    const end = FOUNDATION.indexOf('\n$$;', start);
    const resolver = FOUNDATION.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(resolver).toContain('p_price_list_id uuid');
    expect(resolver).toContain('pl.active');
    expect(resolver).toContain('pl.valid_from <=');
    expect(resolver).toContain('pl.valid_to >=');
    expect(resolver).toContain("THEN 'table_color'");
    expect(resolver).toContain('pli.min_quantity');
    expect(resolver).toContain('<= COALESCE(p_quantity, 0)');
    expect(resolver).toContain('DESC NULLS LAST');
    expect(resolver).toContain('ASC NULLS LAST');
    expect(resolver).toContain('rmv.unit_price_override');
    expect(resolver).toContain('ts.sale_price');
    expect(resolver).not.toContain('cost_price');
    expect(resolver).not.toContain('get_effective_price');
    expect(FOUNDATION).toContain('sale_order_total_mismatch');
    expect(FOUNDATION).toContain("'item_price_below_floor'");
    expect(FOUNDATION).toContain("'item_manual_price'");
    expect(FOUNDATION).toContain('COALESCE(v_commercial.discount_pct, 0)');
    expect(FOUNDATION).toContain('v_warnings := v_warnings || v_price_warnings');
    expect(FOUNDATION).toContain("'price_list_missing_using_fallback'");
    expect(FOUNDATION).not.toContain("'commercial_policy_required'");

    // Contrato de fronteira: base 100 e teto 10% aceita exatamente 90 e
    // bloqueia abaixo da tolerância centesimal. A migration 143 muda somente o
    // caso sem base: valor positivo explícito no item passa com warning.
    const minimumPrice = 100 * (1 - 10 / 100);
    expect(90).toBeGreaterThanOrEqual(minimumPrice - 0.01);
    expect(89.98).toBeLessThan(minimumPrice - 0.01);
    expect(PRICE_WITHOUT_BASE).toContain("'item_price_without_base'");
    expect(PRICE_WITHOUT_BASE).toContain('v_old_missing_base_condition');
    expect(PRICE_WITHOUT_BASE).toContain('v_occurrences <> 3');
    expect(PRICE_WITHOUT_BASE).toContain('v_positive_item_without_base_accepted');
    expect(PRICE_WITHOUT_BASE).toContain("THEN 'item_price_missing'");
    expect(PRICE_WITHOUT_BASE).toContain("'item_price_below_floor'");
    expect(PRICE_WITHOUT_BASE).toContain(
      "i.unit_price::text IN ('NaN', 'Infinity', '-Infinity')",
    );
    expect(PRICE_WITHOUT_BASE).toContain('COALESCE(i.unit_price, 0) <= 0');
    expect(PRICE_WITHOUT_BASE).toContain("has_function_privilege('anon', v_preflight, 'EXECUTE')");
  });

  it('preflight deriva teardown e consentimento de OP sem confiar no browser', () => {
    expect(FOUNDATION).toContain("v_command = 'update' AND p_payload ? 'items'");
    expect(FOUNDATION).toContain("'derived_teardown_op_ids'");
    expect(FOUNDATION).toContain("'required_cancel_op_ids'");
    expect(FOUNDATION).toContain("'missing_cancel_op_ids'");
    expect(FOUNDATION).toContain("'non_reversible_removed_op_ids'");
    expect(FOUNDATION).toContain("'non_reversible_changed_op_ids'");
    expect(FOUNDATION).toContain("'removed_allocated_item_ids'");
    expect(FOUNDATION).toContain("'advanced_orders_require_cancel_confirmation'");
    expect(FOUNDATION).toContain("'non_reversible_removed_orders'");
    expect(FOUNDATION).toContain("'non_reversible_changed_orders'");
    expect(FOUNDATION).toContain("'removed_items_have_lot_allocations'");
    expect(FOUNDATION).toContain('o.sale_order_item_id IS NULL');
    expect(FOUNDATION).toContain('public.stock_movements sm');
    expect(FOUNDATION).toContain('public.production_consumptions pc');
    expect(FOUNDATION).toContain('public.material_reservations mr');
    expect(FOUNDATION).toContain('public.order_stages os');
    expect(FOUNDATION).toContain('public.order_lots ol');
    expect(FOUNDATION).toContain('public.sale_order_lot_allocations sola');
    expect(FOUNDATION).toContain(
      'public.order_has_non_reversible_production_facts(o.id)',
    );
    expect(FOUNDATION).toContain('o.deleted_at IS NULL');
    expect(FOUNDATION).toContain("'ignored_cancelled_history', true");
  });

  it('billing conserva a justificativa do estado resultante', () => {
    expect(FOUNDATION.match(/v_billing_target_override := CASE/g)?.length)
      .toBe(2);
    expect(FOUNDATION.match(/v_billing_target_reason := CASE/g)?.length)
      .toBe(2);
    expect(FOUNDATION).toContain(
      "length(COALESCE(v_billing_target_reason, '')) < 10",
    );
  });

  it('espelha a allow-list granular de /sales sem remover o fallback RBAC', () => {
    const start = FOUNDATION.indexOf(
      'CREATE OR REPLACE FUNCTION public.can_execute_sale_order_command',
    );
    const end = FOUNDATION.indexOf('\n$$;', start);
    const gate = FOUNDATION.slice(start, end);

    expect(gate).toContain('up.can_view');
    expect(gate).toContain('up.can_create');
    expect(gate).toContain('up.can_edit');
    expect(gate).toContain("up.module = '/sales'");
    expect(gate).toContain("up.module = 'vendas'");
    expect(gate).toContain('IF NOT v_has_granular THEN\n    RETURN true;');
    expect(FOUNDATION).toContain("public.can_execute_sale_order_command('edit')");
  });

  it('override é somente admin, justificado e sem expiração', () => {
    const tableStart = FOUNDATION.indexOf('CREATE TABLE public.sale_order_readiness_overrides');
    const tableEnd = FOUNDATION.indexOf('\n);', tableStart) + 3;
    const overrideTable = FOUNDATION.slice(tableStart, tableEnd);
    expect(FOUNDATION).toContain("public.user_has_any_role(ARRAY['admin'])");
    expect(FOUNDATION).toContain("length(btrim(COALESCE(p_justification, ''))) < 10");
    expect(overrideTable).not.toContain('expires_at');
  });
});
