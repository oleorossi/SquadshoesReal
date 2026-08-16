import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const readMigration = (name: string) =>
  readFileSync(resolve(ROOT, `supabase/migrations/${name}`), 'utf8');

const CATALOG = readMigration('20270101003000_artisanal_straps_catalog_core.sql');
const SCHEMA = readMigration('20270101003100_artisanal_straps_operational_schema.sql');
const ENGINE = readMigration('20270101003200_artisanal_straps_operational_engine.sql');
const LEGACY = readMigration('20270101003300_artisanal_straps_legacy_migration_apply.sql');
const HARDENING = readMigration('20270101003050_artisanal_straps_catalog_postdeploy_hardening.sql');
const PER_PV_APPLIED = readMigration('20261022120000_compute-materials-per-pv-uses-strap-single-engine.sql');
const ITEM_OP_SYNC = readMigration('20260925133000_stock-debit-hole-prevention.sql');

function functionBody(sql: string, name: string, nextMarker: string) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end = sql.indexOf(nextMarker, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

function returnTableShape(sql: string) {
  const match = sql.match(/RETURNS TABLE\((.*?)\)\s*LANGUAGE/is);
  expect(match).not.toBeNull();
  return match![1].replace(/\s+/g, ' ').trim().toLowerCase();
}

describe('Tiras artesanais — contrato SQL canônico', () => {
  it('mantém identidade exata por medida, base e cor, com aliases aprovados sem ambiguidade', () => {
    expect(CATALOG).toContain('CREATE TABLE public.artisanal_strap_types');
    expect(CATALOG).toContain('CREATE TABLE public.artisanal_strap_measures');
    expect(CATALOG).toContain('CREATE TABLE public.canonical_colors');
    expect(CATALOG).toContain('CREATE TABLE public.base_material_color_official_products');
    expect(CATALOG).toMatch(/UNIQUE \(measure_id, base_group_id, color_id\)/);
    expect(CATALOG).toContain('color_aliases_approved_alias_norm_uq');
    expect(CATALOG).toContain('base_material_official_products_active_identity_uq');
    expect(CATALOG).toContain('resolve_artisanal_strap_catalog');
  });

  it('versiona receita e limita o rendimento confirmado ao teto físico', () => {
    expect(CATALOG).toContain('confirmed_yield_m_per_m > 0');
    expect(CATALOG).toMatch(
      /confirmed_yield_m_per_m <= floor\(usable_base_width_mm_snapshot \/ cut_band_width_mm\)/,
    );
    expect(CATALOG).toContain('artisanal_strap_recipes_current_approved_uq');
    expect(CATALOG).toContain("status IN ('draft', 'pending_approval', 'approved', 'superseded', 'suspended', 'archived')");
  });

  it('persiste escolha por linha, fila transacional e worker de até um minuto', () => {
    expect(SCHEMA).toContain('technical_strap_line_id uuid NOT NULL');
    expect(SCHEMA).toContain("source_mode IN ('internal', 'buy_ready')");
    expect(SCHEMA).toContain('CREATE TABLE public.strap_demand_jobs');
    expect(ENGINE).toContain('set_sale_order_item_strap_sourcing');
    expect(ENGINE).toContain('enqueue_sale_order_strap_demands');
    expect(ENGINE).toContain('process_strap_demand_job');
    expect(ENGINE).toContain("'* * * * *'");
    expect(ENGINE).toContain("drain_strap_demand_jobs(100, 'pg_cron')");
  });

  it('isola o backfill cadastral do gatilho que cria OPs e movimenta estoque', () => {
    const backfillStart = SCHEMA.indexOf('DO $strap_sourcing_backfill$');
    const backfillEnd = SCHEMA.indexOf('$strap_sourcing_backfill$;', backfillStart);
    expect(backfillStart).toBeGreaterThanOrEqual(0);
    expect(backfillEnd).toBeGreaterThan(backfillStart);

    const backfill = SCHEMA.slice(backfillStart, backfillEnd);
    const suppress = backfill.indexOf("set_config('app.suppress_item_op_sync', '1', true)");
    const firstUpdate = backfill.indexOf('UPDATE public.sale_order_items');
    const restore = backfill.lastIndexOf("'app.suppress_item_op_sync'");

    expect(suppress).toBeGreaterThanOrEqual(0);
    expect(suppress).toBeLessThan(firstUpdate);
    expect(backfill.match(/UPDATE public\.sale_order_items/g)).toHaveLength(2);
    expect(restore).toBeGreaterThan(backfill.lastIndexOf('UPDATE public.sale_order_items'));
    expect(backfill).toContain("coalesce(v_previous_item_op_sync, '')");

    const syncTrigger = functionBody(
      ITEM_OP_SYNC,
      'tg_sync_orders_from_sale_order_item',
      'CREATE OR REPLACE FUNCTION public.tg_release_reservations_on_order_terminal',
    );
    expect(syncTrigger).toContain(
      "current_setting('app.suppress_item_op_sync', true) = '1'",
    );
  });

  it('usa quantidade exata da grade e não inventa consumo ausente', () => {
    expect(ENGINE).toContain('v_scale := p_order_quantity / v_grade_total');
    expect(ENGINE).toContain('RETURN (v_total_cm * v_scale) / 100');
    expect(ENGINE).toContain("v_default_cm numeric := coalesce(nullif(p_line ->> 'consumption', '')::numeric, 0)");
    expect(ENGINE).not.toMatch(/PERFORM public\.debit_strap_stock/);
  });

  it('neutraliza callers legados qualificados e não qualificados antes do cutover', () => {
    const cutoverStart = ENGINE.indexOf('-- 14. Cutover nominal');
    const cutoverEnd = ENGINE.indexOf(
      'CREATE TABLE public.strap_service_order_financial_snapshots',
      cutoverStart,
    );
    const cutover = ENGINE.slice(cutoverStart, cutoverEnd);

    expect(cutover).toContain("p.prosrc LIKE '%debit_strap_stock%'");
    expect(cutover).toContain(
      "'public.debit_strap_stock','public.deprecated_strap_stock_noop'",
    );
    expect(cutover).toContain(
      "'debit_strap_stock','public.deprecated_strap_stock_noop'",
    );
    expect(cutover).toContain(
      "p.proname NOT IN ('debit_strap_stock','deprecated_strap_stock_noop')",
    );
    expect(cutover).toContain(
      "THEN RAISE EXCEPTION 'Cutover incompleto: caller vivo de baixa legada de tira'",
    );
  });

  it('valida a view de custo sem depender dos aliases reescritos pelo PostgreSQL', () => {
    const viewAssertionStart = ENGINE.indexOf(
      "DECLARE v_definition text:=lower(pg_get_viewdef(\n  'public.v_strap_cost_variance_operational'",
    );
    const viewAssertionEnd = ENGINE.indexOf('GRANT SELECT ON', viewAssertionStart);
    const viewAssertion = ENGINE.slice(viewAssertionStart, viewAssertionEnd);

    expect(viewAssertionStart).toBeGreaterThanOrEqual(0);
    expect(viewAssertion).toContain("position('sale_order_strap_demand_id' IN v_definition)=0");
    expect(viewAssertion).toContain("position('purchase_demand_contribution_id' IN v_definition)=0");
    expect(viewAssertion).toContain("position('batch_contribution_id' IN v_definition)=0");
    expect(viewAssertion).toContain("v_definition !~ 'not [a-z_][a-z0-9_]*\\.is_current'");
    expect(viewAssertion).toContain("position('replenishment_required_m' IN v_definition)=0");
    expect(viewAssertion).not.toContain("position('not d.is_current'");
    expect(viewAssertion).not.toContain("position('d.replenishment_required_m'");
  });

  it('expõe ajustes do cabeçalho e do item da OC sem nomes de coluna duplicados', () => {
    const viewStart = ENGINE.indexOf(
      'CREATE OR REPLACE VIEW public.v_strap_purchase_order_items_operational',
    );
    const viewEnd = ENGINE.indexOf(
      'CREATE OR REPLACE VIEW public.v_strap_service_order_items_operational',
      viewStart,
    );
    const view = ENGINE.slice(viewStart, viewEnd);

    expect(viewStart).toBeGreaterThanOrEqual(0);
    expect(viewEnd).toBeGreaterThan(viewStart);
    expect(view).toContain('po.strap_manual_adjustment_reason,');
    expect(view).toContain(
      'i.strap_manual_adjustment_reason AS item_manual_adjustment_reason,',
    );
    expect(view).toContain('i.strap_manual_adjusted_by AS item_manual_adjusted_by,');
    expect(view).toContain('i.strap_manual_adjusted_at AS item_manual_adjusted_at,');
    expect(view).not.toMatch(/\n\s+i\.strap_manual_adjustment_reason,\n/);
    expect(view).not.toMatch(/\n\s+i\.strap_manual_adjusted_by,\n/);
    expect(view).not.toMatch(/\n\s+i\.strap_manual_adjusted_at,\n/);
  });

  it('retira tiras integralmente do canal genérico por PV sem quebrar sua assinatura', () => {
    const applied = functionBody(
      PER_PV_APPLIED,
      'compute_materials_per_pv',
      'COMMENT ON FUNCTION public.compute_materials_per_pv',
    );
    const cutover = functionBody(
      ENGINE,
      'compute_materials_per_pv',
      'COMMENT ON FUNCTION public.compute_materials_per_pv',
    );

    expect(returnTableShape(cutover)).toBe(returnTableShape(applied));
    expect(cutover).toContain('exploded AS (');
    expect(cutover).toContain('FROM agg a');
    expect(cutover).toContain('mr.sale_order_strap_demand_id IS NULL');
    expect(cutover).toContain('mr.strap_stock_floor_contribution_id IS NULL');
    expect(cutover).not.toContain('strap_lines AS (');
    expect(cutover).not.toContain('resolve_strap_stock_lines');
    expect(cutover).not.toContain('order_strap_needs');
    expect(cutover).not.toContain("component='Tira'");
    expect(ENGINE).toContain('compute_materials_per_pv ainda duplica o motor canonico de tiras');
  });

  it('separa compra por fornecedor, mês e quinzena e congela os parâmetros comerciais', () => {
    expect(SCHEMA).toContain('billing_fortnight smallint NOT NULL');
    expect(SCHEMA).toContain('supplier_lead_time_days_snapshot integer NOT NULL DEFAULT 15');
    expect(SCHEMA).toContain('material_preparation_days_snapshot integer NOT NULL DEFAULT 2');
    expect(ENGINE).toContain('po.supplier_id IS NOT DISTINCT FROM v_group.supplier_id');
    expect(ENGINE).toContain('po.billing_year = v_group.billing_year');
    expect(ENGINE).toContain('po.billing_month = v_group.billing_month');
    expect(ENGINE).toContain('po.billing_fortnight = v_group.billing_fortnight');
    expect(ENGINE).toContain('prepare_strap_purchase_order_approval');
    expect(ENGINE).toContain('approve_strap_purchase_order');
    expect(ENGINE).toContain("VALUES ('strap-purchase-orders', 'strap-purchase-orders', false");
  });

  it('registra parciais, custódia, perdas e ciclos financeiros por RPC idempotente', () => {
    [
      'register_strap_purchase_receipt',
      'register_strap_production_receipt',
      'send_strap_material_to_contractor',
      'return_strap_material_from_contractor',
      'adjust_strap_contractor_custody',
      'create_strap_contractor_loss_claim',
      'decide_strap_contractor_loss_claim',
      'close_contractor_payment_cycle',
      'mark_contractor_payment_cycle_paid',
    ].forEach((rpc) => expect(ENGINE).toContain(`FUNCTION public.${rpc}`));
    expect(SCHEMA).toContain('CONSTRAINT contractor_loss_claims_idempotency_uq');
    expect(SCHEMA).toContain("entry_type IN ('accrual', 'loss_claim', 'credit_carry')");
  });

  it('cria a fila de retrabalho antes de compilar qualquer função que a consulta', () => {
    const table = ENGINE.indexOf('CREATE TABLE public.strap_rework_material_requests');
    const firstReference = ENGINE.indexOf('FROM public.strap_rework_material_requests');
    const lockHelper = ENGINE.indexOf(
      'CREATE OR REPLACE FUNCTION public.lock_strap_physical_operation_scope',
    );

    expect(table).toBeGreaterThanOrEqual(0);
    expect(firstReference).toBeGreaterThan(table);
    expect(lockHelper).toBeGreaterThan(firstReference);
    expect(ENGINE.match(/CREATE TABLE public\.strap_rework_material_requests/g)).toHaveLength(1);
  });

  it('fecha writers antigos e expõe somente a allow-list operacional', () => {
    expect(SCHEMA).toContain('DROP TRIGGER IF EXISTS trg_debit_service_order_base');
    expect(ENGINE).toContain('Fecha o default EXECUTE PUBLIC de todas as funcoes definidas neste motor');
    expect(ENGINE).toContain('REVOKE INSERT,UPDATE ON public.sale_order_items FROM PUBLIC,anon,authenticated');
    expect(ENGINE).toContain('tg_guard_canonical_strap_service_order');
    expect(ENGINE).toContain('tg_guard_strap_purchase_order_item');
    expect(ENGINE).toContain('tg_guard_canonical_strap_stock_movement');
    expect(ENGINE).toContain('coalesce(pg.is_artisanal_strap,false)');
    expect(ENGINE).toContain("v_new_source IS DISTINCT FROM 'strap_demand'");
    expect(ENGINE).toContain('tg_assert_strap_purchase_order_item_origin');
    expect(ENGINE).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(ENGINE).toContain('c.purchase_product_id=NEW.product_id');
  });

  it('não exige a função auxiliar legada ao remover o trigger de dupla baixa', () => {
    const cutover = SCHEMA.slice(SCHEMA.indexOf('-- 11. Cutover'));
    const dropTrigger = cutover.indexOf(
      'DROP TRIGGER IF EXISTS trg_debit_service_order_base ON public.service_orders',
    );
    const optionalGuard = cutover.indexOf(
      "to_regprocedure('public.debit_service_order_base()') IS NOT NULL",
    );
    const legacyComment = cutover.indexOf(
      'COMMENT ON FUNCTION public.debit_service_order_base() IS',
    );

    expect(dropTrigger).toBeGreaterThanOrEqual(0);
    expect(optionalGuard).toBeGreaterThan(dropTrigger);
    expect(legacyComment).toBeGreaterThan(optionalGuard);
    expect(cutover).toContain('EXECUTE $legacy_comment$');
  });

  it('isola a baixa fabril por setor somente quando o writer legado existe', () => {
    const cutoverStart = ENGINE.indexOf(
      "SELECT pg_get_functiondef(to_regprocedure(\n    'public.debit_reserved_materials_for_sector",
    );
    const cutoverEnd = ENGINE.indexOf(
      "SELECT pg_get_functiondef('public.resync_op_atomic(uuid)'::regprocedure)",
      cutoverStart,
    );
    const cutover = ENGINE.slice(cutoverStart, cutoverEnd);

    expect(cutoverStart).toBeGreaterThanOrEqual(0);
    expect(cutoverEnd).toBeGreaterThan(cutoverStart);
    expect(cutover).toContain('IF v_def IS NOT NULL THEN');
    expect(cutover).toContain("coalesce(mr.source,'''') NOT IN");
    expect(cutover).toContain(
      'Cutover recusado: baixa por setor nao foi isolada das reservas de tira',
    );
    expect(cutover).toContain('EXECUTE v_def;');
    expect(cutover).not.toContain("::regprocedure)\n    INTO v_def");
    expect(cutover).not.toContain('debit_reserved_materials_for_sector ausente');
  });

  it('internaliza o update legado e mantém somente o wrapper com preflight', () => {
    expect(ENGINE).toContain('RENAME TO update_sale_order_atomic_legacy_202701');
    expect(ENGINE).toContain(
      'REVOKE ALL ON FUNCTION public.update_sale_order_atomic_legacy_202701(uuid,jsonb,jsonb)',
    );
    expect(ENGINE).toContain(
      'v_result:=public.update_sale_order_atomic_legacy_202701(p_order_id,p_header,p_items)',
    );
    expect(ENGINE).toContain(
      'public.update_sale_order_with_teardown(uuid,jsonb,jsonb,uuid[])',
    );
    expect(ENGINE).toContain(
      "to_regprocedure('public.update_sale_order_atomic(uuid,jsonb,jsonb)') IS NOT NULL",
    );
    expect(ENGINE).toContain("has_function_privilege('authenticated'");
  });

  it('declara o estado de reexpansão no orquestrador global que o utiliza', () => {
    const component = functionBody(
      ENGINE,
      'resolve_strap_netting_component',
      '-- Orquestrador global por napa',
    );
    const reconcile = functionBody(
      ENGINE,
      'reconcile_strap_variant',
      '-- Contrato executavel: todos os competidores',
    );

    ['v_locked_base_ids uuid[]', 'v_missing_base_ids uuid[]', 'v_lock_ceiling uuid'].forEach(
      (declaration) => expect(reconcile).toContain(declaration),
    );
    expect(component).not.toContain('v_locked_base_ids');
    expect(component).not.toContain('v_missing_base_ids');
    expect(component).not.toContain('v_lock_ceiling');
    expect(reconcile.indexOf('v_locked_base_ids uuid[]'))
      .toBeLessThan(reconcile.indexOf('v_locked_base_ids:=v_base_ids'));
  });

  it('serializa writers físicos antes dos row locks e exige remessa no recebimento externo', () => {
    const scope = functionBody(
      ENGINE,
      'lock_strap_physical_operation_scope',
      'CREATE OR REPLACE FUNCTION public.strap_custody_open_value',
    );
    const receipt = functionBody(
      ENGINE,
      'register_strap_production_receipt',
      '-- -----------------------------------------------------------------------------\n-- 11.',
    );

    expect(scope.indexOf("'strap-base-netting:'"))
      .toBeLessThan(scope.indexOf("'strap-variant:'"));
    expect(receipt.indexOf('lock_strap_physical_operation_scope'))
      .toBeLessThan(receipt.indexOf('FOR UPDATE'));
    expect(receipt).toContain('v_line.sent_at IS NULL');
    expect(receipt).toContain('m.service_order_id=v_line.service_order_id');
    expect(receipt).toContain('m.base_product_id=v_item.base_product_id');
    expect(receipt).toContain("m.movement_type='sent'");
    expect(receipt).toContain('p_base_consumed_m<=0');
  });

  it('faz fan-out de estoque por snapshots operacionais exatos, inclusive suspensos', () => {
    const fanout = functionBody(
      ENGINE,
      'tg_enqueue_strap_product_stock_change',
      'DROP TRIGGER IF EXISTS trg_enqueue_strap_product_stock_change',
    );

    [
      'sale_order_strap_demands',
      'strap_stock_floor_contributions',
      'material_reservations',
      'service_order_items',
      'strap_production_batch_items',
      'purchase_demand_contributions',
    ].forEach((relation) => expect(fanout).toContain(relation));
    expect(fanout).toContain('d.base_product_id=NEW.id');
    expect(fanout).toContain('soi.base_product_id=NEW.id');
    expect(fanout).not.toContain("v.status='active'");
    expect(fanout).not.toContain("op.status='active'");
  });

  it('faz migração conservativa com checksum, conservação, diagnóstico e rollback', () => {
    [
      'resolve_technical_strap_line_migration',
      'resolve_legacy_artisanal_recipe_migration',
      'resolve_legacy_strap_product_migration',
      'apply_artisanal_strap_migration',
      'preview_artisanal_strap_migration_rollback',
      'rollback_artisanal_strap_migration',
      'artisanal_strap_legacy_migration_diagnostics',
    ].forEach((rpc) => expect(LEGACY).toContain(`FUNCTION public.${rpc}`));
    expect(LEGACY).toContain('p_expected_checksum');
    expect(LEGACY).toContain('pre_conservation');
    expect(LEGACY).toContain('post_conservation');
    expect(LEGACY).toContain('expected_post_checksum');
    expect(LEGACY).toContain('legacy_product_mapping_required');
  });

  it('captura produto e classificação de grupo sem misturar rowtype e escalar no INTO', () => {
    const provenance = functionBody(
      LEGACY,
      'capture_artisanal_strap_product_provenance',
      'CREATE OR REPLACE FUNCTION public.tg_capture_artisanal_strap_product_provenance',
    );

    expect(provenance).toContain('SELECT * INTO v_product');
    expect(provenance).toContain(
      'SELECT coalesce(pg.is_artisanal_strap,false) INTO v_group_is_strap',
    );
    expect(provenance).not.toContain('INTO v_product,v_group_is_strap');
    expect(provenance).toContain(
      'coalesce(v_product.is_artisanal,false) OR coalesce(v_group_is_strap,false)',
    );

    const rowtypeVariables = [...LEGACY.matchAll(
      /^\s*(v_[a-z0-9_]+)\s+public\.[a-z0-9_.]+%ROWTYPE;/gmi,
    )].map((match) => match[1]);
    expect(rowtypeVariables.length).toBeGreaterThan(0);
    rowtypeVariables.forEach((variable) => {
      expect(LEGACY).not.toMatch(new RegExp(`INTO\\s+${variable}\\s*,`, 'i'));
      expect(LEGACY).not.toMatch(new RegExp(`INTO[^;\\n]*,\\s*${variable}\\b`, 'i'));
    });
    expect(LEGACY).toContain('INTO v_review_json,v_cutover_id,v_actor_id');
    expect(LEGACY).toContain('v_review:=jsonb_populate_record(');
  });

  it('migra somente rotas específicas, sem herdar o acesso amplo de terceirizados', () => {
    const grants = HARDENING.slice(
      HARDENING.indexOf('WITH explicit_legacy AS'),
      HARDENING.indexOf('-- Override: resolve_artisanal_strap_source_availability'),
    );
    expect(grants).toContain("'/calculadora-tiras'");
    expect(grants).toContain("'/artisanal-recipes'");
    expect(grants).toContain("'/tiras-artesanais'");
    expect(grants).not.toMatch(/^\s*'\/terceirizados'\s*,?$/m);
    expect(HARDENING).toContain("broad.module = '/terceirizados'");
    expect(HARDENING).toContain('artisanal_strap_user_capabilities cap');
  });

  it('mantém edição cadastral separada da administração operacional', () => {
    const bundle = functionBody(
      HARDENING,
      'save_artisanal_strap_catalog_bundle',
      '-- Override: preview_artisanal_strap_catalog_migration',
    );

    expect(bundle).toContain("assert_artisanal_strap_capability('manage_strap_catalog')");
    expect(bundle).toContain("v_product_payload ? 'purchase_order_unit'");
    expect(bundle).toContain('Campo legado purchase_order_unit nao e aceito; use purchase_unit');
    expect(bundle).not.toContain('administer_strap_operations');
  });
});
