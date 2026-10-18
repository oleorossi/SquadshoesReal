import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const MIGRATION = 'supabase/migrations/20270101042700_atelier_materialize_com_op_viva.sql';
const GLOBAL_SEARCH = 'src/components/layout/GlobalSearch.tsx';

describe('Ateliê materialize com OP viva — contratos', () => {
  it('remove o guard que pulava item com OP sem demanda', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.materialize_cabedal_prep_demands');
    expect(sql).not.toMatch(/has_op\s+AND\s+NOT\s+EXISTS/i);
    expect(sql).not.toContain('já virou OP sem passar pelo Ateliê');
    expect(sql).toContain('atelier_sync_jobs_for_demand');
    expect(sql).toContain('fora_do_atelier');
  });

  it('trigger rematerializa ao mudar o catálogo Ateliê', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain('tg_atelier_catalog_rematerialize');
    expect(sql).toContain('trg_atelier_catalog_rematerialize');
    expect(sql).toContain('atelier_complex_references');
    expect(sql).toContain("so.status IN ('Aprovado', 'Em Produção')");
    expect(sql).toContain('SELECT public.reapply_atelier_eligibility()');
  });

  it('GlobalSearch desambigua product_groups via FK canônica', () => {
    const src = readFileSync(GLOBAL_SEARCH, 'utf8');
    expect(src).toContain('product_groups!products_group_id_fkey(name)');
    expect(src).not.toMatch(/product_groups\(name\)/);
  });
});
