import { describe, expect, it } from 'vitest';
import { invoiceSummaryPeriod, summarizeIncomingInvoices, summarizeOutgoingInvoices } from '@/lib/invoiceSummary';

describe('resumo documental do financeiro', () => {
  it('soma entradas importadas em centavos e exclui estados não efetivados', () => {
    expect(summarizeIncomingInvoices([
      { status: 'imported', total_value: '0.10' },
      { status: 'imported', total_value: 0.2 },
      { status: 'cancelled', total_value: 900 },
      { status: 'draft', total_value: 800 },
    ])).toEqual({ count: 2, total: 0.3 });
  });

  it('não mistura rejeições, cancelamentos e homologação com saídas autorizadas', () => {
    expect(summarizeOutgoingInvoices([
      { status: 'autorizada', valor_total: 123.45, tp_amb_sefaz: '1' },
      { status: 'autorizada', valor_total: '10.55', tp_amb_sefaz: null },
      { status: 'autorizada', valor_total: 9999, tp_amb_sefaz: '2' },
      { status: 'cancelada', valor_total: 9999, tp_amb_sefaz: '1' },
      { status: 'rejeitada', valor_total: 9999, tp_amb_sefaz: '1' },
      { status: 'erro', valor_total: 9999, tp_amb_sefaz: null },
      { status: 'processando', valor_total: 9999, tp_amb_sefaz: '1' },
      { status: 'rejeitada', valor_total: 9999, tp_amb_sefaz: '2' },
    ])).toEqual({ count: 2, total: 134, processing: 1, failed: 2, unknownEnvironment: 1 });
  });

  it('um período consultado sem notas é zero real, não dado de demonstração', () => {
    expect(summarizeIncomingInvoices([])).toEqual({ count: 0, total: 0 });
    expect(summarizeOutgoingInvoices([])).toEqual({ count: 0, total: 0, processing: 0, failed: 0, unknownEnvironment: 0 });
  });

  it.each(['', 'não numérico', -1, Infinity, Number.MAX_SAFE_INTEGER])('não transforma valor inválido %s em zero', value => {
    expect(() => summarizeIncomingInvoices([{ status: 'imported', total_value: value }])).toThrow();
    expect(() => summarizeOutgoingInvoices([{ status: 'autorizada', valor_total: value, tp_amb_sefaz: '1' }])).toThrow();
  });

  it.each([null, undefined, false])('recusa valor ausente ou não numérico %s recebido em runtime', value => {
    expect(() => summarizeIncomingInvoices([{ status: 'imported', total_value: value as unknown as number }])).toThrow();
  });

  it('valida limites mensais, virada do ano e fevereiro bissexto', () => {
    expect(invoiceSummaryPeriod('2026-12')).toMatchObject({ startDate: '2026-12-01', endDateExclusive: '2027-01-01' });
    expect(invoiceSummaryPeriod('2024-02')).toMatchObject({ startDate: '2024-02-01', endDateExclusive: '2024-03-01' });
    const range = invoiceSummaryPeriod('2026-09');
    expect(new Date(range.startTimestamp).getDate()).toBe(1);
    expect(new Date(range.startTimestamp).getHours()).toBe(0);
    expect(new Date(range.endTimestampExclusive).getMonth()).toBe(9);
  });

  it.each(['', '2026-00', '2026-13', '2026-9', '2026-09-01', '0000-01'])('rejeita período inválido %s', month => {
    expect(() => invoiceSummaryPeriod(month)).toThrow('mês válido');
  });
});
