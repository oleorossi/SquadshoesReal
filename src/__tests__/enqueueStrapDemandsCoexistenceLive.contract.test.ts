import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A 20400 reescreveu enqueue e reintroduziu o MUTEX upper_material → [].
 * O corpo VIVO (maior carimbo que redefine a função) tem que manter
 * coexistência 14675/16100 + no-ops de pré-baseline da 20400 + freeze
 * canônico 21900 (prepare × ficha sem falso positivo).
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

function sqlFunction(sql: string, name: string, schema = 'public'): string {
  const marker = `CREATE OR REPLACE FUNCTION ${schema}.${name}`;
  const start = sql.lastIndexOf(marker);
  expect(start, `${schema}.${name} deve existir`).toBeGreaterThanOrEqual(0);
  const tail = sql.slice(start);
  const end = Math.max(tail.indexOf('\n$$;'), tail.indexOf('\n$function$;'));
  expect(end, `${schema}.${name} deve terminar com $$;/$function$;`).toBeGreaterThanOrEqual(0);
  const closer = tail.indexOf('\n$$;') === end ? 4 : 12;
  return tail.slice(0, end + closer);
}

describe('enqueue_sale_order_strap_demands — corpo vivo', () => {
  const latest = latestEnqueueMigration();
  const enqueue = sqlFunction(latest.sql, 'enqueue_sale_order_strap_demands');

  it('usa a migration mais recente do enqueue (freeze canônico 21900)', () => {
    expect(latest.file).toMatch(
      /20270101021900_.*\.sql$/,
    );
  });

  it('mantem coexistencia cabedal+tiras (sem MUTEX upper_material)', () => {
    expect(enqueue).toContain('upper_and_straps_coexist_20270101014675');
    expect(enqueue).not.toContain('nullif(btrim(coalesce(ts.upper_material');
    expect(enqueue).toContain('production_excluded_at IS NULL');
    expect(enqueue).toContain('private.canonical_strap_freeze_projection');
    expect(enqueue).toContain('strap_freeze_canonical_20270101021900');
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

describe('canonical_strap_freeze_projection — contrato', () => {
  const latest = latestEnqueueMigration();
  const helper = sqlFunction(latest.sql, 'canonical_strap_freeze_projection', 'private');

  it('espelha prepare: zera identity_group_id em reference_base', () => {
    expect(helper).toContain('finished_product_group');
    expect(helper).toContain('identity_group_id');
    expect(helper).toMatch(/ELSE NULL/);
  });

  it('normaliza UUID, consumo numerico e lista de materiais ordenada', () => {
    expect(helper).toContain('try_parse_uuid');
    expect(helper).toContain('::numeric');
    expect(helper).toContain('ORDER BY parsed.uid');
    expect(helper).toContain('allowed_material_group_ids');
    expect(helper).toContain('consumption_per_size');
  });
});
