import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SQL = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20270101008100_products-list-min-stock-zero-is-no-floor.sql'),
  'utf8',
);

const TABLE = readFileSync(
  resolve(process.cwd(), 'src/components/inventory/ProductTable.tsx'),
  'utf8',
);

describe('v_products_list — min_stock 0 é sem piso', () => {
  it('não trata min_stock 0/null como 1 no status', () => {
    expect(SQL).not.toMatch(/CASE WHEN COALESCE\(p\.min_stock, 0\) = 0 THEN 1/);
    expect(SQL).toContain('WHEN COALESCE(p.min_stock, 0) = 0 THEN 2');
    expect(SQL).toContain('COALESCE(p.min_stock, 0) > 0');
  });

  it('status usa ATP (quantity - reserved), não o bruto', () => {
    expect(SQL).toContain('COALESCE(p.quantity, 0) - COALESCE(p.reserved_stock, 0)) <= 0');
  });

  it('a tabela de estoque compara o disponível com min_stock || 0', () => {
    expect(TABLE).toContain('const min = Number(product.min_stock) || 0');
    expect(TABLE).toContain('if (min === 0) return { label: \'Normal\'');
  });
});
