import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const migration = readFileSync(
  resolve(ROOT, 'supabase/migrations/20270101014600_insole_fiber_is_color_agnostic.sql'),
  'utf8',
);

describe('fibra da palmilha não varia por cor', () => {
  it('marca placa/fibra como is_color_agnostic e poupa o forro', () => {
    expect(migration).toContain("SET is_color_agnostic = true");
    expect(migration).toContain("COALESCE(pg.sector, '') = 'Palmilha'");
    expect(migration).toContain('(fibra|placa|\\yeva\\y|celulose|papelao|strobel|^palmilha$)');
    expect(migration).toContain('(forr|revest|forro|lining|napa|pronta|pronto)');
    expect(migration).toContain("IS DISTINCT FROM 'Forração da Palmilha'");
  });

  it('restaura is_color_agnostic no resolver genérico e no de palmilha', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.resolve_material_product');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.resolve_insole_material_for_variant');
    expect(migration).toMatch(/AND NOT COALESCE\(pg2\.is_color_agnostic, false\)/);
    expect(migration).toMatch(/AND NOT COALESCE\(pg\.is_color_agnostic, false\)/);
    expect(migration).toContain('__fiber_regression_missing_color__');
  });

  it('não apaga produtos nem reescreve pedidos pra esconder o aviso', () => {
    expect(migration).not.toMatch(
      /\b(delete from)\s+public\.(products|product_groups|sale_orders|sale_order_items)\b/i,
    );
  });
});
