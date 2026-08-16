import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const HARDENING = readFileSync(resolve(
  ROOT,
  'supabase/migrations/20270101003050_artisanal_straps_catalog_postdeploy_hardening.sql',
), 'utf8');
const ENGINE = readFileSync(resolve(
  ROOT,
  'supabase/migrations/20270101003200_artisanal_straps_operational_engine.sql',
), 'utf8');

function functionBody(sql: string, name: string, nextMarker: string) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end = sql.indexOf(nextMarker, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe('Tiras artesanais — disponibilidade por origem (Req25/Req118)', () => {
  it('separa suspensão administrativa de saldo acabado, produção interna e compra pronta', () => {
    const helper = functionBody(
      HARDENING,
      'resolve_artisanal_strap_source_availability',
      'CREATE OR REPLACE FUNCTION public.assert_artisanal_strap_variant_activation',
    );

    expect(helper).toContain("'administratively_active'");
    expect(helper).toContain("'finished_stock_consumption_allowed'");
    expect(helper).toContain("'internal_production_allowed'");
    expect(helper).toContain("'buy_ready_purchase_allowed'");
    expect(helper).toContain("'canonical_color_discontinued'");
    expect(helper).toContain("'official_base_color_discontinued'");
  });

  it('não transforma descontinuação de cor/base/receita em suspensão da variante', () => {
    const statusRpc = functionBody(
      HARDENING,
      'set_artisanal_strap_record_status',
      '-- Override: list_artisanal_strap_catalog',
    );
    const sourceOnlyBranches = [
      ["WHEN 'canonical_colors' THEN", "WHEN 'color_aliases' THEN"],
      ["WHEN 'base_material_width_profiles' THEN", "WHEN 'base_material_color_official_products' THEN"],
      ["WHEN 'base_material_color_official_products' THEN", "WHEN 'artisanal_strap_variants' THEN"],
      ["WHEN 'artisanal_strap_recipes' THEN", 'ELSE'],
    ] as const;

    sourceOnlyBranches.forEach(([startMarker, endMarker]) => {
      const start = statusRpc.indexOf(startMarker);
      const end = statusRpc.indexOf(endMarker, start + startMarker.length);
      expect(statusRpc.slice(start, end)).not.toContain('UPDATE public.artisanal_strap_variants');
    });
  });

  it('gates novos reabastecimentos por fonte e preserva o ramo administrativo', () => {
    const reconcile = functionBody(
      ENGINE,
      'reconcile_strap_variant_local_202701',
      '-- Contrato executavel Req76',
    );

    expect(reconcile).toContain("IF v_variant.status <> 'active' THEN");
    expect(reconcile).toContain("v_demand.source_mode = 'internal' AND v_internal_allowed");
    expect(reconcile).toContain("v_demand.source_mode = 'buy_ready' AND v_buy_allowed");
    expect(reconcile).toContain("status IN ('approved','sent','partial','received')");
    expect(reconcile).toContain("status IN ('in_progress','partial','fulfilled')");
  });

  it('retoma somente suspensão técnica desta origem e reavalia saldo acabado', () => {
    const reconcile = functionBody(
      ENGINE,
      'reconcile_strap_variant_local_202701',
      '-- Contrato executavel Req76',
    );

    expect(reconcile.match(/status=coalesce\(suspended_from_status,'pending'\)/g)).toHaveLength(2);
    expect(reconcile.match(/Variante fora do estado ativo:%/g)).toHaveLength(2);
    expect(reconcile).toContain("suspension_reason LIKE 'Producao interna indisponivel:%'");
    expect(reconcile).toContain("suspension_reason LIKE 'Compra pronta indisponivel:%'");
    expect(reconcile).toContain("IF v_demand.status='suspended' THEN");
  });

  it('não supersede contribuição de OS externa já enviada', () => {
    const local = functionBody(
      ENGINE,
      'reconcile_strap_variant_local_202701',
      '-- Contrato executavel Req76',
    );
    const global = functionBody(
      ENGINE,
      'reconcile_strap_variant',
      '-- Contrato executavel: todos os competidores',
    );
    const adminBranch = local.slice(
      local.indexOf("IF v_variant.status <> 'active' THEN"),
      local.indexOf('-- Reconstroi as alocacoes reversiveis'),
    );
    const cleanupBranch = local.slice(
      local.indexOf('-- Remove somente contribuicoes automaticas reversiveis'),
    );

    [adminBranch, cleanupBranch].forEach((branch) => {
      expect(branch).toContain('UPDATE public.strap_production_batch_contributions');
      expect(branch).toContain('soi.sent_at IS NOT NULL');
    });
    expect(global.match(/soi\.sent_at IS NOT NULL/g)).toHaveLength(2);
  });

  it('preserva fatos realizados e bloqueia somente saldo físico/documental ainda aberto', () => {
    const helper = functionBody(
      ENGINE,
      'strap_demand_has_external_commitment',
      'CREATE OR REPLACE FUNCTION public.inspect_strap_source_override_state',
    );
    const state = functionBody(
      ENGINE,
      'inspect_strap_source_override_state',
      'CREATE OR REPLACE FUNCTION public.neutralize_strap_source_override_promises',
    );
    const neutralizer = functionBody(
      ENGINE,
      'neutralize_strap_source_override_promises',
      'CREATE OR REPLACE FUNCTION public.tg_version_and_guard_sale_order_item_strap_sourcing',
    );
    const trigger = functionBody(
      ENGINE,
      'tg_version_and_guard_sale_order_item_strap_sourcing',
      'DROP TRIGGER IF EXISTS trg_version_guard_sale_order_item_strap_sourcing',
    );
    const override = functionBody(
      ENGINE,
      'override_sale_order_item_strap_sourcing',
      '-- -----------------------------------------------------------------------------\n-- 3. Fila persistente',
    );
    const worker = functionBody(
      ENGINE,
      'process_strap_demand_job',
      '-- Contrato executavel Req48/89/118',
    );

    expect(helper).toContain('soi.sale_order_strap_demand_id = p_sale_order_strap_demand_id');
    expect(helper).toContain('c.sale_order_strap_demand_id = p_sale_order_strap_demand_id');
    expect(helper).toContain('c.service_order_item_id = soi.id');
    expect(helper).toContain('soi.sent_at IS NOT NULL');
    expect(helper).toContain('contractor_material_custody_movements');
    expect(helper).toContain('strap_production_receipts');
    expect(helper).toContain('contractor_loss_claims');
    expect(helper).not.toContain('balance_in_custody > 0');
    expect(state).toContain("'purchase_document_frozen_with_open_balance'");
    expect(state).toContain("'contractor_custody_open'");
    expect(state).toContain("'physical_reconciliation_pending'");
    expect(state).toContain("'purchase_allocation_inconsistent'");
    expect(state).toContain("'contractor_custody_link_inconsistent'");
    expect(state).toContain("'preserved_realized_facts'");
    expect(state).toContain("'purchase_receipt'");
    expect(state).toContain("'production_receipt'");
    expect(state).toContain("'finished_stock_consumption'");
    expect(state).toContain("'contractor_production_receipt'");
    expect(state).toContain("'contractor_loss_claim'");
    expect(neutralizer).toContain('quantity_reserved=coalesce(r.quantity_consumed,0)');
    expect(neutralizer).toContain("status='superseded'");
    expect(neutralizer).toContain('delivered_m e receipt allocations ficam intactos');
    expect(neutralizer).toContain("'released_finished_stock_m'");
    expect(trigger).toContain('strap_demand_has_external_commitment(d.id)');
    expect(override).toContain('inspect_strap_source_override_state(v_changed_demand_ids)');
    expect(override).toContain("'strap_source_override_blocked'");
    expect(override).toContain("'strap_source_override_reconciliation_failed'");
    expect(override).toContain("'strap_source_override_postcondition_failed'");
    expect(override).toContain("'strap_source_override_applied'");
    expect(override).toContain('neutralize_strap_source_override_promises');
    expect(override).toContain("'released_to_free_stock_m'");
    expect(override).toContain("'preserved_realized_facts'");
    expect(override).toContain("'coverage_policy','global_priority_netting'");
    expect(override).toContain("'new_demand_state'");
    expect(override).toContain('coalesce(d.fulfilled_m,0)<>0');
    expect(override).toContain('coalesce(d.cancelled_m,0)<>0');
    expect(override).toContain('process_strap_demand_job(v_job_id,v_worker_id)');
    expect(override).toContain("VALUES('sale_order_item',v_item.id,'override_source'");
    expect(worker).toContain('strap_demand_has_external_commitment(v_existing.id)');
    expect(worker).toContain("current_setting('app.strap_source_admin_override',true)");
    expect(worker).toContain('v_existing.strap_variant_id<>v_variant_id');
    expect(worker).toContain('v_carry_fulfilled:=0');
    expect(worker).toContain('v_carry_cancelled:=0');
    expect(worker).not.toContain('v_prior_revision_settled');
    expect(worker).toContain("'admin_source_revision_split'");
    expect(worker).toContain("'new_identity_gross_m',v_gross");
    expect(worker).toContain("'inherited_fulfilled_m',0");
    expect(worker).toContain("'inherited_cancelled_m',0");
    expect(worker).toContain('v_existing.strap_variant_id=v_variant_id');
    expect(worker.indexOf('strap_demand_has_external_commitment(v_existing.id)'))
      .toBeLessThan(worker.indexOf("is_current=false,status='superseded'"));
  });

  it('não herda cobertura nem custo de outra identidade após override administrativo', () => {
    const worker = functionBody(
      ENGINE,
      'process_strap_demand_job',
      '-- Contrato executavel Req48/89/118',
    );
    const overrideBranch = worker.slice(
      worker.indexOf('IF v_is_admin_identity_change THEN'),
      worker.indexOf('ELSE', worker.indexOf('IF v_is_admin_identity_change THEN')),
    );
    const costView = ENGINE.slice(
      ENGINE.indexOf('CREATE OR REPLACE VIEW public.v_strap_cost_variance_operational'),
      ENGINE.indexOf('GRANT SELECT ON public.v_strap_contractor_loss_claims_operational'),
    );

    expect(overrideBranch).toContain('v_carry_fulfilled:=0');
    expect(overrideBranch).toContain('v_carry_cancelled:=0');
    expect(overrideBranch).not.toContain('v_existing.fulfilled_m');
    expect(overrideBranch).not.toContain('v_existing.cancelled_m');
    expect(worker).toContain('IF FOUND AND v_existing.source_mode=v_source_mode');
    expect(worker).toContain('AND v_existing.strap_variant_id=v_variant_id THEN');
    expect(costView).toContain('WHEN NOT d.is_current THEN coalesce(rr.realized_m,0)');
    expect(costView).toContain("WHEN d.calculation_explanation ? 'admin_source_override'");
    expect(costView).toContain('THEN greatest(0,d.replenishment_required_m)');
  });

  it('aplica gates novos em migration pendente sem depender da 030 já publicada', () => {
    expect(HARDENING).toContain('hardening pos-deploy');
    expect(HARDENING).toContain('CREATE OR REPLACE FUNCTION public.assert_artisanal_strap_variant_activation');
    expect(HARDENING).not.toContain('CREATE TABLE public.artisanal_strap_variants');
    expect(ENGINE.indexOf('FUNCTION public.resolve_artisanal_strap_source_availability'))
      .toBeLessThan(ENGINE.indexOf('FUNCTION public.reconcile_strap_variant_local_202701'));
  });

  it('revalida variante ativa ao trocar a origem do piso ou compra pronta', () => {
    const trigger = functionBody(
      HARDENING,
      'tg_validate_artisanal_strap_variant',
      '-- Override: tg_guard_artisanal_strap_finished_product',
    );
    const save = functionBody(
      HARDENING,
      'save_artisanal_strap_variant',
      '-- Override: set_artisanal_strap_record_status',
    );

    expect(trigger).toContain('NEW.min_stock_replenishment_mode');
    expect(trigger).toContain('NEW.purchase_enabled IS DISTINCT FROM OLD.purchase_enabled');
    expect(save).toContain("IF p_status = 'active' THEN");
    expect(save).toContain('assert_artisanal_strap_variant_activation(v_id)');
  });

  it('mantém UUID de cor descontinuada para resolução exata de saldo/compra pronta', () => {
    const preview = functionBody(
      ENGINE,
      'preview_sale_order_strap_demand_draft',
      'CREATE OR REPLACE FUNCTION public.preview_sale_order_strap_demand(',
    );

    expect(preview).toContain('SELECT 1 FROM public.canonical_colors c WHERE c.id = v_color_id');
    expect(preview).not.toContain(
      'SELECT 1 FROM public.canonical_colors c WHERE c.id = v_color_id AND c.active',
    );
  });

  it('refaz o componente global depois da espera sem adquirir locks fora de ordem', () => {
    const reconcile = functionBody(
      ENGINE,
      'reconcile_strap_variant',
      '-- Contrato executavel: todos os competidores',
    );
    const initialLocks = reconcile.indexOf('v_locked_base_ids:=v_base_ids;');
    const refresh = reconcile.indexOf('resolve_strap_netting_component', initialLocks);

    expect(reconcile.match(/resolve_strap_netting_component/g)).toHaveLength(2);
    expect(initialLocks).toBeGreaterThanOrEqual(0);
    expect(refresh).toBeGreaterThan(initialLocks);
    expect(reconcile).toContain('WHERE u.id<v_lock_ceiling');
    expect(reconcile).toContain("USING ERRCODE='40001'");
    expect(reconcile).toContain('ORDER BY u.id LOOP');
  });

  it('enfileira toda variante afetada após retorno/ajuste, mas não após remessa', () => {
    const send = functionBody(
      ENGINE,
      'send_strap_material_to_contractor',
      'CREATE OR REPLACE FUNCTION public.return_strap_material_from_contractor(',
    );
    const returned = functionBody(
      ENGINE,
      'return_strap_material_from_contractor',
      'CREATE OR REPLACE FUNCTION public.adjust_strap_contractor_custody(',
    );
    const adjusted = functionBody(
      ENGINE,
      'adjust_strap_contractor_custody',
      '-- Contrato executavel Req53/61/89',
    );
    const fanout = functionBody(
      ENGINE,
      'enqueue_strap_base_availability_reconciliation',
      'CREATE OR REPLACE FUNCTION public.capture_strap_financial_snapshot(',
    );

    expect(send).not.toContain('enqueue_strap_base_availability_reconciliation');
    expect(returned).toContain('enqueue_strap_base_availability_reconciliation');
    expect(adjusted).toContain('enqueue_strap_base_availability_reconciliation');
    expect(fanout).toContain("'custody_availability_changed'");
    expect(fanout).toContain('d.base_product_id=p_base_product_id');
    expect(fanout).toContain('f.base_product_id=p_base_product_id');
    expect(fanout).toContain('op.official_product_id=p_base_product_id');
    expect(fanout).toContain('strap-custody-availability:%s:%s');
    expect(fanout).toContain("'reason',btrim(p_reason)");
    expect(fanout).toContain('),v_key,p_correlation_id');
  });

  it('reagrega prazo e termos da OC sob o lock do bucket', () => {
    const materialize = functionBody(
      ENGINE,
      'materialize_strap_purchase_orders',
      'CREATE OR REPLACE FUNCTION public.adjust_strap_purchase_order(',
    );
    const lock = materialize.indexOf('PERFORM pg_advisory_xact_lock');
    const aggregate = materialize.indexOf('INTO v_group', lock);
    const header = materialize.indexOf('SELECT * INTO v_po', lock);
    const lines = materialize.indexOf('FOR v_line IN', lock);

    expect(materialize.match(/SELECT c\.supplier_id, c\.billing_year,/g)).toHaveLength(2);
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(aggregate).toBeGreaterThan(lock);
    expect(header).toBeGreaterThan(aggregate);
    expect(lines).toBeGreaterThan(aggregate);
    expect(materialize).toContain('v_bucket_supplier_id:=v_group.supplier_id');
  });
});
