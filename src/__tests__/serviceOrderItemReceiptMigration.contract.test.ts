import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SQL = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20270101000800_recebimento-parcial-os-por-item.sql'),
  'utf8',
);

describe('recebimento parcial de OS por item — contrato SQL', () => {
  it('mantém o retorno agregado e adiciona um ledger imutável por item', () => {
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS public\.service_order_return_items/);
    expect(SQL).toMatch(/REFERENCES public\.service_order_returns\(id\) ON DELETE CASCADE/);
    expect(SQL).toMatch(/CONSTRAINT uq_so_return_item UNIQUE/);
    expect(SQL).not.toMatch(/GRANT (?:INSERT|ALL)[^;]*TO authenticated/i);
  });

  it('registra cabeçalho e linhas na mesma função transacional', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.register_service_order_return/);
    expect(SQL).toMatch(/INSERT INTO public\.service_order_returns/);
    expect(SQL).toMatch(/INSERT INTO public\.service_order_return_items/);
    expect(SQL).toMatch(/A soma dos itens não confere com o resumo do retorno/);
  });

  it('preserva o financeiro por pares bons e acrescenta rastreabilidade dos itens', () => {
    expect(SQL).toMatch(/UPDATE public\.accounts_payable/);
    expect(SQL).toMatch(/Itens recebidos:/);
    expect(SQL).toMatch(/UPDATE public\.service_order_events/);
  });

  it('não inventa item para retornos legados sem rateio', () => {
    expect(SQL).toMatch(/unallocated_return_qty/);
    expect(SQL).toMatch(/rt\.quantity - at\.quantity/);
  });
});
