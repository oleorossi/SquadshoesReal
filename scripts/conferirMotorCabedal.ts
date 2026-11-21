/**
 * Conferência do motor a partir do JSON de list_cabedal_motor_purchase_snapshot.
 * Não grava nada. Uso: bun scripts/conferirMotorCabedal.ts snapshot.json [ocs.json]
 */
import { readFileSync } from 'node:fs';
import {
  allocateStock,
  decideRelease,
  DEFAULT_MOTOR_SETTINGS,
  planItemClock,
  suggestPurchases,
  type MotorSettings,
  type PlanDemand,
} from '../src/lib/cabedalPlanningMotor';
import { planMotorApply } from '../src/lib/cabedalMotorApply';

interface SnapItem {
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
}

interface Snapshot {
  motor_enabled?: boolean;
  urgent_release_without_material?: boolean;
  purchase_horizon_business_days?: number;
  weekly_purchase_cap_brl?: number | null;
  buffer_business_days?: number;
  ready_before_billing_days?: number;
  items?: SnapItem[];
  stock?: { product_id: string; free: number }[];
}

const today = new Date();
const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

const raw = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Snapshot;
const settings: MotorSettings = {
  ...DEFAULT_MOTOR_SETTINGS,
  enabled: true,
  urgentMayReleaseWithoutMaterial: false,
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
const plan = planMotorApply({
  enabled: true,
  items,
  allocation,
  purchases,
  settings,
  todayIso,
});
const releases = decideRelease(items, allocation, settings);

const failures: string[] = [];
if (items.some((item) => item.orderNumber === 'PV-00249')) failures.push('PV-00249 entrou na leitura');

const byOrder = new Map<string, {
  week: string | null;
  start: string | null;
  material: string | null;
  holds: string[];
  ocs: string[];
}>();

for (const item of items) {
  const clock = planItemClock(item, settings, todayIso);
  const start = clock.assemblyStart ?? clock.departure;
  if (clock.anchor && start && start > clock.anchor) {
    failures.push(`${item.orderNumber} início ${start} depois do faturamento ${clock.anchor}`);
  }
  if (!clock.anchor) failures.push(`${item.orderNumber} sem semana de faturamento`);
  const bucket = byOrder.get(item.orderNumber) ?? {
    week: item.billingWeek,
    start: null,
    material: null,
    holds: [],
    ocs: [],
  };
  bucket.week = item.billingWeek;
  if (start && (!bucket.start || start < bucket.start)) bucket.start = start;
  const material = clock.needDate ?? clock.departure;
  if (material && (!bucket.material || material < bucket.material)) bucket.material = material;
  const hold = releases.find((row) => row.itemId === item.itemId);
  if (hold) bucket.holds.push(`${item.referenceCode}/${item.color}: ${hold.status}`);
  byOrder.set(item.orderNumber, bucket);
}

for (const line of purchases) {
  const bucket = byOrder.get(line.orderNumber);
  if (!bucket) continue;
  if (line.quantity > 0) {
    bucket.ocs.push(`${line.productName} ${line.quantity} ${line.unit ?? ''} ${line.supplierName} ${line.status}`.trim());
  }
}

if (settings.weeklyPurchaseCapBrl != null) {
  const spent = new Map<string, number>();
  for (const line of purchases) {
    if (line.status !== 'liberada' || line.urgent) continue;
    const week = line.buyBy ? line.buyBy.slice(0, 7) : 'sem-data';
    const used = (spent.get(week) ?? 0) + (line.valueBrl ?? 0);
    spent.set(week, used);
    if (used > settings.weeklyPurchaseCapBrl) {
      failures.push(`teto estourado em ${week} por ${line.orderNumber} ${line.productName}`);
    }
  }
}

const reservedByProduct = new Map<string, number>();
for (const move of plan.reservations) {
  reservedByProduct.set(move.productId, (reservedByProduct.get(move.productId) ?? 0) + move.quantity);
}

console.log(JSON.stringify({
  todayIso,
  enabledLive: raw.motor_enabled === true,
  urgentRelease: raw.urgent_release_without_material === true,
  weeklyCap: settings.weeklyPurchaseCapBrl,
  failures,
  orders: [...byOrder.entries()].map(([orderNumber, row]) => ({ orderNumber, ...row })),
  holds: plan.holds,
  reservationProducts: reservedByProduct.size,
  purchaseLines: purchases.length,
}, null, 2));
