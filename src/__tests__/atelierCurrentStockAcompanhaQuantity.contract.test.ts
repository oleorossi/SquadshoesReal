import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const migration = readFileSync(
  resolve(ROOT, 'supabase/migrations/20270101049400_atelie_current_stock_acompanha_quantity.sql'),
  'utf8',
);

function body(name: string): string {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  const tail = migration.slice(start);
  const end = tail.indexOf('\n$$;');
  expect(end, name).toBeGreaterThan(0);
  return tail.slice(0, end);
}

describe('saída do Ateliê acompanha current_stock', () => {
  it('o corte e a liberação gravam quantity e current_stock com o mesmo saldo', () => {
    const inbound = body('apply_atelier_inbound');
    const release = body('atelier_confirm_lot_release');
    expect(inbound).toContain('quantity = quantity - v_qty');
    expect(inbound).toContain('current_stock = quantity - v_qty');
    expect(release).toContain('quantity = quantity - v_debit');
    expect(release).toContain('current_stock = quantity - v_debit');
    expect(inbound).toContain('Ateliê · corte completado pela entrada');
    expect(release).toContain('Ateliê · liberação');
  });

  it('só alinha o produto medido, e só no estado 0 / 0.24', () => {
    const updates = migration.match(/UPDATE public\.products[\s\S]*?;/g) ?? [];
    expect(updates).toHaveLength(3);
    const dataFix = updates[2];
    expect(dataFix).toContain('657aa32d-e665-4972-8e60-d19ad7841c2b');
    expect(dataFix).toContain('current_stock = 0');
    expect(dataFix).toContain('quantity = 0');
    expect(dataFix).toContain('0.2400');
    expect(dataFix).not.toContain('SET quantity');
    const list = migration.slice(migration.indexOf('FOR v_row IN'));
    expect(list).toContain('RAISE NOTICE');
    expect(list).not.toContain('UPDATE public.products');
  });
});
