/**
 * PV soft-deleted (deleted_at) não volta a gerar demanda de tira na agenda
 * nem no processador. Fonte: 20270101046000_tiras-ignora-pv-soft-deleted.sql
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIG = readFileSync(
  resolve('supabase/migrations/20270101046000_tiras-ignora-pv-soft-deleted.sql'),
  'utf8',
);

describe('tiras ignoram PV soft-deleted', () => {
  it('o rebuild da agenda não enfileira PV com deleted_at', () => {
    expect(MIG).toContain('CREATE OR REPLACE FUNCTION public.recompute_production_schedule(');
    expect(MIG).toContain('recompute_production_schedule_if_stale chama esta função');
    expect(MIG).toContain('AND so.deleted_at IS NULL');
    expect(MIG).toContain("AND so.status IN ('Aprovado', 'Em Produção')");
    const scan = MIG.indexOf('SELECT DISTINCT d.sale_order_id');
    const deleted = MIG.indexOf('AND so.deleted_at IS NULL', scan);
    const status = MIG.indexOf("AND so.status IN ('Aprovado', 'Em Produção')", scan);
    expect(scan).toBeGreaterThan(0);
    expect(deleted).toBeGreaterThan(scan);
    expect(status).toBeGreaterThan(deleted);
  });

  it('o trigger da agenda sai antes de enfileirar PV excluído', () => {
    expect(MIG).toContain('tg_enqueue_strap_demands_on_schedule_change');
    expect(MIG).toContain('OR v_deleted_at IS NOT NULL');
    expect(MIG).toContain('so.deleted_at');
  });

  it('o processador no-opa PV excluído depois do cancelled e antes do PV fechado', () => {
    expect(MIG).toContain('process_strap_demand_job');
    expect(MIG).toContain("'pv_excluido'");
    expect(MIG).toContain('so.deleted_at IS NOT NULL');
    const excluded = MIG.indexOf("'pv_excluido'");
    const closedAfter = MIG.indexOf('is_closed_sale_order_status((', excluded);
    expect(excluded).toBeGreaterThan(0);
    expect(closedAfter).toBeGreaterThan(excluded);
  });
});
