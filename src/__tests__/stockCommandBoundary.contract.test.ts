import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const MIGRATION = read(
  'supabase/migrations/20270101012500_stock_command_boundary.sql',
);
const COMMAND = read('src/lib/stockCommand.ts');

function sqlFunction(name: string): string {
  const start = MIGRATION.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `${name} ausente`).toBeGreaterThanOrEqual(0);
  const tail = MIGRATION.slice(start);
  const match = tail.match(/\n\$(?:function)?\$;/);
  expect(match?.index, `${name} sem terminador`).toBeTypeOf('number');
  return tail.slice(0, (match?.index ?? 0) + (match?.[0].length ?? 0));
}

describe('fronteira canonica de comandos de estoque', () => {
  const execute = sqlFunction('execute_stock_command');

  it('fecha os quatro comandos em uma unica API tipada', () => {
    for (const command of [
      'adjust_products',
      'create_product',
      'configure_product_grades',
      'ready_stock',
    ]) {
      expect(execute).toContain(`'${command}'`);
      expect(COMMAND).toContain(`'${command}'`);
    }
    expect(COMMAND).toContain("rpc('execute_stock_command'");
    expect(COMMAND).toContain('p_expected_snapshot: expectedSnapshot');
    expect(COMMAND).toContain('globalThis.crypto.randomUUID');
  });

  it('persiste receipt e recusa replay divergente por comando, hash e ator', () => {
    expect(MIGRATION).toContain('CREATE TABLE public.stock_command_receipts');
    expect(MIGRATION).toContain('client_request_id uuid NOT NULL UNIQUE');
    expect(execute).toContain("'stock-command-request:' || p_request_id::text");
    expect(execute).toContain("'expected_snapshot', v_snapshot");
    expect(execute).toContain('v_receipt.request_hash IS DISTINCT FROM v_request_hash');
    expect(execute).toContain('v_receipt.actor_id IS DISTINCT FROM v_actor_id');
    expect(MIGRATION).toContain('actor_id uuid NOT NULL');
    expect(execute).toContain('00000000-0000-0000-0000-000000000125');
    expect(execute).toContain('v_auth_user_id uuid := auth.uid()');
    expect(execute).toContain("jsonb_build_object('replayed', true)");
    expect(execute).toContain('INSERT INTO public.stock_command_receipts');
  });

  it('trava identidades em ordem, valida CAS e aplica lote somente sem erros', () => {
    expect(execute).toContain("ORDER BY value ->> 'product_id'");
    expect(execute).toContain("'stock-product:'");
    expect(execute).toContain('ORDER BY product.id');
    expect(execute).toContain('FOR UPDATE');
    expect(execute).toContain('round(v_product.quantity, 4)');
    expect(execute).toContain("'CONCURRENCY_ERROR'");
    expect(execute).toContain('IF jsonb_array_length(v_errors) = 0 THEN');
    expect(execute).toContain("'DUPLICATE_PRODUCT'");
    expect(execute).toContain("'DUPLICATE_READY_STOCK'");
  });

  it('mantem quantity/current_stock/grade coerentes e protege reservas', () => {
    expect(execute).toContain('stock_grade_validation_error_125');
    expect(execute).toContain("'GRADE_REQUIRED_FOR_GRADED_PRODUCT'");
    expect(execute).toContain("'EXPECTED_GRADE_REQUIRED'");
    expect(execute).toContain('SET quantity = v_new_qty');
    expect(execute).toContain('current_stock = v_new_qty');
    expect(execute).toContain("'RESERVADO_PARA_OP'");
    expect(execute).toContain('v_new_qty < COALESCE(v_product.reserved_stock, 0)');
    expect(execute).not.toMatch(/v_enforce_reserved\s+AND\s+v_order_id IS NULL/);
    expect(execute).toContain("'NEGATIVE_QTY_NOT_ALLOWED'");
    expect(execute).not.toContain('GREATEST(v_ready');
  });

  it('grava ledgers idempotentes na mesma transacao do efeito', () => {
    expect(MIGRATION).toContain('CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_stock_command_item_uq');
    expect(MIGRATION).toContain('CREATE TABLE public.ready_stock_movements');
    expect(MIGRATION).toMatch(/stock_command_receipt_id uuid[\s\S]{0,180}DEFERRABLE INITIALLY DEFERRED/);
    expect(execute).toContain('INSERT INTO public.stock_movements');
    expect(execute).toContain('INSERT INTO public.ready_stock_movements');
    expect(execute).toContain('stock_command_item_index');
    expect(execute).toContain('previous_quantity');
    expect(execute).toContain('new_quantity');
    expect(execute).toContain("'ajuste', v_receipt_id");
    expect(execute).not.toContain("'ajuste_manual'");
  });

  it('cria produto e saldo inicial atomicamente sem escolher identidade ambigua', () => {
    expect(execute).toContain("'stock-product-sku:' || COALESCE(v_lock_key, '')");
    expect(execute).toContain("lower(btrim(product.sku)) = lower(v_sku)");
    expect(execute).toContain("'SKU_ALREADY_EXISTS'");
    expect(execute).toContain('INSERT INTO public.products');
    expect(execute).toContain('RETURNING id INTO v_created_product_id');
    expect(execute).toContain('v_created_product_id, \'in\', v_new_qty');
    expect(execute).toContain("'INVALID_CONVERSION_RATE'");
    expect(execute).toContain("v_payload -> 'products'");
    expect(execute).toContain('jsonb_array_length(v_items) > 500');
    expect(execute).toContain("jsonb_typeof(v_snapshot -> 'product_absent_skus') IS DISTINCT FROM 'array'");
    expect(execute).toContain('WITH ORDINALITY item(value, ordinal)');
    expect(execute).toContain('apply_product_metadata_125');
    expect(MIGRATION).toContain("'quantity','current_stock','reserved_stock','stock_grade'");
    expect(execute).not.toMatch(/products[\s\S]{0,160}(?:ILIKE|similarity)\s*\(/i);
  });

  it('pronta-entrega preserva variante, CAS e ledger inclusive no delete', () => {
    expect(MIGRATION).toContain('ready_stock_ref_variant_color_size_uq');
    expect(execute).toContain('ready.material_variant_id IS NOT DISTINCT FROM v_material_variant_id');
    expect(execute).toContain('variant.reference_id = v_reference_id');
    expect(execute).toContain("'VARIANT_REFERENCE_MISMATCH'");
    expect(execute).toContain("IF v_action = 'delete' THEN");
    expect(execute.indexOf('INSERT INTO public.ready_stock_movements')).toBeLessThan(
      execute.indexOf('DELETE FROM public.ready_stock'),
    );
  });

  it('ACL remove somente campos fisicos e preserva metadados de products', () => {
    for (const field of [
      'quantity', 'current_stock', 'reserved_stock',
      'stock_grade', 'blocked_qty', 'quarantine_qty',
    ]) {
      expect(MIGRATION).toContain(`'${field}'`);
    }
    expect(MIGRATION).toContain('GRANT INSERT (%s) ON public.products TO authenticated');
    expect(MIGRATION).toContain('GRANT UPDATE (%s) ON public.products TO authenticated');
    expect(MIGRATION).toContain('REVOKE INSERT, UPDATE, DELETE ON TABLE public.ready_stock');
    expect(MIGRATION).toContain('REVOKE INSERT, UPDATE, DELETE ON TABLE public.stock_movements');
    expect(MIGRATION).toContain("'adjust_stock', 'adjust_stock_batch', 'move_stock_delta'");
    expect(MIGRATION).toContain("ARRAY['admin','gerente','almoxarifado']");
    expect(MIGRATION).toContain("USING ERRCODE = '42501'");
  });

  it('callers de saldo nao mantem writers legados ou DML fisico direto', () => {
    const stockAdjustments = read('src/lib/stockAdjustments.ts');
    const stockPage = read('src/pages/StockAdjustmentPage.tsx');
    const productDetail = read('src/pages/ProductDetail.tsx');
    const manualOut = read('src/components/inventory/ManualStockOutDialog.tsx');
    const readyHook = read('src/hooks/useReadyStock.ts');
    const suppliers = read('src/pages/Suppliers.tsx');
    const addToStock = read('src/components/suppliers/AddToStockDialog.tsx');

    expect(stockAdjustments).toContain('adjustProductsStock');
    expect(stockPage).toContain('adjustProductsStock');
    expect(productDetail).toContain('adjustStockSafe');
    expect(manualOut).toContain('adjustStockSafe');
    expect(readyHook).toContain('mutateReadyStock');
    expect(readyHook).toContain('useBatchDeleteReadyStock');
    expect(suppliers).toContain('createProductWithStock');
    expect(addToStock).toContain('createProductWithStock');

    const combined = [
      stockAdjustments, stockPage, productDetail, manualOut,
      readyHook, suppliers, addToStock,
    ].join('\n');
    expect(combined).not.toMatch(/rpc\(['"](?:adjust_stock|adjust_stock_batch|move_stock_delta|create_product_with_initial_stock|upsert_ready_stock_atomic)['"]/);
    expect(readyHook).not.toMatch(/from\(['"]ready_stock['"]\)[\s\S]{0,180}\.(?:insert|update|delete)\(/);
    expect(suppliers).not.toMatch(/from\(['"]stock_movements['"]\)[\s\S]{0,180}\.insert\(/);
  });

  it('todos os editores de grade usam o comando com snapshot anterior', () => {
    for (const path of [
      'src/components/inventory/ProductFormDialog.tsx',
      'src/components/inventory/SoleSizeConjugationsEditor.tsx',
      'src/components/inventory/MasterVariantDialog.tsx',
      'src/components/inventory/SoladoGradeDialog.tsx',
      'src/components/soles-hub/SoleCreateDialog.tsx',
    ]) {
      const source = read(path);
      expect(source).toMatch(/configureProductGrades|adjustProductsStock|adjustStockSafe|createProductWithStock/);
      expect(source).not.toMatch(/from\(['"]products['"]\)[\s\S]{0,180}\.update\(\{\s*stock_grade\s*:/);
    }
    const productsHook = read('src/hooks/useProducts.ts');
    expect(productsHook).toContain('stripProductPhysicalFields');
    expect(productsHook).toContain('createProductWithStock');
    expect(productsHook).toContain('createProductsWithStock');
    expect(productsHook).toContain('blocked_qty');
    expect(productsHook).toContain('quarantine_qty');
    expect(productsHook).not.toMatch(/from\(['"]products['"]\)[\s\S]{0,180}\.insert\(/);

    const quickFamily = read('src/components/inventory/QuickFamilyDialog.tsx');
    expect(quickFamily).toContain('createProductsWithStock');
    expect(quickFamily).not.toMatch(/from\(['"]products['"]\)[\s\S]{0,180}\.insert\(/);
  });

  it('instala self-test SQL read-only e fecha a migration', () => {
    expect(MIGRATION).toContain('run_stock_command_boundary_self_test_125');
    expect(MIGRATION).toContain("test_name := 'browser_physical_acl'");
    expect(MIGRATION).toContain("test_name := 'entrypoint_acl'");
    expect(MIGRATION.trimEnd()).toMatch(/COMMIT;$/);
  });
});
