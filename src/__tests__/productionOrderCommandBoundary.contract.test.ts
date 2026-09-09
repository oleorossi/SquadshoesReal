import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const MIGRATION = read(
  'supabase/migrations/20270101010800_production_order_command_boundary.sql',
);
const USE_ORDERS = read('src/hooks/useOrders.ts');
const ORDERS_PAGE = read('src/pages/Orders.tsx');
const PICKING_PAGE = read('src/pages/OrderPickingPage.tsx');
const SALE_ORDERS_PAGE = read('src/pages/SaleOrders.tsx');
const USE_SALE_ORDERS = read('src/hooks/useSaleOrders.ts');
const USE_REVERT = read('src/hooks/useRevertInvoicedSaleOrder.ts');
const REVERT_BUTTON = read('src/components/sale-orders/RevertInvoiceButton.tsx');

function sqlFunction(name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}(`;
  const start = MIGRATION.indexOf(marker);
  expect(start, `${name} ausente`).toBeGreaterThanOrEqual(0);
  const tail = MIGRATION.slice(start);
  const end = tail.indexOf('\n$$;');
  expect(end, `${name} sem terminador`).toBeGreaterThanOrEqual(0);
  return tail.slice(0, end + 4);
}

describe('OP command boundary — transação e estoque', () => {
  const execute = sqlFunction('execute_production_order_command');
  const materialize = sqlFunction('materialize_production_order_internal');
  const cancel = sqlFunction('cancel_production_order_internal');

  it('fecha create/etapas/status/cancel/delete com receipt, lock e CAS', () => {
    for (const command of ['create', 'ensure_stages', 'transition', 'cancel', 'delete']) {
      expect(execute).toContain(`'${command}'`);
    }
    expect(execute).toContain('public.operational_command_receipts');
    expect(execute).toContain('p_client_request_id IS NULL');
    expect(execute).toContain('pg_advisory_xact_lock');
    expect(execute).toContain('FOR UPDATE');
    expect(execute).toContain('expected_status');
    expect(execute).toContain("v_order.status IS DISTINCT FROM v_expected_status");
    expect(MIGRATION).toContain('BEGIN;');
    expect(MIGRATION).toContain('COMMIT;');
  });

  it('reutiliza motores canônicos sem fabricar consumo nem perda', () => {
    for (const canonical of [
      'initialize_order_material_reservations',
      'debit_sole_stock_by_grade',
      'debit_packaging_for_order',
      'ensure_production_order_stages_internal',
    ]) {
      expect(materialize).toContain(canonical);
    }
    expect(materialize).not.toContain('waste_pct');
    expect(materialize).not.toContain('consumption_loss_pct');
    expect(MIGRATION).not.toContain('1 + waste');
  });

  it('cancela com estorno causal e delete lógico audit-safe', () => {
    expect(cancel).toContain('release_order_reservations');
    expect(cancel).toContain('restore_sole_grade_for_order');
    expect(cancel).toContain('restore_product_stocks_for_order');
    expect(cancel).toContain('v_has_physical_sole');
    expect(cancel).toContain('Baixa na finalização — Solado por grade%');
    expect(cancel).toContain('v_has_prior_inbound AND v_has_positive_net_debit');
    expect(cancel).not.toContain('DELETE FROM public.stock_movements');
    expect(execute).toContain('deleted_at = now()');
    expect(execute).toContain("'audit_preserved', true");
    expect(execute).not.toContain('DELETE FROM public.production_consumptions');
    expect(execute).not.toContain('DELETE FROM public.material_reservations');
  });

  it('revoga DML de orders e mantém internos explicitamente marcados', () => {
    expect(MIGRATION).toContain(
      'REVOKE INSERT, UPDATE, DELETE ON TABLE public.orders\n  FROM PUBLIC, anon, authenticated;',
    );
    expect(MIGRATION).toContain(
      'REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.orders',
    );
    expect(MIGRATION).toContain('trg_000_enforce_production_order_command_boundary');
    expect(MIGRATION).toContain('DO $revoke_orders_column_writes$');
    expect(MIGRATION).toContain('has_column_privilege(');
    expect(MIGRATION).toContain('app.production_order_command_internal');
    expect(MIGRATION).toContain('app.sale_order_command_internal');
    expect(MIGRATION).toContain('DROP POLICY IF EXISTS orders_select_approved');
    expect(MIGRATION).toContain('run_production_order_command_contract_tests');
  });
});

describe('OP command boundary — integrações de PV e logística', () => {
  it('expedição preflights o lote inteiro e fecha PV/OP/rota/manifesto junto', () => {
    const shipment = sqlFunction('register_order_shipment_command');
    expect(shipment).toContain('p_expected_versions');
    expect(shipment).toContain('v_preflight_count');
    expect(shipment).toContain('ORDER BY so.id\n     FOR UPDATE');
    expect(shipment).toContain('public.nfe_emitidas');
    expect(shipment).toContain('v_so.nfe_external');
    expect(shipment).toContain("v_so.status = 'Em Produção'");
    expect(shipment).toContain("'Finalizado', 'FINALIZADO', 'Faturado'");
    expect(shipment).toContain("'Concluída', 'Concluído', 'Concluido', 'completed'");
    expect(shipment).toContain('UPDATE public.order_stages');
    expect(shipment).toContain('UPDATE public.orders');
    expect(shipment).toContain('public.loading_manifest_items');
    expect(shipment).toContain("'register_shipment'");
  });

  it('wrappers legados têm versão, idempotência, papel e superfície fechada', () => {
    const force = sqlFunction('force_sale_order_production_command');
    const softDelete = sqlFunction('soft_delete_sale_order_command');
    const restore = sqlFunction('restore_sale_order_command');
    const revert = sqlFunction('revert_invoiced_sale_order_command');
    expect(force).toContain('p_expected_order_version');
    expect(force).toContain('public.execute_sale_order_command(');
    expect(force).toContain("ARRAY['admin']");
    expect(softDelete).toContain('soft_delete_sale_order_internal_108');
    expect(restore).toContain('p_expected_order_version');
    expect(restore).toContain("app.production_order_command_internal");
    expect(revert).toContain('length(v_reason) < 10');
    expect(revert).toContain('v_so.is_standalone_nfe');
    expect(revert).toContain('revert_invoiced_sale_order_internal_108');
    for (const legacy of [
      'register_order_shipment(uuid[], uuid, text)',
      'force_sale_order_production(uuid)',
      'restore_sale_order(uuid)',
    ]) {
      expect(MIGRATION).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${legacy.replace(/[()[\]]/g, '\\$&')}[\\s\\S]*?service_role`),
      );
    }
  });

  it('gatilhos de etapa atravessam o boundary com receipt e sem UPDATE próprio', () => {
    const internal = sqlFunction('apply_sale_order_stage_transition_internal');
    const promote = sqlFunction('auto_promote_sale_order_to_production');
    const bill = sqlFunction('auto_bill_sale_order_on_finishing');
    expect(internal).toContain('pg_advisory_xact_lock');
    expect(internal).toContain('v_so.order_version');
    expect(internal).toContain('public.operational_command_receipts');
    expect(internal).toContain("app.sale_order_command_internal");
    expect(promote).toContain('apply_sale_order_stage_transition_internal');
    expect(bill).toContain('apply_sale_order_stage_transition_internal');
    expect(promote).not.toContain('UPDATE public.sale_orders');
    expect(bill).not.toContain('UPDATE public.sale_orders');
  });
});

describe('OP command boundary — callers do browser', () => {
  it('Orders/useOrders não fazem DML direto nem orquestram estorno no browser', () => {
    const browser = `${USE_ORDERS}\n${ORDERS_PAGE}`;
    expect(browser).toContain("'execute_production_order_command'");
    for (const dml of ['.insert(', '.update(', '.delete(', '.upsert(']) {
      expect(browser).not.toContain(dml);
    }
    for (const internalRpc of [
      'initialize_order_material_reservations',
      'debit_sole_stock_by_grade',
      'debit_packaging_for_order',
      'release_order_reservations',
      'restore_sole_grade_for_order',
      'restore_product_stocks_for_order',
    ]) {
      expect(browser).not.toContain(internalRpc);
    }
    expect(USE_ORDERS).toContain('expected_status');
    expect(USE_ORDERS).toContain('crypto.randomUUID()');
  });

  it('Picking, force, delete, restore e revert usam commands com CAS/UUID', () => {
    expect(PICKING_PAGE).toContain("'register_order_shipment_command'");
    expect(PICKING_PAGE).toContain('p_expected_versions');
    expect(PICKING_PAGE).toContain('order_version');
    expect(PICKING_PAGE).toContain(".in('status', ['Faturado', 'Em Produção'])");
    expect(PICKING_PAGE).toContain('so.nfe_required && !so.nfe_external');
    expect(PICKING_PAGE).toContain('crypto.randomUUID()');
    expect(SALE_ORDERS_PAGE).toContain("'force_sale_order_production_command'");
    expect(SALE_ORDERS_PAGE).toContain('p_expected_order_version');
    expect(USE_SALE_ORDERS).toContain("'soft_delete_sale_order_command'");
    expect(USE_SALE_ORDERS).toContain("'get_deleted_sale_order_restore_context'");
    expect(USE_SALE_ORDERS).toContain("'restore_sale_order_command'");
    expect(USE_REVERT).toContain("'revert_invoiced_sale_order_command'");
    expect(USE_REVERT).toContain('p_expected_order_version');
    expect(USE_REVERT).toContain('is_standalone_nfe');
    expect(REVERT_BUTTON).toContain('reason.trim().length < 10');

    const callers = `${PICKING_PAGE}\n${SALE_ORDERS_PAGE}\n${USE_SALE_ORDERS}\n${USE_REVERT}`;
    for (const legacyCall of [
      "rpc('register_order_shipment'",
      "rpc('force_sale_order_production'",
      "rpc('soft_delete_sale_order'",
      "rpc('restore_sale_order'",
      "rpc('revert_invoiced_sale_order'",
    ]) {
      expect(callers).not.toContain(legacyCall);
    }
  });
});
