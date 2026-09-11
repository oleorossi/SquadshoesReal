import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const MIGRATIONS = resolve(ROOT, 'supabase/migrations');
const FIX = '20270101022800_fix_pv_total_sync_after_edit_rematerialize.sql';

function readMigration(file: string): string {
  return readFileSync(resolve(MIGRATIONS, file), 'utf8');
}

function latestLegacyWriterMigration(): { file: string; sql: string } {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  let hit: { file: string; sql: string } | null = null;
  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS, file), 'utf8');
    if (
      sql.includes(
        'CREATE OR REPLACE FUNCTION public.update_sale_order_atomic_legacy_202701',
      )
    ) {
      hit = { file, sql };
    }
  }
  if (!hit) {
    throw new Error('nenhuma migration redefine update_sale_order_atomic_legacy_202701');
  }
  return hit;
}

function sqlFunction(sql: string, name: string, schema = 'public'): string {
  const marker = `CREATE OR REPLACE FUNCTION ${schema}.${name}`;
  const start = sql.lastIndexOf(marker);
  expect(start, `${schema}.${name} deve existir`).toBeGreaterThanOrEqual(0);
  const tail = sql.slice(start);
  const end = Math.max(tail.indexOf('\n$$;'), tail.indexOf('\n$function$;'));
  expect(end, `${schema}.${name} deve terminar`).toBeGreaterThanOrEqual(0);
  const closer = tail.indexOf('\n$$;') === end ? 4 : 12;
  return tail.slice(0, end + closer);
}

describe('PV edit — total server-side após soft-preserve (22800)', () => {
  const sql = readMigration(FIX);
  const latest = latestLegacyWriterMigration();

  it('é a migration viva do writer legado', () => {
    expect(latest.file).toBe(FIX);
  });

  it('restaura recalc somando só itens produtivos', () => {
    const recalc = sqlFunction(sql, 'recalc_sale_order_total');
    expect(recalc).toContain('pv_total_sync_after_edit_20270101022800');
    expect(recalc).toContain('production_excluded_at IS NULL');
    expect(recalc).toContain('SET total = v_total');
  });

  it('restaura triggers de sync de total (split INSERT/DELETE + UPDATE)', () => {
    expect(sql).toContain('CREATE TRIGGER trg_sync_sale_order_total');
    expect(sql).toContain('CREATE TRIGGER trg_sync_sale_order_total_on_update');
    expect(sql).toContain('fn_sync_sale_order_total');
    expect(sql).toContain("to_jsonb(OLD) - 'material_variant_commercial_snapshot'");
  });

  it('writer não confia no total do cliente e recalcula após finalize', () => {
    const legacy = sqlFunction(latest.sql, 'update_sale_order_atomic_legacy_202701');
    expect(legacy).toContain('pv_total_sync_after_edit_20270101022800');
    expect(legacy).toContain('private.finalize_removed_sale_order_items(');
    expect(legacy).toContain('public.recalc_sale_order_total(p_order_id)');
    expect(legacy).not.toContain('total              = v_merged.total');
  });

  it('preflight de confirm/promote filtra soft-excluded no calculated_total', () => {
    expect(sql).toContain('AND i.production_excluded_at IS NULL');
    expect(sql).toContain('preflight_sale_order_command(uuid,text,bigint,uuid,jsonb)');
  });

  it('RAISE pós-update inclui a mensagem do blocker duro', () => {
    expect(sql).toContain('bloqueio sem detalhe');
    expect(sql).toContain(
      'Readiness pós-update recusou a rematerialização do PV ativo: %s',
    );
    expect(sql).toContain(
      'execute_sale_order_command(uuid,text,bigint,text,jsonb,uuid)',
    );
  });
});
