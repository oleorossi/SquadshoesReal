import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const MIGRATION = read(
  'supabase/migrations/20270101014500_admin_retire_technical_sheet_in_production.sql',
);
const HOOK = read('src/hooks/useTechnicalSheets.ts');
const PAGE = read('src/pages/TechnicalSheets.tsx');
const GRID = read('src/components/technical-sheets/TechnicalSheetCardGrid.tsx');
const SALE_ORDERS = read('src/pages/SaleOrders.tsx');
const SALE_ORDER_FORM = read('src/pages/SaleOrderForm.tsx');
const SALE_ORDER_FORM_PANEL = read('src/components/sale-orders/SaleOrderFormPanel.tsx');
const SALE_ORDER_ITEM_FORM = read('src/components/sale-orders/SaleOrderItemForm.tsx');

function sqlFunction(name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}(`;
  const start = MIGRATION.indexOf(marker);
  expect(start, `${name} ausente`).toBeGreaterThanOrEqual(0);
  const tail = MIGRATION.slice(start);
  const end = tail.indexOf('\n$function$;');
  expect(end, `${name} sem terminador`).toBeGreaterThanOrEqual(0);
  return tail.slice(0, end + '\n$function$;'.length);
}

describe('exclusão administrativa de ficha técnica', () => {
  const impact = sqlFunction('get_technical_sheet_retirement_impact');
  const command = sqlFunction('admin_retire_technical_sheet');
  const links = sqlFunction('technical_sheet_delete_link_counts');
  const referenceGuard = sqlFunction('tg_require_active_technical_sheet_reference');
  const itemExclusionGuard = sqlFunction('tg_guard_sale_order_item_production_exclusion');
  const metadataGuard = sqlFunction('tg_guard_technical_sheet_retirement_metadata');
  const cloneGuard = sqlFunction('tg_guard_technical_sheet_clone_metadata');
  const completeClone = sqlFunction('complete_technical_sheet_clone');
  const cleanupClone = sqlFunction('cleanup_failed_technical_sheet_clone');
  const serviceOrderGuard = sqlFunction('tg_guard_service_order_excluded_item');
  const serviceOrderLineGuard = sqlFunction('tg_guard_service_order_line_excluded_item');
  const waveItemGuard = sqlFunction('tg_guard_wave_item_retired_sheet');
  const waveSourceGuard = sqlFunction('tg_guard_wave_source_excluded_item');
  const queueSync = sqlFunction('tg_sync_production_queue');

  it('é exclusiva de admin no browser e novamente no servidor', () => {
    expect(PAGE).toContain('canDelete={perm.isAdmin}');
    expect(PAGE).not.toContain('canDelete={perm.canDelete}');
    expect(impact).toContain("public.user_has_any_role(ARRAY['admin'])");
    expect(command).toContain("public.user_has_any_role(ARRAY['admin'])");
    expect(command).toContain("ERRCODE = '42501'");
    expect(command).toContain('SECURITY DEFINER');
    expect(command).toContain("SET search_path = ''");
    expect(MIGRATION).toContain(
      'REVOKE DELETE ON TABLE public.technical_sheets\n  FROM PUBLIC, anon, authenticated;',
    );
    expect(MIGRATION).toContain(
      'GRANT EXECUTE ON FUNCTION public.admin_retire_technical_sheet(',
    );
  });

  it('faz preflight dos vínculos preservados sem confiar no browser', () => {
    for (const table of [
      'public.orders',
      'public.sale_order_items',
      'public.technical_sheet_snapshots',
      'public.technical_strap_line_identity_map',
      'public.production_wave_items',
      'public.product_references',
      'public.ready_stock',
      'public.ready_stock_movements',
      'public.reference_materials',
      'public.sop_plan_items',
      'public.nfe_devolucao_item_claims',
    ]) {
      expect(links).toContain(table);
    }
    expect(impact).toContain('active_orders');
    expect(impact).toContain('historical_order_count');
    expect(impact).toContain("'mode', 'retire'");
    expect(impact).toContain("'can_hard_delete', false");
    expect(impact).toContain('blocking_active_order_count');
    expect(HOOK).toContain("'get_technical_sheet_retirement_impact'");
  });

  it('cancela só a produção ativa pelo boundary e preserva o histórico', () => {
    expect(command).toContain('public.execute_production_order_command(');
    expect(command).toContain("'cancel'");
    expect(command).toContain("status = 'Descontinuado'");
    expect(command).toContain("status_ficha = 'arquivada'");
    expect(command).toContain('retirement_reason = v_reason');
    expect(command).toContain('AVISO ADMINISTRATIVO: OP retirada da producao');
    expect(command).toContain('INSERT INTO public.production_alerts');
    expect(command).toContain('INSERT INTO public.audit_logs');
    expect(command).toContain('production_excluded_at = v_retired_at');
    expect(command).toContain('production_exclusion_request_id = p_client_request_id');
    expect(command).toContain('excluded_sale_order_item_ids');
    expect(command).not.toContain('DELETE FROM public.orders');
    expect(command).not.toContain('DELETE FROM public.sale_order_items');
    expect(command).not.toContain('DELETE FROM public.technical_sheet_snapshots');
    expect(command).not.toContain('DELETE FROM public.technical_sheets');
    expect(command).toContain('DELETE FROM public.production_wave_item_sources');
    expect(command).toContain('DELETE FROM public.production_wave_items');
    expect(command).toContain('NOT EXISTS (\n         SELECT 1\n           FROM public.production_wave_item_sources');
    expect(command).not.toContain('DELETE FROM public.production_waves');
    expect(command).not.toContain('DELETE FROM public.production_wave_stages');
  });

  it('recusa atomicamente OP ativa que já possui fato fabril irreversível', () => {
    expect(impact).toContain('public.order_has_non_reversible_production_facts(o.id)');
    expect(command).toContain('public.order_has_non_reversible_production_facts(o.id)');
    expect(command).toContain("ERRCODE = 'PZ233'");
    expect(command.indexOf("ERRCODE = 'PZ233'")).toBeLessThan(
      command.indexOf('public.execute_production_order_command('),
    );
  });

  it('usa CAS, idempotência e ordem de locks PV → ficha → OP', () => {
    expect(command).toContain('p_expected_updated_at');
    expect(command).toContain("ERRCODE = '40001'");
    expect(command).toContain('public.operational_command_receipts');
    expect(command).toContain("'retire_technical_sheet'");
    expect(command).toContain("'sale-order-command:' || v_sale_order_id::text");
    expect(command).toContain('ORDER BY o.sale_order_id, o.id');
    expect(command).toContain('v_locked_sale_order_ids');
    expect(command).toContain("ERRCODE = '40001'");
  });

  it('impede uma ficha aposentada de voltar a novos PVs ou OPs', () => {
    expect(referenceGuard).toContain('FOR SHARE');
    expect(referenceGuard).toContain('IF NEW.reference_id IS NULL THEN');
    expect(referenceGuard).not.toContain("v_status IS DISTINCT FROM 'Ativo'");
    expect(referenceGuard).toContain("ERRCODE = 'PZ231'");
    expect(referenceGuard).toContain('NEW.sale_order_item_id');
    expect(referenceGuard).toContain("ERRCODE = 'PZ236'");
    expect(MIGRATION).toContain('trg_require_active_sheet_on_sale_order_item');
    expect(MIGRATION).toContain('trg_require_active_sheet_on_order');
    expect(HOOK).not.toContain(".filter('retired_at', 'is', null)");
  });

  it('torna a aposentadoria imutável e inacessível à edição comum de gerente', () => {
    expect(metadataGuard).toContain("app.technical_sheet_retirement_internal");
    expect(metadataGuard).toContain("public.user_has_any_role(ARRAY['admin'])");
    expect(metadataGuard).toContain("ERRCODE = '42501'");
    expect(metadataGuard).toContain('OLD.retired_at IS NOT NULL');
    expect(MIGRATION).toContain('trg_000_guard_technical_sheet_retirement_metadata');
    expect(MIGRATION).toContain('BEFORE INSERT OR UPDATE ON public.technical_sheets');
    expect(MIGRATION).toContain('tg_guard_retired_technical_sheet_child');
    expect(MIGRATION).not.toContain('pg_catalog.left(\n               v_warning');
  });

  it('mantém o item comercial e filtra os motores operacionais cobertos', () => {
    expect(MIGRATION).toContain('ADD COLUMN IF NOT EXISTS production_excluded_at');
    expect(itemExclusionGuard).toContain('app.sale_order_item_production_exclusion_internal');
    expect(itemExclusionGuard).toContain("public.user_has_any_role(ARRAY['admin'])");
    expect(MIGRATION).toContain('patch_sale_order_promotion_for_excluded_items');
    for (const signature of [
      'public.fn_projected_demand()',
      'public.fn_projected_packaging_demand()',
      'public.compute_materials_per_pv(uuid[])',
      'public.get_wave_material_needs_core(uuid[],date,boolean)',
      'public.compute_per_pv_packaging_purchase_needs_124(uuid[])',
      'public.calculate_consumption_report_batch(uuid[],uuid[])',
    ]) {
      expect(MIGRATION).toContain(signature);
    }
    expect(MIGRATION).toContain('production_excluded_at IS NULL');
    expect(MIGRATION).toContain("'item retirado da produção'");
  });

  it('fecha reentrada por restore, ondas, terceirização e fila de antecipação', () => {
    expect(command).toContain('IF v_actor_id IS NULL');
    expect(command).toContain("'app.sale_order_command_internal'");
    expect(MIGRATION).toContain('restauracao bloqueada para nao reativar producao');
    expect(MIGRATION).toContain('reversao bloqueada para nao reativar producao');
    expect(waveItemGuard).toContain("ERRCODE = 'PZ231'");
    expect(waveSourceGuard).toContain("ERRCODE = 'PZ236'");
    expect(serviceOrderGuard).toContain('NEW.linked_sale_order_ids');
    expect(serviceOrderGuard).toContain('selected_sale_order_item_ids');
    expect(serviceOrderLineGuard).toContain('NEW.source_item_key');
    expect(serviceOrderLineGuard).toContain('NEW.sale_order_id = item.sale_order_id');
    expect(queueSync).toContain('queue_item.production_excluded_at IS NOT NULL');
    expect(queueSync).toContain('queue_sheet.retired_at IS NOT NULL');
    expect(MIGRATION).toContain('patch_production_queue_view_for_retirement');
    expect(MIGRATION).toContain('patch_recompute_queue_for_retirement');
    expect(MIGRATION).toContain('sale_order_item_id, reference_id');
    expect(itemExclusionGuard).toContain("IF TG_OP = 'DELETE' THEN");
    expect(itemExclusionGuard).toContain('pg_catalog.to_jsonb(NEW)');
  });

  it('substitui a exclusão direta por diálogo de impacto e RPC', () => {
    expect(HOOK).toContain("'admin_retire_technical_sheet'");
    expect(HOOK).toContain('expectedUpdatedAt');
    expect(HOOK).toContain('clientRequestId');
    expect(PAGE).toContain('TechnicalSheetRetirementDialog');
    expect(GRID).not.toContain('DeleteConfirmButton');
  });

  it('mantém o rollback da clonagem sem reabrir DELETE para gerente', () => {
    expect(cloneGuard).toContain('NEW.created_by := v_actor_id');
    expect(cloneGuard).toContain('clone_cleanup_started_at');
    expect(completeClone).toContain('clone_completed_request_id = p_cleanup_request_id');
    expect(cleanupClone).toContain("interval '15 minutes'");
    expect(cleanupClone).toContain("fk.confrelid = 'public.technical_sheets'::regclass");
    expect(cleanupClone).toContain('pg_catalog.format(');
    expect(cleanupClone).toContain('DELETE FROM public.sheet_materials');
    expect(cleanupClone).toContain('app.technical_sheet_clone_cleanup_internal');
    expect(HOOK).toContain("'cleanup_failed_technical_sheet_clone'");
    expect(HOOK).toContain("'complete_technical_sheet_clone'");
    expect(HOOK).toContain('clone_completed_request_id, clone_cleanup_request_id');
    expect(HOOK).toContain('isTechnicalSheetCloneCompletionConfirmed');
    expect(HOOK).toContain('clone_cleanup_request_id: cleanupRequestId');
    expect(HOOK).not.toContain("from('technical_sheets').delete()");
  });

  it('mantém aviso persistente no item comercial retirado da produção', () => {
    expect(SALE_ORDERS).toContain('item.production_excluded_at');
    expect(SALE_ORDERS).toContain('item.production_exclusion_reason');
    expect(SALE_ORDERS).toContain('Retirado da produção');
    expect(SALE_ORDERS).toContain('Este item não faz mais parte da carga de produção.');
  });

  it('preserva e bloqueia o item retirado durante a edição do PV', () => {
    expect(SALE_ORDER_FORM).toContain('production_exclusion_request_id');
    expect(SALE_ORDER_FORM_PANEL).toContain('isProductionExcludedSaleOrderItem');
    expect(SALE_ORDER_ITEM_FORM).toContain('Item preservado e bloqueado para edição');
    expect(SALE_ORDER_ITEM_FORM).toContain('disabled={productionExcluded}');
    expect(SALE_ORDER_ITEM_FORM).toContain('item.production_exclusion_reason');
  });
});
