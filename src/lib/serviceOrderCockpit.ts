import { normalizeMaterialRequirements, type ReceiptMaterialRequirementsInput } from '@/lib/printServiceOrderReceipt';
import { isOsCancelled } from '@/lib/osStatusMachine';

export interface CockpitMaterialSent {
  material?: string | null;
  color?: string | null;
  meters?: number | null;
  quantity?: number | null;
  unit?: string | null;
  completed?: boolean;
}

export interface CockpitBalance {
  sent: number;
  returned: number;
  inField: number;
  toDispatch: number;
}

export interface OsCycleTotals {
  osCount: number;
  generatedValue: number;
  billingCount: number;
  billingValue: number;
  itemCount: number;
  pairCount: number;
  sentPairs: number;
  returnedPairs: number;
  materialLines: number;
  materialQty: number;
  unsignedReceipts: number;
}

const qty = (value: number | null | undefined) => Math.max(0, Number(value) || 0);

const roundQty = (value: number) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 1e6) / 1e6;
};

export function materialLineQty(material: CockpitMaterialSent | null | undefined): number {
  if (!material) return 0;
  if (material.quantity != null) return qty(material.quantity);
  return qty(material.meters);
}

export function documentedMaterials(materials: CockpitMaterialSent[] | null | undefined): CockpitMaterialSent[] {
  return (materials || []).filter((material) => {
    const name = (material.material || '').trim();
    return !!name && materialLineQty(material) > 0;
  });
}

export function summarizeMaterialsSent(materials: CockpitMaterialSent[] | null | undefined): {
  count: number;
  totalQty: number;
  label: string;
} {
  const lines = documentedMaterials(materials);
  const totalQty = lines.reduce((sum, material) => sum + materialLineQty(material), 0);
  if (lines.length === 0) return { count: 0, totalQty: 0, label: 'sem material' };
  const units = [...new Set(lines.map((material) => (material.unit || 'm').trim()).filter(Boolean))];
  const unit = units.length === 1 ? units[0] : '';
  const qtyLabel = totalQty.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  return {
    count: lines.length,
    totalQty,
    label: unit
      ? `${lines.length} ${lines.length === 1 ? 'item' : 'itens'} · ${qtyLabel} ${unit}`
      : `${lines.length} ${lines.length === 1 ? 'item' : 'itens'} · ${qtyLabel}`,
  };
}

/** Kit documental da remessa: o que a ficha calculou, proporcional aos pares desta saída.
 *  Se a OS já tem materiais enviados gravados, reusa o registro — não inventa segunda remessa. */
export function buildDispatchMaterialKit(input: {
  requirements?: ReceiptMaterialRequirementsInput;
  existingSent?: CockpitMaterialSent[] | null;
  dispatchQty: number;
  orderQty: number;
}): CockpitMaterialSent[] {
  const existing = documentedMaterials(input.existingSent);
  if (existing.length > 0) return existing;
  const snapshot = normalizeMaterialRequirements(input.requirements);
  if (snapshot.items.length === 0) return [];
  const scale = input.orderQty > 0 ? qty(input.dispatchQty) / qty(input.orderQty) : 1;
  return snapshot.items.map((item) => {
    const quantity = roundQty((Number(item.quantity) || 0) * scale);
    const unit = (item.unit || '').trim() || 'm';
    return {
      material: item.material,
      color: item.color || '',
      quantity,
      unit,
      meters: unit === 'm' ? quantity : quantity,
    };
  }).filter((item) => (item.material || '').trim() && materialLineQty(item) > 0);
}

export function toPersistedMaterialsSent(materials: CockpitMaterialSent[]): Array<{
  material: string;
  color: string;
  meters: number;
  quantity?: number;
  unit?: string;
}> {
  return documentedMaterials(materials).map((material) => {
    const quantity = materialLineQty(material);
    const unit = (material.unit || '').trim();
    return {
      material: (material.material || '').trim(),
      color: (material.color || '').trim(),
      meters: quantity,
      ...(quantity ? { quantity } : {}),
      ...(unit ? { unit } : {}),
    };
  });
}

export function resolveOsCycleBalance(input: {
  quantity?: number | null;
  dispatchTracked?: boolean | null;
  qtyDispatched?: number | null;
  qtySent?: number | null;
  qtyInField?: number | null;
  qtyToDispatch?: number | null;
  qtyReturnedGood?: number | null;
  qtyReturnedDefect?: number | null;
  qtyLoss?: number | null;
}): CockpitBalance {
  const quantity = qty(input.quantity);
  const tracked = Boolean(input.dispatchTracked);
  const sent = qty(input.qtyDispatched ?? input.qtySent ?? (tracked ? 0 : quantity));
  const returned = qty(input.qtyReturnedGood) + qty(input.qtyReturnedDefect) + qty(input.qtyLoss);
  const inField = qty(input.qtyInField ?? Math.max(0, sent - returned));
  const toDispatch = qty(input.qtyToDispatch ?? Math.max(0, quantity - sent));
  return { sent, returned, inField, toDispatch };
}

export type OsReceiptState = 'none' | 'unsigned' | 'signed';

export function resolveOsReceiptState(input: {
  signedPhotoUrl?: string | null;
  sentPairs: number;
}): OsReceiptState {
  if (input.signedPhotoUrl) return 'signed';
  if (input.sentPairs > 0) return 'unsigned';
  return 'none';
}

export interface CycleOrderInput {
  archivedAt?: string | null;
  status?: string | null;
  quantity?: number | null;
  totalValue?: number | null;
  dispatchTracked?: boolean | null;
  signedPhotoUrl?: string | null;
  materialsSent?: CockpitMaterialSent[] | null;
  selectedItemIds?: string[] | null;
  overview?: {
    qty_dispatched?: number | null;
    qty_sent?: number | null;
    qty_in_field?: number | null;
    qty_to_dispatch?: number | null;
    qty_returned_good?: number | null;
    qty_returned_defect?: number | null;
    qty_loss?: number | null;
    has_payable?: boolean | null;
    payment_status?: string | null;
    payable_open_amount?: number | null;
    payable_amount?: number | null;
    is_paid?: boolean | null;
  } | null;
}

export function summarizeOsCycle(orders: CycleOrderInput[]): OsCycleTotals {
  const totals: OsCycleTotals = {
    osCount: 0,
    generatedValue: 0,
    billingCount: 0,
    billingValue: 0,
    itemCount: 0,
    pairCount: 0,
    sentPairs: 0,
    returnedPairs: 0,
    materialLines: 0,
    materialQty: 0,
    unsignedReceipts: 0,
  };

  for (const order of orders) {
    if (order.archivedAt || isOsCancelled(order.status)) continue;
    totals.osCount += 1;
    totals.generatedValue += qty(order.totalValue);
    totals.pairCount += qty(order.quantity);
    const itemIds = Array.isArray(order.selectedItemIds) ? order.selectedItemIds.filter(Boolean) : [];
    totals.itemCount += itemIds.length > 0 ? itemIds.length : 1;

    const balance = resolveOsCycleBalance({
      quantity: order.quantity,
      dispatchTracked: order.dispatchTracked,
      qtyDispatched: order.overview?.qty_dispatched,
      qtySent: order.overview?.qty_sent,
      qtyInField: order.overview?.qty_in_field,
      qtyToDispatch: order.overview?.qty_to_dispatch,
      qtyReturnedGood: order.overview?.qty_returned_good,
      qtyReturnedDefect: order.overview?.qty_returned_defect,
      qtyLoss: order.overview?.qty_loss,
    });
    totals.sentPairs += balance.sent;
    totals.returnedPairs += balance.returned;

    const materials = summarizeMaterialsSent(order.materialsSent);
    totals.materialLines += materials.count;
    totals.materialQty += materials.totalQty;

    if (order.overview?.has_payable && order.overview.payment_status !== 'paid' && !order.overview.is_paid) {
      totals.billingCount += 1;
      totals.billingValue += qty(order.overview.payable_open_amount ?? order.overview.payable_amount ?? order.totalValue);
    }

    if (resolveOsReceiptState({ signedPhotoUrl: order.signedPhotoUrl, sentPairs: balance.sent }) === 'unsigned') {
      totals.unsignedReceipts += 1;
    }
  }

  return totals;
}
