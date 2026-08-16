import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20270101004500_employee_termination_lifecycle.sql'),
  'utf8',
);

describe('contrato de desligamento do funcionário', () => {
  it('inativa no banco sem apagar o histórico de ponto ou folha', () => {
    expect(migration).toContain('NEW.active := false');
    expect(migration).toMatch(/BEFORE INSERT OR UPDATE OF termination_date, active/i);
    expect(migration).not.toMatch(/DELETE\s+FROM\s+public\.(time_records|payroll_runs)/i);
  });
});
