/**
 * O que o motor gravaria se a chave estivesse ligada.
 * Com enabled = false o plano sai vazio: nenhuma OC, reserva ou trava.
 */
import {
  allocateStock,
  decideRelease,
  DEFAULT_MOTOR_SETTINGS,
  isUrgentOrderType,
  planItemClock,
  selectionCanBecomePurchaseOrder,
  suggestPurchases,
  type AllocationResult,
  type MotorSettings,
  type PlanDemand,
  type PurchaseSuggestion,
  type ReleaseDecision,
} from '@/lib/cabedalPlanningMotor';

export interface MotorPurchaseGroup {
  supplierId: string | null;
  supplierName: string;
  groupKey: string;
  lines: PurchaseSuggestion[];
}

export interface MotorReservationMove {
  saleOrderItemId: string;
  productId: string;
  quantity: number;
}

export interface MotorHold {
  saleOrderItemId: string;
  status: ReleaseDecision['status'];
  reason: string;
  departureOn: string | null;
}

export interface MotorApplyPlan {
  purchases: MotorPurchaseGroup[];
  reservations: MotorReservationMove[];
  holds: MotorHold[];
}

const EMPTY: MotorApplyPlan = { purchases: [], reservations: [], holds: [] };

export function planMotorApply(input: {
  enabled: boolean;
  items: PlanDemand[];
  allocation: AllocationResult;
  purchases: PurchaseSuggestion[];
  settings: MotorSettings;
  todayIso: string;
}): MotorApplyPlan {
  if (!input.enabled) return EMPTY;
  return {
    purchases: purchaseGroups(input.purchases),
    reservations: reservationMoves(input.items, input.allocation),
    holds: holdsFor(input.items, input.allocation, input.settings, input.todayIso),
  };
}

function purchaseGroups(lines: PurchaseSuggestion[]): MotorPurchaseGroup[] {
  const buckets = new Map<string, PurchaseSuggestion[]>();
  for (const line of lines) {
    if (line.status !== 'liberada' || line.quantity <= 0) continue;
    const list = buckets.get(line.groupKey) ?? [];
    list.push(line);
    buckets.set(line.groupKey, list);
  }
  const groups: MotorPurchaseGroup[] = [];
  for (const [groupKey, rows] of buckets) {
    if (!selectionCanBecomePurchaseOrder(rows).ok) continue;
    if (mixesDistantDates(rows)) continue;
    groups.push({
      supplierId: rows[0].supplierId,
      supplierName: rows[0].supplierName,
      groupKey,
      lines: rows,
    });
  }
  return groups;
}

function mixesDistantDates(rows: PurchaseSuggestion[]): boolean {
  if (rows.every((row) => row.urgent)) return false;
  const months = new Set(rows.map((row) => (row.needDate ?? row.buyBy ?? '').slice(0, 7)).filter(Boolean));
  return months.size > 1;
}

function reservationMoves(items: PlanDemand[], allocation: AllocationResult): MotorReservationMove[] {
  const moves: MotorReservationMove[] = [];
  for (const line of allocation.lines) {
    const item = items.find((row) => row.itemId === line.itemId);
    if (!item || item.protected || item.isPinned || item.isFrozen) continue;
    if (line.orderNumber === 'PV-00249' || item.orderNumber === 'PV-00249') continue;
    moves.push({
      saleOrderItemId: line.itemId,
      productId: line.productId,
      quantity: Math.max(0, line.allocated),
    });
  }
  return moves;
}

function holdsFor(
  items: PlanDemand[],
  allocation: AllocationResult,
  settings: MotorSettings,
  todayIso: string,
): MotorHold[] {
  return decideRelease(items, allocation, settings)
    .filter((row) => row.status !== 'protegido')
    .filter((row) => row.orderNumber !== 'PV-00249')
    .map((row) => {
      const item = items.find((candidate) => candidate.itemId === row.itemId);
      const clock = item ? planItemClock(item, settings, todayIso) : null;
      return {
        saleOrderItemId: row.itemId,
        status: row.status,
        reason: row.reason,
        departureOn: clock?.departure ?? null,
      };
    });
}

/** Urgente na frente da fila real. Com a chave desligada, os dois lados empatam neste critério. */
export function planFromMotorSnapshot(raw: {
  motor_enabled?: boolean;
  urgent_release_without_material?: boolean;
  purchase_horizon_business_days?: number;
  weekly_purchase_cap_brl?: number | null;
  buffer_business_days?: number;
  ready_before_billing_days?: number;
  items?: Array<{
    sale_order_id: string;
    order_number: string;
    order_type: string | null;
    billing_week: string | null;
    item_id: string;
    reference_code: string;
    color: string | null;
    pairs: number;
    assembly_capacity_per_day: number | null;
    prep_business_days: number | null;
    explicit_complex: boolean;
    materials: Array<{
      product_id: string;
      product_name: string;
      unit: string | null;
      required: number;
      unit_price: number | null;
      supplier_id: string | null;
      supplier_name: string | null;
      supplier_lead_days: number | null;
    }>;
  }>;
  stock?: { product_id: string; free: number }[];
}, todayIso: string): MotorApplyPlan {
  const enabled = raw.motor_enabled === true;
  const settings: MotorSettings = {
    ...DEFAULT_MOTOR_SETTINGS,
    enabled,
    urgentMayReleaseWithoutMaterial: raw.urgent_release_without_material === true,
    purchaseHorizonBusinessDays: raw.purchase_horizon_business_days ?? DEFAULT_MOTOR_SETTINGS.purchaseHorizonBusinessDays,
    weeklyPurchaseCapBrl: raw.weekly_purchase_cap_brl ?? null,
    bufferBusinessDays: raw.buffer_business_days ?? DEFAULT_MOTOR_SETTINGS.bufferBusinessDays,
    readyBeforeBillingDays: raw.ready_before_billing_days ?? DEFAULT_MOTOR_SETTINGS.readyBeforeBillingDays,
  };
  const items: PlanDemand[] = (raw.items ?? []).map((item) => ({
    saleOrderId: item.sale_order_id,
    orderNumber: item.order_number,
    orderType: item.order_type,
    billingWeek: item.billing_week,
    itemId: item.item_id,
    referenceCode: item.reference_code,
    color: item.color,
    pairs: Number(item.pairs) || 0,
    assemblyCapacityPerDay: item.assembly_capacity_per_day,
    prepBusinessDays: item.prep_business_days,
    explicitComplex: item.explicit_complex === true,
    cabedalReceived: false,
    closeScore: 0,
    isPinned: false,
    isFrozen: false,
    pinnedPosition: null,
    frozenPosition: null,
    protected: false,
    materials: (item.materials ?? []).map((row) => ({
      productId: row.product_id,
      productName: row.product_name,
      unit: row.unit,
      required: Number(row.required) || 0,
      unitPrice: row.unit_price,
      supplierId: row.supplier_id,
      supplierName: row.supplier_name || 'Sem fornecedor',
      supplierLeadDays: row.supplier_lead_days,
      protectedHeld: 0,
    })),
  }));
  const stock = (raw.stock ?? []).map((row) => ({ productId: row.product_id, free: Number(row.free) || 0 }));
  const allocation = allocateStock(items, stock, settings);
  const purchases = suggestPurchases(items, allocation, settings, todayIso);
  return planMotorApply({ enabled, items, allocation, purchases, settings, todayIso });
}

export function motorQueueRank(orderType: string | null | undefined, enabled: boolean): number {
  if (!enabled) return 0;
  return isUrgentOrderType(orderType) ? 0 : 1;
}

/** Corte do complexo sai na data de saída. Antes disso, e com a chave desligada, não libera. */
export function corteReleasedByMotor(input: {
  enabled: boolean;
  departureOn: string | null;
  todayIso: string;
}): boolean {
  if (!input.enabled || !input.departureOn) return false;
  return input.todayIso >= input.departureOn;
}
