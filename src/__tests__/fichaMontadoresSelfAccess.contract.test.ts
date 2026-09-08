import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIG = join(
  process.cwd(),
  'supabase/migrations/20270101021200_ficha-montadores-self-access.sql',
);

describe('migration ficha-montadores-self-access', () => {
  const sql = readFileSync(MIG, 'utf8');

  it('adiciona user_id e papel montador', () => {
    expect(sql).toMatch(/ADD VALUE IF NOT EXISTS 'montador'/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS user_id uuid/);
    expect(sql).toMatch(/employees_user_id_uniq/);
  });

  it('define helpers e RLS por escopo', () => {
    expect(sql).toMatch(/current_employee_id/);
    expect(sql).toMatch(/is_ficha_montadores_manager/);
    expect(sql).toMatch(/ficha_montadores_select_scoped/);
    expect(sql).toMatch(/trg_aa_ficha_montadores_enforce_self/);
  });

  it('permite o próprio zerar o dia (DELETE na policy)', () => {
    expect(sql).toMatch(/ficha_montadores_delete_scoped/);
    expect(sql).toMatch(/OR montador_id = public\.current_employee_id\(\)/);
  });
});
