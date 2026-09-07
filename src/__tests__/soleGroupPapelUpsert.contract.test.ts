import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

const FIX =
  'supabase/migrations/20270101019100_sole-group-papel-unique-for-postgrest.sql';
const ORIGIN =
  'supabase/migrations/20261102120200_move-papel-to-group-registry-and-fix-sql-costing.sql';
const HOOK = 'src/hooks/useSoleGroupStandardConsumption.ts';

function section(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

/**
 * Salvamento de PAPEL em Solados → Consumo Padrão.
 *
 * O índice único histórico era parcial (`WHERE role IS NOT NULL`). PostgREST
 * não repete o predicado no ON CONFLICT →
 * "no unique or exclusion constraint matching the ON CONFLICT specification".
 *
 * Duas camadas: client sem upsert-onConflict + índice total no banco.
 */
describe('upsert de PAPEL do solado sem ON CONFLICT inválido', () => {
  it('o hook grava PAPEL com select+update/insert, sem onConflict', () => {
    const setRole = section(
      read(HOOK),
      'export function useSetSoleGroupRole()',
      'export function useUpsertSoleGroupItem()',
    );
    expect(setRole).toContain(".eq('sole_group_id', params.soleGroupId)");
    expect(setRole).toContain(".eq('role', params.role)");
    expect(setRole).toContain('.maybeSingle()');
    expect(setRole).toContain('.update(updatePayload)');
    expect(setRole).toContain('.insert(payload)');
    expect(setRole).not.toContain('onConflict');
    expect(setRole).not.toContain('.upsert(');
    expect(setRole).not.toContain('as any');
  });

  it('a migration de origem criou o índice parcial (histórico do bug)', () => {
    const origin = read(ORIGIN);
    expect(origin).toMatch(
      /create unique index if not exists sole_group_standard_items_role_unique[\s\S]*where role is not null/i,
    );
  });

  it('a migration corretiva recria o índice SEM predicado WHERE', () => {
    const fix = read(FIX);
    expect(fix).toContain('DROP INDEX IF EXISTS public.sole_group_standard_items_role_unique');
    expect(fix).toMatch(
      /CREATE UNIQUE INDEX sole_group_standard_items_role_unique\s+ON public\.sole_group_standard_items \(sole_group_id, role\);/,
    );
    // Só o CREATE — o COMMENT pode mencionar WHERE ao explicar o bug.
    const createStmt = fix.match(
      /CREATE UNIQUE INDEX sole_group_standard_items_role_unique[\s\S]*?;/,
    )?.[0] ?? '';
    expect(createStmt).toBeTruthy();
    expect(createStmt.toLowerCase()).not.toMatch(/\bwhere\b/);
  });

  it('nenhuma migration posterior reintroduz o predicado no índice de PAPEL', () => {
    const migrationsDir = resolve(ROOT, 'supabase/migrations');
    const later = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql') && f > '20270101019100_')
      .sort();

    for (const file of later) {
      const sql = readFileSync(resolve(migrationsDir, file), 'utf8');
      if (!/sole_group_standard_items_role_unique/i.test(sql)) continue;
      expect(
        sql,
        `${file} recria sole_group_standard_items_role_unique com WHERE — quebra ON CONFLICT PostgREST`,
      ).not.toMatch(
        /sole_group_standard_items_role_unique[\s\S]{0,200}where\s+role\s+is\s+not\s+null/i,
      );
    }
  });
});
