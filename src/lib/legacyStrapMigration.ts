const SCALE_DIGITS = 9;
const SCALE = 1_000_000_000n;

export interface LegacyStrapAllocationDraft {
  variantId: string;
  quantity: string;
}

export interface LegacyStrapProductAllocationInput {
  strap_variant_id: string;
  quantity: string;
  reserved_stock: string;
  reservation_ids: string[];
  purchase_order_item_ids: string[];
  service_order_item_ids: string[];
}

export interface LegacyStrapReservationBalance {
  id: string;
  remainingReserved: string | number;
}

export interface BuildLegacyStrapAllocationInput {
  expectedQuantity: string | number;
  expectedReservedStock: string | number;
  allocations: LegacyStrapAllocationDraft[];
  reservations: LegacyStrapReservationBalance[];
  assignablePurchaseItemIds: string[];
  serviceOrderItemIds: string[];
  reservationAssignments: Record<string, string>;
  purchaseAssignments: Record<string, string>;
  serviceAssignments: Record<string, string>;
}

/**
 * Documento congelado só deixa de bloquear quando não há remapeamento: uma
 * única alocação aponta de volta para o próprio produto legado. Nesse caso os
 * IDs imutáveis ficam fora do payload e o servidor apenas conserva o vínculo.
 */
export function isLegacySelfTargetAllocation(
  legacyProductId: string,
  targetProductIds: string[],
) {
  return targetProductIds.length === 1 && targetProductIds[0] === legacyProductId;
}

function decimalText(value: string | number): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Quantidade não numérica.');
    return value.toFixed(SCALE_DIGITS);
  }
  return value.trim().replace(',', '.');
}

export function decimalToMigrationUnits(value: string | number): bigint {
  const text = decimalText(value);
  const match = text.match(/^(\d+)(?:\.(\d{0,9}))?$/);
  if (!match) throw new Error('Use quantidade positiva com até 9 casas decimais.');
  const integer = BigInt(match[1]);
  const fraction = BigInt((match[2] || '').padEnd(SCALE_DIGITS, '0'));
  return integer * SCALE + fraction;
}

export function migrationUnitsToDecimal(value: bigint): string {
  const integer = value / SCALE;
  const fraction = String(value % SCALE).padStart(SCALE_DIGITS, '0').replace(/0+$/, '');
  return fraction ? `${integer}.${fraction}` : String(integer);
}

function assertEveryAssignment(
  ids: string[],
  assignments: Record<string, string>,
  variantIds: Set<string>,
  label: string,
) {
  const missing = ids.filter((id) => !variantIds.has(assignments[id]));
  if (missing.length > 0) {
    throw new Error(`Atribua ${label} a uma das variantes selecionadas (${missing.length} pendente(s)).`);
  }
}

/**
 * Monta o payload nominal exigido pelo RPC 03300. Reserved stock nunca é
 * digitado: deriva exatamente da soma de remaining_reserved das reservas
 * atribuídas àquela variante.
 */
export function buildLegacyStrapProductAllocations(
  input: BuildLegacyStrapAllocationInput,
): LegacyStrapProductAllocationInput[] {
  if (input.allocations.length === 0) throw new Error('Adicione ao menos uma variante de destino.');
  const variantIds = input.allocations.map((allocation) => allocation.variantId).filter(Boolean);
  if (variantIds.length !== input.allocations.length) throw new Error('Selecione a variante exata em todas as linhas.');
  if (new Set(variantIds).size !== variantIds.length) throw new Error('A mesma variante não pode aparecer duas vezes no rateio.');
  const allowedVariants = new Set(variantIds);

  const quantityUnits = input.allocations.map((allocation) => decimalToMigrationUnits(allocation.quantity));
  const allocatedQuantity = quantityUnits.reduce((sum, quantity) => sum + quantity, 0n);
  if (allocatedQuantity !== decimalToMigrationUnits(input.expectedQuantity)) {
    throw new Error('A soma das quantidades por variante deve ser exatamente igual ao saldo legado.');
  }

  const reservationIds = input.reservations.map((reservation) => reservation.id);
  assertEveryAssignment(reservationIds, input.reservationAssignments, allowedVariants, 'todas as reservas abertas');
  assertEveryAssignment(input.assignablePurchaseItemIds, input.purchaseAssignments, allowedVariants, 'todos os itens de OC atribuíveis');
  assertEveryAssignment(input.serviceOrderItemIds, input.serviceAssignments, allowedVariants, 'todas as linhas de OS abertas');

  const reservationBalance = new Map(input.reservations.map((reservation) => [
    reservation.id,
    decimalToMigrationUnits(reservation.remainingReserved),
  ]));
  const openReserved = [...reservationBalance.values()].reduce((sum, quantity) => sum + quantity, 0n);
  if (openReserved !== decimalToMigrationUnits(input.expectedReservedStock)) {
    throw new Error('O reservado do produto não confere com as linhas de reserva abertas; corrija o bloqueio antes do rateio.');
  }

  return input.allocations.map((allocation, index) => {
    const assignedReservationIds = reservationIds
      .filter((id) => input.reservationAssignments[id] === allocation.variantId)
      .sort();
    const reservedUnits = assignedReservationIds.reduce(
      (sum, id) => sum + (reservationBalance.get(id) || 0n),
      0n,
    );
    return {
      strap_variant_id: allocation.variantId,
      quantity: migrationUnitsToDecimal(quantityUnits[index]),
      reserved_stock: migrationUnitsToDecimal(reservedUnits),
      reservation_ids: assignedReservationIds,
      purchase_order_item_ids: input.assignablePurchaseItemIds
        .filter((id) => input.purchaseAssignments[id] === allocation.variantId)
        .sort(),
      service_order_item_ids: input.serviceOrderItemIds
        .filter((id) => input.serviceAssignments[id] === allocation.variantId)
        .sort(),
    };
  });
}
