import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SQL = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20270101000900_integridade-ajuste-estoque-grade-unidades.sql'),
  'utf8',
);

describe('ajuste de estoque — contrato de integridade SQL', () => {
  it('registra grade anterior e nova no histórico', () => {
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS previous_grade jsonb/);
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS new_grade jsonb/);
    expect(SQL).toMatch(/previous_grade, new_grade/);
  });

  it('bloqueia frações em unidades de contagem', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.is_discrete_stock_unit/);
    expect(SQL).toMatch(/FRACTIONAL_DISCRETE_UNIT/);
    expect(SQL).toMatch(/FRACTIONAL_GRADE_BUCKET/);
  });

  it('valida que o total fecha com a soma por numeração', () => {
    expect(SQL).toMatch(/GRADE_TOTAL_MISMATCH/);
    expect(SQL).toMatch(/abs\(v_grade_total - v_new_qty\) > 0\.0001/);
  });

  it('restaura o gatilho de coerência de grade', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.check_grade_quantity_coherence/);
    expect(SQL).toMatch(/CREATE TRIGGER trg_check_grade_quantity_coherence/);
    expect(SQL).toMatch(/BEFORE UPDATE OF stock_grade, quantity, unit ON public\.products/);
  });

  it('mantém o lote transacional e a trava de concorrência', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.adjust_stock_batch/);
    expect(SQL).toMatch(/FOR UPDATE/);
    expect(SQL).toMatch(/CONCURRENCY_ERROR/);
  });
});
