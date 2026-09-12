import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Confirm/promote de rascunho precisa reidratar strap_colors pela ficha
 * vigente ANTES do UPDATE de status — senão o enqueue estoura o freeze
 * canônico (PV-00194 / NL03).
 *
 * O helper vivo (23900) também precisa setar app.strap_source_rpc antes de
 * gravar strap_sourcing, senão o guard 03200 bloqueia o Aprovar.
 */
const ROOT = resolve(__dirname, '../..');
const MIGRATIONS = resolve(ROOT, 'supabase/migrations');
const INTRO_FILE = '20270101023800_refresh_draft_strap_freeze_on_confirm.sql';
const LIVE_HELPER_FILE = '20270101023900_refresh_draft_strap_freeze_set_source_rpc.sql';
const INTRO_MARKER = 'strap_refresh_on_confirm_20270101023800';
const LIVE_MARKER = 'strap_refresh_source_rpc_20270101023900';

function migrationSql(file: string): string {
  return readFileSync(resolve(MIGRATIONS, file), 'utf8');
}

function latestHelperMigration(): { file: string; sql: string } {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  let hit: { file: string; sql: string } | null = null;
  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS, file), 'utf8');
    if (
      sql.includes(
        'CREATE OR REPLACE FUNCTION private.refresh_draft_strap_freeze_for_confirmation(',
      )
    ) {
      hit = { file, sql };
    }
  }
  if (!hit) {
    throw new Error('nenhuma migration redefine refresh_draft_strap_freeze_for_confirmation');
  }
  return hit;
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
    // Só conta patch que INJETA a chamada (PERFORM), não guard que só lê o corpo.
    if (
      sql.includes(
        'PERFORM private.refresh_draft_strap_freeze_for_confirmation(p_sale_order_id);',
      )
      && sql.includes(`'public.${fnName}(uuid,text)'`)
    ) {
      hit = { file, sql };
    }
  }
  if (!hit) throw new Error(`nenhuma migration redefine/patch ${fnName}`);
  return hit;
}

describe('refresh_draft_strap_freeze_for_confirmation — intro 23800', () => {
  const sql = migrationSql(INTRO_FILE);

  it('cria o helper privado e injeta nos promotes', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION private.refresh_draft_strap_freeze_for_confirmation(',
    );
    expect(sql).toContain(INTRO_MARKER);
    expect(sql).toContain('public.prepare_sale_order_item_internal_straps(');
    expect(sql).toContain('sale_order_strap_demands');
    expect(sql).toContain('is_current');
    expect(sql).toContain('production_excluded_at IS NULL');
    expect(sql).toContain(
      'PERFORM private.refresh_draft_strap_freeze_for_confirmation(p_sale_order_id);',
    );
  });

  it('revoga EXECUTE público do helper', () => {
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION private\.refresh_draft_strap_freeze_for_confirmation\(uuid\)\s+FROM PUBLIC, anon, authenticated, service_role/,
    );
  });

  it('preserva o RAISE de freeze canônico no enqueue (rede de segurança)', () => {
    expect(sql).toContain(
      'PV nao congelou exatamente as linhas de tira da ficha vigente',
    );
    expect(sql).toContain('private.canonical_strap_freeze_projection');
  });
});

describe('refresh_draft_strap_freeze_for_confirmation — corpo vivo 23900', () => {
  const latest = latestHelperMigration();

  it('usa a migration 23900 como corpo vivo do helper', () => {
    expect(latest.file).toBe(LIVE_HELPER_FILE);
    expect(latest.sql).toContain(LIVE_MARKER);
  });

  it('seta app.strap_source_rpc antes de gravar strap_sourcing', () => {
    expect(latest.sql).toContain("set_config('app.strap_source_rpc', '1', true)");
    expect(latest.sql).toContain('app.strap_source_rpc');
    // GUC imediatamente antes do UPDATE que toca strap_sourcing.
    const gucPos = latest.sql.indexOf("set_config('app.strap_source_rpc', '1', true)");
    const sourcingUpdatePos = latest.sql.indexOf('strap_sourcing = v_next_sourcing');
    expect(gucPos).toBeGreaterThanOrEqual(0);
    expect(sourcingUpdatePos).toBeGreaterThan(gucPos);
  });

  it('nao grava strap_sourcing_revision a mao no UPDATE', () => {
    // Comentários/guards podem citar o nome; o SET do UPDATE não pode.
    expect(latest.sql).not.toMatch(
      /SET[\s\S]{0,200}strap_sourcing_revision\s*=/,
    );
  });

  it('atualiza so strap_colors quando sourcing nao mudou', () => {
    expect(latest.sql).toContain('v_sourcing_changed');
    expect(latest.sql).toContain('v_colors_changed');
    expect(latest.sql).toMatch(
      /SET strap_colors = v_next_colors\s+WHERE id = v_item\.id/,
    );
  });
});

describe('promote vivo — ainda chama o helper de refresh', () => {
  it('atomic: injecao 23800 permanece (ultima patch do promote)', () => {
    const latest = latestPromoteMigration('promote_sale_order_atomic_internal');
    expect(latest.file).toBe(INTRO_FILE);
    expect(latest.sql).toContain(
      'private.refresh_draft_strap_freeze_for_confirmation(p_sale_order_id)',
    );
  });

  it('partial: injecao 23800 permanece', () => {
    const latest = latestPromoteMigration('promote_sale_order_partial_internal');
    expect(latest.file).toBe(INTRO_FILE);
    expect(latest.sql).toContain(
      'private.refresh_draft_strap_freeze_for_confirmation(p_sale_order_id)',
    );
  });
});
