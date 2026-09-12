import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Confirm/promote de rascunho precisa reidratar strap_colors pela ficha
 * vigente ANTES do UPDATE de status — senão o enqueue estoura o freeze
 * canônico (PV-00194 / NL03).
 */
const ROOT = resolve(__dirname, '../..');
const MIGRATIONS = resolve(ROOT, 'supabase/migrations');
const MIGRATION_FILE = '20270101023800_refresh_draft_strap_freeze_on_confirm.sql';
const MARKER = 'strap_refresh_on_confirm_20270101023800';

function migrationSql(): string {
  return readFileSync(resolve(MIGRATIONS, MIGRATION_FILE), 'utf8');
}

function latestPromoteMigration(
  fnName: 'promote_sale_order_atomic_internal' | 'promote_sale_order_partial_internal',
): { file: string; sql: string } {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  let hit: { file: string; sql: string } | null = null;
  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS, file), 'utf8');
    if (sql.includes(`CREATE OR REPLACE FUNCTION public.${fnName}`)) {
      hit = { file, sql };
    }
    // Patches via pg_get_functiondef + replace also count as the live body source.
    if (
      sql.includes(`'public.${fnName}(uuid,text)'`)
      && sql.includes('refresh_draft_strap_freeze_for_confirmation')
    ) {
      hit = { file, sql };
    }
  }
  if (!hit) throw new Error(`nenhuma migration redefine/patch ${fnName}`);
  return hit;
}

describe('refresh_draft_strap_freeze_for_confirmation — contrato 23800', () => {
  const sql = migrationSql();

  it('cria o helper privado com marcador estável', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION private.refresh_draft_strap_freeze_for_confirmation(',
    );
    expect(sql).toContain(MARKER);
    expect(sql).toContain('public.prepare_sale_order_item_internal_straps(');
    expect(sql).toContain('sale_order_strap_demands');
    expect(sql).toContain('is_current');
    expect(sql).toContain('production_excluded_at IS NULL');
  });

  it('revoga EXECUTE público do helper', () => {
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION private\.refresh_draft_strap_freeze_for_confirmation\(uuid\)\s+FROM PUBLIC, anon, authenticated, service_role/,
    );
  });

  it('injeta refresh no promote atomic e partial antes do status', () => {
    expect(sql).toContain('promote_sale_order_atomic_internal(uuid,text)');
    expect(sql).toContain('promote_sale_order_partial_internal(uuid,text)');
    expect(sql).toContain(
      'PERFORM private.refresh_draft_strap_freeze_for_confirmation(p_sale_order_id);',
    );
    // Âncora: depois do FOR UPDATE / NOT FOUND, antes de ler status alvo.
    expect(sql).toContain('v_already_target := v_so.status = p_target_status;');
    expect(sql).toContain(
      "v_pkg_mode := COALESCE(v_so.packaging_mode, 'individual_amarrado');",
    );
  });

  it('preserva o RAISE de freeze canônico no enqueue (rede de segurança)', () => {
    expect(sql).toContain(
      'PV nao congelou exatamente as linhas de tira da ficha vigente',
    );
    expect(sql).toContain('private.canonical_strap_freeze_projection');
    expect(sql).toContain('enqueue_sale_order_strap_demands');
  });

  it('alinha o portão do prepare ao BEFORE (service_role/postgres)', () => {
    expect(sql).toContain("auth.role() IS DISTINCT FROM 'service_role'");
    expect(sql).toContain("session_user NOT IN ('postgres', 'supabase_admin')");
    expect(sql).toContain('Somente Comercial/Gerencia pode preparar as tiras do PV');
  });
});

describe('promote vivo — última migration que patcha promote chama refresh', () => {
  it('atomic: corpo vivo referencia o helper 23800', () => {
    const latest = latestPromoteMigration('promote_sale_order_atomic_internal');
    expect(latest.file).toBe(MIGRATION_FILE);
    expect(latest.sql).toContain(MARKER);
    expect(latest.sql).toContain(
      'private.refresh_draft_strap_freeze_for_confirmation(p_sale_order_id)',
    );
  });

  it('partial: corpo vivo referencia o helper 23800', () => {
    const latest = latestPromoteMigration('promote_sale_order_partial_internal');
    expect(latest.file).toBe(MIGRATION_FILE);
    expect(latest.sql).toContain(MARKER);
    expect(latest.sql).toContain(
      'private.refresh_draft_strap_freeze_for_confirmation(p_sale_order_id)',
    );
  });
});
