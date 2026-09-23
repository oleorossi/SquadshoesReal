import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CABEDAL_PREP_PO_SOURCE, cabedalLeadDaysBeforeBilling } from '@/lib/cabedalPrep';
import { isCabedalPrepPurchaseOrder } from '@/lib/perPvPurchasing';

const MIGRATION = 'supabase/migrations/20270101027600_cabedal_prep_motor.sql';
const OUTBOX = 'supabase/functions/process-sale-order-outbox/index.ts';
const HUB = 'src/pages/TerceirizadosHub.tsx';

describe('cabedal prep motor — contratos', () => {
  it('migration cria demandas, alocações, débitos e source_type cabedal_prep', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain('cabedal_prep_demands');
    expect(sql).toContain('cabedal_prep_allocations');
    expect(sql).toContain('cabedal_prep_stock_debits');
    expect(sql).toContain("'cabedal_prep'");
    expect(sql).toContain('process_cabedal_prep_purchase_shortages');
    expect(sql).toContain('generate_cabedal_prep_service_orders');
    expect(sql).toContain('cabedal_prep_product_already_debited');
  });

  it('outbox chama prep ANTES do canal per_pv', () => {
    const src = readFileSync(OUTBOX, 'utf8');
    const prep = src.indexOf('process_cabedal_prep_purchase_shortages');
    const perPv = src.indexOf('process_sale_order_purchase_shortages');
    expect(prep).toBeGreaterThan(-1);
    expect(perPv).toBeGreaterThan(prep);
  });

  it('hub expõe aba prep', () => {
    const hub = readFileSync(HUB, 'utf8');
    expect(hub).toContain('CabedalPrepPanel');
    expect(hub).toContain("'prep'");
  });

  it('predicado de OC e lead time canônicos', () => {
    expect(CABEDAL_PREP_PO_SOURCE).toBe('cabedal_prep');
    expect(isCabedalPrepPurchaseOrder({ source_type: 'cabedal_prep' })).toBe(true);
    expect(isCabedalPrepPurchaseOrder({ source_type: 'per_pv' })).toBe(false);
    expect(cabedalLeadDaysBeforeBilling(1200, 600)).toBe(3);
    expect(cabedalLeadDaysBeforeBilling(1200, 400)).toBe(4);
  });
});
