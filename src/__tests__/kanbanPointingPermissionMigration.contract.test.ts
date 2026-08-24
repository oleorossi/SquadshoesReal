import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const migration = readFileSync(resolve(
  ROOT,
  'supabase/migrations/20270101009300_proteger_apontamento_kanban_por_permissao.sql',
), 'utf8');

function sqlFunction(name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = migration.indexOf(marker);
  expect(start, `${name} deve existir`).toBeGreaterThanOrEqual(0);
  const tail = migration.slice(start);
  const end = tail.indexOf('\n$$;');
  expect(end, `${name} deve terminar com $$;`).toBeGreaterThanOrEqual(0);
  return tail.slice(0, end + 4);
}

describe('permissão server-side do apontamento de produção', () => {
  it('espelha admin, modo granular e fallback RBAC da UI', () => {
    const gate = sqlFunction('can_execute_production_pointing');

    expect(gate).toContain("ur.role::text = 'admin'");
    expect(gate).toContain('AND up.can_view');
    expect(gate).toContain("up.module IN ('producao', 'ordens')");
    expect(gate).toContain("'/producao/kanban'");
    expect(gate).toContain("'/producao/apontamento'");
    expect(gate).toContain("'/producao/analises'");
    expect(gate).toContain("'/orders'");
    expect(gate).toContain('AND up.can_edit');
    expect(gate).toContain("ur.role::text IN ('gerente', 'producao', 'consulta')");
    expect(gate).toContain("SET search_path = ''");
    expect(gate).not.toContain('auth.role()');
  });

  it('isola a implementação privilegiada do Data API', () => {
    expect(migration).toContain(
      "to_regprocedure(\n    'public.apontar_producao_setor_impl(uuid,text,integer,uuid,text,boolean,text[])'",
    );
    expect(migration).toMatch(/IF to_regprocedure\([\s\S]*?\) IS NULL THEN/);
    expect(migration).toMatch(
      /ALTER FUNCTION public\.apontar_producao_setor\([\s\S]*?\) RENAME TO apontar_producao_setor_impl;/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.apontar_producao_setor_impl\([\s\S]*?\) FROM PUBLIC, anon, authenticated;/,
    );
  });

  it('expõe somente o portão que exige can_edit', () => {
    const wrapper = sqlFunction('apontar_producao_setor');

    expect(wrapper).toContain('IF NOT public.can_execute_production_pointing()');
    expect(wrapper).toContain("ERRCODE = '42501'");
    expect(wrapper).toContain('public.apontar_producao_setor_impl(');
    expect(wrapper).toContain("SET search_path = ''");
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.apontar_producao_setor\([\s\S]*?\) FROM PUBLIC, anon;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.apontar_producao_setor\([\s\S]*?\) TO authenticated, service_role;/,
    );
  });
});
