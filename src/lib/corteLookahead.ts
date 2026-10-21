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

/** Bancadas internas da Fila unificada (specs/fila-corte-unificada.md). */
export const CORTE_LOOKAHEAD_SECTORS = [
  'Corte Cabedal',
  'Corte Fibra',
  'Corte Forração',
] as const;

export type CorteLookaheadSector = (typeof CORTE_LOOKAHEAD_SECTORS)[number];

export type CorteMaterialKind = 'upper' | 'lining' | 'fiber';

export type CorteCutKind = 'cabedal' | 'fibra' | 'forracao';

export function corteMaterialKind(sector: CorteLookaheadSector): CorteMaterialKind {
  switch (sector) {
    case 'Corte Cabedal':
      return 'upper';
    case 'Corte Forração':
      return 'lining';
    case 'Corte Fibra':
      return 'fiber';
  }
}

export function corteCutKindFromSector(sector: CorteLookaheadSector): CorteCutKind {
  switch (sector) {
    case 'Corte Cabedal':
      return 'cabedal';
    case 'Corte Fibra':
      return 'fibra';
    case 'Corte Forração':
      return 'forracao';
  }
}

/** Nomes legados que ainda aparecem em production_sectors. */
const SECTOR_ALIASES: Record<string, string[]> = {
  'Corte Cabedal': ['Corte Cabedal'],
  'Corte Forração': ['Corte Forração', 'Palmilha · Forração'],
  'Corte Fibra': ['Corte Fibra', 'Palmilha · Fibra', 'Corte Palmilha'],
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
  /**
   * Nº do PV — só pra NOMEAR quem consumiu o SKU quando outro item fica sem.
   * Não entra em nenhuma comparação de ordem.
   */
  orderNumber?: string | null;
  daysUntilPlannedStart?: number | null;
  gapLabel?: string | null;
}

export interface CorteLookaheadRanked extends CorteLookaheadRankInput {
  liberable: boolean;
  simulatedFreeAfter: number;
  chips: CorteLookaheadChip[];
  /**
   * Pedidos que consumiram este SKU ANTES desta linha na alocação simulada —
   * só preenchido quando a linha ficou bloqueada por falta.
   *
   * Existe porque o relatório é ordenado por PRAZO e a alocação segue a
   * sequência oficial (fechar PV → urgência → cor → ref): sem isso, o PV do
   * topo aparece bloqueado e um de baixo verde, e a tela parece quebrada.
   * Nomear quem levou transforma a contradição aparente em explicação.
   */
  blockedByOrderNumbers?: string[];
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
  // Quem já consumiu cada SKU nesta simulação, na ordem em que consumiu.
  const consumersByProduct = new Map<string, string[]>();

  for (const row of sortedForSim) {
    const productId = row.stock.productId;
    const required = Math.max(0, row.stock.requiredQty);
    let liberable = row.liberableBase && !!productId;
    let gap = row.gapLabel || null;
    let simulatedFreeAfter = productId ? (freePool.get(productId) ?? 0) : 0;
    let blockedByOrderNumbers: string[] | undefined;

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
        // Quem levou o material antes desta linha — exclui o próprio pedido,
        // que não é explicação pra ele mesmo.
        const own = String(row.orderNumber || '').trim();
        const takers = (consumersByProduct.get(productId) ?? []).filter((n) => n !== own);
        if (takers.length > 0) blockedByOrderNumbers = [...new Set(takers)];
      } else {
        freePool.set(productId, Math.max(0, free - required));
        simulatedFreeAfter = free - required;
        const taker = String(row.orderNumber || '').trim();
        if (taker) {
          consumersByProduct.set(productId, [...(consumersByProduct.get(productId) ?? []), taker]);
        }
      }
    }

    const deadline = row.dueDate ?? opts?.deadlineByItemId?.[row.itemId];
    ranked.push({
      ...row,
      liberable,
      simulatedFreeAfter,
      gapLabel: gap,
      blockedByOrderNumbers,
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

/**
 * Precedência de material de corte — ESPELHO de `resolve_upper_material_for_variant`
 * / `resolve_lining_material_for_variant` / `resolve_insole_material_for_variant`.
 *
 * ⚠ A ORDEM é a regra, não um detalhe. Até 13/10/2026 esta função divergia do
 * motor em dois pontos, e os dois faziam a Fila de Corte apontar a napa ERRADA:
 *
 *   1. Não conhecia `main_material_group_id`. Quando a ficha delega o componente
 *      à variante (`variant_drives_upper` / `variant_drives_lining`) e a variante
 *      declara só o material principal — o caso de 72 das 81 variantes ativas —
 *      a Fila caía no NOME do material da ficha, que é o material antigo. Medido:
 *      a S300 mostrava NAPA SOFT onde o motor resolve GLOW METALIC.
 *   2. O pin da FICHA vencia o grupo da VARIANTE, porque o chamador tenta
 *      `productId` antes de `groupId`. No motor o pin da ficha é fallback TARDIO.
 *      Por isso a precedência inteira mora AQUI e a função devolve UMA decisão:
 *      quem resolveu por grupo devolve `productId: null` de propósito.
 *
 * ⚠ PALMILHA NÃO TEM RAMO `main`, de propósito: `resolve_insole_material_for_variant`
 * não tem, e a flag `variant_drives_insole` foi REMOVIDA do banco na migration
 * `20261027120800_drop-variant-drives-insole`. Inventar o ramo aqui poria a tela
 * à frente do motor — a divergência de volta, só com o sinal trocado.
 *
 * ⚠ A FICHA NÃO TEM `lining_material_group_id` NEM `insole_material_group_id`.
 * Não é `select` esquecido: as colunas não existem em `technical_sheets` (ver
 * `resolveGroupIdByMaterialName` abaixo). Por isso esses ramos terminam em `null`
 * e o chamador cai no casamento por nome.
 *
 * ⚠ Diferença conhecida que sobra: quando o grupo resolve mas a COR não existe
 * nele, o motor devolve um SKU com `matched_by = 'color_mismatch'` e a Fila
 * devolve nada (`pickProductForColor` não tem esse ramo). A linha aparece sem
 * material em vez de mostrar a cor errada — é tela, e mostrar nada é o lado
 * seguro. Não replicar `color_mismatch` aqui sem decidir o que a tela faria com ele.
 */
export function resolveCorteMaterialPins(input: {
  sector: CorteLookaheadSector;
  sheet: {
    upper_material_product_id?: string | null;
    upper_material_group_id?: string | null;
    lining_material_product_id?: string | null;
    insole_material?: string | null;
    insole_plate_product?: string | null;
    variant_drives_upper?: boolean | null;
    variant_drives_lining?: boolean | null;
  };
  variant?: {
    upper_material_product_id?: string | null;
    upper_material_group_id?: string | null;
    lining_material_product_id?: string | null;
    lining_material_group_id?: string | null;
    insole_material_product_id?: string | null;
    insole_material_group_id?: string | null;
    main_material_group_id?: string | null;
  } | null;
}): { productId: string | null; groupId: string | null } {
  const kind = corteMaterialKind(input.sector);
  const v = input.variant;
  const s = input.sheet;

  /** Pin da variante > grupo da variante > main (se a ficha delega) > pin da ficha > grupo da ficha. */
  const resolve = (
    variantPin: string | null | undefined,
    variantGroup: string | null | undefined,
    sheetDelegates: boolean,
    sheetPin: string | null | undefined,
    sheetGroup: string | null | undefined,
  ): { productId: string | null; groupId: string | null } => {
    if (variantPin) return { productId: variantPin, groupId: null };
    if (variantGroup) return { productId: null, groupId: variantGroup };
    if (sheetDelegates && v?.main_material_group_id) {
      return { productId: null, groupId: v.main_material_group_id };
    }
    if (sheetPin) return { productId: sheetPin, groupId: null };
    return { productId: null, groupId: sheetGroup || null };
  };

  if (kind === 'upper') {
    return resolve(
      v?.upper_material_product_id,
      v?.upper_material_group_id,
      Boolean(s.variant_drives_upper),
      s.upper_material_product_id,
      s.upper_material_group_id,
    );
  }
  if (kind === 'lining') {
    // A ficha não tem grupo de forração — o chamador casa por nome.
    return resolve(
      v?.lining_material_product_id,
      v?.lining_material_group_id,
      Boolean(s.variant_drives_lining),
      s.lining_material_product_id,
      null,
    );
  }
  if (kind === 'fiber') {
    // Fibra/palmilha: sem ramo `main` — espelha `resolve_insole_material_for_variant`
    // (`variant_drives_insole` removida na mig 20261027120800).
    return resolve(
      v?.insole_material_product_id,
      v?.insole_material_group_id,
      false,
      null,
      null,
    );
  }
  // Fallback fibra sem pin: o hook tenta casar produto
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
