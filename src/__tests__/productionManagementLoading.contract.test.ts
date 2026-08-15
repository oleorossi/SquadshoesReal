import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SQL = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20270101000700_otimizar-carregamento-modo-gestao.sql'),
  'utf8',
);

describe('carregamento do Modo Gestão — contrato SQL', () => {
  it('indexa o run da agenda usado pela fila', () => {
    expect(SQL).toMatch(/idx_prod_sched_run_date_order/);
    expect(SQL).toMatch(/\(recalc_run_id, date, order_id\)/);
  });

  it('resolve o último recálculo em uma passagem protegida', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.latest_schedule_run_id/);
    expect(SQL).toMatch(/SECURITY DEFINER/);
    expect(SQL).toMatch(/GROUP BY ps\.recalc_run_id/);
    expect(SQL).toMatch(/ORDER BY max\(r\.ran_at\) DESC NULLS LAST/);
    expect(SQL).not.toMatch(/WHERE EXISTS/);
  });

  it('não expõe a função para acesso anônimo', () => {
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.latest_schedule_run_id\(\) FROM PUBLIC, anon/);
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.latest_schedule_run_id\(\) TO authenticated, service_role/);
  });
});
