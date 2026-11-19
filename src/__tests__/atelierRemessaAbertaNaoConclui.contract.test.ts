import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync(
  'supabase/migrations/20270101049800_atelie_remessa_aberta_nao_conclui.sql',
  'utf8',
);

describe('remessa aberta do Ateliê — conferência não fecha a OS', () => {
  it('o rollup ignora a conclusão enquanto a OS aceita remessa', () => {
    expect(SQL).toContain('FUNCTION public.tg_service_order_rollup');
    expect(SQL).toContain('COALESCE(accepting_shipments, false)');
    expect(SQL).toContain('AND NOT COALESCE(v_open, false)');
    expect(SQL).toContain('THEN \'Concluído\'');
    expect(SQL).not.toContain('PV-00249');
    expect(SQL).not.toMatch(/UPDATE public\.products/);
  });

  it('o estorno abate a linha da parte conferida, não a primeira do job', () => {
    const body = SQL.slice(SQL.indexOf('FUNCTION public.atelier_reverse_receipt_return'));
    const fn = body.slice(0, body.indexOf('REVOKE ALL ON FUNCTION public.atelier_reverse_receipt_return'));
    expect(fn).toContain('WHEN v_receipt.part_id IS NOT NULL THEN i.atelier_part_id = v_receipt.part_id');
    expect(fn).toContain('ELSE i.atelier_job_id = v_receipt.job_id');
    expect(fn).not.toContain('i.atelier_job_id = v_receipt.job_id OR i.atelier_part_id = v_receipt.part_id');
    expect(fn).toContain('adjustment_kind');
    expect(fn).toContain("'reversal'");
  });
});
