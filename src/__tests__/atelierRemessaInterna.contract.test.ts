import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync('supabase/migrations/20270101049700_atelie_remessa_interna.sql', 'utf8');

describe('remessa interna do Ateliê', () => {
  it('a fábrica não tem prestador e não gera conta', () => {
    expect(SQL).toContain('internal_execution boolean NOT NULL DEFAULT false');
    expect(SQL).toContain('contractor_id IS NULL');
    expect(SQL).toContain("THEN 'internal' ELSE 'contractor'");
    expect(SQL).toContain('NOT COALESCE(so.internal_execution, false)');
    expect(SQL).toContain('COALESCE(v_so.internal_execution, false)');
    expect(SQL).toContain('Produção interna do Ateliê');
    expect(SQL).not.toContain('PV-00249');
    expect(SQL).not.toMatch(/UPDATE public\.products/);
    expect(SQL).not.toMatch(/INSERT INTO public\.contractors/);
  });
});
