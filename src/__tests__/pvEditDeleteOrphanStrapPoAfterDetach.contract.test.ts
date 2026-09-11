import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const MIGRATIONS = resolve(ROOT, 'supabase/migrations');
const FIX = '20270101023000_fix_pv_edit_delete_orphan_strap_po_item_after_detach.sql';

function readMigration(file: string): string {
  return readFileSync(resolve(MIGRATIONS, file), 'utf8');
}

function latestFinalizeMigration(): { file: string; sql: string } {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  let hit: { file: string; sql: string } | null = null;
  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS, file), 'utf8');
    if (sql.includes('CREATE OR REPLACE FUNCTION private.finalize_removed_sale_order_items')) {
      hit = { file, sql };
    }
  }
  if (!hit) {
    throw new Error('nenhuma migration redefine finalize_removed_sale_order_items');
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

describe('PV edit — DELETE órfão de OC após detach (23000)', () => {
  const sql = readMigration(FIX);
  const latest = latestFinalizeMigration();

  it('é a migration viva do finalize', () => {
    expect(latest.file).toBe(FIX);
  });

  it('finalize apaga órfãos com app.strap_po_engine após detach', () => {
    const finalize = sqlFunction(
      latest.sql,
      'finalize_removed_sale_order_items',
      'private',
    );
    expect(finalize).toContain('pv_edit_delete_orphan_po_after_detach_20270101023000');
    expect(finalize).toContain('pv_edit_detach_cancelled_po_fk_20270101022900');
    expect(finalize).toContain("set_config('app.strap_po_engine', '1', true)");
    expect(finalize).toContain('superseded_purchase_order_item_id');
    expect(finalize).toContain('DELETE FROM public.purchase_order_items i');
    expect(finalize).toContain("c.status = 'awaiting_approval'");
    expect(finalize).toContain('deleted_orphan_strap_po_items');
  });

  it('documento da migration cita o erro de origem canônica', () => {
    expect(sql).toMatch(/origem canonica/i);
    expect(sql).toMatch(/estrutural/i);
    expect(sql).toContain('b4794161');
  });
});
