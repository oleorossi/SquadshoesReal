import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const SQL = readFileSync(
  resolve(ROOT, 'supabase/migrations/20270101024100_pv_header_save_skips_op_rewrite.sql'),
  'utf8',
);
const FORM = readFileSync(resolve(ROOT, 'src/pages/SaleOrderForm.tsx'), 'utf8');

function sqlFunction(name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}(`;
  const start = SQL.indexOf(marker);
  expect(start, `${name} ausente`).toBeGreaterThanOrEqual(0);
  const tail = SQL.slice(start);
  const end = tail.indexOf('\n$fn$;');
  expect(end, `${name} sem terminador`).toBeGreaterThanOrEqual(0);
  return tail.slice(0, end + 6);
}

describe('PV header save skips OP rewrite (20270101024100)', () => {
  const helper = sqlFunction('sale_order_update_is_production_neutral');
  const documentary = sqlFunction('apply_sale_order_documentary_header');
  const neutralUpdate = sqlFunction('apply_sale_order_production_neutral_update');

  it('helper de produção ignora NF/OC e olha demanda/embalagem', () => {
    expect(helper).toContain('pv_header_save_skips_op_rewrite_20270101024100');
    expect(helper).toContain("v_header ? 'packaging_mode'");
    expect(helper).toContain("v_header ? 'box_grouping'");
    expect(helper).toContain("v_header ? 'packaging_product_id'");
    expect(helper).toContain("v_header ? 'packaging_quantity'");
    expect(helper).toContain("v_header ? 'outsource_to_contractor_id'");
    expect(helper).toContain("v_header ? 'outsource_to_sector'");
    expect(helper).toContain('soi.fichas');
    expect(helper).toContain('material_variant_id');
    expect(helper).toContain('selected_terceirizacao_ids');
    expect(helper).not.toContain('client_order_number');
    expect(helper).not.toContain("v_header ? 'nfe'");
  });

  it('documentary header persiste NF e pedido do cliente só quando a chave veio', () => {
    expect(documentary).toContain("v_header ? 'client_order_number'");
    expect(documentary).toContain("v_header ? 'nfe'");
    expect(documentary).toContain("v_header ? 'remessa'");
    expect(documentary).toContain("v_header ? 'notes'");
    expect(documentary).toContain('Chave ausente preserva o valor atual');
    expect(documentary).not.toContain('packaging_mode');
    expect(documentary).not.toContain('outsource_to_contractor_id');
  });

  it('caminho neutro não chama teardown nem promote', () => {
    expect(neutralUpdate).toContain('apply_sale_order_documentary_header');
    expect(neutralUpdate).toContain("'production_neutral', true");
    expect(neutralUpdate).toContain('recalc_sale_order_total');
    expect(neutralUpdate).not.toContain('update_sale_order_with_teardown');
    expect(neutralUpdate).not.toContain('promote_sale_order_atomic_internal');
  });

  it('execute vivo pula PZ120/teardown/promote quando production-neutral', () => {
    expect(SQL).toContain('v_production_neutral boolean := false');
    expect(SQL).toContain('sale_order_update_is_production_neutral(');
    expect(SQL).toContain('IF NOT v_production_neutral AND p_payload ? \'cancel_op_ids\' THEN');
    expect(SQL).toContain('IF NOT v_production_neutral AND EXISTS (');
    expect(SQL).toContain("USING ERRCODE = 'PZ120'");
    expect(SQL).toContain('apply_sale_order_production_neutral_update(');
    expect(SQL).toContain('ELSIF cardinality(v_cancel_op_ids) > 0 THEN');
    expect(SQL).toContain('IF NOT v_production_neutral\n           AND v_so.status IN (\'Aprovado\', \'Em Produção\')');
    expect(SQL).toContain('IF NOT v_production_neutral\n           AND cardinality(v_cancel_op_ids) = 0');
    expect(SQL).toContain('promote_sale_order_atomic_internal');
    expect(SQL).toContain('PERFORM public.apply_sale_order_documentary_header(');
  });

  it('preflight não pede cancelamento de OP em save documental', () => {
    expect(SQL).toContain("'advanced_orders_require_cancel_confirmation'");
    expect(SQL).toContain('AND NOT public.sale_order_update_is_production_neutral(');
    expect(SQL).toContain("COALESCE(p_payload -> 'header', '{}'::jsonb)");
  });

  it('formulário só abre o diálogo de cancelar OP quando a fábrica mudou', () => {
    expect(FORM).toContain('saleOrderProductionFingerprintChanged(');
    expect(FORM).toContain('buildSaleOrderProductionSignature({');
    expect(FORM).toContain('documentaryFieldsFromSnapshot(order)');
    expect(FORM).toContain('NF, OC, notas e cliente não');
  });
});
