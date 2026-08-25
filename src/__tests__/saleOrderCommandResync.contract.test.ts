import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync(
  resolve(
    __dirname,
    '../../supabase/migrations/20270101010300_safe_resync_op_command.sql',
  ),
  'utf8',
);

function sqlFunction(name: string): string {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `${name} ausente`).toBeGreaterThanOrEqual(0);
  const tail = SQL.slice(start);
  const end = tail.indexOf('\n$$;');
  expect(end, `${name} sem terminador`).toBeGreaterThanOrEqual(0);
  return tail.slice(0, end + 4);
}

describe('sale order command — resync seguro', () => {
  const resync = sqlFunction('resync_op_atomic');

  it('restaura ledger antes de aposentar qualquer projeção derivada', () => {
    const restore = resync.indexOf('restore_order_stock_for_safe_resync(');
    const retireConsumption = resync.indexOf('UPDATE public.production_consumptions');
    const retireReservations = resync.indexOf('UPDATE public.material_reservations');
    const stages = resync.indexOf('DELETE FROM public.order_stages');

    expect(restore).toBeGreaterThanOrEqual(0);
    expect(restore).toBeLessThan(retireConsumption);
    expect(retireConsumption).toBeLessThan(retireReservations);
    expect(retireReservations).toBeLessThan(stages);
    expect(resync).not.toContain('DELETE FROM public.stock_movements');
    expect(resync).not.toContain('DELETE FROM public.technical_sheet_snapshots');
    expect(resync).not.toMatch(/UPDATE public\.stock_movements[\s\S]*?order_id\s*=\s*NULL/);
  });

  it('arquiva o snapshot completo e recalcula por upsert sem perder identidade', () => {
    expect(resync).toContain('sale_order_resync_snapshot_history');
    expect(resync).toContain('to_jsonb(tss)');
    expect(resync).toContain('public.freeze_technical_sheet(');
    expect(resync).toContain('outdated_at = NULL');
  });

  it('reconstrói reservas soft e embalagem hard pela assinatura canônica', () => {
    expect(resync).toMatch(
      /hybrid_debit_stock_for_order\([\s\S]*?p_order_grade\s*=>[\s\S]*?p_force_soft\s*=>\s*true/,
    );
    expect(resync).toMatch(
      /debit_sole_stock_by_grade\([\s\S]*?p_order_grade\s*=>[\s\S]*?p_force_soft\s*=>\s*true/,
    );
    expect(resync).toMatch(
      /debit_packaging_for_order\([\s\S]*?p_packaging_mode\s*=>[\s\S]*?p_force_soft\s*=>\s*false/,
    );
    expect(SQL).toMatch(
      /DROP FUNCTION public\.hybrid_debit_stock_for_order\(\s*uuid,\s*numeric,\s*text,\s*uuid,\s*jsonb\s*\)/,
    );
  });

  it('preserva reservas e movimentos do motor canônico de tiras', () => {
    expect(SQL).toContain("COALESCE(metadata ->> 'kind', '') <> 'strap'");
    expect(resync).toContain("COALESCE(mr.metadata ->> 'kind', '') <> 'strap'");
    expect(resync).toContain(
      "COALESCE(sm.description, '') NOT ILIKE 'Debito Tira%'",
    );
  });

  it('recusa fatos físicos e histórico sem plano comprometido', () => {
    for (const token of [
      'quantity_processed',
      'order_lots',
      'quantity_consumed',
      'pending_reconciliation',
      'production_consumptions',
      'histórico não será auto-reparado',
      "USING ERRCODE = 'PZ103'",
    ]) {
      expect(resync).toContain(token);
    }
  });

  it('usa a rota default viva de 11 etapas sem Corte Cabedal', () => {
    const fallback = resync.match(/ARRAY\[\s*'Corte Fibra'[\s\S]*?\]/)?.[0] ?? '';
    const names = Array.from(fallback.matchAll(/'([^']+)'/g), (match) => match[1]);
    expect(names).toEqual([
      'Corte Fibra',
      'Corte Forração',
      'Costura Palmilha',
      'Costura Cabedal',
      'Aviamento',
      'Silk',
      'Colagem',
      'Montagem',
      'Solagem',
      'Acabamento',
      'Expedição',
    ]);
    expect(fallback).not.toContain("'Corte Cabedal'");
  });
});
