import { describe, expect, it } from 'vitest';
import {
  FIRM_HORIZON_WEEKS,
  buildCalendarWeeks,
  buildMonthlyEvalRows,
  buildProjectionRow,
  cashTotalsByBuyWeek,
  computeQtyNet,
  filterRowsForHorizon,
  isOpenPoStatus,
  quinzenaOfDate,
  resolvePurchasePrice,
  resolveUseAndBuyDates,
  startOfCalendarWeek,
  subtractCalendarDays,
  toLocalISODate,
  weekStartISO,
} from '@/lib/purchaseProjectionWeekly';

describe('purchaseProjectionWeekly — semana civil seg–dom', () => {
  it('startOfCalendarWeek volta para segunda', () => {
    // 2026-09-10 = quinta
    const thu = new Date(2026, 8, 10);
    const mon = startOfCalendarWeek(thu);
    expect(toLocalISODate(mon)).toBe('2026-09-07');
    expect(mon.getDay()).toBe(1);
  });

  it('domingo pertence à semana que começou na segunda anterior', () => {
    const sun = new Date(2026, 8, 13); // domingo
    expect(weekStartISO(sun)).toBe('2026-09-07');
  });

  it('buildCalendarWeeks marca allowsForecast só a partir da 5ª semana', () => {
    const weeks = buildCalendarWeeks(8, new Date(2026, 8, 10));
    expect(weeks).toHaveLength(8);
    expect(weeks[0].weekStart).toBe('2026-09-07');
    expect(weeks[0].allowsForecast).toBe(false);
    expect(weeks[FIRM_HORIZON_WEEKS - 1].allowsForecast).toBe(false);
    expect(weeks[FIRM_HORIZON_WEEKS].allowsForecast).toBe(true);
  });
});

describe('purchaseProjectionWeekly — uso × compra (lead time)', () => {
  it('R$ de caixa cai na semana de compra, não na de uso', () => {
    // Uso na semana de 21/09 (seg); lead 7 dias → compra 14/09 (semana 14/09)
    const row = buildProjectionRow({
      productId: 'p1',
      productName: 'NAPA',
      unit: 'm',
      qtyNet: 10,
      useDate: '2026-09-23',
      leadTimeDays: 7,
      purchasePrice: 5,
    });
    expect(row.useWeekStart).toBe('2026-09-21');
    expect(row.buyByDate).toBe('2026-09-16');
    expect(row.buyWeekStart).toBe('2026-09-14');
    expect(row.amountNeed).toBe(50);

    const cash = cashTotalsByBuyWeek([row]);
    expect(cash['2026-09-14']).toBe(50);
    expect(cash['2026-09-21']).toBeUndefined();
  });

  it('resolveUseAndBuyDates deriva buy a partir de use − lead', () => {
    const r = resolveUseAndBuyDates({
      useDate: '2026-09-20',
      leadTimeDays: 5,
    });
    expect(r.buyByDate).toBe(subtractCalendarDays('2026-09-20', 5));
    expect(r.leadTimeMissing).toBe(false);
  });
});

describe('purchaseProjectionWeekly — forecast só após 4 semanas', () => {
  it('exclui forecast nas primeiras 4 semanas do horizonte', () => {
    const weeks = buildCalendarWeeks(8, new Date(2026, 8, 7));
    const firm = buildProjectionRow({
      productId: 'a',
      productName: 'A',
      unit: 'm',
      qtyNet: 1,
      useDate: weeks[0].weekStart,
      buyByDate: weeks[0].weekStart,
      purchasePrice: 1,
      isForecast: false,
    });
    const forecastEarly = buildProjectionRow({
      productId: 'b',
      productName: 'B',
      unit: 'm',
      qtyNet: 1,
      useDate: weeks[1].weekStart,
      buyByDate: weeks[1].weekStart,
      purchasePrice: 1,
      isForecast: true,
    });
    const forecastLate = buildProjectionRow({
      productId: 'c',
      productName: 'C',
      unit: 'm',
      qtyNet: 1,
      useDate: weeks[5].weekStart,
      buyByDate: weeks[5].weekStart,
      purchasePrice: 1,
      isForecast: true,
    });
    const filtered = filterRowsForHorizon([firm, forecastEarly, forecastLate], weeks);
    expect(filtered.map((r) => r.productId).sort()).toEqual(['a', 'c']);
  });

  it('linha forecast não é selecionável', () => {
    const row = buildProjectionRow({
      productId: 'f',
      productName: 'F',
      unit: 'm',
      qtyNet: 5,
      useDate: '2026-10-20',
      buyByDate: '2026-10-13',
      purchasePrice: 2,
      isForecast: true,
    });
    expect(row.selectable).toBe(false);
  });
});

describe('purchaseProjectionWeekly — OC draft/cancelled e preço', () => {
  it('só status abertos contam como on-order', () => {
    expect(isOpenPoStatus('pending')).toBe(true);
    expect(isOpenPoStatus('approved')).toBe(true);
    expect(isOpenPoStatus('sent')).toBe(true);
    expect(isOpenPoStatus('parcial')).toBe(true);
    expect(isOpenPoStatus('draft')).toBe(false);
    expect(isOpenPoStatus('cancelled')).toBe(false);
  });

  it('líquido desconsidera onOrder de draft se não passado', () => {
    // Client só soma onOrder de status abertos antes de chamar computeQtyNet
    expect(computeQtyNet({ qtyGross: 100, availableNow: 20, qtyOnOrder: 0 })).toBe(80);
    expect(computeQtyNet({ qtyNet: 15 })).toBe(15);
  });

  it('sem purchase_price → R$ 0 + noPrice', () => {
    expect(resolvePurchasePrice(null).noPrice).toBe(true);
    expect(resolvePurchasePrice(0).noPrice).toBe(true);
    expect(resolvePurchasePrice(0).amount(10)).toBe(0);
    const row = buildProjectionRow({
      productId: 'x',
      productName: 'X',
      unit: 'm',
      qtyNet: 3,
      useDate: '2026-09-10',
      buyByDate: '2026-09-08',
      purchasePrice: null,
    });
    expect(row.noPrice).toBe(true);
    expect(row.amountNeed).toBe(0);
    expect(row.selectable).toBe(true);
  });
});

describe('purchaseProjectionWeekly — quinzena e mês', () => {
  it('quinzena 1 = dias 1–15; 2 = 16+', () => {
    expect(quinzenaOfDate('2026-09-01')).toBe(1);
    expect(quinzenaOfDate('2026-09-15')).toBe(1);
    expect(quinzenaOfDate('2026-09-16')).toBe(2);
    expect(quinzenaOfDate('2026-09-30')).toBe(2);
  });

  it('buildMonthlyEvalRows agrega gap e cobertura', () => {
    const rows = [
      buildProjectionRow({
        productId: 'p',
        productName: 'P',
        unit: 'm',
        qtyNet: 10,
        qtyOnOrder: 4,
        useDate: '2026-09-10',
        buyByDate: '2026-09-01',
        purchasePrice: 2,
      }),
    ];
    const monthly = buildMonthlyEvalRows(rows, { p: { qty: 3, brl: 6 } });
    expect(monthly).toHaveLength(1);
    expect(monthly[0].needQty).toBe(10);
    expect(monthly[0].needBrl).toBe(20);
    expect(monthly[0].receivedQty).toBe(3);
    expect(monthly[0].gap).toBe(7);
    expect(monthly[0].coveragePct).toBeGreaterThan(0);
  });
});
