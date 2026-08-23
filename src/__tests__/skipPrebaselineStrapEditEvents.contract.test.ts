import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const migration = readFileSync(
  resolve(
    ROOT,
    'supabase/migrations/20270101009300_skip_prebaseline_strap_edit_events.sql',
  ),
  'utf8',
);

function sqlFunction(name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = migration.lastIndexOf(marker);
  expect(start, `${name} deve existir`).toBeGreaterThanOrEqual(0);
  const tail = migration.slice(start);
  const end = tail.indexOf('\n$$;');
  expect(end, `${name} deve terminar com $$;`).toBeGreaterThanOrEqual(0);
  return tail.slice(0, end + 4);
}

describe('Edicao de PV — evento de tiras sem demanda corrente', () => {
  it('nao aborta o save em schedule_changed/item_updated antes da baseline', () => {
    const enqueue = sqlFunction('enqueue_sale_order_strap_demands');
    const revision = sqlFunction('tg_assign_sale_order_strap_job_revision');

    expect(enqueue).toContain("p_event_type = 'schedule_changed'");
    expect(enqueue).toContain('AND v_block_count > 0');
    expect(enqueue).toContain('RETURN NULL');
    expect(enqueue).toContain("NOT IN ('confirmed', 'approved', 'direct_production', 'cancelled')");
    expect(enqueue).toContain('FROM public.sale_order_strap_demands d');
    expect(enqueue).toContain('d.is_current');

    expect(revision).toContain("NEW.event_type = 'schedule_changed'");
    expect(revision).toContain('AND NOT v_has_current THEN');
    expect(revision).toContain('RETURN NULL');
    expect(revision).toContain("NEW.event_type IN ('confirmed', 'approved', 'direct_production')");
  });

  it('mantem a recusa autoritativa so na confirmacao', () => {
    const enqueue = sqlFunction('enqueue_sale_order_strap_demands');
    const revision = sqlFunction('tg_assign_sale_order_strap_job_revision');

    expect(enqueue).toContain(
      'PV possui % linha(s) de tira bloqueada(s); consulte preview_sale_order_strap_demand',
    );
    expect(revision).toContain(
      'Evento de tiras bloqueado antes da primeira demanda; corrija e salve o PV',
    );

    const raiseAt = revision.indexOf('RAISE EXCEPTION');
    const confirmedAt = revision.indexOf(
      "NEW.event_type IN ('confirmed', 'approved', 'direct_production')",
    );
    const skipAt = revision.lastIndexOf('RETURN NULL');
    expect(confirmedAt).toBeGreaterThanOrEqual(0);
    expect(raiseAt).toBeGreaterThan(confirmedAt);
    expect(skipAt).toBeGreaterThan(raiseAt);
  });

  it('nao reescreve pedidos, demandas ou planejamento', () => {
    expect(migration).not.toMatch(/\b(?:UPDATE|INSERT INTO|DELETE FROM)\s+public\.(sale_orders|sale_order_items|sale_order_strap_demands|production_orders)\b/i);
  });
});
