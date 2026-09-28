import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const MIGRATION = readFileSync(
  resolve(
    ROOT,
    'supabase/migrations/20270101029800_get_sector_daily_management_qualify_sector.sql',
  ),
  'utf8',
);

/**
 * OUT param `sector` de RETURNS TABLE colidia com coluna de production_schedule.
 * Caso vivo: toast "column reference \"sector\" is ambiguous" via QueryCache.
 */
describe('get_sector_daily_management: sector qualificado', () => {
  it('marca 298 e usa ps.sector no CTE scheduled', () => {
    expect(MIGRATION).toContain('get_sector_daily_management_qualify_sector_298');
    expect(MIGRATION).toContain('ps.sector');
    expect(MIGRATION).toContain('FROM public.production_schedule ps');
  });

  it('não reintroduz SELECT sector sem alias no CTE scheduled', () => {
    const fnBody = MIGRATION.slice(
      MIGRATION.indexOf('AS $function$'),
      MIGRATION.indexOf('$function$;'),
    );
    expect(fnBody).not.toMatch(/SELECT\s+sector\s*,/i);
    expect(fnBody).toMatch(/SELECT\s+ps\.sector\s+AS\s+sector/i);
  });
});
