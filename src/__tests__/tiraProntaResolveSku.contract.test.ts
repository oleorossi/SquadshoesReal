import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20270101049800_tira_pronta_resolve_sku.sql'),
  'utf8',
);

describe('tira comprada pronta resolve pelo SKU', () => {
  const writer = sql.slice(sql.indexOf('$patch_writer_sku$'), sql.indexOf('$patch_precheck_sku$'));
  const fresh = writer.slice(writer.indexOf('strap_pronta_sku_direto_20270101049800'));

  it('aceita o SKU escolhido e o grupo da ficha, e não cria produto', () => {
    expect(fresh).toContain("nullif(v_line ->> 'group_id', '')");
    expect(fresh).toContain("nullif(v_line ->> 'finished_product_id', '')");
    expect(fresh).toContain('O pedido nao cria SKU');
    expect(fresh).not.toContain('INSERT INTO public.products');
  });

  it('a pré-checagem aceita finished_product_id sem cor do Hub', () => {
    const precheck = sql.slice(sql.indexOf('$patch_precheck_sku$'));
    expect(precheck).toContain("nullif(v_source ->> 'finished_product_id', '') IS NULL)");
    expect(precheck).toContain('v_line_color_id IS NOT NULL');
  });
});
