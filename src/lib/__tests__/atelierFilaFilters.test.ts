import { describe, expect, it } from 'vitest';
import {
  EMPTY_ATELIER_FILA_FILTERS,
  collectFilaFilterOptions,
  matchesAtelierFilaFilters,
  normalizeFilaText,
} from '@/lib/atelierFilaFilters';

describe('atelierFilaFilters', () => {
  const lotSp301 = {
    color: 'ROCHA',
    orders: [
      { order_number: 'PV-00237', pairs: 360 },
      { order_number: 'PV-00240', pairs: 120 },
    ],
  };
  const lotNewIsc = {
    color: 'NEW WHISKY',
    orders: [{ order_number: 'PV-00237', pairs: 360 }],
  };
  const lotOther = {
    color: 'PRETO',
    orders: [{ order_number: 'PV-00241', pairs: 48 }],
  };

  it('filtra por pedido — lote com vários PVs aparece só se contém o PV', () => {
    expect(
      matchesAtelierFilaFilters(lotSp301, { ...EMPTY_ATELIER_FILA_FILTERS, orderNumber: 'PV-00237' }),
    ).toBe(true);
    expect(
      matchesAtelierFilaFilters(lotSp301, { ...EMPTY_ATELIER_FILA_FILTERS, orderNumber: 'PV-00241' }),
    ).toBe(false);
    expect(
      matchesAtelierFilaFilters(lotOther, { ...EMPTY_ATELIER_FILA_FILTERS, orderNumber: 'PV-00241' }),
    ).toBe(true);
  });

  it('filtra por cor entre referências (sem acento / caixa)', () => {
    expect(normalizeFilaText('New Whisky')).toBe('new whisky');
    expect(
      matchesAtelierFilaFilters(lotNewIsc, { ...EMPTY_ATELIER_FILA_FILTERS, color: 'new whisky' }),
    ).toBe(true);
    expect(
      matchesAtelierFilaFilters(lotNewIsc, { ...EMPTY_ATELIER_FILA_FILTERS, color: 'whisky' }),
    ).toBe(true);
    expect(
      matchesAtelierFilaFilters(lotSp301, { ...EMPTY_ATELIER_FILA_FILTERS, color: 'new whisky' }),
    ).toBe(false);
  });

  it('filtro de cor lista todas as refs da mesma cor (ex. New ISC)', () => {
    const a = { color: 'NEW ISC', orders: [{ order_number: 'PV-001' }] };
    const b = { color: 'NEW ISC', orders: [{ order_number: 'PV-002' }] };
    const c = { color: 'ROCHA', orders: [{ order_number: 'PV-001' }] };
    const f = { ...EMPTY_ATELIER_FILA_FILTERS, color: 'New ISC' };
    expect([a, b, c].filter((lot) => matchesAtelierFilaFilters(lot, f))).toEqual([a, b]);
  });

  it('combina pedido + cor', () => {
    expect(
      matchesAtelierFilaFilters(lotNewIsc, {
        orderNumber: 'PV-00237',
        color: 'NEW WHISKY',
      }),
    ).toBe(true);
    expect(
      matchesAtelierFilaFilters(lotNewIsc, {
        orderNumber: 'PV-00240',
        color: 'NEW WHISKY',
      }),
    ).toBe(false);
  });

  it('coleta opções únicas de PV e cor', () => {
    const opts = collectFilaFilterOptions([lotSp301, lotNewIsc, lotOther]);
    expect(opts.orderNumbers).toEqual(['PV-00237', 'PV-00240', 'PV-00241']);
    expect(opts.colors).toContain('ROCHA');
    expect(opts.colors).toContain('NEW WHISKY');
    expect(opts.colors).toContain('PRETO');
  });
});
