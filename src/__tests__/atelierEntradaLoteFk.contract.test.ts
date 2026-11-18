import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(process.cwd(), 'supabase/migrations');
const HISTORICAL_LOT_FK = [
  '20270101047800_liberacao_atelie_idempotente.sql',
  '20270101047900_entrada_libera_atelie.sql',
];

function files(): string[] {
  return readdirSync(ROOT).filter((name) => name.endsWith('.sql')).sort();
}

function source(name: string): string {
  return readFileSync(join(ROOT, name), 'utf8');
}

/** Último CREATE OR REPLACE da função (corpo que o banco fica executando). */
function living(name: string): { file: string; body: string } {
  const hits = files().filter((file) => source(file).includes(`CREATE OR REPLACE FUNCTION public.${name}`));
  expect(hits.length, name).toBeGreaterThan(0);
  const file = hits[hits.length - 1];
  const text = source(file);
  const start = text.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  const tail = text.slice(start);
  const end = tail.indexOf('\n$$;');
  expect(end, name).toBeGreaterThan(0);
  return { file, body: tail.slice(0, end) };
}

describe('entrada e liberação do Ateliê não gravam atelier_lots.id em stock_movements.lot_id', () => {
  it('a função viva da entrada quita o corte sem usar lot_tracking', () => {
    const inbound = living('apply_atelier_inbound');
    expect(inbound.file).toContain('20270101048500');
    expect(inbound.body).toContain('NULL, NULL, v_need.lot_id');
    expect(inbound.body).toContain('atelier_lot_id');
    expect(inbound.body).toContain('Ateliê · corte completado pela entrada');
    expect(inbound.body).toContain('Reserva aberta zero não bloqueia');
    expect(inbound.body).not.toContain('LEAST(v_qty, COALESCE(v_open, 0))');
    const movement = inbound.body.indexOf('INSERT INTO public.stock_movements');
    const pending = inbound.body.indexOf('pending_qty = pending_qty - v_qty');
    expect(movement).toBeGreaterThan(0);
    expect(movement).toBeLessThan(pending);
    expect(replaceGood(inbound.body, 'NULL, NULL, v_need.lot_id')).not.toContain('NULL, v_need.lot_id');
  });

  it('a liberação com débito de kit grava atelier_lot_id e continua idempotente', () => {
    const release = living('atelier_confirm_lot_release');
    expect(release.file).toContain('20270101048500');
    expect(release.body).toContain('NULL, NULL, p_lot_id');
    expect(release.body).toContain('Ateliê · liberação');
    const guard = release.body.indexOf("s.sector = 'liberacao_atelier'");
    const stock = release.body.indexOf('UPDATE public.products');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(stock);
    expect(replaceGood(release.body, 'NULL, NULL, p_lot_id')).not.toContain('NULL, p_lot_id');
  });

  it('o gatilho quita o corte antes do rateio da quinzena', () => {
    const trigger = living('tg_cover_commitments_on_stock_in');
    expect(trigger.file).toContain('20270101048500');
    const cut = trigger.body.indexOf('apply_atelier_inbound');
    const rateio = trigger.body.indexOf('reallocate_product_commitments');
    expect(cut).toBeGreaterThan(0);
    expect(rateio).toBeGreaterThan(cut);
  });

  it('o rateio, na mesma quinzena, põe corte confirmado e demanda Ateliê na frente', () => {
    const mig = source('20270101048500_entrada_atelie_lote_e_prioridade.sql');
    expect(mig).toContain('atelier_inbound_cover_tier(mr.sale_order_id, mr.product_id) ASC');
    expect(mig).toContain('billing_fortnight_start(public.resolve_billing_week_for_order(mr.sale_order_id)) NULLS LAST');
    expect(mig).toContain('THEN 0');
    expect(mig).toContain("d.sector = 'corte_atelier'");
    expect(mig).toContain("j.pipeline_status = 'awaiting_cut'");
    expect(mig).toContain('ELSE 2');
    expect(mig).toContain('ADD COLUMN IF NOT EXISTS atelier_lot_id uuid');
    expect(mig).toContain('REFERENCES public.atelier_lots(id)');
    expect(mig).toContain('ON DELETE SET NULL');
    expect(mig).toContain('idx_stock_movements_atelier_lot_id');
    expect(mig).toContain('run_atelier_stock_lot_guards');
    expect(mig).not.toContain('PV-00249');
    expect(mig).not.toContain('PV-00250');
    expect(mig).not.toContain('LOTE-00004');
  });

  it('nenhuma função viva além do histórico grava o lote do Ateliê em lot_id', () => {
    const bad = files().filter((file) => {
      const text = source(file);
      return /(?<!NULL, )NULL,\s*v_need\.lot_id,\s*'out'/.test(text)
        || /(?<!NULL, )NULL,\s*p_lot_id,\s*'out'/.test(text);
    });
    expect(bad).toEqual(HISTORICAL_LOT_FK);
  });
});

function replaceGood(body: string, good: string): string {
  return body.split(good).join('');
}
