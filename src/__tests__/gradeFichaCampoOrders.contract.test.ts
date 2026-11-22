import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const migration = readFileSync(
  resolve(root, 'supabase/migrations/20270101052800_grade_ficha_sem_campo_de_orders.sql'),
  'utf8',
);
const script = readFileSync(resolve(root, 'scripts/teste-grade-ficha-insere-item.sql'), 'utf8');

describe('grade fecha ficha sem o campo da OP no item', () => {
  it('lê sale_order_item_id só pelo jsonb de orders', () => {
    expect(migration).toContain("NULLIF(to_jsonb(NEW) ->> 'sale_order_item_id', '')::uuid");
    expect(migration).toContain("TG_TABLE_NAME = 'orders' AND TG_OP = 'INSERT'");
    expect(migration).not.toMatch(/NEW\.sale_order_item_id\s+IS NOT NULL/);
    expect(migration).not.toMatch(/soi\.id = NEW\.sale_order_item_id/);
    expect(migration).not.toContain('UPDATE public.sale_orders');
  });

  it('o script insere item e OP e aborta a transação', () => {
    expect(script).toContain('BEGIN;');
    expect(script).toContain('INSERT INTO public.sale_order_items');
    expect(script).toContain('INSERT INTO public.orders');
    expect(script).toContain("RAISE EXCEPTION 'rollback teste grade ficha'");
    expect(script).toContain('PV-00249');
    expect(script).toContain('LOTE-00004');
    expect(script).not.toContain('COMMIT');
  });
});
