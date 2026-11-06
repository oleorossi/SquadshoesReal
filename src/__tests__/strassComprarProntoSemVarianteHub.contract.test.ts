import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Spec tira-comprar-pronto-so-registra D4/D8: strass (finished_product_group)
 * para de exigir variante Hub; prepare acha/cria SKU com token de catálogo.
 */
const ROOT = resolve(__dirname, '../..');
const MIGRATIONS = resolve(ROOT, 'supabase/migrations');
const MARKER = 'strap_strass_comprar_pronto_sem_variante_20270101045600';
const FILE = '20270101045600_strass-comprar-pronto-sem-variante-hub.sql';

function latestFileWith(needle: string): string {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  let hit: string | null = null;
  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS, file), 'utf8');
    if (sql.includes(needle)) hit = file;
  }
  if (!hit) throw new Error(`nenhuma migration menciona ${needle}`);
  return hit;
}

describe('strass Comprar pronto sem variante Hub — contrato 45600', () => {
  const sql = readFileSync(resolve(MIGRATIONS, FILE), 'utf8');

  it('é a autoridade viva do ramo finished_product_group', () => {
    expect(latestFileWith(MARKER)).toBe(FILE);
    expect(sql).toContain('pg_get_functiondef');
    expect(sql).toContain("'public.prepare_sale_order_item_internal_straps(jsonb)'");
    expect(sql).toContain("'public.tg_validate_sale_order_item_strap_color_alignment()'");
  });

  it('prepare: acha/cria SKU sem variante, com token e gross_required_m', () => {
    expect(sql).toContain("app.artisanal_strap_catalog_write");
    expect(sql).toContain('INSERT INTO public.products');
    expect(sql).toContain("'strap_variant_id', NULL");
    expect(sql).toContain("'finished_product_id', v_catalog ->> 'finished_product_id'");
    expect(sql).toContain("'gross_required_m'");
    expect(sql).toContain('calculate_strap_line_required_m');
    expect(sql).toContain('ha mais de um SKU ativo da cor no grupo acabado');
    // v_old cita resolve_artisanal_strap_catalog; o v_new do writer não.
    const writerNew = sql.slice(
      sql.indexOf('v_new text := $new$'),
      sql.indexOf('$new$;', sql.indexOf('v_new text := $new$')),
    );
    expect(writerNew).toContain(MARKER);
    expect(writerNew).not.toContain('resolve_artisanal_strap_catalog');
    expect(sql).toContain('Tira comprada pronta nao possui variante comercial ativa exata');
  });

  it('alinhamento: valida SKU do grupo/cor e recusa variante Hub', () => {
    expect(sql).toContain('Tira de grupo acabado exige origem buy_ready com SKU acabado e sem variante Hub');
    expect(sql).toContain('SKU acabado da tira comprada pronta nao corresponde a grupo/cor da ficha');
    expect(sql).toContain('v_source_variant_id IS NOT NULL');
    expect(sql).toContain('Variante comprada pronta nao corresponde a medida/grupo/cor da ficha');
  });

  it('UI: NeedsBuyReadyHubCadastro sempre falso (D4)', () => {
    const gap = readFileSync(resolve(ROOT, 'src/lib/buyReadyStrapGap.ts'), 'utf8');
    const needsBody = gap.match(
      /export function strapLineNeedsBuyReadyHubCadastro\([\s\S]*?\n\}/,
    )?.[0] || '';
    expect(needsBody).toContain('return false');
    expect(needsBody).not.toContain('strapLineWantsBuyReady');
    const listBody = gap.match(
      /export function listBuyReadyStrapGaps\([\s\S]*?\n\}/,
    )?.[0] || '';
    expect(listBody).toContain('return []');
  });
});
