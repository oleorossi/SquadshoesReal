import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');
const migration = read('supabase/migrations/20270101012100_purchase_order_command_boundary.sql');
const compatibility = read('supabase/migrations/20270101011500_command_boundary_compatibility.sql');
const service = read('src/services/purchaseOrderCommandService.ts');
const hook = read('src/hooks/usePurchaseOrders.ts');
const page = read('src/pages/PurchaseOrders.tsx');

function sqlFunction(name: string): string {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `${name} ausente`).toBeGreaterThanOrEqual(0);
  const tail = migration.slice(start);
  const end = tail.indexOf('\n$function$;');
  expect(end, `${name} sem terminador`).toBeGreaterThan(0);
  return tail.slice(0, end + '\n$function$;'.length);
}

function sourceFiles(path: string): string[] {
  return readdirSync(path).flatMap((entry) => {
    const absolute = resolve(path, entry);
    if (statSync(absolute).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(absolute);
    }
    if (/\.test\./.test(entry) || absolute.endsWith('/integrations/supabase/types.ts')) return [];
    return /\.(?:ts|tsx|js|mjs)$/.test(entry) ? [absolute] : [];
  });
}

describe('fronteira transacional de OC genérica', () => {
  const command = sqlFunction('execute_purchase_order_command');
  const winner = sqlFunction('select_purchase_quotation_winner_command');
  const quotation = sqlFunction('create_po_from_quotation_command');
  const mrp = sqlFunction('generate_purchase_orders_from_mrp');

  it('persiste receipt/hash e trava epoch → produto → embalagem → OC → item', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.purchase_order_command_receipts');
    expect(command).toContain("'purchase-order-command:' || p_client_request_id::text");
    expect(command).toContain('Replay divergente para client_request_id');
    expect(command.indexOf('lock_sale_order_purchase_allocation')).toBeLessThan(
      command.indexOf('lock_sale_order_purchase_products(v_product_ids)'),
    );
    expect(command.indexOf('lock_sale_order_purchase_products(v_product_ids)')).toBeLessThan(
      command.indexOf('lock_purchase_order_box_types_121(v_box_type_ids)'),
    );
    expect(command.indexOf('lock_purchase_order_box_types_121(v_box_type_ids)')).toBeLessThan(
      command.indexOf("'purchase-order:' || p_purchase_order_id::text"),
    );
    expect(command).toContain('ORDER BY locked_item.id');
  });

  it('modela produto XOR embalagem e usa ledger canônico específico de box_type', () => {
    expect(migration).toContain('ALTER COLUMN product_id DROP NOT NULL');
    expect(migration).toContain('purchase_order_items_exactly_one_stock_identity_ck');
    expect(migration).toContain('CHECK ((product_id IS NULL) <> (box_type_id IS NULL))');
    expect(migration).toContain('VALIDATE CONSTRAINT purchase_order_items_exactly_one_stock_identity_ck');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.box_type_stock_movements');
    expect(migration).toContain('UNIQUE (client_request_id, purchase_order_item_id)');
    expect(command).toMatch(
      /IF v_item_row\.box_type_id IS NOT NULL THEN[\s\S]*?UPDATE public\.box_types[\s\S]*?INSERT INTO public\.box_type_stock_movements/,
    );
    const boxStart = command.indexOf('IF v_item_row.box_type_id IS NOT NULL THEN');
    const boxBranch = command.slice(boxStart, command.indexOf('\n      ELSE', boxStart));
    expect(boxBranch).not.toContain('INSERT INTO public.stock_movements');
    expect(command).toContain("CASE WHEN v_box_type.tipo::text = 'fitilho' THEN 'm' ELSE 'un' END");
    expect(command).toMatch(/v_factor := 1;[\s\S]*?v_received_stock := v_receive_qty;/);
  });

  it('recebe produto com reason/origin aceitos pelo schema vivo e tudo na mesma transação', () => {
    expect(command).toMatch(
      /INSERT INTO public\.stock_movements[\s\S]*?v_actor_id, v_new_unit_price, 'compra',[\s\S]*?NULL, v_effective_unit_price/,
    );
    expect(command).not.toContain("'purchase_order_receipt', v_effective_unit_price");
    expect(command).toContain('UPDATE public.purchase_order_items item SET');
    expect(command).toContain('INSERT INTO public.purchase_order_command_receipts');
    expect(migration).toContain("position('compra' IN COALESCE(v_stock_constraints, ''))");
    expect(migration).toContain("column_row.column_name = 'origin_type'");
    expect(migration).toContain("column_row.is_nullable = 'YES'");
  });

  it('falha fechado para grade textual, negativa ou fracionária', () => {
    expect(command).toContain("jsonb_typeof(grade_entry.value) = 'number'");
    expect(command).toContain("(grade_entry.value #>> '{}')::numeric < 0");
    expect(command).toContain("pg_catalog.trunc((grade_entry.value #>> '{}')::numeric)");
    expect(command).toContain('v_grade_sum IS DISTINCT FROM v_item_row.quantity');
    expect(command).toContain('quantidades inteiras e nao negativas');
  });

  it('deduplica atomicamente o append do mesmo PV e preserva notas anteriores', () => {
    expect(command).toContain("v_payload ->> 'deduplicate_sale_order_id'");
    expect(command).toMatch(/v_skip_append :=[\s\S]*?linked_sale_order_ids/);
    expect(command).toContain("'deduplicated', v_skip_append");
    expect(command).toContain("purchase_order.notes || E'\\n' || (v_patch ->> 'notes_append')");
    expect(command).toMatch(/IF NOT v_skip_append AND \([\s\S]*?create_payables/);
  });

  it('congela award comercial e gera OC/AP apenas do snapshot completo', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.purchase_quotation_award_snapshots');
    expect(migration).toContain('trg_preserve_purchase_quotation_award_snapshot_121');
    expect(migration).toContain('ux_purchase_quotation_one_winner_121');
    expect(winner).toContain('v_price_count <> v_item_count');
    expect(winner).toContain('effective_unit_price');
    expect(winner).toContain("'freight_value', COALESCE(v_response.freight_value, 0)");
    expect(winner).toContain("'payment_terms', v_response.payment_terms");
    expect(winner).toContain("'subtotal_value', v_subtotal_value");
    expect(winner).toContain("'total_value', v_total_value");
    expect(winner).toContain('app.purchase_quotation_award_internal');
    expect(quotation).toContain('purchase_quotation_award_snapshots');
    expect(quotation).toContain('pg_catalog.md5(v_award.snapshot::text)');
    expect(quotation).not.toContain('purchase_quotation_prices');
    expect(quotation).toContain("'quotation_award_snapshot_id', v_award.id");
    expect(quotation).toContain("'create_payables', true");
    expect(quotation).toContain("'payment_days', v_payment_days");
    expect(command).toContain('purchase_order.freight_value + (');
    expect(command).toContain('quotation_award_snapshot_id');
  });

  it('faz replay do MRP pelo input congelado antes de reler necessidades vivas', () => {
    expect(migration).toContain("'force_delete_product', 'quotation_winner'");
    expect(migration).toContain("'receive', 'mrp'");
    expect(mrp).toContain("'all_products', p_product_ids IS NULL");
    expect(mrp).toContain("'product_ids', v_requested_ids");
    expect(mrp.indexOf('WHERE receipt.client_request_id')).toBeLessThan(
      mrp.indexOf('FROM public.v_mrp_needs need'),
    );
    expect(migration).toContain('public.generate_purchase_orders_from_mrp(uuid[],uuid)');
    expect(migration).toContain('public.create_po_from_quotation_command(uuid,uuid)');
  });

  it('fecha REST e RPCs legadas somente depois de migrar todos os writers vivos', () => {
    for (const table of ['purchase_orders', 'purchase_order_items']) {
      expect(migration).toMatch(
        new RegExp(`REVOKE INSERT, UPDATE, DELETE ON TABLE public\\.${table}[\\s\\S]*?anon, authenticated, service_role`),
      );
    }
    for (const rpc of [
      'create_purchase_order_normalized',
      'upsert_po_item_atomic',
      'upsert_open_purchase_order',
    ]) {
      expect(migration).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${rpc}`));
    }
    expect(compatibility).toMatch(
      /REVOKE ALL ON FUNCTION public\.upsert_open_purchase_order\([\s\S]*?authenticated, service_role/,
    );
    expect(migration).not.toContain('legacy_cutover_is_compatible');

    const directWriter = /\.from\(\s*['"](?:purchase_orders|purchase_order_items)['"]\s*\)[\s\S]{0,1200}?\.(?:insert|update|delete|upsert)\s*\(/;
    const legacyRpc = /\.rpc\(\s*['"](?:create_purchase_order_normalized|upsert_po_item_atomic|upsert_open_purchase_order|create_po_from_quotation)['"]/;
    const offenders = [
      ...sourceFiles(resolve(ROOT, 'src')),
      ...sourceFiles(resolve(ROOT, 'supabase/functions')),
    ].flatMap((path) => {
      const contents = readFileSync(path, 'utf8');
      return directWriter.test(contents) || legacyRpc.test(contents) ? [path] : [];
    });
    expect(offenders).toEqual([]);
  });

  it('mantém request UUID em falha ambígua também nos commands auxiliares', () => {
    expect(service).toContain('function throwCommandError');
    expect(service).toContain("typeof error?.code === 'string' && error.code.length > 0");
    expect(service.match(/if \(error\) throwCommandError\(logicalKey, error\);/g)?.length).toBe(4);
    expect(service).toContain('samePayload');
  });

  it('mantém upsert automático fora dos canais exclusivos e idempotente por PV', () => {
    expect(hook).toContain(".not('source_type', 'in', '(per_pv,strap_demand)')");
    expect(hook).toContain('notes_append: data.notes');
    expect(hook).toContain('deduplicate_sale_order_id: data.sale_order_id');
  });

  it('usa o prazo comercial congelado e valida a grade na tela antes da RPC', () => {
    expect(page).toContain('order.quotation_award_snapshot_id');
    expect(page).toContain('order.payment_terms ?? null');
    expect(page).toContain('Number.isInteger(value)');
    expect(page).toContain('gradeSum !== itemQty');
  });

  it('protege exclusão destrutiva com admin, CAS, receipt e locks', () => {
    const forceDelete = sqlFunction('force_delete_product_command');
    expect(forceDelete).toContain("ARRAY['admin']");
    expect(forceDelete).toContain('p_expected_updated_at');
    expect(forceDelete.indexOf('lock_sale_order_purchase_allocation')).toBeLessThan(
      forceDelete.indexOf('lock_sale_order_purchase_products'),
    );
    expect(forceDelete).toContain('purchase_order_command_receipts');
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.force_delete_product_command\([\s\S]*?PUBLIC, anon, service_role/,
    );
  });

  it('executa contrato introspectivo e fecha a migration sem tocar dados vivos', () => {
    expect(migration).toContain('run_purchase_order_command_boundary_contract_tests');
    expect(migration).toContain("RAISE EXCEPTION 'Contrato da fronteira de OC falhou: %'");
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
    expect(migration).not.toMatch(/\bUPDATE public\.purchase_quotation_(?:items|prices)\b[\s\S]*?WHERE\s+TRUE/i);
  });
});
