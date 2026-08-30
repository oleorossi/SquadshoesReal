import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const migration = readFileSync(
  resolve(ROOT, 'supabase/migrations/20270101014600_insole_fiber_is_color_agnostic.sql'),
  'utf8',
);
const dataPatch = migration.match(
  /UPDATE public\.product_groups pg[\s\S]*?;(?=\n\n-- Fail-closed:)/,
)?.[0] ?? '';

describe('fibra da palmilha não varia por cor', () => {
  it('marca somente placa/fibra do setor Palmilha e poupa materiais coloridos de outros setores', () => {
    expect(dataPatch).toContain('SET is_color_agnostic = true');
    expect(dataPatch).toContain("AND COALESCE(pg.sector, '') = 'Palmilha'");
    expect(dataPatch).toContain('(fibra|placa|\\yeva\\y|celulose|papelao|strobel|^palmilha$)');
    expect(dataPatch).toContain('(forr|revest|forro|lining|napa|pronta|pronto)');
    expect(dataPatch).not.toMatch(
      /COALESCE\(pg\.sector, ''\) = 'Palmilha'\s+OR/,
    );
    expect(migration).toContain('$assert_colored_non_insole_materials$');
    expect(migration).toContain(
      "count(DISTINCT NULLIF(btrim(p.color), '')) > 1",
    );
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
