import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Migration viva que define a regra atual (supercede 20270101042200). */
const SQL = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20270101044300_turno-parcial-duas-batidas.sql'),
  'utf8',
);

describe('diário de ponto — turno parcial n=2 paga (migration 20270101044300)', () => {
  it('redefine calculate_day_summary, helper e a view de pendências no mesmo arquivo', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.two_punches_need_lunch_marks/);
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.calculate_day_summary/);
    expect(SQL).toMatch(/CREATE OR REPLACE VIEW public\.v_pending_time_records/);
    expect(SQL).toMatch(/\nBEGIN;\n/);
    expect(SQL.trimEnd()).toMatch(/COMMIT;$/);
  });

  it('n=2 só vira irregular quando two_punches_need_lunch_marks', () => {
    expect(SQL).toMatch(/v_n2_pending := public\.two_punches_need_lunch_marks/);
    expect(SQL).toContain("partial_reason', 'faltam_batidas_almoco'");
    expect(SQL).toContain("WHEN v_count = 3 THEN 'punches_impar'");
    expect(SQL).not.toContain("v_partial_reason := 'almoco_inferido'");
    // A trava antiga "todo n=2" não pode voltar.
    expect(SQL).not.toMatch(/IF v_count < 4 OR \(v_count % 2\) <> 0 THEN/);
  });

  it('a fila lista n=2 só quando precisa de almoço / virada', () => {
    expect(SQL).toMatch(/rwg\.pc = 2 AND public\.two_punches_need_lunch_marks\(rwg\.punches\)/);
    expect(SQL).toMatch(/\(rwg\.pc % 2\) <> 0/);
  });

  it('helper detecta cruzamento de almoço e virada', () => {
    expect(SQL).toMatch(/v_first < 12 \* 60 AND v_last >= 13 \* 60/);
    expect(SQL).toMatch(/v_a >= 5 \* 60 AND v_b < 5 \* 60/);
  });

  it('preserva security_invoker na view', () => {
    expect(SQL).toMatch(/WITH \(security_invoker = true\)/);
  });
});
