import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Migration viva que define a regra atual (supercede 20270101024200). */
const SQL = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20270101042200_ponto-pendencia-exige-quatro-batidas.sql'),
  'utf8',
);

describe('diário de ponto — só 4 batidas completam o dia (migration 20270101042200)', () => {
  it('redefine calculate_day_summary e a view de pendências no mesmo arquivo', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.calculate_day_summary/);
    expect(SQL).toMatch(/CREATE OR REPLACE VIEW public\.v_pending_time_records/);
    expect(SQL).toMatch(/\nBEGIN;\n/);
    expect(SQL.trimEnd()).toMatch(/COMMIT;$/);
  });

  it('1, 2, 3 ou ímpar ≥5 viram irregular com worked_min 0', () => {
    expect(SQL).toMatch(/v_count < 4 OR \(v_count % 2\) <> 0/);
    expect(SQL).toContain("WHEN v_count = 2 THEN 'faltam_batidas_almoco'");
    expect(SQL).toContain("WHEN v_count = 3 THEN 'punches_impar'");
    expect(SQL).not.toContain("v_partial_reason := 'almoco_inferido'");
  });

  it('a fila lista todo n=2 e todo n=3 (sem exceção de saída real)', () => {
    expect(SQL).toMatch(/rwg\.pc < 4\s+OR \(rwg\.pc % 2\) <> 0/);
    expect(SQL).not.toMatch(/last_punch_min, 0\) > \(13 \* 60\)/);
  });

  it('preserva security_invoker na view', () => {
    expect(SQL).toMatch(/WITH \(security_invoker = true\)/);
  });
});
