import { describe, expect, it } from 'vitest';
import {
  EMPTY_ATELIER_REPORT_FILTERS,
  collectFilterOptions,
  matchesAtelierReportFilters,
  weekKeyFromDeadline,
} from '@/lib/atelierReportFilters';
import { atelierNextStreetOk, atelierBlocksKanbanPointing } from '@/lib/atelier';

describe('atelierReportFilters', () => {
  const row = {
    clientName: 'Loja Centro',
    deliveryDeadline: '2026-10-20',
    billingWeek: '2026-W42',
    color: 'PRETO',
    materialLabels: ['Cabedal', 'NAPA SOFT'],
  };

  it('filtra por cliente, cor, material, semana e prazo', () => {
    expect(matchesAtelierReportFilters(row, { ...EMPTY_ATELIER_REPORT_FILTERS, client: 'centro' })).toBe(true);
    expect(matchesAtelierReportFilters(row, { ...EMPTY_ATELIER_REPORT_FILTERS, client: 'norte' })).toBe(false);
    expect(matchesAtelierReportFilters(row, { ...EMPTY_ATELIER_REPORT_FILTERS, color: 'preto' })).toBe(true);
    expect(matchesAtelierReportFilters(row, { ...EMPTY_ATELIER_REPORT_FILTERS, material: 'napa' })).toBe(true);
    expect(matchesAtelierReportFilters(row, { ...EMPTY_ATELIER_REPORT_FILTERS, week: 'W42' })).toBe(true);
    expect(
      matchesAtelierReportFilters(row, {
        ...EMPTY_ATELIER_REPORT_FILTERS,
        dateFrom: '2026-10-21',
      }),
    ).toBe(false);
    expect(
      matchesAtelierReportFilters(row, {
        ...EMPTY_ATELIER_REPORT_FILTERS,
        dateFrom: '2026-10-01',
        dateTo: '2026-10-31',
      }),
    ).toBe(true);
  });

  it('coleta opções únicas', () => {
    const opts = collectFilterOptions([row, { ...row, color: 'OFF WHITE', clientName: 'Outra' }]);
    expect(opts.colors).toEqual(['OFF WHITE', 'PRETO']);
    expect(opts.clients).toContain('Loja Centro');
    expect(opts.materials).toContain('Cabedal');
  });

  it('deriva semana ISO da entrega', () => {
    expect(weekKeyFromDeadline('2026-10-15')).toMatch(/^2026-W\d{2}$/);
  });
});

describe('atelier street OK steps', () => {
  it('próximo OK: cortado → enviado → realizado → conferido', () => {
    expect(atelierNextStreetOk('cut')).toBe('sent_to_contractor');
    expect(atelierNextStreetOk('sent_to_contractor')).toBe('realized');
    expect(atelierNextStreetOk('realized')).toBe('received_at_factory');
    expect(atelierNextStreetOk('received_at_factory')).toBeNull();
  });

  it('Kanban bloqueia enquanto no prestador ou realizado', () => {
    expect(atelierBlocksKanbanPointing('sent_to_contractor')).toBe(true);
    expect(atelierBlocksKanbanPointing('realized')).toBe(true);
    expect(atelierBlocksKanbanPointing('received_at_factory')).toBe(false);
  });
});
