import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const RESTORE = readFileSync(
  resolve(
    __dirname,
    '../../supabase/migrations/20270101044100_restore_v_employee_punch_pattern_public.sql',
  ),
  'utf8',
);

const ORGANIZE = readFileSync(
  resolve(
    __dirname,
    '../../supabase/migrations/20270101029600_organize_postgrest_private_surface.sql',
  ),
  'utf8',
);

const IDENTITY = readFileSync(
  resolve(
    __dirname,
    '../../supabase/migrations/20270101013600_identidade_canonica_pendencias_ponto.sql',
  ),
  'utf8',
);

describe('restore public.v_employee_punch_pattern (20270101044100)', () => {
  it('devolve a view a public e marca o incidente', () => {
    expect(RESTORE).toContain('restore_v_employee_punch_pattern_public_20270101044100');
    expect(RESTORE).toContain('ALTER VIEW private.v_employee_punch_pattern SET SCHEMA public');
    expect(RESTORE).toContain(
      'GRANT SELECT ON TABLE public.v_employee_punch_pattern TO authenticated, service_role',
    );
    expect(RESTORE).toContain('NOTIFY pgrst, \'reload schema\'');
  });

  it('endurece a guarda de organize pra varrer prosrc (não só pg_depend)', () => {
    expect(RESTORE).toContain('private._org_move_view_if_unreferenced');
    expect(RESTORE).toContain('pg_proc');
    expect(RESTORE).toContain('prosrc');
  });

  it('a safelist da 29600 não volta a citar a view (evita re-mover)', () => {
    expect(ORGANIZE).not.toMatch(/'v_employee_punch_pattern'/);
    expect(ORGANIZE).toContain('20270101044100');
  });

  it('suggest_punches_for_record continua apontando pra public.v_employee_punch_pattern', () => {
    expect(IDENTITY).toContain('FROM public.v_employee_punch_pattern');
    expect(IDENTITY).toContain('CREATE OR REPLACE FUNCTION public.suggest_punches_for_record');
  });
});
