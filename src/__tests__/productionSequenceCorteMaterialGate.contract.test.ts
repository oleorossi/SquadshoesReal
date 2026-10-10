import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const mig = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20270101031200_production_sequence_corte_material_gate.sql'),
  'utf8',
);

describe('production sequence corte material gate (contract)', () => {
  it('expõe o helper D9 separado do BOM', () => {
    expect(mig).toContain('sale_order_item_corte_material_gate_block_reason');
    expect(mig).not.toMatch(/check_stock_availability/);
    expect(mig.toLowerCase()).not.toMatch(/waste_pct|consumption_loss/);
  });

  it('factory_gate chama corte depois do Ateliê', () => {
    expect(mig).toContain('sale_order_item_factory_gate_block_reason');
    expect(mig).toContain('atelier_complex_references');
    expect(mig).toContain('received_at_factory');
    expect(mig).toContain('sale_order_item_corte_material_gate_block_reason(p_item_id)');
  });

  it('não lê colunas inexistentes na ficha (grupo forro / pin palmilha)', () => {
    expect(mig).not.toMatch(/v_sheet\.lining_material_group_id/);
    expect(mig).not.toMatch(/v_sheet\.insole_material_product_id/);
    expect(mig).not.toMatch(/v_sheet\.insole_material_group_id/);
    expect(mig).toContain('v_sheet.lining_material');
    expect(mig).toContain('v_sheet.insole_material');
    expect(mig).toContain('v_var_lining_gid');
    expect(mig).toContain('v_var_insole_pid');
    expect(mig).toContain('reference_material_variants');
  });

  it('converte dm² pela ficha de componente, não compara cru com o estoque', () => {
    expect(mig).toContain('get_material_conversion_info');
    expect(mig).toContain('dm2_per_unit');
  });

  it('apontamento no 1º setor usa porta_sequencia; pin fura', () => {
    expect(mig).toContain('porta_sequencia');
    expect(mig).toContain('apontar_producao_setor_impl');
    expect(mig).toContain('pinned_position IS NOT NULL');
  });

  it('só críticos de corte (cabedal / forração / palmilha), sem fibra inventada', () => {
    expect(mig).toContain("ARRAY['cabedal', 'forracao', 'palmilha']");
    expect(mig).not.toMatch(/FOREACH v_sector IN ARRAY ARRAY\['cabedal', 'forracao', 'palmilha', 'fibra'\]/);
  });
});
