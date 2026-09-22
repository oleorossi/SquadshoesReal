import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const migration = readFileSync(resolve(
  ROOT,
  'supabase/migrations/20270101027200_audit-insole-material-via-sole-pin.sql',
), 'utf8');

describe('SQL — auditoria: grupo da palmilha via pin do solado', () => {
  it('isenta missing_insole_material quando existe pin placa_palmilha', () => {
    expect(migration).toContain("role = 'placa_palmilha'");
    expect(migration).toContain('material_product_id IS NOT NULL');
    expect(migration).toContain('missing_insole_material');
    expect(migration).toContain('sole_group_standard_items');
  });

  it('trava pós-condição no SOLADO 01 / DS53', () => {
    expect(migration).toContain('a238ef80-5370-4468-88d1-6b9e66933dd1');
    expect(migration).toContain('69c86aa8-57af-45e8-813f-19a1b50340d8');
    expect(migration).toContain(
      'ainda ha missing_insole_material com pin placa_palmilha no SOLADO 01',
    );
  });

  it('preserva security_invoker', () => {
    expect(migration).toContain(
      'ALTER VIEW public.v_technical_sheets_audit SET (security_invoker = true)',
    );
  });
});
