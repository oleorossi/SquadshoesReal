import { resolveReferenceImageUrl } from '@/lib/referenceImage';

/**
 * Lançamento de corte do cabedal complexo.
 * Cada aprovação é independente: o próximo corte sugere os prestadores
 * do último lançamento, e o operador pode trocar. O mesmo prestador
 * numa segunda leva ganha outra OS.
 */

export interface CutRangeCap {
  label: string;
  sizes: string[];
  cap: number;
  mode: 'range' | 'total';
}

export interface CutHistoryOrder {
  id: string;
  number: string | null;
  contractorId: string;
  contractorName: string;
  quantity: number;
  grade: Record<string, number>;
}

export interface CutHistoryEntry {
  id: string;
  at: string;
  totalPairs: number;
  ranges: Array<{ label: string; pairs: number }>;
  orders: CutHistoryOrder[];
}

export interface CutQueueCard {
  jobId: string;
  orderNumber: string;
  clientName: string | null;
  billingWeek: string | null;
  referenceCode: string | null;
  referenceName: string | null;
  imageUrl: string | null;
  images: unknown;
  variantImageUrl: string | null;
  pretoImageUrl: string | null;
  photoUrl: string;
  itemGrade: Record<string, number>;
  sheetId: string | null;
  color: string | null;
  sector: string;
  sectorLabel: string;
  totalPairs: number;
  cutPairs: number;
  remainingPairs: number;
  preferredContractorId: string | null;
  lastContractorIds: string[];
  ranges: CutRangeCap[];
  blockReason: string | null;
  inQueue: boolean;
  history: CutHistoryEntry[];
}

export interface CutContractorOption {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  preferred: boolean;
}

export function suggestContractorIds(
  lastIds: string[],
  preferredId: string | null,
  availableIds: string[],
): string[] {
  const allowed = new Set(availableIds);
  const seed = lastIds.length > 0 ? lastIds : (preferredId ? [preferredId] : []);
  const out: string[] = [];
  for (const id of seed) {
    if (allowed.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

export function rangeBoard(
  cut: Record<string, number>,
  assigned: Array<Record<string, number>>,
): Array<{ label: string; cut: number; assigned: number; closed: boolean }> {
  return Object.keys(cut).map((label) => {
    const target = Math.max(0, Math.trunc(Number(cut[label]) || 0));
    const sum = assigned.reduce((acc, row) => acc + Math.max(0, Math.trunc(Number(row[label]) || 0)), 0);
    return { label, cut: target, assigned: sum, closed: sum === target && target >= 0 };
  });
}

export function cutTotal(cut: Record<string, number>): number {
  return Object.values(cut).reduce((acc, n) => acc + Math.max(0, Math.trunc(Number(n) || 0)), 0);
}

export function singleRange(ranges: CutRangeCap[]): boolean {
  return ranges.length <= 1;
}

/**
 * Mesma cascata das fichas de operador: foto da cor, depois preto,
 * depois technical_sheets.images e o image_url legado.
 */
export function resolveCutPhoto(input: {
  variantImageUrl?: string | null;
  pretoImageUrl?: string | null;
  images?: unknown;
  imageUrl?: string | null;
}): string {
  const variant = (input.variantImageUrl || '').trim();
  if (variant) return variant;
  const preto = (input.pretoImageUrl || '').trim();
  if (preto) return preto;
  return resolveReferenceImageUrl({ images: input.images, image_url: input.imageUrl });
}

/** Reparte o corte da faixa pela curva da grade do item. Não grava consumo. */
export function sizeGradeForCut(
  ranges: readonly CutRangeCap[],
  cut: Record<string, number>,
  itemGrade: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const range of ranges) {
    const pairs = Math.max(0, Math.trunc(Number(cut[range.label]) || 0));
    const sizes = range.sizes.filter(Boolean);
    if (pairs <= 0 || sizes.length === 0) continue;
    const weights = sizes.map((size) => Math.max(0, Math.trunc(Number(itemGrade[size]) || 0)));
    const weight = weights.reduce((sum, value) => sum + value, 0);
    if (weight <= 0) continue;
    const floors = weights.map((value) => Math.floor((pairs * value) / weight));
    let left = pairs - floors.reduce((sum, value) => sum + value, 0);
    const order = weights
      .map((value, index) => ({ index, frac: ((pairs * value) / weight) - floors[index] }))
      .sort((a, b) => b.frac - a.frac || a.index - b.index);
    for (const item of order) {
      if (left <= 0) break;
      floors[item.index] += 1;
      left -= 1;
    }
    sizes.forEach((size, index) => {
      if (floors[index] > 0) out[size] = (out[size] || 0) + floors[index];
    });
  }
  return out;
}

export function weekLoad(
  lines: readonly { contractorId: string | null; sectorKey: string | null; periodStart: string | null; streetPairs: number; capacityPeriod: number | null }[],
  contractorId: string,
  sectorKey: string,
  weekStart: string,
): { street: number; free: number | null } {
  const mine = lines.filter((line) => line.contractorId === contractorId && (!sectorKey || line.sectorKey === sectorKey));
  const street = mine.reduce((sum, line) => sum + Math.max(0, line.streetPairs), 0);
  const week = mine.filter((line) => line.periodStart === weekStart);
  const capacity = week.find((line) => line.capacityPeriod != null)?.capacityPeriod ?? null;
  const weekStreet = week.reduce((sum, line) => sum + Math.max(0, line.streetPairs), 0);
  return { street, free: capacity == null ? null : Math.max(0, capacity - weekStreet) };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

export function parseCutQueue(payload: unknown): CutQueueCard[] {
  if (!Array.isArray(payload)) return [];
  return payload.map((raw) => {
    const row = asRecord(raw);
    const ranges = Array.isArray(row.ranges) ? row.ranges.map((item) => {
      const range = asRecord(item);
      return {
        label: String(range.label || 'total'),
        sizes: Array.isArray(range.sizes) ? range.sizes.map(String) : [],
        cap: asNumber(range.cap),
        mode: range.mode === 'total' ? 'total' as const : 'range' as const,
      };
    }) : [];
    const history = Array.isArray(row.history) ? row.history.map((item) => {
      const entry = asRecord(item);
      const orders = Array.isArray(entry.orders) ? entry.orders.map((orderRaw) => {
        const order = asRecord(orderRaw);
        const grade = asRecord(order.grade);
        const parsed: Record<string, number> = {};
        for (const [key, value] of Object.entries(grade)) parsed[key] = asNumber(value);
        return {
          id: String(order.id || ''),
          number: order.number == null ? null : String(order.number),
          contractorId: String(order.contractor_id || ''),
          contractorName: String(order.contractor_name || 'Prestador'),
          quantity: asNumber(order.quantity),
          grade: parsed,
        };
      }) : [];
      const entryRanges = Array.isArray(entry.ranges) ? entry.ranges.map((rangeRaw) => {
        const range = asRecord(rangeRaw);
        return { label: String(range.label || ''), pairs: asNumber(range.pairs) };
      }) : [];
      return {
        id: String(entry.id || ''),
        at: String(entry.at || ''),
        totalPairs: asNumber(entry.total_pairs),
        ranges: entryRanges,
        orders,
      };
    }) : [];
    return {
      jobId: String(row.job_id || ''),
      orderNumber: String(row.order_number || ''),
      clientName: row.client_name == null ? null : String(row.client_name),
      billingWeek: row.billing_week == null ? null : String(row.billing_week),
      referenceCode: row.reference_code == null ? null : String(row.reference_code),
      referenceName: row.reference_name == null ? null : String(row.reference_name),
      imageUrl: row.image_url == null ? null : String(row.image_url),
      images: row.images,
      variantImageUrl: row.variant_image_url == null ? null : String(row.variant_image_url),
      pretoImageUrl: row.preto_image_url == null ? null : String(row.preto_image_url),
      photoUrl: resolveCutPhoto({
        variantImageUrl: row.variant_image_url == null ? null : String(row.variant_image_url),
        pretoImageUrl: row.preto_image_url == null ? null : String(row.preto_image_url),
        images: row.images,
        imageUrl: row.image_url == null ? null : String(row.image_url),
      }),
      itemGrade: Object.fromEntries(Object.entries(asRecord(row.item_grade)).map(([key, value]) => [key, asNumber(value)])),
      sheetId: row.sheet_id == null ? null : String(row.sheet_id),
      color: row.color == null ? null : String(row.color),
      sector: String(row.sector || ''),
      sectorLabel: String(row.sector_label || row.sector || ''),
      totalPairs: asNumber(row.total_pairs),
      cutPairs: asNumber(row.cut_pairs),
      remainingPairs: asNumber(row.remaining_pairs),
      preferredContractorId: row.preferred_contractor_id == null ? null : String(row.preferred_contractor_id),
      lastContractorIds: Array.isArray(row.last_contractor_ids) ? row.last_contractor_ids.map(String) : [],
      ranges,
      blockReason: row.block_reason == null ? null : String(row.block_reason),
      inQueue: row.in_queue === true,
      history,
    };
  }).filter((card) => card.jobId);
}
