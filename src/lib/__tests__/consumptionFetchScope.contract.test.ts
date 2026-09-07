import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * P1.1 — fetchConsumptionContext / BOM não podem varrer o catálogo inteiro.
 * products e sole_technical_specs devem ser filtrados pelos grupos/solados
 * das fichas pedidas.
 */
const orderSrc = readFileSync(
  resolve(__dirname, '../orderConsumption.ts'),
  'utf8',
);
const bomSrc = readFileSync(resolve(__dirname, '../bomConsumption.ts'), 'utf8');

describe('P1.1 escopo do fetch de consumo', () => {
  it('orderConsumption usa fetchActiveProductsByGroupIds (não full-catalog solto)', () => {
    expect(orderSrc).toContain('export async function fetchActiveProductsByGroupIds');
    expect(orderSrc).toMatch(/\.in\('group_id',\s*chunk\)/);
    // A query de products do helper ainda projeta as colunas do motor.
    expect(orderSrc).toMatch(
      /\.from\('products'\)[\s\S]{0,400}?\.select\('id, name, unit, color, category, group_id, quantity, reserved_stock, stock_grade, sole_classification, is_fachetado, fachete_material_group_id'\)/,
    );
  });

  it('sole_technical_specs no contexto é filtrada por sole_id (não full-table)', () => {
    // Uma query unificada com .in('sole_id', …) — sem select sem filtro.
    const specsBlocks = [
      ...orderSrc.matchAll(/\.from\('sole_technical_specs'\)[\s\S]{0,250}?\.select\(/g),
    ];
    expect(specsBlocks.length).toBeGreaterThanOrEqual(1);
    for (const m of orderSrc.matchAll(
      /\.from\('sole_technical_specs'\)([\s\S]{0,350}?)(?=\.from\(|for \(const r of reduceSole|$)/g,
    )) {
      const block = m[1];
      expect(block).toMatch(/\.in\('sole_id'/);
    }
  });

  it('bomConsumption importa o helper e escopa specs por sole_id', () => {
    expect(bomSrc).toContain('fetchActiveProductsByGroupIds');
    expect(bomSrc).toMatch(/sole_technical_specs/);
    expect(bomSrc).toMatch(/\.in\('sole_id',\s*\[\.\.\.soleCandidateIds\]\)/);
    // Não pode restar products full-catalog sem .in no calculateBomForOrders.
    expect(bomSrc).not.toMatch(
      /supabase\.from\('products'\)\.select\([^)]+\)\.eq\('active',\s*true\)\s*,/,
    );
  });
});
