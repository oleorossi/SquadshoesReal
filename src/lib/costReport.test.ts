import { describe, it, expect } from 'vitest';
import {
  CostReportRow,
  summarizeRows,
  groupByProvider,
  groupByMonth,
  filterRowsByPeriod,
  inDateRange,
  rowDateForBasis,
  slugForFilename,
} from './costReport';
import { buildCostReportDoc } from './costReportPdf';

function row(p: Partial<CostReportRow>): CostReportRow {
  return {
    id: p.id || Math.random().toString(36).slice(2),
    number: p.number || 'OC-0001',
    provider: p.provider || 'Fornecedor A',
    description: p.description || 'Item',
    total: p.total ?? 100,
    createdAt: p.createdAt || '2026-05-10T12:00:00.000Z',
    date: p.date || '2026-05-10',
    dueDate: p.dueDate === undefined ? '2026-06-10' : p.dueDate,
    status: p.status || 'pending',
    statusLabel: p.statusLabel || 'Pendente',
    isPaid: p.isPaid ?? false,
    isCancelled: p.isCancelled ?? false,
  };
}

describe('summarizeRows', () => {
  it('soma total, pago e a pagar (cancelada não conta)', () => {
    const rows = [
      row({ total: 100, isPaid: true }),
      row({ total: 200, isPaid: false }),
      row({ total: 999, isCancelled: true }), // ignorada
    ];
    const s = summarizeRows(rows);
    expect(s.total).toBe(300);
    expect(s.paid).toBe(100);
    expect(s.pending).toBe(200);
    expect(s.count).toBe(2);
    expect(s.rowCount).toBe(3);
    expect(s.avgTicket).toBe(150);
    expect(s.paidPct).toBeCloseTo(33.333, 2);
  });

  it('invariante: pago + a pagar == total', () => {
    const rows = [
      row({ total: 123.45, isPaid: true }),
      row({ total: 67.89, isPaid: false }),
      row({ total: 10, isPaid: true }),
    ];
    const s = summarizeRows(rows);
    expect(s.paid + s.pending).toBeCloseTo(s.total, 6);
  });

  it('lista vazia → zeros sem divisão por zero', () => {
    const s = summarizeRows([]);
    expect(s.total).toBe(0);
    expect(s.avgTicket).toBe(0);
    expect(s.paidPct).toBe(0);
  });
});

describe('groupByProvider', () => {
  it('agrupa e ordena por total desc', () => {
    const rows = [
      row({ provider: 'A', total: 100, isPaid: true }),
      row({ provider: 'B', total: 500, isPaid: false }),
      row({ provider: 'A', total: 50, isPaid: false }),
      row({ provider: 'C', total: 9, isCancelled: true }),
    ];
    const g = groupByProvider(rows);
    expect(g.map((x) => x.provider)).toEqual(['B', 'A']); // C cancelada some
    expect(g[0]).toMatchObject({ provider: 'B', count: 1, total: 500, paid: 0, pending: 500 });
    expect(g[1]).toMatchObject({ provider: 'A', count: 2, total: 150, paid: 100, pending: 50 });
  });
});

describe('groupByMonth', () => {
  it('quebra por mês usando a base de criação', () => {
    const rows = [
      row({ createdAt: '2026-05-01T00:00:00Z', total: 100, isPaid: true }),
      row({ createdAt: '2026-05-20T00:00:00Z', total: 200, isPaid: false }),
      row({ createdAt: '2026-06-02T00:00:00Z', total: 300, isPaid: false }),
    ];
    const g = groupByMonth(rows, 'criacao');
    expect(g.map((x) => x.month)).toEqual(['2026-05', '2026-06']);
    expect(g[0]).toMatchObject({ count: 2, total: 300, paid: 100, pending: 200 });
    expect(g[1]).toMatchObject({ count: 1, total: 300 });
  });

  it('base vencimento usa dueDate', () => {
    const rows = [
      row({ createdAt: '2026-05-01T00:00:00Z', dueDate: '2026-07-15', total: 100 }),
    ];
    const g = groupByMonth(rows, 'vencimento');
    expect(g[0].month).toBe('2026-07');
  });
});

describe('filtro de período', () => {
  it('inDateRange respeita limites inclusivos', () => {
    expect(inDateRange('2026-05-10', '2026-05-01', '2026-05-31')).toBe(true);
    expect(inDateRange('2026-05-10', '2026-05-11', null)).toBe(false);
    expect(inDateRange('2026-05-10', null, '2026-05-09')).toBe(false);
    expect(inDateRange('2026-05-10', null, null)).toBe(true);
  });

  it('rowDateForBasis cai pra criação quando não há vencimento', () => {
    const r = row({ createdAt: '2026-05-10T00:00:00Z', dueDate: null });
    expect(rowDateForBasis(r, 'vencimento')).toBe('2026-05-10');
    expect(rowDateForBasis(r, 'criacao')).toBe('2026-05-10');
  });

  it('filterRowsByPeriod filtra por vencimento', () => {
    const rows = [
      row({ number: 'A', dueDate: '2026-06-10' }),
      row({ number: 'B', dueDate: '2026-08-10' }),
    ];
    const out = filterRowsByPeriod(rows, '2026-06-01', '2026-06-30', 'vencimento');
    expect(out.map((r) => r.number)).toEqual(['A']);
  });
});

describe('slugForFilename', () => {
  it('remove acentos, espaços e barras', () => {
    expect(slugForFilename('Calçados São João / Ltda')).toBe('calcados-sao-joao-ltda');
    expect(slugForFilename('')).toBe('todos');
  });
});

describe('buildCostReportDoc (smoke)', () => {
  it('gera PDF não-vazio e resumo correto pras 3 linhas-fixture', () => {
    const rows = [
      row({ number: 'OC-1', provider: 'A', total: 100, isPaid: true, createdAt: '2026-05-01T00:00:00Z' }),
      row({ number: 'OC-2', provider: 'B', total: 200, isPaid: false, createdAt: '2026-05-15T00:00:00Z' }),
      row({ number: 'OC-3', provider: 'A', total: 300, isPaid: false, createdAt: '2026-06-01T00:00:00Z' }),
    ];
    const { doc, summary, filename } = buildCostReportDoc({
      kind: 'OC',
      rows,
      period: { from: '2026-05-01', to: '2026-06-30' },
      basis: 'criacao',
      providerName: null,
      generatedBy: 'Tester',
      scope: 'filtro',
      generatedAt: '2026-06-20T10:00:00.000Z',
    });
    // Resumo correto
    expect(summary.total).toBe(600);
    expect(summary.paid).toBe(100);
    expect(summary.pending).toBe(500);
    expect(summary.count).toBe(3);
    // PDF de fato produzido
    const buf = doc.output('arraybuffer');
    expect(buf.byteLength).toBeGreaterThan(1000);
    expect(filename).toBe('relatorio-oc-todos-20260501-20260630.pdf');
  });
});
