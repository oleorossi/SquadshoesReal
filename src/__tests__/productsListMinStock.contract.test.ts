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

  // Estoque mínimo foi removido do front (specs/remover-estoque-minimo.md,
  // E1): a tabela de estoque não lê mais min_stock — o status olha só o
  // disponível (negativo = Crítico).
  it('a tabela de estoque não usa mais min_stock no status', () => {
    expect(TABLE).not.toMatch(/min_stock/);
    expect(TABLE).toContain("if (qty < 0) return { label: 'Crítico'");
    expect(TABLE).not.toContain("label: 'Baixo'");
  });
});
