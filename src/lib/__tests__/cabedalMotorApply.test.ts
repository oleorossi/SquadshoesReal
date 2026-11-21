import { describe, expect, it } from 'vitest';
import { allocateStock, decideRelease, DEFAULT_MOTOR_SETTINGS, suggestPurchases, type PlanDemand } from '@/lib/cabedalPlanningMotor';
import { corteReleasedByMotor, motorQueueRank, planFromMotorSnapshot, planMotorApply } from '@/lib/cabedalMotorApply';

function item(partial: Partial<PlanDemand> & Pick<PlanDemand, 'itemId' | 'orderNumber'>): PlanDemand {
  return {
    saleOrderId: partial.itemId,
    orderType: 'programado',
    billingWeek: '2026-06-S1',
    referenceCode: 'SR01',
    color: 'PRETO',
    pairs: 10,
    assemblyCapacityPerDay: 100,
    prepBusinessDays: 8,
    explicitComplex: true,
    cabedalReceived: false,
    closeScore: 0.2,
    isPinned: false,
    isFrozen: false,
    pinnedPosition: null,
    frozenPosition: null,
    protected: false,
    materials: [{
      productId: 'napa',
      productName: 'NAPA',
      unit: 'm',
      required: 10,
      unitPrice: 5,
      supplierId: 'forn',
      supplierName: 'Fornecedor',
      supplierLeadDays: 10,
      protectedHeld: 0,
    }],
    ...partial,
  };
}

const settings = { ...DEFAULT_MOTOR_SETTINGS, enabled: true };
const off = { ...DEFAULT_MOTOR_SETTINGS, enabled: false };

describe('motor desligado não grava', () => {
  const items = [
    item({ itemId: 'a', orderNumber: 'PV-A' }),
    item({ itemId: 'u', orderNumber: 'PV-U', orderType: 'urgente', prepBusinessDays: 0, explicitComplex: false }),
  ];
  const allocation = allocateStock(items, [{ productId: 'napa', free: 4 }], settings);
  const purchases = suggestPurchases(items, allocation, settings, '2026-11-19');

  it('o plano de OC, reserva e trava fica vazio', () => {
    const plan = planMotorApply({
      enabled: false,
      items,
      allocation,
      purchases,
      settings: off,
      todayIso: '2026-11-19',
    });
    expect(plan.purchases).toEqual([]);
    expect(plan.reservations).toEqual([]);
    expect(plan.holds).toEqual([]);
    expect(motorQueueRank('urgente', false)).toBe(motorQueueRank('programado', false));
    expect(corteReleasedByMotor({ enabled: false, departureOn: '2026-11-01', todayIso: '2026-11-19' })).toBe(false);
  });

  it('ligado separa OC por fornecedor e mês, e não mexe no PV-00249', () => {
    const plan = planMotorApply({
      enabled: true,
      items: [...items, item({ itemId: 'legado', orderNumber: 'PV-00249' })],
      allocation,
      purchases,
      settings,
      todayIso: '2026-11-19',
    });
    expect(plan.purchases.length).toBeGreaterThan(0);
    expect(plan.purchases.every((group) => group.lines.every((line) => line.status === 'liberada'))).toBe(true);
    expect(plan.reservations.some((row) => row.saleOrderItemId === 'legado')).toBe(false);
    expect(plan.holds.some((row) => row.status === 'aguardando_material' || row.status === 'aguardando_cabedal')).toBe(true);
    expect(decideRelease(items, allocation, off).find((row) => row.itemId === 'u')?.status).not.toBe('liberado');
  });

  it('o snapshot com a chave desligada também não gera plano', () => {
    const plan = planFromMotorSnapshot({
      motor_enabled: false,
      items: [{
        sale_order_id: 'pv',
        order_number: 'PV-A',
        order_type: 'urgente',
        billing_week: '2026-06-S1',
        item_id: 'a',
        reference_code: 'SR01',
        color: 'PRETO',
        pairs: 10,
        assembly_capacity_per_day: 100,
        prep_business_days: 8,
        explicit_complex: true,
        materials: [{
          product_id: 'napa',
          product_name: 'NAPA',
          unit: 'm',
          required: 10,
          unit_price: 5,
          supplier_id: 'forn',
          supplier_name: 'Fornecedor',
          supplier_lead_days: 10,
        }],
      }],
      stock: [{ product_id: 'napa', free: 0 }],
    }, '2026-11-19');
    expect(plan.purchases).toEqual([]);
    expect(plan.reservations).toEqual([]);
    expect(plan.holds).toEqual([]);
  });

  it('urgente fica na frente só com a chave ligada, e o corte espera a data de saída', () => {
    expect(motorQueueRank('urgente', true)).toBeLessThan(motorQueueRank('programado', true));
    expect(corteReleasedByMotor({ enabled: true, departureOn: '2026-11-20', todayIso: '2026-11-19' })).toBe(false);
    expect(corteReleasedByMotor({ enabled: true, departureOn: '2026-11-19', todayIso: '2026-11-19' })).toBe(true);
  });
});
