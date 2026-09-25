import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const FIX = readFileSync(
  resolve(ROOT, 'supabase/migrations/20270101028700_fix_documentary_header_not_null_empty.sql'),
  'utf8',
);

function sqlFunction(name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}(`;
  const start = FIX.indexOf(marker);
  expect(start, `${name} ausente`).toBeGreaterThanOrEqual(0);
  const tail = FIX.slice(start);
  const end = tail.indexOf('\n$fn$;');
  expect(end, `${name} sem terminador`).toBeGreaterThanOrEqual(0);
  return tail.slice(0, end + 6);
}

describe('documentary header NOT NULL empty (20270101028700)', () => {
  const documentary = sqlFunction('apply_sale_order_documentary_header');

  it('marca a correção e não deixa NULLIF solto em colunas NOT NULL', () => {
    expect(documentary).toContain('fix_documentary_header_not_null_empty_20270101028700');

    // OC vazia → '' (NOT NULL), nunca NULL
    expect(documentary).toMatch(
      /client_order_number = CASE WHEN v_header \? 'client_order_number'\s+THEN COALESCE\(NULLIF\(btrim\(v_header ->> 'client_order_number'\), ''\), ''\)/,
    );

    // brand / client_name idem
    expect(documentary).toMatch(
      /brand = CASE WHEN v_header \? 'brand'\s+THEN COALESCE\(NULLIF\(btrim\(v_header ->> 'brand'\), ''\), ''\)/,
    );
    expect(documentary).toMatch(
      /client_name = CASE WHEN v_header \? 'client_name'\s+THEN COALESCE\(NULLIF\(btrim\(v_header ->> 'client_name'\), ''\), ''\)/,
    );

    // order_type vazio preserva o atual (não inventa NULL nem '')
    expect(documentary).toContain("COALESCE(\n             NULLIF(btrim(v_header ->> 'order_type'), ''),\n             so.order_type\n           )");
  });

  it('campos nullable continuam com NULLIF ("" → NULL)', () => {
    expect(documentary).toMatch(
      /nfe = CASE WHEN v_header \? 'nfe'\s+THEN NULLIF\(btrim\(v_header ->> 'nfe'\), ''\)/,
    );
    expect(documentary).toMatch(
      /notes = CASE WHEN v_header \? 'notes'\s+THEN NULLIF\(btrim\(v_header ->> 'notes'\), ''\)/,
    );
  });
});
