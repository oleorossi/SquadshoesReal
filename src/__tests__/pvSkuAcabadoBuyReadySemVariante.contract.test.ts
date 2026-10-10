import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * PV Comprar pronto (sku_acabado) não exige variante Hub: find/INSERT do SKU
 * da Cor Principal, freeze com finished_product_id, sem demanda automática.
 */
const ROOT = resolve(__dirname, '../..');
const MIGRATIONS = resolve(ROOT, 'supabase/migrations');
const MARKER = 'strap_pv_sku_acabado_sem_variante_20270101031900';
const FILE = '20270101031900_pv-sku-acabado-buy-ready-sem-variante.sql';

function migrationSql(): string {
  return readFileSync(resolve(MIGRATIONS, FILE), 'utf8');
}

function latestPatchMigration(needle: string): { file: string; sql: string } {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  let hit: { file: string; sql: string } | null = null;
  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS, file), 'utf8');
    if (sql.includes(needle)) hit = { file, sql };
  }
  if (!hit) throw new Error(`nenhuma migration menciona ${needle}`);
  return hit;
}

describe('pv sku_acabado buy_ready sem variante — contrato 31900', () => {
  const sql = migrationSql();

  it('é a migration canônica do carimbo e patcha via pg_get_functiondef', () => {
    expect(latestPatchMigration(MARKER).file).toBe(FILE);
    expect(sql).toContain(MARKER);
    expect(sql).toContain('pg_get_functiondef');
    expect(sql).toContain("'public.prepare_sale_order_item_internal_straps(jsonb)'");
    expect(sql).toContain("'public.tg_validate_sale_order_item_strap_color_alignment()'");
    expect(sql).toContain('resolve_committed_strap_identity');
    expect(sql).toContain('enqueue_sale_order_strap_demands');
  });

  it('prepare congela buy_ready com finished_product_id e sem variante', () => {
    expect(sql).toContain("'finished_product_id', v_catalog ->> 'finished_product_id'");
    expect(sql).toContain("'strap_variant_id', NULL");
    expect(sql).toContain("v_color_mode := 'follow_main'");
    expect(sql).toContain('v_line_color_id := v_color_id');
    expect(sql).not.toMatch(
      /sku_acabado[\s\S]{0,800}resolve_artisanal_strap_catalog/,
    );
  });

  it('enqueue ignora buy_ready sem variante (sem demanda/compra)', () => {
    expect(sql).toContain("p.source_mode = 'buy_ready'");
    expect(sql).toContain('p.strap_variant_id IS NULL');
  });

  it('UI do PV não trata sku_acabado como lacuna de Hub', () => {
    const gap = readFileSync(resolve(ROOT, 'src/lib/buyReadyStrapGap.ts'), 'utf8');
    const form = readFileSync(resolve(ROOT, 'src/components/sale-orders/SaleOrderItemForm.tsx'), 'utf8');
    expect(gap).toContain('strapLineIsPvBuyReadyChoice');
    const wantsBody = gap.match(
      /export function strapLineWantsBuyReady\([\s\S]*?\n\}/,
    )?.[0] || '';
    expect(wantsBody).toContain('finished_product_group');
    expect(wantsBody).not.toContain('sku_acabado');
    expect(form).toContain("finished_product_id: preview?.finishedProductId");
    expect(form).toContain("strap_variant_id: null");
    expect(form).toContain('A linha usa a tira pronta; a napa não será movimentada');
  });
});
