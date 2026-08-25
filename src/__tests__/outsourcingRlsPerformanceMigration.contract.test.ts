import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    __dirname,
    '../../supabase/migrations/20270101010000_otimizar_rls_terceirizacao.sql',
  ),
  'utf8',
);

describe('RLS de terceirização sem reavaliação por linha', () => {
  it('preserva as quatro policies e transforma identidade/permissão em init plans', () => {
    for (const policy of [
      'reference_terceirizacoes_select_approved',
      'reference_terceirizacoes_insert_privileged',
      'reference_terceirizacoes_update_privileged',
      'reference_terceirizacoes_delete_privileged',
    ]) {
      expect(migration).toContain(`ALTER POLICY ${policy}`);
    }

    expect(migration).toContain('(SELECT public.is_approved_user())');
    expect(migration).toContain('(SELECT public.user_has_any_role(');
    expect(migration).toContain("(SELECT pg_catalog.current_setting('request.jwt.claim.role', true))");
    expect(migration).not.toMatch(/(?<!SELECT )public\.is_approved_user\(\)/);
  });

  it('mantém escrita restrita aos papéis operacionais e leitura a authenticated', () => {
    expect(migration).toContain('TO authenticated\n  USING');
    expect(migration.match(/TO authenticated, service_role/g)).toHaveLength(3);
    expect(migration).toContain("ARRAY['admin', 'gerente', 'producao']");
  });
});
