import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const MIGRATION = readFileSync(
  resolve(
    ROOT,
    'supabase/migrations/20270101011500_command_boundary_compatibility.sql',
  ),
  'utf8',
);

function sqlFunction(name: string): string {
  const starts = [
    MIGRATION.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`),
    MIGRATION.indexOf(`CREATE FUNCTION public.${name}(`),
  ].filter(index => index >= 0);
  const start = starts.length > 0 ? Math.min(...starts) : -1;
  expect(start, `${name} ausente`).toBeGreaterThanOrEqual(0);
  const tail = MIGRATION.slice(start);
  const match = tail.match(/\n\$(?:function)?\$;/);
  expect(match?.index, `${name} sem terminador`).toBeTypeOf('number');
  return tail.slice(0, (match?.index ?? 0) + (match?.[0].length ?? 0));
}

describe('compatibilidade dos command boundaries 105/108/113', () => {
  const saleItemGuard = sqlFunction('tg_enforce_sale_order_command_boundary');
  const orderGuard = sqlFunction('tg_enforce_production_order_command_boundary');
  const stageGuard = sqlFunction('tg_enforce_order_stage_command_boundary');

  it('aceita somente markers estreitos e deltas allowlisted em sale_order_items', () => {
    for (const marker of [
      'app.sale_order_item_commercial_review_internal',
      'app.sale_order_item_strap_context_reference_id',
      'app.sale_order_item_strap_sourcing_item_id',
      'app.sale_order_item_strap_reconcile_item_id',
      'app.sale_order_item_cutover_apply_run_id',
      'app.sale_order_item_cutover_rollback_id',
    ]) {
      expect(saleItemGuard).toContain(marker);
    }
    for (const column of [
      'material_variant_commercial_snapshot',
      'strap_colors',
      'strap_sourcing',
      'strap_migration_status',
      'strap_migration_reason',
      'strap_migration_cutover_id',
    ]) {
      expect(saleItemGuard).toContain(column);
    }
    expect(saleItemGuard).toContain('pg_catalog.to_jsonb(NEW)');
    expect(saleItemGuard).not.toContain('pg_trigger_depth');
  });

  it('wrappers de item restauram o GUC inclusive no erro e mantem CAS antigo', () => {
    for (const name of [
      'review_legacy_material_variant_commercial_snapshot',
      'resolve_technical_strap_context_from_sale_order',
      'resolve_technical_strap_line_migration',
      'set_sale_order_item_strap_sourcing',
      'override_sale_order_item_strap_sourcing',
      'try_resolve_open_sale_order_item_strap_migration',
      'apply_artisanal_strap_migration',
      'rollback_artisanal_strap_migration',
    ]) {
      const body = sqlFunction(name);
      expect(body).toContain('_impl_115');
      expect(body).toContain('EXCEPTION WHEN OTHERS');
      expect(body).toContain('COALESCE(v_previous, \'\')');
    }
    expect(MIGRATION).toContain('p_expected_snapshot');
    expect(MIGRATION).toContain('p_expected_revision');
    expect(MIGRATION).toContain('p_expected_updated_at');
  });

  it('preserva override admin-only e nao reabre o setter aposentado', () => {
    expect(MIGRATION).toMatch(
      /REVOKE ALL ON FUNCTION public\.set_sale_order_item_strap_sourcing\(uuid,integer,jsonb\)[\s\S]*?PUBLIC, anon, authenticated, service_role/,
    );
    expect(MIGRATION).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.override_sale_order_item_strap_sourcing\([\s\S]*?TO authenticated/,
    );
    expect(MIGRATION).toContain(
      'A implementacao preservada continua exigindo admin, motivo, CAS',
    );
  });

  it('limita metadata de terceirizacao, gate material e bloqueio de etapa', () => {
    expect(orderGuard).toContain('app.outsource_order_metadata_internal');
    expect(orderGuard).toContain('app.material_gate_sale_orders_internal');
    for (const column of [
      'outsourced_to_contractor_id',
      'outsourced_sector',
      'outsourced_at',
      'material_ready_date',
      'material_gate_reason',
      'planned_start',
    ]) {
      expect(orderGuard).toContain(column);
    }
    expect(stageGuard).toContain('app.outsource_stage_block_internal');
    expect(stageGuard).toContain('blocked_until');
    expect(stageGuard).toContain('blocked_reason');
    expect(orderGuard).not.toContain('pg_trigger_depth');
    expect(stageGuard).not.toContain('pg_trigger_depth');
  });

  it('serializa terceirizacao em PV -> global -> OP em todos os callers', () => {
    const primitive = sqlFunction('create_op_service_order');
    expect(primitive.indexOf("'sale-order-command:'")).toBeLessThan(
      primitive.indexOf("'outsource_service_order_generation'"),
    );
    expect(primitive.indexOf("'outsource_service_order_generation'")).toBeLessThan(
      primitive.indexOf("'production-order:'"),
    );

    for (const name of [
      'commit_capacity_overflow_outsourcing',
      'send_item_sector_os',
      'generate_configured_outsource_orders_for_order',
      'generate_op_service_orders',
    ]) {
      const wrapper = sqlFunction(name);
      expect(wrapper).toContain('lock_outsource_sale_orders_before_global_115');
      expect(wrapper.indexOf('lock_outsource_sale_orders_before_global_115')).toBeLessThan(
        wrapper.indexOf('_impl_115'),
      );
    }
  });

  it('sincroniza onda somente com RBAC e caminho trigger privado', () => {
    const sync = sqlFunction('sync_wave_from_kanban');
    const locked = sqlFunction('sync_wave_from_kanban_locked_internal_115');
    const trigger = sqlFunction('fn_sync_wave_on_stage_complete');
    expect(sync).toContain('public.can_execute_production_pointing()');
    expect(sync).toContain('app.wave_sync_internal');
    expect(locked).toContain("'sale-order-command:'");
    expect(locked).toContain("'production-order:'");
    expect(locked).toContain("'production-wave:'");
    expect(locked).toContain('v_current_sale_order_ids IS DISTINCT FROM v_sale_order_ids');
    expect(locked).toContain('v_current_order_ids IS DISTINCT FROM v_order_ids');
    expect(trigger).toContain('sync_wave_from_kanban_locked_internal_115');
    expect(MIGRATION).toMatch(
      /REVOKE ALL ON FUNCTION public\.sync_wave_from_kanban_impl_115\(uuid\)[\s\S]*?authenticated, service_role/,
    );
  });

  it('internaliza helpers crus e aposenta compactacao sem caller vivo', () => {
    for (const signature of [
      'initialize_order_material_reservations(uuid,boolean)',
      'debit_sole_stock_by_grade(uuid,uuid,text,jsonb,boolean)',
      'debit_strap_stock(jsonb,integer,uuid,jsonb,boolean)',
      'debit_packaging_for_order(uuid,uuid,uuid,integer,text,boolean)',
      'release_order_reservations(uuid)',
      'convert_reservation_to_out(uuid,uuid)',
      'process_order_stock_out(uuid,uuid,integer)',
      'restore_sole_grade_for_order(uuid)',
      'restore_product_stocks_for_order(uuid)',
      'reserve_missing_materials_for_order(uuid,boolean)',
      'resync_reservations_for_sheet(uuid)',
      'refresh_order_reservations(uuid)',
      'increment_qty_devolvida(uuid,numeric)',
      'compact_sale_order(uuid)',
      'upsert_open_purchase_order(uuid,text,uuid,text,jsonb)',
    ]) {
      expect(MIGRATION).toContain(`REVOKE ALL ON FUNCTION public.${signature}`);
    }
    expect(MIGRATION).toContain('public.try_reserve_materials(');
    expect(MIGRATION).toContain('FROM PUBLIC, anon, authenticated, service_role;');
    expect(MIGRATION).toContain(
      'DROP FUNCTION IF EXISTS public.consume_from_lot(uuid,uuid,numeric,text)',
    );
  });

  it('deixa o recálculo de lead time somente no cron/service role', () => {
    expect(MIGRATION).toMatch(
      /REVOKE ALL ON FUNCTION public\.recalc_supplier_lead_from_history\(\)[\s\S]*?FROM PUBLIC, anon, authenticated;/,
    );
    expect(MIGRATION).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.recalc_supplier_lead_from_history\(\)[\s\S]*?TO service_role;/,
    );
    expect(MIGRATION).toContain("'acl_recalc_supplier_lead'");
  });

  it('consume_all trava OP e recusa terminal antes do corpo que embala', () => {
    const consume = sqlFunction('consume_all_reservations_for_order');
    expect(consume).toContain("'production-order:' || p_order_id::text");
    expect(consume).toContain('FOR UPDATE');
    expect(consume).toContain('esta terminal e nao aceita consumo/picking');
    expect(consume.indexOf('esta terminal')).toBeLessThan(
      consume.indexOf('consume_all_reservations_for_order_impl_115'),
    );
  });

  it('cancelamento completa apenas saldo liquido e nao aborta por IN anterior', () => {
    const cancel = sqlFunction('cancel_production_order_internal');
    expect(cancel).toContain('net_debit');
    expect(cancel).toContain('public.restore_sole_grade_for_order');
    expect(cancel).toContain('public.restore_product_stocks_for_order');
    expect(cancel).toContain("'restore_basis', 'net_ledger'");
    expect(cancel).not.toContain('v_has_prior_inbound');
    expect(cancel).not.toContain('estorno parcial anterior');
    expect(cancel).toContain('destino');
  });

  it('writers de OC exigem admin/gerente e ordem produto -> OC -> item', () => {
    const create = sqlFunction('create_purchase_order_normalized');
    const upsert = sqlFunction('upsert_po_item_atomic');
    for (const body of [create, upsert]) {
      expect(body).toContain('public.is_approved_user()');
      expect(body).toContain("ARRAY['admin', 'gerente']");
      expect(body).toContain('public.lock_sale_order_purchase_products');
    }
    expect(create.indexOf('lock_sale_order_purchase_products')).toBeLessThan(
      create.indexOf('create_purchase_order_normalized_impl_115'),
    );
    expect(upsert.indexOf('lock_sale_order_purchase_products')).toBeLessThan(
      upsert.indexOf('FOR UPDATE'),
    );
    expect(upsert.indexOf('FOR UPDATE')).toBeLessThan(
      upsert.indexOf('upsert_po_item_atomic_impl_115'),
    );
  });

  it('executa contrato live somente de introspeccao e fecha a transacao', () => {
    expect(MIGRATION).toContain('run_command_boundary_compatibility_contract_tests');
    expect(MIGRATION).toContain("'writes_business_data', false");
    expect(MIGRATION).toContain(
      'SELECT public.run_command_boundary_compatibility_contract_tests();',
    );
    expect(MIGRATION.trimEnd()).toMatch(/COMMIT;$/);
  });

  it('não qualifica a sintaxe especial substring(... FROM ...)', () => {
    expect(MIGRATION).not.toMatch(/pg_catalog\.substring\s*\([\s\S]{0,120}?\bFROM\b/i);
    expect(MIGRATION).toContain('pg_catalog.substr(');
  });
});
