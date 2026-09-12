import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20270101024200_interpret-three-punches-day-summary.sql'),
  'utf8',
);

describe('diário de ponto — n=3 com saída real (migration 20270101024200)', () => {
  it('redefine calculate_day_summary e a view de pendências no mesmo arquivo', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.calculate_day_summary/);
    expect(SQL).toMatch(/CREATE OR REPLACE VIEW public\.v_pending_time_records/);
    expect(SQL).toMatch(/\nBEGIN;\n/);
    expect(SQL.trimEnd()).toMatch(/COMMIT;$/);
  });

  it('n=3 com última batida ainda no almoço continua irregular', () => {
    expect(SQL).toMatch(/v_c <= \(13 \* 60\)/);
    expect(SQL).toMatch(/partial_reason', 'punches_impar'/);
  });

  it('n=3 com saída real infere almoço (12:00 se volta ≥12:30, senão volta 13:00)', () => {
    expect(SQL).toMatch(/v_b >= \(12 \* 60 \+ 30\)/);
    expect(SQL).toMatch(/v_lunch_out := LEAST\(12 \* 60, v_b\)/);
    expect(SQL).toMatch(/v_i2a := 13 \* 60/);
    expect(SQL).toContain("v_partial_reason := 'almoco_inferido'");
  });

  it('ímpar ≥5 continua irregular — a decisão de 2026-07-30 não foi reaberta', () => {
    expect(SQL).toMatch(/v_count = 1 OR \(v_count > 1 AND v_count % 2 <> 0\)/);
  });

  it('a fila não lista n=3 cuja última batida já é a saída', () => {
    expect(SQL).toContain('last_punch_min');
    expect(SQL).toMatch(/WHEN rwg\.pc = 3 AND COALESCE\(rwg\.last_punch_min, 0\) <= \(13 \* 60\) THEN 'falta_saida_apos_almoco'/);
    expect(SQL).toMatch(/rwg\.pc = 3\s+AND COALESCE\(rwg\.last_punch_min, 0\) > \(13 \* 60\)/);
  });

  it('preserva o detector de jornada curta e o security_invoker', () => {
    expect(SQL).toContain("THEN 'dia_incompleto_suspeito'");
    expect(SQL).toMatch(/WITH \(security_invoker = true\)/);
  });
});
