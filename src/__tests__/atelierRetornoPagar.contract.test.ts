import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync(
  'supabase/migrations/20270101048100_atelier_retorno_vira_pagar.sql',
  'utf8',
);

describe('Ateliê — conferência vira retorno e conta a pagar', () => {
  it('usa o preço da linha e não cria título para interno', () => {
    expect(SQL).toContain('v_line.unit_price');
    expect(SQL).toContain("execution_mode = 'internal'");
    expect(SQL).toContain('service_order_return');
    expect(SQL).toContain("status = 'pending'");
  });

  it('estorno recusa título que saiu de pending e apaga o retorno', () => {
    expect(SQL).toContain('já não está em aberto');
    expect(SQL).toContain('DELETE FROM public.service_order_returns');
    expect(SQL).toContain('DELETE FROM public.accounts_payable');
  });

  it('dispara na conferência e no estorno, sem reescrever o livro de pares', () => {
    expect(SQL).toContain('trg_atelier_receipt_posts_os');
    expect(SQL).toContain('AFTER INSERT OR UPDATE OF reversed_at');
    expect(SQL).not.toContain('CREATE OR REPLACE FUNCTION public.register_atelier_job_receipt');
  });
});
