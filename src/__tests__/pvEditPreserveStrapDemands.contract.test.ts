import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const MIGRATIONS = resolve(ROOT, 'supabase/migrations');

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

describe('edição de PV — preserve itens com demanda de tira', () => {
  const latest = latestLegacyWriterMigration();

  it('usa a migration 22000 como corpo vivo do writer legado', () => {
    expect(latest.file).toMatch(/20270101022000_.*\.sql$/);
  });

  it('writer legado chama finalize em vez de DELETE cru do payload', () => {
    const legacy = sqlFunction(latest.sql, 'update_sale_order_atomic_legacy_202701');
    expect(legacy).toContain('pv_edit_preserve_strap_demands_20270101022000');
    expect(legacy).toContain('private.finalize_removed_sale_order_items(');
    expect(legacy).not.toMatch(
      /DELETE FROM public\.sale_order_items\s+WHERE sale_order_id = p_order_id/,
    );
  });

  it('finalize soft-exclude itens com strap_demands e cancela saldo reversível', () => {
    const finalizeMig = latestFinalizeMigration();
    expect(finalizeMig.file).toMatch(/20270101022200_.*\.sql$/);
    const finalize = sqlFunction(
      finalizeMig.sql,
      'finalize_removed_sale_order_items',
      'private',
    );
    expect(finalize).toContain('sale_order_strap_demands');
    expect(finalize).toContain('production_excluded_at');
    expect(finalize).toContain('strap_demand_has_external_commitment');
    expect(finalize).toContain('compromisso externo');
    expect(finalize).toContain('reconcile_strap_variant');
    expect(finalize).toContain('app.sale_order_item_production_exclusion_internal');
    expect(finalize).toContain('cancelled_purchase_contributions');
    expect(finalize).toContain("status IN ('proposed', 'awaiting_approval', 'suspended')");
  });

  it('guard de exclusão libera gerente/comercial quando GUC interno está ligado', () => {
    const guard = sqlFunction(
      latest.sql,
      'tg_guard_sale_order_item_production_exclusion',
    );
    expect(guard).toContain("'admin', 'gerente', 'comercial'");
  });
});

describe('FK sale_order_strap_demands — ON DELETE SET NULL', () => {
  const migration = readFileSync(
    resolve(ROOT, 'supabase/migrations/20270101022100_strap_demand_item_fk_set_null_on_delete.sql'),
    'utf8',
  );

  it('torna sale_order_item_id nullable com ON DELETE SET NULL', () => {
    expect(migration).toContain('ALTER COLUMN sale_order_item_id DROP NOT NULL');
    expect(migration).toContain('ON DELETE SET NULL');
    expect(migration).toContain('strap_demand_item_fk_set_null_20270101022100');
  });

  it('BEFORE DELETE cancela demanda reversível e barra compromisso externo', () => {
    expect(migration).toContain('tg_release_strap_demands_before_item_delete');
    expect(migration).toContain('strap_demand_has_external_commitment');
    expect(migration).toContain('BEFORE DELETE ON public.sale_order_items');
  });
});

describe('edição de PV — cancela compra reversível ao remover item (22200)', () => {
  const migration = readFileSync(
    resolve(ROOT, 'supabase/migrations/20270101022200_pv_edit_cancel_reversible_purchase_on_item_remove.sql'),
    'utf8',
  );

  it('release trigger cancela e solta FK de purchase_demand_contributions', () => {
    expect(migration).toContain('pv_edit_cancel_reversible_purchase_20270101022200');
    expect(migration).toContain('purchase_demand_contributions');
    expect(migration).toContain('sale_order_item_id = NULL');
  });
});
