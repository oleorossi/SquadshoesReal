import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const SQL = readFileSync(
  resolve(ROOT, 'supabase/migrations/20270101044600_ponto-reimport-protected.sql'),
  'utf8',
);

describe('ponto reimport_protected migration contract', () => {
  it('adiciona coluna e protege punches no import', () => {
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS reimport_protected boolean NOT NULL DEFAULT false/);
    expect(SQL).toContain('ELSIF COALESCE(v_existing_protected, false) THEN');
    expect(SQL).toContain("'skipped_protected', skp_protected_count");
    // protegido: atualiza metadados, NÃO chama merge de punches
    const protectedBranch = SQL.slice(
      SQL.indexOf('ELSIF COALESCE(v_existing_protected, false) THEN'),
      SQL.indexOf('ELSE', SQL.indexOf('ELSIF COALESCE(v_existing_protected, false) THEN')),
    );
    expect(protectedBranch).not.toContain('merge_time_record_punches');
    expect(protectedBranch).toContain('import_batch');
  });

  it('upsert liga proteção; RPC de unlock exige motivo e respeita período fechado', () => {
    expect(SQL).toMatch(/SET punches = v_new_punches,\s*reimport_protected = true/);
    expect(SQL).toContain('CREATE OR REPLACE FUNCTION public.set_time_record_reimport_protection');
    expect(SQL).toContain("length(v_reason) < 4");
    expect(SQL).toContain("tp.status = 'fechado'");
    expect(SQL).toContain('GRANT EXECUTE ON FUNCTION public.set_time_record_reimport_protection');
  });
});
