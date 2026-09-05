import {
  isUuid,
  strapColorMode,
  technicalStrapLineId,
  type TechnicalStrapLineLike,
} from '@/lib/technicalStrapLines';
import { strapIdentityBasis } from '@/lib/strapIdentity';
import {
  pruneStrapSourcing,
  setStrapSourcing,
  type StrapSourcingMap,
} from '@/lib/strapSourcing';

export interface ReconcileStrapLineLike extends TechnicalStrapLineLike {
  label?: string | null;
  color?: string | null;
  color_id?: string | null;
  internal_production_enabled?: boolean | null;
  group_id?: string | null;
  group_name?: string | null;
  consumption?: number | string | null;
  consumption_per_size?: Record<string, number | string | null> | null;
}

export type StrapSnapshotChangeKind =
  | 'added'
  | 'removed'
  | 'reordered'
  | 'structure_changed'
  | 'color_cleared'
  | 'legacy_unmatched';

export interface StrapSnapshotChange {
  kind: StrapSnapshotChangeKind;
  lineId: string | null;
  ordinal: number;
}

export interface PreserveStrapColorInput<T extends ReconcileStrapLineLike> {
  snapshot: T;
  technical: T;
}

export interface ReconcileEditableStrapSnapshotsInput<T extends ReconcileStrapLineLike> {
  snapshotLines: T[] | null | undefined;
  technicalLines: T[] | null | undefined;
  sourcing?: StrapSourcingMap | null;
  /**
   * Validação de catálogo opcional. Sem ela, a cor só atravessa quando a base
   * estrutural não mudou. `false` sempre limpa a escolha e sua origem.
   */
  canPreserveColor?: (input: PreserveStrapColorInput<T>) => boolean;
}

export interface ReconcileEditableStrapSnapshotsResult<T extends ReconcileStrapLineLike> {
  lines: T[];
  sourcing: StrapSourcingMap;
  changed: boolean;
  linesChanged: boolean;
  sourcingChanged: boolean;
  orderChanged: boolean;
  changes: StrapSnapshotChange[];
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalValue(entry)]));
  }
  return value;
}

function equivalent(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
}

function canonicalConsumption(value: unknown): number | string | null {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : String(value).trim();
}

function canonicalConsumptionPerSize(value: unknown): Array<[string, number | string | null]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right, 'pt-BR', { numeric: true }))
    .map(([size, consumption]) => [size, canonicalConsumption(consumption)]);
}

function technicalStrapStructure(line: ReconcileStrapLineLike) {
  const basis = strapIdentityBasis(line);
  return {
    lineId: technicalStrapLineId(line),
    label: String(line.label || '').trim(),
    strapTypeId: line.strap_type_id || null,
    measureId: line.measure_id || null,
    identityBasis: basis,
    identityGroupId: basis === 'finished_product_group'
      ? line.identity_group_id || null
      : null,
    colorMode: strapColorMode(line),
    internalProductionEnabled: line.internal_production_enabled ?? null,
    groupId: line.group_id || null,
    groupName: String(line.group_name || '').trim(),
    consumption: canonicalConsumption(line.consumption),
    consumptionPerSize: canonicalConsumptionPerSize(line.consumption_per_size),
  };
}

/** Estrutura técnica de uma linha, sem a escolha comercial de cor do PV. */
export function sameTechnicalStrapStructure(
  left: ReconcileStrapLineLike,
  right: ReconcileStrapLineLike,
): boolean {
  return equivalent(technicalStrapStructure(left), technicalStrapStructure(right));
}

/** A ordem do array é parte da sequência técnica; UUID nunca codifica posição. */
export function technicalStrapSequenceSignature(
  lines: ReconcileStrapLineLike[] | null | undefined,
): string {
  return JSON.stringify((lines || []).map(technicalStrapStructure));
}

function sameSourcingInputs(
  snapshot: ReconcileStrapLineLike,
  technical: ReconcileStrapLineLike,
  reconciled: ReconcileStrapLineLike,
): boolean {
  const snapshotBasis = strapIdentityBasis(snapshot);
  const technicalBasis = strapIdentityBasis(technical);
  return snapshot.strap_type_id === technical.strap_type_id
    && snapshot.measure_id === technical.measure_id
    && snapshotBasis === technicalBasis
    && (snapshotBasis !== 'finished_product_group'
      || snapshot.identity_group_id === technical.identity_group_id)
    && strapColorMode(snapshot) === strapColorMode(technical)
    && (snapshot.internal_production_enabled ?? null)
      === (technical.internal_production_enabled ?? null)
    && (snapshot.group_id || null) === (technical.group_id || null)
    && canonicalConsumption(snapshot.consumption)
      === canonicalConsumption(technical.consumption)
    && equivalent(
      canonicalConsumptionPerSize(snapshot.consumption_per_size),
      canonicalConsumptionPerSize(technical.consumption_per_size),
    )
    && (snapshot.color_id || null) === (reconciled.color_id || null);
}

function defaultColorScopeIsCompatible(
  snapshot: ReconcileStrapLineLike,
  technical: ReconcileStrapLineLike,
): boolean {
  const snapshotBasis = strapIdentityBasis(snapshot);
  const technicalBasis = strapIdentityBasis(technical);
  if (snapshotBasis !== technicalBasis) return false;
  if (snapshotBasis === 'finished_product_group') {
    return (snapshot.identity_group_id || null) === (technical.identity_group_id || null);
  }
  return (snapshot.group_id || null) === (technical.group_id || null);
}

function selectedColorCanBePreserved<T extends ReconcileStrapLineLike>(
  snapshot: T,
  technical: T,
  canPreserveColor?: (input: PreserveStrapColorInput<T>) => boolean,
): boolean {
  if (strapColorMode(snapshot) !== 'select_on_order'
      || strapColorMode(technical) !== 'select_on_order'
      || !String(snapshot.color || '').trim()
      || !isUuid(snapshot.color_id)) return false;
  if (strapIdentityBasis(snapshot) !== strapIdentityBasis(technical)) return false;
  return canPreserveColor
    ? canPreserveColor({ snapshot, technical })
    : defaultColorScopeIsCompatible(snapshot, technical);
}

function reconciledLine<T extends ReconcileStrapLineLike>(
  technical: T,
  snapshot: T | undefined,
  canPreserveColor?: (input: PreserveStrapColorInput<T>) => boolean,
): T {
  const lineId = technicalStrapLineId(technical);
  const basis = strapIdentityBasis(technical);
  const preserveFollowMainColor = !!snapshot
    && strapColorMode(snapshot) === 'follow_main'
    && strapColorMode(technical) === 'follow_main';
  const preserveSelectedColor = !!snapshot
    && selectedColorCanBePreserved(snapshot, technical, canPreserveColor);
  const preserveColor = preserveFollowMainColor || preserveSelectedColor;
  return {
    ...technical,
    id: lineId || technical.id || null,
    technical_strap_line_id: lineId || technical.technical_strap_line_id || null,
    identity_basis: basis,
    identity_group_id: basis === 'finished_product_group'
      ? technical.identity_group_id || null
      : null,
    color_mode: strapColorMode(technical),
    color: preserveColor ? snapshot?.color || '' : '',
    color_id: preserveColor ? snapshot?.color_id || null : null,
  } as T;
}

/**
 * Reconcilia um snapshot EDITÁVEL com a ficha publicada.
 *
 * Só UUID casa posições. Um ordinal/rótulo legado não recebe identidade por
 * inferência: ele vira diagnóstico e a nova linha exige revisão explícita.
 */
export function reconcileEditableStrapSnapshots<T extends ReconcileStrapLineLike>({
  snapshotLines,
  technicalLines,
  sourcing,
  canPreserveColor,
}: ReconcileEditableStrapSnapshotsInput<T>): ReconcileEditableStrapSnapshotsResult<T> {
  const snapshots = snapshotLines || [];
  const technical = technicalLines || [];
  const snapshotById = new Map<string, { line: T; ordinal: number }>();
  snapshots.forEach((line, ordinal) => {
    const lineId = technicalStrapLineId(line);
    if (lineId) snapshotById.set(lineId, { line, ordinal });
  });

  const snapshotIds = snapshots.map(technicalStrapLineId);
  const technicalIds = technical.map(technicalStrapLineId);
  const sameCanonicalSet = snapshotIds.every((id): id is string => !!id)
    && technicalIds.every((id): id is string => !!id)
    && snapshotIds.length === technicalIds.length
    && snapshotIds.every((id) => technicalIds.includes(id));
  const orderChanged = sameCanonicalSet
    && snapshotIds.some((lineId, ordinal) => lineId !== technicalIds[ordinal]);
  const changes: StrapSnapshotChange[] = [];

  snapshots.forEach((line, ordinal) => {
    const lineId = technicalStrapLineId(line);
    if (!lineId) {
      changes.push({ kind: 'legacy_unmatched', lineId: null, ordinal });
    } else if (!technicalIds.includes(lineId)) {
      changes.push({ kind: 'removed', lineId, ordinal });
    }
  });

  let nextSourcing = pruneStrapSourcing(sourcing, technical);
  const lines = technical.map((technicalLine, ordinal) => {
    const lineId = technicalStrapLineId(technicalLine);
    const match = lineId ? snapshotById.get(lineId) : undefined;
    const snapshot = match?.line;
    const line = reconciledLine(technicalLine, snapshot, canPreserveColor);

    if (!snapshot) {
      changes.push({ kind: 'added', lineId, ordinal });
      return line;
    }
    if (match.ordinal !== ordinal) {
      changes.push({ kind: 'reordered', lineId, ordinal });
    }
    if (!sameTechnicalStrapStructure(snapshot, technicalLine)) {
      changes.push({ kind: 'structure_changed', lineId, ordinal });
    }
    const hadColor = !!String(snapshot.color || '').trim() || !!snapshot.color_id;
    if (hadColor && !line.color && !line.color_id) {
      changes.push({ kind: 'color_cleared', lineId, ordinal });
    }
    if (!sameSourcingInputs(snapshot, technicalLine, line)) {
      nextSourcing = setStrapSourcing(nextSourcing, lineId, null);
    }
    return line;
  });

  const linesChanged = !equivalent(snapshots, lines);
  const sourcingChanged = !equivalent(sourcing || {}, nextSourcing);
  return {
    lines,
    sourcing: nextSourcing,
    changed: linesChanged || sourcingChanged,
    linesChanged,
    sourcingChanged,
    orderChanged,
    changes,
  };
}

/**
 * Linhas usadas na UI/preview. Estados comprometidos devolvem o snapshot salvo
 * sem consultar ou sobrepor a ficha viva.
 */
export function strapPresentationLines<T extends ReconcileStrapLineLike>(
  snapshotLines: T[] | null | undefined,
  technicalLines: T[] | null | undefined,
  preserveCommittedSnapshot: boolean,
): T[] {
  const snapshots = snapshotLines || [];
  if (preserveCommittedSnapshot || technicalLines == null) return snapshots;
  return reconcileEditableStrapSnapshots({ snapshotLines: snapshots, technicalLines }).lines;
}
