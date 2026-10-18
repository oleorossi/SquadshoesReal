import { describe, expect, it } from 'vitest';
import {
  aggregateMaterialPendencias,
  billingWeekSortKey,
  comparePendenciaPv,
  filterPendenciaRows,
  type PendenciaPvMeta,
} from '@/lib/materialPendenciaReport';
import type { SaleOrderMaterialShortageInfo } from '@/hooks/useSaleOrderMaterialShortages';

describe('materialPendenciaReport', () => {
  it('ordena billing_week pela data mais próxima', () => {
    expect(billingWeekSortKey('2026-05-S1') < billingWeekSortKey('2026-05-S4')).toBe(true);
    expect(billingWeekSortKey(null)).toBe('9999-99-99');
  });

  it('agrega quantity_short por product_id e ordena PVs por faturamento', () => {
    const shortages = new Map<string, SaleOrderMaterialShortageInfo>([
      ['pv-b', {
        orderNumber: 'PV-002',
        managedLines: 1,
        shortLines: 1,
        shortages: [{
          product_id: 'mat-1',
          product_name: 'NAPA PRETO',
          color: 'PRETO',
          unit: 'm',
          quantity_short: 3,
          shortage_grade: null,
        }],
      }],
      ['pv-a', {
        orderNumber: 'PV-001',
        managedLines: 1,
        shortLines: 1,
        shortages: [{
          product_id: 'mat-1',
          product_name: 'NAPA PRETO',
          color: 'PRETO',
          unit: 'm',
          quantity_short: 5,
          shortage_grade: null,
        }],
      }],
    ]);
    const meta = new Map<string, PendenciaPvMeta>([
      ['pv-a', {
        id: 'pv-a',
        orderNumber: 'PV-001',
        clientName: 'Loja A',
        billingWeek: '2026-05-S4',
        deliveryDeadline: '2026-05-30',
        status: 'Aprovado',
      }],
      ['pv-b', {
        id: 'pv-b',
        orderNumber: 'PV-002',
        clientName: 'Loja B',
        billingWeek: '2026-05-S1',
        deliveryDeadline: '2026-05-10',
        status: 'Em Produção',
      }],
    ]);

    const rows = aggregateMaterialPendencias(shortages, meta, new Map([['mat-1', 2]]));
    expect(rows).toHaveLength(1);
    expect(rows[0].quantityShort).toBe(8);
    expect(rows[0].pvCount).toBe(2);
    expect(rows[0].emCompra).toBe(2);
    expect(rows[0].pvs.map((p) => p.orderNumber)).toEqual(['PV-002', 'PV-001']);
  });

  it('filtra por busca e cobertura de OC', () => {
    const rows = aggregateMaterialPendencias(
      new Map([
        ['pv-1', {
          orderNumber: 'PV-010',
          managedLines: 1,
          shortLines: 1,
          shortages: [{
            product_id: 'a',
            product_name: 'NAPA SOFT',
            color: 'OFF WHITE',
            unit: 'm',
            quantity_short: 10,
            shortage_grade: null,
          }],
        }],
      ]),
      new Map([['pv-1', {
        id: 'pv-1',
        orderNumber: 'PV-010',
        clientName: 'Cliente',
        billingWeek: null,
        deliveryDeadline: null,
        status: 'Aprovado',
      }]]),
      new Map([['a', 4]]),
    );

    expect(filterPendenciaRows(rows, { search: 'soft' })).toHaveLength(1);
    expect(filterPendenciaRows(rows, { search: 'rosa' })).toHaveLength(0);
    expect(filterPendenciaRows(rows, { coverage: 'em_compra' })).toHaveLength(1);
    expect(filterPendenciaRows(rows, { coverage: 'sem_oc' })).toHaveLength(0);
  });

  it('comparePendenciaPv prioriza faturamento antes do prazo', () => {
    const earlier = {
      saleOrderId: '1',
      orderNumber: 'PV-1',
      clientName: null,
      billingWeek: '2026-04-S2',
      deliveryDeadline: '2026-12-01',
      quantityShort: 1,
      shortageGrade: null,
      unit: 'm',
    };
    const later = {
      ...earlier,
      saleOrderId: '2',
      orderNumber: 'PV-2',
      billingWeek: '2026-05-S1',
      deliveryDeadline: '2026-05-01',
    };
    expect(comparePendenciaPv(earlier, later)).toBeLessThan(0);
  });
});
