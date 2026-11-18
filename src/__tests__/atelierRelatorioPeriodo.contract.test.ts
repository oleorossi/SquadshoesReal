import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync(
  'supabase/migrations/20270101048200_atelier_relatorio_periodo.sql',
  'utf8',
);

describe('Ateliê — relatório do período', () => {
  it('separa fábrica e prestador e cobra só o conferido', () => {
    expect(SQL).toContain('FUNCTION public.atelier_period_report');
    expect(SQL).toContain("WHEN j.execution_mode = 'internal' THEN 'internal'");
    expect(SQL).toContain('pairs * unit_price');
    expect(SQL).toContain('r.reversed_at IS NULL');
    expect(SQL).toContain('target_end < CURRENT_DATE');
  });

  it('não grava nada', () => {
    expect(SQL).not.toContain('INSERT INTO');
    expect(SQL).not.toContain('UPDATE public');
  });
});
