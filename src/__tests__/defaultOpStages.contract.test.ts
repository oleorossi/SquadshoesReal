import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RESYNC = readFileSync(resolve(process.cwd(), 'src/lib/resyncOPs.ts'), 'utf8');
const STAGE = readFileSync(
  resolve(process.cwd(), 'src/components/production/worksheet/stageOrder.ts'),
  'utf8',
);
const MIGRATIONS_DIR = resolve(process.cwd(), 'supabase/migrations');
const RENAME_MIG = readdirSync(MIGRATIONS_DIR)
  .filter((name) => /^\d{14}_.+\.sql$/.test(name))
  .sort()
  .reverse()
  .find((name) => name.includes('rename_costura_palmilha_to_acabamento_palmilha'));
const RENAME_SQL = RENAME_MIG
  ? readFileSync(resolve(MIGRATIONS_DIR, RENAME_MIG), 'utf8')
  : '';

/** Overlay do rename de display: migs históricas ainda citam Costura Palmilha;
 *  a 26400 troca o literal nos corpos vivos via replace. */
function withPalmilhaDisplayRename(sql: string): string {
  if (!RENAME_SQL.includes("replace(v_def, 'Costura Palmilha', 'Acabamento Palmilha')")) {
    return sql;
  }
  return sql.replaceAll('Costura Palmilha', 'Acabamento Palmilha');
}

const RESYNC_MIGRATION = readdirSync(MIGRATIONS_DIR)
  .filter((name) => /^\d{14}_.+\.sql$/.test(name))
  .sort()
  .reverse()
  .find((name) => readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8')
    .includes('CREATE OR REPLACE FUNCTION public.resync_op_atomic'));
const RESYNC_SQL = RESYNC_MIGRATION
  ? withPalmilhaDisplayRename(readFileSync(resolve(MIGRATIONS_DIR, RESYNC_MIGRATION), 'utf8'))
  : '';
const RESYNC_FALLBACK = RESYNC_SQL.match(/ARRAY\s*\[\s*'Corte Fibra'[\s\S]*?\]/)?.[0] ?? '';
const RESYNC_FALLBACK_NAMES = Array.from(
  RESYNC_FALLBACK.matchAll(/'([^']+)'/g),
  (match) => match[1],
);

describe('rota canônica Corte Fibra', () => {
  it('canonical_stage_order TS espelha a mig 05300', () => {
    expect(STAGE).toContain("'Corte Fibra': 1");
    expect(STAGE).toContain("'Acabamento Palmilha': 3");
    expect(STAGE).toContain("'Costura Cabedal': 4");
    expect(STAGE).toContain("'Aviamento': 5");
    expect(STAGE).toContain("'Expedição': 11");
  });

  it('resync fino passa pelo comando do PV; o motor SQL usa a rota viva', () => {
    expect(RESYNC).toContain('executeSaleOrderCommand');
    expect(RESYNC).toContain("command: 'resync'");
    expect(RESYNC).not.toContain("rpc('resync_op_atomic'");
    expect(RESYNC).not.toContain("{ name: 'Corte Fibra'");
    expect(RESYNC_MIGRATION, 'migration de resync_op_atomic ausente').toBeDefined();
    expect(RENAME_MIG, 'migration de rename Costura→Acabamento Palmilha ausente').toBeDefined();
    expect(RESYNC_FALLBACK_NAMES).toEqual([
      'Corte Fibra',
      'Corte Forração',
      'Acabamento Palmilha',
      'Costura Cabedal',
      'Aviamento',
      'Silk',
      'Colagem',
      'Montagem',
      'Solagem',
      'Acabamento',
      'Expedição',
    ]);
  });
});
