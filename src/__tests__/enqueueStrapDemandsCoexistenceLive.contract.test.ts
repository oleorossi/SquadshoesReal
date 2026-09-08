import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A 20400 reescreveu enqueue e reintroduziu o MUTEX upper_material → [].
 * O corpo VIVO (maior carimbo que redefine a função) tem que manter
 * coexistência 14675/16100 + no-ops de pré-baseline da 20400.
 */
const ROOT = resolve(__dirname, '../..');
const MIGRATIONS = resolve(ROOT, 'supabase/migrations');

function latestEnqueueMigration(): { file: string; sql: string } {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  let hit: { file: string; sql: string } | null = null;
  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS, file), 'utf8');
    if (
      sql.includes(
        'CREATE OR REPLACE FUNCTION public.enqueue_sale_order_strap_demands',
      )
    ) {
      hit = { file, sql };
    }
  }
  if (!hit) throw new Error('nenhuma migration redefine enqueue_sale_order_strap_demands');
  return hit;
}

function sqlFunction(sql: string, name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = sql.lastIndexOf(marker);
  expect(start, `${name} deve existir`).toBeGreaterThanOrEqual(0);
  const tail = sql.slice(start);
  const end = tail.indexOf('\n$$;');
  expect(end, `${name} deve terminar com $$;`).toBeGreaterThanOrEqual(0);
  return tail.slice(0, end + 4);
}

describe('enqueue_sale_order_strap_demands — corpo vivo', () => {
  const latest = latestEnqueueMigration();
  const enqueue = sqlFunction(latest.sql, 'enqueue_sale_order_strap_demands');

  it('usa a migration mais recente do enqueue (pos-20400)', () => {
    // 21600 restaura coexistencia; 21700 garante preview operacional se a
    // 21600 ja tiver sido aplicada cedo com preview publico.
    expect(latest.file).toMatch(
      /20270101021[67]00_.*\.sql$/,
    );
  });

  it('mantem coexistencia cabedal+tiras (sem MUTEX upper_material)', () => {
    expect(enqueue).toContain('upper_and_straps_coexist_20270101014675');
    expect(enqueue).not.toContain('nullif(btrim(coalesce(ts.upper_material');
    expect(enqueue).toContain('production_excluded_at IS NULL');
    expect(enqueue).toContain("'color_mode'");
    expect(enqueue).toContain("'material_mode'");
    expect(enqueue).toContain("'allowed_material_group_ids'");
  });

  it('usa preview operacional privado (nao o publico com yield NULL)', () => {
    expect(enqueue).toContain('private.preview_sale_order_strap_demand_operational');
    expect(enqueue).not.toContain(
      'public.preview_sale_order_strap_demand(p_sale_order_id)',
    );
  });

  it('preserva no-ops de pre-baseline da 20400', () => {
    expect(enqueue).toContain("p_event_type = 'schedule_changed'");
    expect(enqueue).toContain(
      "NOT IN ('confirmed', 'approved', 'direct_production', 'cancelled')",
    );
    expect(enqueue).toContain('RETURN NULL');
    expect(enqueue).toContain(
      'PV possui % linha(s) de tira bloqueada(s); consulte preview_sale_order_strap_demand',
    );
  });

  it('ainda recusa freeze estrutural divergente', () => {
    expect(enqueue).toContain(
      'PV nao congelou exatamente as linhas de tira da ficha vigente; revise a ficha e o item antes de confirmar',
    );
  });
});
