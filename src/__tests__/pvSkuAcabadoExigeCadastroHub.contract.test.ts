import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Histórico 45200: removeu o INSERT do prepare e passou a exigir Hub.
 * Superada para tira de NAPA pela 45300 (so-registra): Comprar pronto só
 * registra cor + metros. STRASS (finished_product_group) deixa de exigir
 * variante Hub na 45600 (acha/cria SKU).
 */
const ROOT = resolve(__dirname, '../..');
const MIGRATIONS = resolve(ROOT, 'supabase/migrations');
const MARKER = 'strap_pv_sku_acabado_exige_cadastro_hub_20270101045200';
const FILE = '20270101045200_pv-sku-acabado-exige-cadastro-hub.sql';
const SO_REGISTRA = '20270101045300_tira-comprar-pronto-so-registra.sql';
const SO_MARKER = 'strap_comprar_pronto_so_registra_20270101045300';

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

describe('pv sku_acabado exige cadastro Hub — contrato 45200 (histórico)', () => {
  const sql = readFileSync(resolve(MIGRATIONS, FILE), 'utf8');

  it('arquivo 45200 remove o INSERT e RAISE pedindo Hub', () => {
    expect(sql).toContain(MARKER);
    expect(sql).toContain('pg_get_functiondef');
    expect(sql).toContain("'public.prepare_sale_order_item_internal_straps(jsonb)'");
    expect(sql).toContain('INSERT INTO public.products');
    expect(sql).toContain('v_old :=');
    expect(sql).toContain('Cadastre a tira no Hub');
    expect(sql).toMatch(/RAISE EXCEPTION[\s\S]*Cadastre a tira no Hub/);
  });

  it('45300 so-registra é a autoridade viva do ramo napa + sku_acabado', () => {
    expect(latestFileWith(SO_MARKER)).toBe(SO_REGISTRA);
    const so = readFileSync(resolve(MIGRATIONS, SO_REGISTRA), 'utf8');
    expect(so).toContain("'finished_product_id', NULL");
    expect(so).toContain("'source_mode', 'buy_ready'");
    expect(so).toContain(MARKER); // guarda que o RAISE 45200 saiu do writer
  });

  it('UI: lacuna Hub não bloqueia save (D4/45600); diálogo legado permanece', () => {
    const gap = readFileSync(resolve(ROOT, 'src/lib/buyReadyStrapGap.ts'), 'utf8');
    const panel = readFileSync(
      resolve(ROOT, 'src/components/sale-orders/SaleOrderFormPanel.tsx'),
      'utf8',
    );
    expect(gap).toContain('strapLineNeedsBuyReadyHubCadastro');
    expect(gap).toContain('listOrderBuyReadyStrapGaps');
    const needsBody = gap.match(
      /export function strapLineNeedsBuyReadyHubCadastro\([\s\S]*?\n\}/,
    )?.[0] || '';
    expect(needsBody).toContain('return false');
    expect(panel).toContain('collectBuyReadyGaps');
    expect(panel).toContain('showBuyReadyGapDialog');
    expect(panel).toContain('Cadastro Comprar pronto pendente');
  });
});
