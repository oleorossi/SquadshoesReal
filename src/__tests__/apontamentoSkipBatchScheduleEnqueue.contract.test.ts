import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const MIGRATION = read(
  'supabase/migrations/20270101024900_apontamento_skip_batch_sem_enqueue_agenda.sql',
);
const USE_STAGES = read('src/hooks/useOrderStages.ts');
const POINTING_PLAN = read('src/components/production/kanban/pointingPlan.ts');

function sqlFunction(name: string): string {
  const starts = [
    MIGRATION.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`),
    MIGRATION.lastIndexOf(`CREATE FUNCTION public.${name}(`),
  ].filter(index => index >= 0);
  const start = starts.length > 0 ? Math.max(...starts) : -1;
  expect(start, `${name} ausente`).toBeGreaterThanOrEqual(0);
  const tail = MIGRATION.slice(start);
  const end = tail.indexOf('\n$$;');
  expect(end, `${name} sem terminador`).toBeGreaterThanOrEqual(0);
  return tail.slice(0, end + 4);
}

describe('apontamento — pulo em lote e agenda sem tempestade de tiras', () => {
  it('o trigger da agenda sai no GUC antes de qualquer JOIN', () => {
    const fn = sqlFunction('tg_enqueue_strap_demands_on_schedule_change');
    const guc = fn.indexOf("current_setting('app.skip_schedule_strap_enqueue'");
    const join = fn.indexOf('FROM public.orders o');
    expect(guc).toBeGreaterThanOrEqual(0);
    expect(join).toBeGreaterThan(guc);
  });

  it('o rebuild liga o GUC e não enfileira tiras no apontamento', () => {
    const fn = sqlFunction('recompute_production_schedule');
    expect(fn).toContain("set_config('app.skip_schedule_strap_enqueue', '1', true)");
    expect(fn).toContain('recompute_production_schedule_impl_249');
    expect(fn).toContain("IS DISTINCT FROM 'apontamento'");
    expect(fn).toContain('enqueue_sale_order_strap_demands');
    expect(MIGRATION).not.toContain(
      'CREATE OR REPLACE FUNCTION public.enqueue_sale_order_strap_demands',
    );
  });

  it('o command aceita skip na mesma transação e dropar a assinatura de 9 args', () => {
    expect(MIGRATION).toContain(
      'DROP FUNCTION IF EXISTS public.execute_production_pointing_command(\n  uuid, text, integer, uuid, text, boolean, text[], timestamptz, uuid\n)',
    );
    const pointing = sqlFunction('execute_production_pointing_command');
    expect(pointing).toContain('p_skip_stage_names text[] DEFAULT NULL');
    expect(pointing).toContain('FOREACH v_skip_name IN ARRAY');
    expect(pointing).toContain('public.apontar_producao_setor_impl(');
    expect(pointing).toContain("'skip_stage_names'");
    expect(pointing.indexOf('RETURN v_receipt.response')).toBeLessThan(
      pointing.indexOf('public.apontar_producao_setor_impl'),
    );
  });

  it('o browser manda os pulos num RPC só e não faz loop de mutateAsync', () => {
    expect(USE_STAGES).toContain('p_skip_stage_names:');
    expect(USE_STAGES).toContain('skipStageNames?: string[]');
    expect(POINTING_PLAN).toContain('skipStageNames: skipped.length ? skipped : undefined');
    expect(POINTING_PLAN).not.toMatch(/for \(const skippedSector of skipped\)/);
  });
});
