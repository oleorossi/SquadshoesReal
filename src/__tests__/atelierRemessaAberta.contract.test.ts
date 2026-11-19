import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync('supabase/migrations/20270101049600_atelie_remessa_aberta.sql', 'utf8');

describe('remessa aberta do Ateliê', () => {
  it('a OS que aceita remessa não conclui sozinha e a seguinte reaproveita a aberta', () => {
    expect(SQL).toContain('accepting_shipments boolean NOT NULL DEFAULT false');
    expect(SQL).toContain('NOT COALESCE(v_so.accepting_shipments, false)');
    expect(SQL).toContain('FUNCTION public.atelier_send_remessa');
    expect(SQL).toContain('FUNCTION public.atelier_close_shipments');
    expect(SQL).toContain('so.accepting_shipments');
    expect(SQL).toContain('O tamanho % passa do saldo');
    expect(SQL).toContain('A OS aberta não tem R$/par');
    expect(SQL).not.toContain('PV-00249');
    expect(SQL).not.toMatch(/UPDATE public\.products/);
  });
});
