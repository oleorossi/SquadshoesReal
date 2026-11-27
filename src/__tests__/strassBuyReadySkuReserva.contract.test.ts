import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Spec tira-comprar-pronto-so-registra D7/R10: strass Comprar pronto sem
 * variante Hub reserva e debita o SKU (finished_product_id). A 31900 pulava
 * buy_ready sem variante; a 65100 cria reserva source=strap_buy_ready_sku.
 */
const ROOT = resolve(__dirname, '../..');
const MIGRATIONS = resolve(ROOT, 'supabase/migrations');
const FILE = '20270101065100_strass_buy_ready_reserva_sem_variante.sql';
const MARKER = 'strass_buy_ready_sku_reserva_20270101065100';

function latestWith(needle: string): string {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  let hit: string | null = null;
  for (const file of files) {
    if (readFileSync(resolve(MIGRATIONS, file), 'utf8').includes(needle)) hit = file;
  }
  if (!hit) throw new Error(`nenhuma migration menciona ${needle}`);
  return hit;
}

describe('strass buy_ready reserva SKU sem variante — 65100', () => {
  const sql = readFileSync(resolve(MIGRATIONS, FILE), 'utf8');

  it('é a migration canônica do sync e dos patches de settle/enqueue', () => {
    expect(latestWith(MARKER)).toBe(FILE);
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.sync_buy_ready_strap_sku_reservations_for_sale_order');
    expect(sql).toContain("'strap_buy_ready_sku'");
    expect(sql).toContain('enqueue_sale_order_strap_demands');
    expect(sql).toContain('settle_canonical_strap_reservation_for_order');
    expect(sql).toContain('settle_open_reservations_for_order');
    expect(sql).toContain('trg_sync_buy_ready_strap_sku_on_op');
  });

  it('só reserva buy_ready com finished_product_id e sem variante (napa fica fora)', () => {
    expect(sql).toContain("source_mode', '') IS DISTINCT FROM 'buy_ready'");
    expect(sql).toContain("finished_product_id");
    expect(sql).toContain('strap_variant_id');
    expect(sql).toContain('CONTINUE; -- napa so-registra (D1): sem SKU');
    expect(sql).toContain('CONTINUE; -- caminho clássico com variante Hub');
  });

  it('settle trata strap_buy_ready_sku como baixa física sem demanda/variante', () => {
    expect(sql).toContain("coalesce(v_res.source, '') = 'strap_buy_ready_sku'");
    expect(sql).toContain('v_res.sale_order_strap_demand_id IS NULL');
    expect(sql).toContain('v_res.strap_variant_id IS NULL');
  });

  it('enqueue chama o sync antes de montar o job de demanda', () => {
    expect(sql).toContain('PERFORM public.sync_buy_ready_strap_sku_reservations_for_sale_order(');
    expect(sql).toContain('p_sale_order_id, p_correlation_id, p_event_type');
  });
});
