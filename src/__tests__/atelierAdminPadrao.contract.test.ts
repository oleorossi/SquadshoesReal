import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync(
  'supabase/migrations/20270101047500_atelier_admin_padrao_prestador.sql',
  'utf8',
);

describe('Ateliê — padrão da ficha e setor do prestador', () => {
  it('grava o padrão na ficha e não reescreve jobs já criados', () => {
    expect(SQL).toContain('default_execution_mode');
    expect(SQL).toContain('default_contractor_id');
    expect(SQL).toContain('FUNCTION public.atelier_set_reference_execution_default');
    expect(SQL).toContain('Não altera jobs já criados');
    const sync = SQL.slice(SQL.indexOf('FUNCTION public.atelier_sync_jobs_for_demand'));
    expect(sync).toContain('v_sheet_mode');
    expect(sync).toContain('atelier_contractor_can_take');
    expect(sync).not.toContain('execution_mode = COALESCE');
    expect(sync).not.toContain('execution_mode = EXCLUDED');
  });

  it('prestador de fábrica e inativo não entram', () => {
    const gate = SQL.slice(SQL.indexOf('FUNCTION public.atelier_contractor_can_take'));
    expect(gate).toContain('c.active IS TRUE');
    expect(gate).toContain('COALESCE(c.payment_days, 0) < 999');
    expect(gate).toContain('s.active');
  });

  it('envio novo passa pelo gatilho, sem criar ordem de serviço', () => {
    expect(SQL).toContain('trg_atelier_contractor_can_receive');
    expect(SQL).toContain('Este prestador não recebe remessa deste setor');
    expect(SQL).not.toContain('INSERT INTO public.service_orders');
  });
});
