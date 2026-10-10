import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

describe('estoque: clique no item abre reservas por PV→OP (contract)', () => {
  const productTable = read('src/components/inventory/ProductTable.tsx');
  const dialog = read('src/components/inventory/ProductReservationDetailsDialog.tsx');
  const groups = read('src/lib/productReservationGroups.ts');
  const migration = read(
    'supabase/migrations/20270101031800_list_material_commitments_by_product_client_name.sql',
  );
  const orders = read('src/pages/Orders.tsx');

  it('ProductTable abre reservas no clique da linha e mantém lápis no editor', () => {
    expect(productTable).toContain('onOpenReservations');
    expect(productTable).toContain('ProductReservationDetailsDialog');
    expect(productTable).toMatch(/onClick=\{\(\) => onOpenReservations\(product\)\}/);
    expect(productTable).toContain('aria-label="Editar material"');
    expect(productTable).toContain('onClick={() => onEdit(product)}');
    expect(productTable).not.toMatch(
      /TableRow[^>]*onClick=\{\(\) => navigate\(`\/estoque\/\$\{product\.id\}`\)\}/,
    );
  });

  it('dialog lista PV→OP, sem bloco Em Produção, com deep links', () => {
    expect(dialog).toContain('groupCommitmentsByPv');
    expect(dialog).toContain('/sales/edit/');
    expect(dialog).toContain('/orders?search=');
    expect(dialog).toContain('Editar cadastro');
    expect(dialog).not.toContain('Movimentos em OPs');
    expect(dialog).not.toContain('Em Produção');
  });

  it('órfãs sem PV têm grupo sintético e RPC expõe client_name', () => {
    expect(groups).toContain('__sem_pv__');
    expect(migration).toMatch(/DROP FUNCTION IF EXISTS public\.list_material_commitments_by_product/);
    expect(migration).toMatch(/client_name text/);
    expect(migration).toMatch(/so\.client_name/);
  });

  it('Orders hidrata busca de /orders?search=', () => {
    expect(orders).toContain("searchParams.get('search')");
  });
});
