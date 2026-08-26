import { readFileSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const MIGRATIONS_DIR = resolve(ROOT, 'supabase/migrations');
const DROP_MIGRATION_NAME = '20260910130000_drop-bank-hours.sql';

const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

function withoutSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '')
    .toLowerCase();
}

describe('remoção definitiva do banco de horas', () => {
  it('remove a tabela e as duas RPCs legadas na migration canônica', () => {
    const migration = read(`supabase/migrations/${DROP_MIGRATION_NAME}`);

    expect(migration).toContain('DROP TABLE IF EXISTS public.bank_hours_movements CASCADE');
    expect(migration).toMatch(/'calculate_employee_bank_balance',[\s\S]*'pay_bank_hours'/);
    expect(migration).toContain("EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';");
  });

  it('nenhuma migration posterior ressuscita tabela ou funções descontinuadas', () => {
    const posteriorMigrations = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith('.sql') && name > DROP_MIGRATION_NAME)
      .sort();

    expect(posteriorMigrations).toContain('20270101013600_identidade_canonica_pendencias_ponto.sql');

    for (const name of posteriorMigrations) {
      const sql = withoutSqlComments(readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8'));

      expect(sql, `${basename(name)} recria bank_hours_movements`).not.toMatch(
        /create\s+table(?:\s+if\s+not\s+exists)?\s+(?:public\.)?bank_hours_movements\b/,
      );
      expect(sql, `${basename(name)} recria calculate_employee_bank_balance`).not.toMatch(
        /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?calculate_employee_bank_balance\s*\(/,
      );
      expect(sql, `${basename(name)} recria pay_bank_hours`).not.toMatch(
        /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?pay_bank_hours\s*\(/,
      );
    }
  });
});
