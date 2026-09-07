import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * O Consumo de Materiais do PV (caminho vivo) precisa projetar `unit_price`
 * e renderizar Preço unitário / Valor a gastar. Sem isso o deploy pode
 * “passar” com colunas mortas ou com `—` permanente (bug medido em
 * 07/09/2026: produção ficou sem as colunas porque o CI antigo rejeitava
 * o select com unit_price e o gate de deploy pulava a publicação).
 */
const canonicalSrc = readFileSync(
  resolve(__dirname, '../canonicalConsumptionReport.ts'),
  'utf8',
);
const orderSrc = readFileSync(
  resolve(__dirname, '../orderConsumption.ts'),
  'utf8',
);
const rowsSrc = readFileSync(
  resolve(__dirname, '../consumptionRows.ts'),
  'utf8',
);
const viewSrc = readFileSync(
  resolve(__dirname, '../../components/sale-orders/MaterialConsumptionView.tsx'),
  'utf8',
);
const reportSrc = readFileSync(
  resolve(__dirname, '../materialConsumptionReport.ts'),
  'utf8',
);

describe('consumo — preço unitário e valor a gastar', () => {
  it('caminho vivo (canonical) busca unit_price dos produtos e caixas', () => {
    expect(canonicalSrc).toMatch(
      /\.from\('products'\)[\s\S]{0,250}?\.select\('id, name, unit, color, category, group_id, quantity, reserved_stock, stock_grade, unit_price'\)/,
    );
    expect(canonicalSrc).toMatch(
      /\.from\('box_types'\)[\s\S]{0,200}?\.select\('[^']*unit_price[^']*'\)/,
    );
  });

  it('oráculo TS também projeta unit_price em CONSUMPTION_PRODUCT_SELECT', () => {
    expect(orderSrc).toContain(
      "CONSUMPTION_PRODUCT_SELECT =\n  'id, name, unit, color, category, group_id, quantity, reserved_stock, stock_grade, sole_classification, is_fachetado, fachete_material_group_id, unit_price'",
    );
  });

  it('annotate resolve unitPrice e a UI/PDF mostram preço e valor a gastar', () => {
    expect(rowsSrc).toContain('resolveRowUnitPrice');
    expect(rowsSrc).toContain('row.unitPrice = resolveRowUnitPrice');
    expect(viewSrc).toContain('Preço unitário');
    expect(viewSrc).toContain('Valor a gastar');
    expect(viewSrc).toContain('rowTotalCost');
    expect(reportSrc).toContain('Preço unitário');
    expect(reportSrc).toContain('Valor a gastar');
  });
});
