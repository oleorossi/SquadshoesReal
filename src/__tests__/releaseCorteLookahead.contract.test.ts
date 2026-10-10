import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const MIGRATION = 'supabase/migrations/20270101029900_release_corte_lookahead_items.sql';

describe('release_corte_lookahead_items.contract', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('cria RPC de liberação com is_ahead e bloqueio de Ateliê', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.release_corte_lookahead_items');
    expect(sql).toContain('promote_sale_order_item');
    expect(sql).toContain('true'); // p_is_ahead
    expect(sql).toContain('Adiantada — Fila de Corte');
    expect(sql).toContain('atelier_complex_references');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.release_corte_lookahead_items');
  });

  it('não concede EXECUTE a anon', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.release_corte_lookahead_items\(uuid\[\]\)\s+FROM PUBLIC, anon/);
  });
});
