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
const HARDENING = readMigration('20270101003400_artisanal_straps_catalog_postdeploy_hardening.sql');

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

  it('usa quantidade exata da grade e não inventa consumo ausente', () => {
    expect(ENGINE).toContain('v_scale := p_order_quantity / v_grade_total');
    expect(ENGINE).toContain('RETURN (v_total_cm * v_scale) / 100');
    expect(ENGINE).toContain("v_default_cm numeric := coalesce(nullif(p_line ->> 'consumption', '')::numeric, 0)");
    expect(ENGINE).not.toMatch(/PERFORM public\.debit_strap_stock/);
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
});
