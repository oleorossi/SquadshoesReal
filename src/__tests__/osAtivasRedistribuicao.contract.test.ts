import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync('supabase/migrations/20270101050100_os_ativas_redistribuicao.sql', 'utf8');

describe('OS ativas e redistribuição', () => {
  it('devolve o kit sem produção, sem conta, e guarda o histórico', () => {
    expect(SQL).toContain("'unproduced_return'");
    expect(SQL).toContain('Devolução sem produção');
    expect(SQL).toContain('A soma dos destinos não fecha o total que sai da OS');
    expect(SQL).toContain('service_order_redistributions');
    expect(SQL).toContain('Redistribuição não se altera nem se apaga');
    expect(SQL).toContain('ENABLE ROW LEVEL SECURITY');
    expect(SQL).toContain('REVOKE ALL ON public.service_order_redistributions FROM PUBLIC, anon, authenticated');
    expect(SQL).toContain('adjust_undue_service_order_payable');
    expect(SQL).toContain('unproduced_return');
    expect(SQL).not.toContain('PV-00249');
    expect(SQL).not.toMatch(/INSERT INTO public\.contractors/);
    expect(SQL).not.toMatch(/UPDATE public\.products/);
  });

  it('a rua cai e o recebido de produção não conta a devolução sem produção', () => {
    expect(SQL).toContain("adjustment_kind IN ('scrap', 'unproduced_return')");
    expect(SQL).toContain('b.good + b.defect + b.loss + b.unproduced');
  });

  it('o painel fica em Terceirizados', () => {
    const hub = readFileSync('src/pages/TerceirizadosHub.tsx', 'utf8');
    expect(hub).toContain('os-ativas');
    expect(hub).toContain('OsAtivasPanel');
    expect(hub).toContain('OsRedistribuicaoHistorico');
  });
});
