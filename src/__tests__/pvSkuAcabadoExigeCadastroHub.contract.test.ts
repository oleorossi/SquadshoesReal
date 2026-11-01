import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * PV Comprar pronto (sku_acabado) NÃO cria SKU no prepare — exige Hub.
 * Mig 45200 remove o INSERT da 31900 e RAISE pedindo cadastro.
 */
const ROOT = resolve(__dirname, '../..');
const MIGRATIONS = resolve(ROOT, 'supabase/migrations');
const MARKER = 'strap_pv_sku_acabado_exige_cadastro_hub_20270101045200';
const FILE = '20270101045200_pv-sku-acabado-exige-cadastro-hub.sql';
const WRITER = 'prepare_sale_order_item_internal_straps';

function latestPatchMigration(needle: string): { file: string; sql: string } {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  let hit: { file: string; sql: string } | null = null;
  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS, file), 'utf8');
    if (sql.includes(needle) && sql.includes(WRITER)) hit = { file, sql };
  }
  if (!hit) throw new Error(`nenhuma migration patcha ${needle} em ${WRITER}`);
  return hit;
}

describe('pv sku_acabado exige cadastro Hub — contrato 45200', () => {
  const sql = readFileSync(resolve(MIGRATIONS, FILE), 'utf8');

  it('é a migration canônica do carimbo e patcha o writer', () => {
    expect(latestPatchMigration(MARKER).file).toBe(FILE);
    expect(sql).toContain(MARKER);
    expect(sql).toContain('pg_get_functiondef');
    expect(sql).toContain("'public.prepare_sale_order_item_internal_straps(jsonb)'");
  });

  it('remove o INSERT de products do ramo sku_acabado', () => {
    expect(sql).toContain('INSERT INTO public.products');
    expect(sql).toContain('v_old :=');
    expect(sql).toContain('Cadastre a tira no Hub');
    expect(sql).toMatch(/RAISE EXCEPTION[\s\S]*Cadastre a tira no Hub/);
  });

  it('UI lista lacuna sku_acabado e bloqueia o Criar Pedido', () => {
    const gap = readFileSync(resolve(ROOT, 'src/lib/buyReadyStrapGap.ts'), 'utf8');
    const panel = readFileSync(
      resolve(ROOT, 'src/components/sale-orders/SaleOrderFormPanel.tsx'),
      'utf8',
    );
    expect(gap).toContain('strapLineNeedsBuyReadyHubCadastro');
    expect(gap).toContain('listOrderBuyReadyStrapGaps');
    expect(panel).toContain('collectBuyReadyGaps');
    expect(panel).toContain('showBuyReadyGapDialog');
    expect(panel).toContain('Cadastro Comprar pronto pendente');
  });
});
