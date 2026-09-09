export type LabelPrintCoverage = 'total' | 'partial';

export type PartialLabelPrintSelection = Record<string, Record<string, number>>;

export interface PartialLabelPrintGroup {
  groupKey: string;
  refCode: string;
  refName: string;
  colors: string[];
  orderNumbers: string[];
  aggregatedGrade: Record<string, number>;
  orders?: Array<{ id?: string | null }>;
}

export interface PartialLabelPrintRow {
  key: string;
  groupKey: string;
  refCode: string;
  refName: string;
  color: string;
  orderNumbers: string[];
  size: string;
  available: number;
}

export interface PartialLabelPrintSummary {
  selectedRows: number;
  totalLabels: number;
}

function compareSizes(a: string, b: string): number {
  const aNumber = Number(a);
  const bNumber = Number(b);
  if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) return aNumber - bNumber;
  return a.localeCompare(b, 'pt-BR', { numeric: true });
}

function positiveInteger(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function clampPartialLabelQuantity(rawValue: unknown, available: number): number {
  const limit = positiveInteger(available);
  if (limit <= 0) return 0;
  const parsed = Math.trunc(Number(rawValue));
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(limit, Math.max(1, parsed));
}

export function buildPartialLabelPrintRows(
  groups: PartialLabelPrintGroup[],
): PartialLabelPrintRow[] {
  return groups.flatMap(group => Object.entries(group.aggregatedGrade || {})
    .map(([size, quantity]) => ({ size, available: positiveInteger(quantity) }))
    .filter(row => row.available > 0)
    .sort((a, b) => compareSizes(a.size, b.size))
    .map(row => ({
      key: `${group.groupKey}\u001f${row.size}`,
      groupKey: group.groupKey,
      refCode: group.refCode,
      refName: group.refName,
      color: group.colors.join(' / '),
      orderNumbers: group.orderNumbers,
      size: row.size,
      available: row.available,
    })));
}

/**
 * Remove grupos/numerações que não pertencem mais à seleção e limita a
 * quantidade ao total real da grade. A seleção parcial nunca altera a OP.
 */
export function normalizePartialLabelPrintSelection(
  groups: PartialLabelPrintGroup[],
  selection: PartialLabelPrintSelection,
): PartialLabelPrintSelection {
  const normalized: PartialLabelPrintSelection = {};
  for (const row of buildPartialLabelPrintRows(groups)) {
    const selected = positiveInteger(selection[row.groupKey]?.[row.size]);
    if (selected <= 0) continue;
    normalized[row.groupKey] ||= {};
    normalized[row.groupKey][row.size] = Math.min(selected, row.available);
  }
  return normalized;
}

export function getEffectiveLabelPrintGrade(
  group: PartialLabelPrintGroup,
  coverage: LabelPrintCoverage,
  partialSelection: PartialLabelPrintSelection,
): Record<string, number> {
  const effective: Record<string, number> = {};
  const selectedGrade = partialSelection[group.groupKey] || {};
  for (const [size, rawAvailable] of Object.entries(group.aggregatedGrade || {})) {
    const available = positiveInteger(rawAvailable);
    if (available <= 0) continue;
    const requested = coverage === 'total'
      ? available
      : Math.min(available, positiveInteger(selectedGrade[size]));
    if (requested > 0) effective[size] = requested;
  }
  return effective;
}

export function getLabelPrintGroupTotal(
  group: PartialLabelPrintGroup,
  coverage: LabelPrintCoverage,
  partialSelection: PartialLabelPrintSelection,
): number {
  return Object.values(getEffectiveLabelPrintGrade(group, coverage, partialSelection))
    .reduce((total, quantity) => total + quantity, 0);
}

export function summarizePartialLabelPrintSelection(
  groups: PartialLabelPrintGroup[],
  selection: PartialLabelPrintSelection,
): PartialLabelPrintSummary {
  const normalized = normalizePartialLabelPrintSelection(groups, selection);
  let selectedRows = 0;
  let totalLabels = 0;
  for (const grade of Object.values(normalized)) {
    for (const quantity of Object.values(grade)) {
      selectedRows += 1;
      totalLabels += quantity;
    }
  }
  return { selectedRows, totalLabels };
}

/**
 * Mantém a ordem operacional da sequência completa (ficha a ficha) e consome
 * somente as cotas escolhidas por numeração.
 */
export function filterLabelSizeSequence(
  sequence: string[],
  requestedGrade: Record<string, number>,
): string[] {
  const remaining: Record<string, number> = Object.fromEntries(
    Object.entries(requestedGrade)
      .map(([size, quantity]) => [size, positiveInteger(quantity)] as const)
      .filter(([, quantity]) => quantity > 0),
  );
  const filtered: string[] = [];
  for (const size of sequence) {
    if ((remaining[size] || 0) <= 0) continue;
    filtered.push(size);
    remaining[size] -= 1;
  }
  return filtered;
}

export function getPrintJobOrderIds(
  groups: PartialLabelPrintGroup[],
): string[] {
  return [...new Set(groups.flatMap(group => (group.orders || [])
    .map(order => order.id)
    .filter((id): id is string => Boolean(id))))];
}
