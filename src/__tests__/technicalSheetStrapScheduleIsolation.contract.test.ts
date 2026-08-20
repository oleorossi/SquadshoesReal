import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const migration = read(
  'supabase/migrations/20270101005700_skip_prebaseline_strap_schedule_events.sql',
);
const autoIntentMigration = read(
  'supabase/migrations/20270101005500_auto_internal_strap_intent_from_pv.sql',
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

describe('Ficha tecnica — isolamento do evento derivado de tiras', () => {
  it('nao deixa o planejamento criar a primeira demanda do PV', () => {
    const fn = sqlFunction('tg_enqueue_strap_demands_on_schedule_change');
    const baselineGuard = fn.indexOf('IF NOT EXISTS (');
    const enqueue = fn.indexOf('public.enqueue_sale_order_strap_demands(');

    expect(baselineGuard).toBeGreaterThanOrEqual(0);
    expect(fn).toContain('FROM public.sale_order_strap_demands d');
    expect(fn).toContain('d.sale_order_id = v_sale_order_id');
    expect(fn).toContain('d.is_current');
    expect(fn).toContain("'schedule_changed'");
    expect(enqueue).toBeGreaterThan(baselineGuard);
  });

  it('mantem o evento para revisoes depois que a baseline existe', () => {
    const fn = sqlFunction('tg_enqueue_strap_demands_on_schedule_change');

    expect(fn).toContain("v_status NOT IN ('Aprovado', 'Em Produção')");
    expect(fn).toContain('PERFORM public.enqueue_sale_order_strap_demands(');
    expect(migration).toContain('CREATE CONSTRAINT TRIGGER trg_enqueue_strap_demands_on_schedule_change');
    expect(migration).toContain('DEFERRABLE INITIALLY DEFERRED');
  });

  it('preserva a validacao autoritativa de blockers no save do PV', () => {
    expect(migration).not.toContain('tg_assign_sale_order_strap_job_revision');
    expect(autoIntentMigration).toContain(
      'Evento de tiras bloqueado antes da primeira demanda; corrija e salve o PV',
    );
    expect(autoIntentMigration).toContain("NEW.event_type <> 'cancelled'");
  });

  it('nao reescreve pedidos, demandas ou planejamento durante o reparo', () => {
    expect(migration).not.toMatch(/\b(?:UPDATE|INSERT INTO|DELETE FROM)\s+public\./i);
  });
});
