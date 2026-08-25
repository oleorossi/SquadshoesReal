import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');
const SQL = read(
  'supabase/migrations/20270101011900_desbloquear_fluxo_canonico_tiras.sql',
);
const ENGINE = read(
  'supabase/migrations/20270101003200_artisanal_straps_operational_engine.sql',
);
const CATALOG = read(
  'supabase/migrations/20270101003000_artisanal_straps_catalog_core.sql',
);

function functionBody(name: string, nextMarker: string) {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end = SQL.indexOf(nextMarker, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return SQL.slice(start, end);
}

describe('desbloqueio seguro do fluxo canônico de Tiras', () => {
  it('diagnostica calendário/capacidade sem criar ou inferir configuração operacional', () => {
    expect(SQL).toContain("'executor_calendar_missing'::text");
    expect(SQL).toContain("'executor_capacity_missing'::text");
    expect(SQL).toContain("'save_operation', 'save_strap_operational_calendar'");
    expect(SQL).toContain("'save_operation', 'save_strap_executor_capacity'");
    expect(SQL).not.toContain('strap_planning_fallback_settings');
    expect(SQL).not.toContain('ensure_missing_strap_executor_capacities');
    expect(SQL).not.toContain('configure_strap_capacity_fallback');
    expect(SQL).not.toMatch(/INSERT INTO public\.strap_operational_calendars/i);
    expect(SQL).not.toMatch(/INSERT INTO public\.strap_executor_capacities/i);
  });

  it('mantém buy-ready no produto acabado exato e libera consolidação somente para napa-base', () => {
    const identity = functionBody(
      'strap_purchase_item_identity_is_valid',
      'CREATE OR REPLACE FUNCTION public.strap_purchase_item_has_canonical_origin',
    );

    expect(identity).toContain('v.id = p_strap_variant_id');
    expect(identity).toContain('v.purchase_enabled');
    expect(identity).toContain('v.finished_product_id = p_product_id');
    expect(identity).toContain('p_allow_consolidated_base');
    expect(identity).toContain('base_material_color_official_products');
    expect(identity).toContain('op.official_product_id = p_product_id');
    expect(identity).toContain('finished_variant.finished_product_id = p_product_id');

    const origin = functionBody(
      'strap_purchase_item_has_canonical_origin',
      'CREATE OR REPLACE FUNCTION public.tg_guard_strap_purchase_order_item',
    );
    expect(origin).toContain("c.status NOT IN ('cancelled', 'superseded')");
    expect(origin).toContain('c.purchase_product_id IS DISTINCT FROM v_item.product_id');
    expect(origin).toContain('c.strap_variant_id IS NULL');
    expect(origin).toContain('v_item.strap_variant_id IS NULL');
    expect(origin).toContain('c.strap_variant_id IS DISTINCT FROM v_item.strap_variant_id');
  });

  it('só permite napa consolidada pelo writer canônico e exige prova diferida no commit', () => {
    const guard = functionBody(
      'tg_guard_strap_purchase_order_item',
      'CREATE OR REPLACE FUNCTION public.tg_validate_purchase_order_item',
    );
    const deferred = functionBody(
      'tg_assert_strap_purchase_order_item_origin',
      'DROP TRIGGER IF EXISTS trg_guard_strap_purchase_order_item',
    );

    expect(guard).toContain("current_setting('app.strap_po_engine', true) = '1'");
    expect(guard).toContain("v_new_source = 'strap_demand'");
    expect(guard).toContain('v_new_locked IS NULL');
    expect(guard).toContain('v_allow_consolidated_base');
    expect(deferred).toContain('strap_purchase_item_has_canonical_origin(NEW.id)');
    expect(SQL).toContain('DEFERRABLE INITIALLY DEFERRED');
  });

  it('revalida OLD e NEW quando contribuição muda sem tocar o item da OC', () => {
    const contributionGuard = functionBody(
      'tg_assert_strap_purchase_contribution_origins',
      'DROP TRIGGER IF EXISTS trg_assert_strap_purchase_contribution_origins',
    );
    const trigger = SQL.slice(
      SQL.indexOf(
        'CREATE CONSTRAINT TRIGGER trg_assert_strap_purchase_contribution_origins',
      ),
      SQL.indexOf('DO $strap_purchase_contribution_origin_contract$'),
    );

    expect(contributionGuard).toContain(
      'v_old_item_id := OLD.purchase_order_item_id',
    );
    expect(contributionGuard).toContain(
      'v_new_item_id := NEW.purchase_order_item_id',
    );
    expect(contributionGuard).toContain(
      'strap_purchase_item_has_canonical_origin(v_item_id)',
    );
    expect(contributionGuard).toContain('po.snapshot_locked_at IS NULL');
    expect(contributionGuard).toContain(
      "po.status IN ('draft', 'pending', 'Pendente')",
    );
    expect(trigger).toContain('ON public.purchase_demand_contributions');
    expect(trigger).toContain('AFTER INSERT OR DELETE OR UPDATE OF');
    expect(trigger).toContain('purchase_order_item_id');
    expect(trigger).toContain('purchase_product_id');
    expect(trigger).toContain('strap_variant_id');
    expect(trigger).toContain('status');
    expect(trigger).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(SQL).toContain('(coalesce(v_trigger_type, 0) & 28) <> 28');
    expect(SQL).toMatch(
      /REVOKE ALL ON FUNCTION public\.tg_assert_strap_purchase_contribution_origins\(\)[\s\S]*?FROM PUBLIC, anon, authenticated/,
    );
  });

  it('resolve buy-ready pelo finished_product_id e reencaminha dead-letter somente após prova', () => {
    const reconcileStart = ENGINE.indexOf(
      'CREATE OR REPLACE FUNCTION public.reconcile_strap_variant_local_202701(',
    );
    const reconcileEnd = ENGINE.indexOf(
      'CREATE OR REPLACE FUNCTION public.resolve_strap_netting_component(',
      reconcileStart,
    );
    const reconcile = ENGINE.slice(reconcileStart, reconcileEnd);
    const proof = functionBody(
      'strap_dead_letter_identity_is_unambiguous',
      'CREATE OR REPLACE FUNCTION public.requeue_unambiguous_strap_identity_dead_letters',
    );
    const requeue = functionBody(
      'requeue_unambiguous_strap_identity_dead_letters',
      '-- ---------------------------------------------------------------------------\n-- Fila acionável',
    );

    expect(reconcile).toContain("v_demand.source_mode = 'buy_ready'");
    expect(reconcile).toContain(
      'v_demand.id,NULL,v_demand.finished_product_id,v_shortage',
    );
    expect(proof).toContain("line.value ->> 'source_mode' = 'buy_ready'");
    expect(proof).toContain('v.finished_product_id IS DISTINCT FROM');
    expect(proof).toContain('NOT v.purchase_enabled');
    expect(proof).toContain('strap_purchase_item_has_canonical_origin(i.id)');
    expect(proof).toContain("r.status NOT IN ('approved', 'superseded')");
    expect(proof).not.toContain("r.status <> 'approved'");
    expect(proof).toContain('r.version IS DISTINCT FROM CASE');
    expect(proof).toContain('r.confirmed_yield_m_per_m IS DISTINCT FROM CASE');
    expect(proof).toContain('r.usable_base_width_mm_snapshot IS DISTINCT FROM CASE');
    expect(proof).toContain('r.cut_band_width_mm IS DISTINCT FROM CASE');
    expect(proof).toContain('r.theoretical_yield_m_per_m IS DISTINCT FROM CASE');
    expect(proof).toMatch(
      /WHEN line\.value -> 'blocking_reasons' IS NULL THEN false\s+WHEN jsonb_typeof\(line\.value -> 'blocking_reasons'\) = 'array'\s+THEN jsonb_array_length\(line\.value -> 'blocking_reasons'\) > 0\s+ELSE true/,
    );
    expect(requeue).toContain(
      'public.strap_dead_letter_identity_is_unambiguous(v_job.id)',
    );
    expect(requeue).toContain("SET status = 'retry'");
    expect(requeue).toContain('attempts = 0');
    expect(requeue).not.toContain('drain_strap_demand_jobs');
  });

  it('restaura o bypass transacional do reparo tanto no sucesso quanto na excecao', () => {
    const repair = functionBody(
      'repair_unambiguous_strap_purchase_item_identity',
      'CREATE OR REPLACE FUNCTION public.strap_dead_letter_identity_is_unambiguous',
    );
    expect(repair).toContain(
      "v_previous_engine_setting text := current_setting(\n    'app.strap_po_engine',\n    true\n  )",
    );
    expect(repair).toContain("PERFORM set_config('app.strap_po_engine', '1', true)");
    expect(repair.match(/coalesce\(v_previous_engine_setting, ''\)/g)).toHaveLength(2);
    expect(repair).toMatch(
      /PERFORM set_config\([\s\S]*?coalesce\(v_previous_engine_setting, ''\)[\s\S]*?RETURN jsonb_build_object\([\s\S]*?EXCEPTION WHEN OTHERS THEN[\s\S]*?PERFORM set_config\([\s\S]*?coalesce\(v_previous_engine_setting, ''\)[\s\S]*?RAISE;/,
    );
  });

  it('expõe reviews/larguras sem adivinhar dados e preserva o fluxo físico/OS histórica', () => {
    expect(SQL).toContain("'migration_review_required'::text");
    expect(SQL).toContain("WHERE ri.status = 'review_required'");
    expect(SQL).toContain("'napa_width_inverted'::text");
    expect(SQL).toContain("d.issue_code = 'napa_width_inverted'");
    expect(SQL).not.toMatch(
      /UPDATE public\.(?:artisanal_strap_migration_review_items|component_sheets)/i,
    );

    const contract = SQL.slice(SQL.indexOf('DO $strap_flow_contract$'));
    expect(contract).toContain('strap_production_batch_contributions');
    expect(contract).toContain('Consumo de napa no recebimento de tira');
    expect(contract).toContain('Entrada aprovada de producao de tira');
    expect(contract).toContain('base_stock_deficit');
    expect(contract).toContain("lower(v_close) LIKE '%faturado%'");
    expect(contract).toContain("position('sale_orders' IN v_close) > 0");
  });

  it('mantém rendimento por medida + família, sem dimensão de cor', () => {
    expect(CATALOG).toContain('UNIQUE (measure_id, base_group_id, version)');
    expect(CATALOG).toMatch(
      /artisanal_strap_recipes_current_approved_uq[\s\S]*?\(measure_id, base_group_id\)/,
    );
    expect(SQL).toContain("c.column_name IN ('color_id', 'canonical_color_id')");
    expect(SQL).not.toMatch(/ALTER TABLE public\.artisanal_strap_recipes[\s\S]*?color_id/i);
  });

  it('fornece CheckRows composáveis e mantém a prova de dead-letter interna', () => {
    const diagnostics = functionBody(
      'get_strap_flow_integrity_diagnostics',
      'COMMENT ON FUNCTION public.get_strap_flow_integrity_diagnostics',
    );
    expect(diagnostics).toContain('RETURNS TABLE(');
    expect(diagnostics).toContain('check_name text');
    expect(diagnostics).toContain('category text');
    expect(diagnostics).toContain('severity text');
    expect(diagnostics).toContain('item_count bigint');
    expect(diagnostics).toContain('sample text');
    expect(SQL).toMatch(
      /REVOKE ALL ON FUNCTION public\.strap_dead_letter_identity_is_unambiguous\(uuid\)[\s\S]*?FROM PUBLIC, anon, authenticated/,
    );
    expect(SQL).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.strap_dead_letter_identity_is_unambiguous\(uuid\)[\s\S]*?TO service_role/,
    );
    expect(SQL).toMatch(
      /REVOKE ALL ON FUNCTION public\.list_strap_canonical_action_queue\(\)[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/,
    );
    expect(SQL).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.list_strap_canonical_action_queue\(\)[\s\S]*?TO service_role/,
    );
    expect(SQL).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.list_strap_canonical_action_queue\(\)\s+TO authenticated(?:,|;)/,
    );
  });
});
