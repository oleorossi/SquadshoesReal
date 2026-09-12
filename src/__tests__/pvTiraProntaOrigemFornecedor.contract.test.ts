import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * PV escolhe_no_pv pode marcar tira artesanal (reference_base) como
 * sku_acabado — writer e guard têm que congelar buy_ready no group_id,
 * sem receita/napa. Não mudam origem_padrao do Hub.
 */
const ROOT = resolve(__dirname, '../..');
const MIGRATIONS = resolve(ROOT, 'supabase/migrations');
const MIGRATION_FILE = '20270101024000_pv-tira-pronta-origem-fornecedor.sql';
const MARKER = 'strap_pv_sku_acabado_fornecedor_20270101024000';

function migrationSql(): string {
  return readFileSync(resolve(MIGRATIONS, MIGRATION_FILE), 'utf8');
}

function latestPatchMigration(needle: string): { file: string; sql: string } {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  let hit: { file: string; sql: string } | null = null;
  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS, file), 'utf8');
    if (sql.includes(needle)) hit = { file, sql };
  }
  if (!hit) throw new Error(`nenhuma migration menciona ${needle}`);
  return hit;
}

describe('pv tira pronta origem fornecedor — contrato 24000', () => {
  const sql = migrationSql();

  it('patcha prepare e guard via pg_get_functiondef, sem redefinir o corpo inteiro', () => {
    expect(sql).toContain("pg_get_functiondef(v_fn)");
    expect(sql).toContain("'public.prepare_sale_order_item_internal_straps(jsonb)'");
    expect(sql).toContain("'public.tg_validate_sale_order_item_strap_color_alignment()'");
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.prepare_sale_order_item_internal_straps/);
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.tg_validate_sale_order_item_strap_color_alignment/);
  });

  it('marca o ramo sku_acabado com o carimbo estável', () => {
    expect(sql).toContain(MARKER);
    expect(sql).toContain("nullif(v_line ->> 'pv_origem', '') = 'sku_acabado'");
    expect(sql).toContain("line.value ->> 'pv_origem' = 'sku_acabado'");
  });

  it('congela buy_ready no grupo acabado da ficha, sem receita nem napa', () => {
    expect(sql).toContain("'source_mode', 'buy_ready'");
    expect(sql).toContain("'recipe_id', NULL");
    expect(sql).toContain("'base_product_id', NULL");
    expect(sql).toContain("av.identity_basis = 'finished_product_group'");
    expect(sql).toContain("nullif(v_line ->> 'group_id', '')::uuid");
    expect(sql).not.toContain('origem_padrao');
  });

  it('é a última migration que toca o ramo sku_acabado do prepare', () => {
    const latest = latestPatchMigration(MARKER);
    expect(latest.file).toBe(MIGRATION_FILE);
  });
});
