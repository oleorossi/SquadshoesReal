import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf8');

const MIGRATION = read('../../supabase/migrations/20270101005900_sole_pair_unit_contract.sql');
const AUDIT = read('../../supabase/tests/audit_sole_pair_units.sql');
const TECHNICAL_SHEETS = read('../pages/TechnicalSheets.tsx');
const PRODUCT_TABLE = read('../components/inventory/ProductTable.tsx');
const SOLE_CREATE = read('../components/soles-hub/SoleCreateDialog.tsx');
const ORDER_CONSUMPTION = read('../lib/orderConsumption.ts');
const BOM_CONSUMPTION = read('../lib/bomConsumption.ts');

describe('contrato canônico de unidade do solado', () => {
  it('normaliza estoque, compra, produção e consumo para par sem conversão', () => {
    for (const field of [
      'unit',
      'consumption_unit',
      'production_unit',
      'purchase_unit',
      'purchase_order_unit',
    ]) {
      expect(MIGRATION).toMatch(new RegExp(`${field}\\s*=\\s*'par'`));
      expect(SOLE_CREATE).toMatch(new RegExp(`${field}:\\s*'par'`));
    }
    expect(MIGRATION).toMatch(/conversion_rate = 1/);
    expect(MIGRATION).toMatch(/chk_products_sole_pair_units/);
    expect(MIGRATION).toMatch(/trg_aa_enforce_sole_pair_units/);
  });

  it('fixa a ficha e a variante em exatamente 1 par por par', () => {
    expect(MIGRATION).toMatch(/SET sole_consumption = 1/);
    expect(MIGRATION).toMatch(/NEW\.sole_consumption := 1/);
    expect(MIGRATION).toMatch(/chk_technical_sheets_sole_pair_consumption/);
    expect(MIGRATION).toMatch(/sole_consumption_override IS NULL OR sole_consumption_override = 1/);
    expect(TECHNICAL_SHEETS).toContain('Consumo do solado (par/par)');
    expect(TECHNICAL_SHEETS).toContain('1 par completo (pé esquerdo + pé direito) para cada par de calçado.');
  });

  it('mantém os dois motores de consumo em relação 1:1 com o pedido', () => {
    expect(ORDER_CONSUMPTION).toMatch(/componentType: 'Solado'[\s\S]*?totalQuantity: itemQuantity/);
    expect(BOM_CONSUMPTION).toMatch(/componentType: 'Solado'[\s\S]*?totalQuantity: itemQuantity/);
    expect(ORDER_CONSUMPTION).not.toMatch(/sole_consumption_override[\s\S]{0,180}\* itemQuantity/);
    expect(BOM_CONSUMPTION).not.toMatch(/solePerPair \* itemQuantity/);
  });

  it('obriga ajuste de estoque por numeração e ignora metadados da grade', () => {
    expect(PRODUCT_TABLE).toMatch(/!isSole && \([\s\S]*?aria-label="Baixa manual"/);
    expect(PRODUCT_TABLE).toMatch(/isSole && \([\s\S]*?aria-label="Ajustar pares por numeração"/);
    expect(PRODUCT_TABLE).toMatch(/filter\(\(\[key\]\) => !key\.startsWith\('_'\)\)/);
  });

  it('audita grade, reservas e garante ausência de multiplicação por dois no débito', () => {
    expect(AUDIT).toContain('quantity_grade_drift');
    expect(AUDIT).toContain('effective_grade_mismatch');
    expect(AUDIT).toContain('debit_has_explicit_times_two');
    expect(AUDIT).toContain('1 unidade de estoque = 1 par completo');
  });
});
