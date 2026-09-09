import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const quickFamily = readFileSync('src/components/inventory/QuickFamilyDialog.tsx', 'utf8');
const migration = readFileSync(
  'supabase/migrations/20270101014750_backfill_shared_group_consumption_unit.sql',
  'utf8',
);

describe('unidade das linhas criadas pelo cadastro rápido', () => {
  it('cria shared_specs junto com a unidade já exigida pelo formulário', () => {
    expect(quickFamily).toMatch(
      /shared_specs:\s*true,[\s\S]{0,300}consumption_unit:\s*unit/,
    );
  });

  it('repara apenas grupos compartilhados com unidade homogênea nos produtos', () => {
    expect(migration).toContain('HAVING count(DISTINCT p.unit) = 1');
    expect(migration).toContain('COALESCE(g.shared_specs, false)');
    expect(migration).toContain('SET consumption_unit = h.unit');
  });

  it('impede nova linha compartilhada sem unidade técnica', () => {
    expect(migration).toContain('chk_shared_group_has_consumption_unit');
    expect(migration).toMatch(
      /NOT COALESCE\(shared_specs, false\)[\s\S]*consumption_unit/,
    );
  });
});
