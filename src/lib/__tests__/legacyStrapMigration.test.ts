import { describe, expect, it } from 'vitest';
import {
  buildLegacyStrapProductAllocations,
  decimalToMigrationUnits,
  isLegacySelfTargetAllocation,
} from '@/lib/legacyStrapMigration';

const VARIANT_A = '11111111-1111-4111-8111-111111111111';
const VARIANT_B = '22222222-2222-4222-8222-222222222222';

function validInput() {
  return {
    expectedQuantity: 10,
    expectedReservedStock: 3,
    allocations: [
      { variantId: VARIANT_A, quantity: '4' },
      { variantId: VARIANT_B, quantity: '6' },
    ],
    reservations: [
      { id: 'reservation-a', remainingReserved: 2 },
      { id: 'reservation-b', remainingReserved: 1 },
    ],
    assignablePurchaseItemIds: ['purchase-a'],
    serviceOrderItemIds: ['service-a'],
    reservationAssignments: { 'reservation-a': VARIANT_A, 'reservation-b': VARIANT_B },
    purchaseAssignments: { 'purchase-a': VARIANT_B },
    serviceAssignments: { 'service-a': VARIANT_A },
  };
}

describe('legacyStrapMigration', () => {
  it('rateia saldo e calcula reservado apenas pelas reservas nominais', () => {
    expect(buildLegacyStrapProductAllocations(validInput())).toEqual([
      {
        strap_variant_id: VARIANT_A,
        quantity: '4',
        reserved_stock: '2',
        reservation_ids: ['reservation-a'],
        purchase_order_item_ids: [],
        service_order_item_ids: ['service-a'],
      },
      {
        strap_variant_id: VARIANT_B,
        quantity: '6',
        reserved_stock: '1',
        reservation_ids: ['reservation-b'],
        purchase_order_item_ids: ['purchase-a'],
        service_order_item_ids: [],
      },
    ]);
  });

  it('compara decimais exatamente em 9 casas, sem soma float', () => {
    expect(decimalToMigrationUnits('0,1') + decimalToMigrationUnits('0.2'))
      .toBe(decimalToMigrationUnits('0.3'));
    expect(() => buildLegacyStrapProductAllocations({
      ...validInput(),
      expectedQuantity: '0.3',
      allocations: [
        { variantId: VARIANT_A, quantity: '0.1' },
        { variantId: VARIANT_B, quantity: '0.2' },
      ],
    })).not.toThrow();
  });

  it('bloqueia soma divergente e documento sem variante', () => {
    expect(() => buildLegacyStrapProductAllocations({
      ...validInput(),
      allocations: [
        { variantId: VARIANT_A, quantity: '4' },
        { variantId: VARIANT_B, quantity: '5' },
      ],
    })).toThrow(/soma das quantidades/i);
    expect(() => buildLegacyStrapProductAllocations({
      ...validInput(),
      purchaseAssignments: {},
    })).toThrow(/itens de OC atribuíveis/i);
  });

  it('bloqueia reserved_stock sem lastro exato nas reservas abertas', () => {
    expect(() => buildLegacyStrapProductAllocations({
      ...validInput(),
      expectedReservedStock: 4,
    })).toThrow(/reservado do produto não confere/i);
  });

  it('só reconhece documento congelado como conservado numa alocação self-target', () => {
    const legacyProductId = '33333333-3333-4333-8333-333333333333';
    expect(isLegacySelfTargetAllocation(legacyProductId, [legacyProductId])).toBe(true);
    expect(isLegacySelfTargetAllocation(legacyProductId, [legacyProductId, legacyProductId])).toBe(false);
    expect(isLegacySelfTargetAllocation(legacyProductId, [VARIANT_A])).toBe(false);
  });
});
