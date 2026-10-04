/**
 * Fila de Corte — look-ahead (specs/fila-corte-lookahead.md).
 * Regras puras: score, ordenação, alocação simulada de estoque livre.
 *
 * Ordenação entre liberáveis: motor oficial
 * specs/sequencia-producao.md (fechar PV → urgência → cor → ref).
 */

import {
  areaToStockDivisor,
  LINEAR_UNITS,
  type ComponentSheetCandidate,
} from '@/lib/materialConsumption';
import { compareProductionSequence } from '@/lib/production/productionSequence';

export const CORTE_LOOKAHEAD_SECTORS = [
  'Corte Cabedal',
  'Corte Forração',
  'Corte Palmilha',
  'Corte Fibra',
] as const;

export type CorteLookaheadSector = (typeof CORTE_LOOKAHEAD_SECTORS)[number];

export type CorteMaterialKind = 'upper' | 'lining' | 'insole' | 'fiber';

export function corteMaterialKind(sector: CorteLookaheadSector): CorteMaterialKind {
  switch (sector) {
    case 'Corte Cabedal':
      return 'upper';
    case 'Corte Forração':
      return 'lining';
    case 'Corte Palmilha':
      return 'insole';
    case 'Corte Fibra':
      return 'fiber';
  }
}

/** Nomes legados que ainda aparecem em production_sectors. */
const SECTOR_ALIASES: Record<string, string[]> = {
  'Corte Cabedal': ['Corte Cabedal'],
  'Corte Forração': ['Corte Forração', 'Palmilha · Forração'],
  'Corte Palmilha': ['Corte Palmilha'],
  'Corte Fibra': ['Corte Fibra', 'Palmilha · Fibra'],
};

export function sheetHasCorteSector(
  productionSectors: unknown,
  sector: CorteLookaheadSector,
): boolean {
  const list = Array.isArray(productionSectors)
    ? productionSectors.map((s) => String(s || '').trim()).filter(Boolean)
    : [];
  if (list.length === 0) return false;
  const aliases = SECTOR_ALIASES[sector] || [sector];
  return list.some((name) => aliases.some((a) => a.toLowerCase() === name.toLowerCase()));
}

export function daysUntilDeadline(deadline: string | null | undefined, today = new Date()): number | null {
  if (!deadline) return null;
  const d = new Date(`${deadline}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const start = new Date(today);
  start.setHours(12, 0, 0, 0);
  return Math.round((d.getTime() - start.getTime()) / 86400000);
}

export function corteLookaheadUrgency(deadline: string | null | undefined, today = new Date()): number {
  const days = daysUntilDeadline(deadline, today);
  if (days == null) return 0; // sem prazo → fim da fila entre liberáveis
  return 1 / (Math.max(0, days) + 1);
}

export function corteLookaheadScore(input: {
  remainingBillableValue: number;
  deliveryDeadline: string | null | undefined;
  today?: Date;
}): number {
  const urgency = corteLookaheadUrgency(input.deliveryDeadline, input.today);
  return Math.max(0, Number(input.remainingBillableValue) || 0) * urgency;
}

export function remainingBillableValue(input: {
  saleOrderTotal: number;
  pairsWithoutOp: number;
  pairsTotalOnPv: number;
}): number {
  const total = Math.max(0, Number(input.saleOrderTotal) || 0);
  const pairsTotal = Math.max(0, Number(input.pairsTotalOnPv) || 0);
  const pairsOpen = Math.max(0, Number(input.pairsWithoutOp) || 0);
  if (pairsTotal <= 0) return total;
  return total * (pairsOpen / pairsTotal);
}

export function pvCompletionPct(input: {
  pairsWithOp: number;
  pairsTotalOnPv: number;
}): number {
  const pairsTotal = Math.max(0, Number(input.pairsTotalOnPv) || 0);
  if (pairsTotal <= 0) return 0;
  return Math.min(100, (100 * Math.max(0, Number(input.pairsWithOp) || 0)) / pairsTotal);
}

export interface CorteLookaheadStockInput {
  productId: string | null;
  productName: string | null;
  /** Saldo livre = quantity − reservas de OUTROS PVs. */
  freeQty: number;
  /** Consumo estimado do material principal (mesma unidade do estoque). */
  requiredQty: number;
}

export interface CorteLookaheadRankInput {
  itemId: string;
  createdAt: string;
  liberableBase: boolean;
  stock: CorteLookaheadStockInput;
  score: number;
  completionPct: number;
  /** Cor do item do PV — eixo 3 da sequência oficial. */
  color?: string | null;
  /** Código/nome da referência — eixo 4. */
  reference?: string | null;
  /** Due / delivery (billing); eixo 2. */
  dueDate?: string | null;
  daysUntilPlannedStart?: number | null;
  gapLabel?: string | null;
}

export interface CorteLookaheadRanked extends CorteLookaheadRankInput {
  liberable: boolean;
  simulatedFreeAfter: number;
  chips: CorteLookaheadChip[];
}

export interface CorteLookaheadChip {
  key: 'estoque' | 'score' | 'pct_pv' | 'prazo' | 'gap';
  label: string;
  tone: 'ok' | 'warn' | 'blocked' | 'neutral';
}

/**
 * Ordena pela sequência oficial (fechar PV → urgência → cor → ref);
 * aplica alocação simulada do saldo livre nessa ordem; liberáveis acima dos bloqueados.
 */
export function rankCorteLookaheadRows(
  rows: CorteLookaheadRankInput[],
  opts?: { deadlineByItemId?: Record<string, string | null | undefined>; today?: Date },
): CorteLookaheadRanked[] {
  const today = opts?.today ?? new Date();
  const freePool = new Map<string, number>();
  for (const row of rows) {
    if (!row.stock.productId) continue;
    if (!freePool.has(row.stock.productId)) {
      freePool.set(row.stock.productId, Math.max(0, row.stock.freeQty));
    }
  }

  const sortedForSim = [...rows].sort((a, b) => compareCorteLookahead(a, b, today, opts?.deadlineByItemId));
  const ranked: CorteLookaheadRanked[] = [];

  for (const row of sortedForSim) {
    const productId = row.stock.productId;
    const required = Math.max(0, row.stock.requiredQty);
    let liberable = row.liberableBase && !!productId;
    let gap = row.gapLabel || null;
    let simulatedFreeAfter = productId ? (freePool.get(productId) ?? 0) : 0;

    if (!productId) {
      liberable = false;
      gap = gap || 'Cadastro incompleto: material do setor';
    } else if (!row.liberableBase) {
      liberable = false;
    } else {
      const free = freePool.get(productId) ?? 0;
      if (required > free + 1e-9) {
        liberable = false;
        gap = gap || `Falta ${row.stock.productName || 'material'} (${fmtQty(required - free)})`;
        simulatedFreeAfter = free;
      } else {
        freePool.set(productId, Math.max(0, free - required));
        simulatedFreeAfter = free - required;
      }
    }

    const deadline = row.dueDate ?? opts?.deadlineByItemId?.[row.itemId];
    ranked.push({
      ...row,
      liberable,
      simulatedFreeAfter,
      gapLabel: gap,
      chips: buildChips({
        liberable,
        stockName: row.stock.productName,
        freeQty: row.stock.freeQty,
        requiredQty: required,
        score: row.score,
        completionPct: row.completionPct,
        deadline,
        gap,
        today,
      }),
    });
  }

  return ranked.sort((a, b) => {
    if (a.liberable !== b.liberable) return a.liberable ? -1 : 1;
    return compareCorteLookahead(a, b, today, opts?.deadlineByItemId);
  });
}

function compareCorteLookahead(
  a: CorteLookaheadRankInput,
  b: CorteLookaheadRankInput,
  today: Date,
  deadlineByItemId?: Record<string, string | null | undefined>,
): number {
  return compareProductionSequence(
    {
      id: a.itemId,
      completionPct: a.completionPct,
      dueDate: a.dueDate ?? deadlineByItemId?.[a.itemId],
      color: a.color,
      reference: a.reference,
      createdAt: a.createdAt,
      daysUntilPlannedStart: a.daysUntilPlannedStart,
    },
    {
      id: b.itemId,
      completionPct: b.completionPct,
      dueDate: b.dueDate ?? deadlineByItemId?.[b.itemId],
      color: b.color,
      reference: b.reference,
      createdAt: b.createdAt,
      daysUntilPlannedStart: b.daysUntilPlannedStart,
    },
    today,
  );
}

function buildChips(input: {
  liberable: boolean;
  stockName: string | null;
  freeQty: number;
  requiredQty: number;
  score: number;
  completionPct: number;
  deadline: string | null | undefined;
  gap: string | null;
  today?: Date;
}): CorteLookaheadChip[] {
  const chips: CorteLookaheadChip[] = [];
  if (input.liberable) {
    chips.push({
      key: 'estoque',
      label: input.stockName
        ? `Estoque OK · ${input.stockName}`
        : 'Estoque OK',
      tone: 'ok',
    });
  } else {
    chips.push({
      key: 'estoque',
      label: input.gap || 'Bloqueado',
      tone: 'blocked',
    });
  }

  chips.push({
    key: 'score',
    label: `Score ${formatScore(input.score)}`,
    tone: 'neutral',
  });
  chips.push({
    key: 'pct_pv',
    label: `PV ${Math.round(input.completionPct)}%`,
    tone: input.completionPct >= 80 ? 'ok' : 'neutral',
  });

  const days = daysUntilDeadline(input.deadline, input.today);
  chips.push({
    key: 'prazo',
    label: days == null ? 'Sem prazo' : days < 0 ? `${Math.abs(days)}d atraso` : days === 0 ? 'Entrega hoje' : `${days}d`,
    tone: days == null ? 'warn' : days < 0 ? 'blocked' : days <= 3 ? 'warn' : 'neutral',
  });

  if (!input.liberable && input.gap) {
    chips.push({ key: 'gap', label: input.gap, tone: 'blocked' });
  }

  return chips;
}

function formatScore(score: number): string {
  if (!Number.isFinite(score) || score <= 0) return '0';
  if (score >= 1000) return score.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  return score.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

function fmtQty(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

/** Reservas de outros PVs sobre o SKU — saldo livre para adiantar. */
export function freeQtyExcludingOtherOrders(input: {
  quantity: number;
  reservations: Array<{
    productId: string;
    saleOrderId: string | null;
    quantityReserved: number;
    quantityConsumed: number;
    status: string;
  }>;
  productId: string;
  ownSaleOrderId: string;
}): number {
  const other = input.reservations
    .filter((r) => r.productId === input.productId)
    .filter((r) => r.status === 'reserved' || r.status === 'pending_reconciliation')
    .filter((r) => r.saleOrderId && r.saleOrderId !== input.ownSaleOrderId)
    .reduce((sum, r) => sum + Math.max(0, r.quantityReserved - r.quantityConsumed), 0);
  return Math.max(0, (Number(input.quantity) || 0) - other);
}

export function resolveCorteMaterialPins(input: {
  sector: CorteLookaheadSector;
  sheet: {
    upper_material_product_id?: string | null;
    upper_material_group_id?: string | null;
    lining_material_product_id?: string | null;
    lining_material_group_id?: string | null;
    insole_material?: string | null;
    insole_plate_product?: string | null;
    insole_material_group_id?: string | null;
    insole_material_product_id?: string | null;
  };
  variant?: {
    upper_material_product_id?: string | null;
    upper_material_group_id?: string | null;
    lining_material_product_id?: string | null;
    lining_material_group_id?: string | null;
    insole_material_product_id?: string | null;
    insole_material_group_id?: string | null;
  } | null;
}): { productId: string | null; groupId: string | null } {
  const kind = corteMaterialKind(input.sector);
  const v = input.variant;
  const s = input.sheet;
  if (kind === 'upper') {
    return {
      productId: v?.upper_material_product_id || s.upper_material_product_id || null,
      groupId: v?.upper_material_group_id || s.upper_material_group_id || null,
    };
  }
  if (kind === 'lining') {
    return {
      productId: v?.lining_material_product_id || s.lining_material_product_id || null,
      groupId: v?.lining_material_group_id || s.lining_material_group_id || null,
    };
  }
  if (kind === 'insole') {
    return {
      productId: v?.insole_material_product_id
        || (s as { insole_material_product_id?: string | null }).insole_material_product_id
        || null,
      groupId: v?.insole_material_group_id
        || (s as { insole_material_group_id?: string | null }).insole_material_group_id
        || null,
    };
  }
  // Fibra: na v1 não há pin dedicado na ficha — o hook tenta casar produto
  // ativo do grupo/placa por cor; sem pin fica gap de cadastro.
  return { productId: null, groupId: null };
}

export function pickProductForColor(input: {
  products: Array<{
    id: string;
    group_id: string | null;
    color: string | null;
    active?: boolean | null;
    quantity?: number | null;
    name?: string | null;
    unit?: string | null;
  }>;
  productId: string | null;
  groupId: string | null;
  color: string | null | undefined;
}): { id: string; name: string; quantity: number; group_id: string | null; unit: string | null } | null {
  const active = input.products.filter((p) => p.active !== false);
  const pack = (p: (typeof active)[number]) => ({
    id: p.id,
    name: p.name || 'Material',
    quantity: Number(p.quantity) || 0,
    group_id: p.group_id,
    unit: p.unit ?? null,
  });
  if (input.productId) {
    const pinned = active.find((p) => p.id === input.productId);
    if (pinned) return pack(pinned);
  }
  if (!input.groupId) return null;
  const colorNorm = normalizeColor(input.color);
  const inGroup = active.filter((p) => p.group_id === input.groupId);
  if (inGroup.length === 0) return null;
  if (colorNorm) {
    const byColor = inGroup.find((p) => normalizeColor(p.color) === colorNorm);
    if (byColor) return pack(byColor);
  }
  return null;
}

/** Grupo da ficha pelo nome (technical_sheets não tem lining/insole *_group_id). */
export function resolveGroupIdByMaterialName(
  name: string | null | undefined,
  groups: Array<{ id: string; name: string | null }>,
): string | null {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;
  const hit = groups.find((g) => String(g.name || '').trim().toLowerCase() === key);
  return hit?.id ?? null;
}

/**
 * Consumo de corte na unidade de estoque — espelho da porta SQL (31200).
 * Linear sem largura: incomplete='largura' (não comparar dm² cru com metros).
 */
export function corteRequiredStockQty(input: {
  consumptionPerPair: number | null | undefined;
  pairs: number;
  hasProduct: boolean;
  productUnit?: string | null;
  componentSheet?: ComponentSheetCandidate | null;
}): { qty: number; incomplete: 'largura' | null } {
  const pairs = Math.max(0, Number(input.pairs) || 0);
  const perPair = Number(input.consumptionPerPair);
  if (!Number.isFinite(perPair) || perPair <= 0) {
    return { qty: input.hasProduct ? 0.01 : 0, incomplete: null };
  }
  const dm2 = perPair * pairs;
  const unit = String(input.productUnit || '').trim().toLowerCase();
  const sheet = input.componentSheet ?? null;
  if (LINEAR_UNITS.has(unit)) {
    const div = areaToStockDivisor(unit, sheet);
    if (div == null || div <= 0) {
      return { qty: dm2, incomplete: 'largura' };
    }
    return { qty: dm2 / div, incomplete: null };
  }
  if (unit === 'placa' || unit === 'placas' || unit === 'chapa') {
    const div = areaToStockDivisor(unit, sheet);
    if (div != null && div > 0) {
      return { qty: dm2 / div, incomplete: null };
    }
  }
  return { qty: dm2, incomplete: null };
}

function normalizeColor(color: string | null | undefined): string {
  return String(color || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase();
}
