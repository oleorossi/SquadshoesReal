import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const migration = readFileSync(resolve(
  ROOT,
  'supabase/migrations/20270101021500_audit-consumo-forracao-palmilha-via-solado.sql',
), 'utf8');

describe('SQL — auditoria: forração/fibra via solado', () => {
  it('adiciona sole_has_insole_lining_specs a partir de insole_lining_consumption_dm2', () => {
    expect(migration).toContain('sole_has_insole_lining_specs');
    expect(migration).toContain('insole_lining_consumption_dm2');
    expect(migration).toContain('AS sole_has_insole_specs');
  });

  it('isenta consumo na ficha quando sole_drives_consumption', () => {
    expect(migration).toContain(
      '(NOT COALESCE(ts.sole_drives_consumption, false) OR NOT COALESCE(sp.sole_has_lining_specs, false))',
    );
    expect(migration).toContain(
      '(NOT COALESCE(ts.sole_drives_consumption, false) OR NOT COALESCE(sp.sole_has_insole_specs, false))',
    );
    expect(migration).toContain("'NOT COALESCE(ts.sole_drives_consumption, false)'");
    expect(migration).toContain(
      'missing_lining_consumption ainda exige specs de cabedal na ficha',
    );
    expect(migration).toContain(
      'missing_insole_consumption ainda exige specs de fibra na ficha',
    );
  });

  it('sole_driven_but_specs_missing considera forração de palmilha', () => {
    expect(migration).toContain(
      'NOT COALESCE(sp.sole_has_insole_lining_specs, false)',
    );
    expect(migration).toContain(
      'sole_driven_but_specs_missing nao considera forracao de palmilha',
    );
  });

  it('exige lining_material também quando o solado só tem forração de palmilha', () => {
    // Forma viva do pg_get_viewdef: AND sem parênteses externos (AND > OR).
    expect(migration).toContain(
      'COALESCE(ts.sole_drives_consumption, false) AND COALESCE(sp.sole_has_lining_specs, false)',
    );
    expect(migration).toContain(
      'OR COALESCE(sp.sole_has_insole_lining_specs, false)',
    );
    expect(migration).toContain('missing_lining_material');
  });

  it('ancora sole_driven em uma linha com casts tipados do deparse', () => {
    expect(migration).toContain(
      "COALESCE(ts.lining_material, ''::text) <> ''::text AND NOT COALESCE(sp.sole_has_lining_specs, false) AND COALESCE(ts.lining_consumption, 0::numeric) <= 0::numeric",
    );
  });

  it('preserva security_invoker e não reintroduz requires_cutting_cabedal', () => {
    expect(migration).toContain(
      'ALTER VIEW public.v_technical_sheets_audit SET (security_invoker = true)',
    );
    expect(migration).toContain('requires_cutting_cabedal');
    expect(migration).toContain(
      'patch reintroduziu requires_cutting_cabedal',
    );
  });
});
