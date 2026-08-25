import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const migration116 = read('supabase/migrations/20270101011600_consumption_parity_hotfix.sql');
const migration121 = read('supabase/migrations/20270101012100_purchase_order_command_boundary.sql');
const migration124 = read('supabase/migrations/20270101012400_per_pv_canonical_packaging_purchase.sql');
const purchasing = read('src/lib/perPvPurchasing.ts');
const hook = read('src/hooks/usePerPvPurchasing.ts');
const dialog = read('src/components/purchase/GeneratePurchaseOrdersDialog.tsx');

describe('embalagem canônica — relatório, OC exclusiva e recebimento', () => {
  it('retira as alternativas do BOM e seleciona somente slots UUID por packaging_mode', () => {
    expect(migration116).toContain('legacy_packaging_product_bridges');
    expect(migration116).toContain('AUDIT-PACKAGING-CANONICAL-20260825: BOM legado excluído');
    expect(migration116).toContain('CREATE OR REPLACE FUNCTION public.calculate_packaging_consumption');
    expect(migration116).toContain("WHEN p_packaging_mode = 'colmeia' THEN ARRAY['colmeia']");
    expect(migration116).toMatch(
      /CREATE OR REPLACE FUNCTION public\.fn_projected_packaging_demand\(\)[\s\S]*?calculate_packaging_consumption/,
    );
    expect(migration116).toContain('packaging_cost_uses_canonical_helper');
    expect(migration116).toContain('packaging_hybrid_cannot_reserve_legacy_bom');
    expect(migration116).toContain('packaging_debit_uses_fail_closed_slot_plan');
    expect(migration116).toContain('AUDIT-PACKAGING-CANONICAL-20260825: slot-kind-fail-closed');
    expect(migration116).toContain('packaging_slot_kind_mismatch_fails_closed');
    expect(migration116).not.toContain('v_row_cat_norm%embalagem');
  });

  it('a OC persiste identidade XOR e o recebimento credita box_types/ledger', () => {
    expect(migration121).toContain('ALTER COLUMN product_id DROP NOT NULL');
    expect(migration121).toContain('purchase_order_items_exactly_one_stock_identity_ck');
    expect(migration121).toContain('lock_purchase_order_box_types_121');
    expect(migration121).toMatch(/UPDATE public\.box_types[\s\S]*?quantity = v_new_stock/);
    expect(migration121).toMatch(
      /INSERT INTO public\.box_type_stock_movements[\s\S]*?v_box_type\.id, v_po\.id, v_item_row\.id/,
    );
    expect(migration121).toContain("v_box_type.tipo::text = 'fitilho' THEN 'm'");
  });

  it('o botão por PV usa demanda box_type, trava/revalida e mantém um recibo atômico', () => {
    expect(migration124).toContain('require_purchase_order_box_contract_121');
    expect(migration124).toContain('INSERT INTO public.box_type_stock_movements');
    expect(migration124).toContain('compute_per_pv_purchase_needs_v2');
    expect(migration124).toContain("so.status IN ('Aprovado', 'Em Produção')");
    expect(migration124).toContain('lock_purchase_order_box_types_121');
    expect(migration124).toContain('create_per_pv_purchase_orders_atomic_products_124');
    expect(migration124).toContain('execute_purchase_order_command');
    expect(migration124).toContain('per_pv_purchase_batch_receipts_124');
    expect(migration124).toContain("'append'");
    expect(migration124).toContain('Embalagem do PV não configurada');
    expect(migration124).toContain('purchase_order.source_pv_ids');
    expect(migration124).toContain('NULL::uuid AS material_id');
  });

  it('frontend transporta box_type_id sem consultar/inventar products', () => {
    expect(purchasing).toContain('box_type_id?: string | null');
    expect(purchasing).toContain("kind: 'product' | 'box_type'");
    expect(hook).toContain("rpc('compute_per_pv_purchase_needs_v2'");
    expect(hook).toContain('box_type_id: item.box_type_id ?? null');
    expect(dialog).toContain('perPvStockIdentityKey');
  });
});
