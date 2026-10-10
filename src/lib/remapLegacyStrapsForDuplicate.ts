/**
 * Remapeia snapshot de tiras de um PV legado (id ordinal "1"/"2", sem
 * technical_strap_line_id) para o molde canônico da ficha atual.
 *
 * Usado só em "Duplicar para lojas": o reconcile editável NÃO infere UUID por
 * rótulo (decisão canônica — revisão explícita no formulário). Na duplicação o
 * dono quer levar o mix + as cores comerciais para um PV novo; sem este remap
 * o writer `prepare_sale_order_item_internal_straps` aborta com
 * "Linha artesanal sem UUID estavel".
 *
 * Casamento: UUID estável → rótulo (+ group_id quando ambos têm) → ordinal.
 * A ficha manda na estrutura; só cor/color_id (e pv_origem) atravessam.
 */

import {
  isUuid,
  strapColorMode,
  technicalStrapLineId,
  type TechnicalStrapLineLike,
} from '@/lib/technicalStrapLines';
import { strapIdentityBasis } from '@/lib/strapIdentity';

export interface DuplicateStrapLineLike extends TechnicalStrapLineLike {
  label?: string | null;
  color?: string | null;
  color_id?: string | null;
  group_id?: string | null;
  group_name?: string | null;
  consumption?: number | string | null;
  consumption_per_size?: Record<string, number | string | null> | null;
  internal_production_enabled?: boolean | null;
}

export interface RemapLegacyStrapsForDuplicateInput {
  snapshotLines: DuplicateStrapLineLike[] | null | undefined;
  technicalLines: DuplicateStrapLineLike[] | null | undefined;
  /** Resolve nome de cor → UUID canônico (RPC ou mapa pré-carregado). */
  resolveColorId: (colorName: string) => string | null | undefined;
  /** Rótulo pra mensagem (ex.: "NL02 / CAPUCCINO"). */
  itemLabel?: string;
}

export interface RemapLegacyStrapsForDuplicateResult {
  lines: DuplicateStrapLineLike[];
  /** true quando houve linha sem UUID estável ou conjunto diferente da ficha. */
  remapped: boolean;
}

function normLabel(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

function normColor(value: unknown): string {
  return String(value || '').trim();
}

/** Precisa hidratar a partir da ficha (vazio, legado ou UUID fora da ficha). */
export function strapSnapshotNeedsSheetRemap(
  snapshotLines: DuplicateStrapLineLike[] | null | undefined,
  technicalLines: DuplicateStrapLineLike[] | null | undefined,
): boolean {
  const technical = technicalLines || [];
  if (technical.length === 0) return false;
  const snapshots = snapshotLines || [];
  if (snapshots.length === 0) return true;
  const techIds = new Set(
    technical.map((line) => technicalStrapLineId(line)).filter((id): id is string => !!id),
  );
  if (techIds.size !== technical.length) return true;
  const snapIds = snapshots.map((line) => technicalStrapLineId(line));
  if (snapIds.some((id) => !id)) return true;
  if (snapIds.length !== techIds.size) return true;
  return snapIds.some((id) => !techIds.has(id!));
}

function pickSnapshotForTechnical(
  technical: DuplicateStrapLineLike,
  ordinal: number,
  snapshots: DuplicateStrapLineLike[],
  used: Set<number>,
): DuplicateStrapLineLike | undefined {
  const lineId = technicalStrapLineId(technical);
  if (lineId) {
    const byId = snapshots.findIndex(
      (line, idx) => !used.has(idx) && technicalStrapLineId(line) === lineId,
    );
    if (byId >= 0) {
      used.add(byId);
      return snapshots[byId];
    }
  }

  const techLabel = normLabel(technical.label);
  const techGroup = technical.group_id || technical.identity_group_id || null;
  if (techLabel) {
    const byLabelAndGroup = snapshots.findIndex((line, idx) => {
      if (used.has(idx)) return false;
      if (normLabel(line.label) !== techLabel) return false;
      const snapGroup = line.group_id || line.identity_group_id || null;
      if (techGroup && snapGroup) return techGroup === snapGroup;
      return true;
    });
    if (byLabelAndGroup >= 0) {
      used.add(byLabelAndGroup);
      return snapshots[byLabelAndGroup];
    }
  }

  if (ordinal < snapshots.length && !used.has(ordinal)) {
    used.add(ordinal);
    return snapshots[ordinal];
  }

  return undefined;
}

function resolveLineColorId(
  snapshot: DuplicateStrapLineLike | undefined,
  resolveColorId: (colorName: string) => string | null | undefined,
): { color: string; color_id: string | null } {
  const colorText = normColor(snapshot?.color);
  const fromId = isUuid(snapshot?.color_id) ? snapshot!.color_id! : null;
  if (fromId) {
    return { color: colorText || '', color_id: fromId };
  }
  if (!colorText) return { color: '', color_id: null };
  const resolved = resolveColorId(colorText);
  return {
    color: colorText,
    color_id: isUuid(resolved) ? resolved : null,
  };
}

/**
 * Constrói strap_colors canônicos a partir da ficha, carregando cores do
 * snapshot legado quando o casamento for inequívoco o bastante.
 *
 * @throws Error com mensagem acionável se select_on_order ficar sem cor.
 */
export function remapLegacyStrapsForDuplicate(
  input: RemapLegacyStrapsForDuplicateInput,
): RemapLegacyStrapsForDuplicateResult {
  const technical = input.technicalLines || [];
  const snapshots = input.snapshotLines || [];
  const itemLabel = input.itemLabel || 'item';

  if (technical.length === 0) {
    return { lines: [], remapped: snapshots.length > 0 };
  }

  const needsRemap = strapSnapshotNeedsSheetRemap(snapshots, technical);
  const used = new Set<number>();
  const lines: DuplicateStrapLineLike[] = [];

  for (let ordinal = 0; ordinal < technical.length; ordinal++) {
    const tech = technical[ordinal];
    const lineId = technicalStrapLineId(tech);
    if (!lineId) {
      throw new Error(
        `${itemLabel}: ficha com linha artesanal sem UUID estável — corrija no Estoque`,
      );
    }

    const snapshot = pickSnapshotForTechnical(tech, ordinal, snapshots, used);
    const mode = strapColorMode(tech);
    const basis = strapIdentityBasis(tech);
    const { color, color_id } = resolveLineColorId(snapshot, input.resolveColorId);

    if (mode === 'select_on_order' && !color_id) {
      const lineLabel = String(tech.label || `TIRA ${ordinal + 1}`).trim();
      throw new Error(
        `${itemLabel}, ${lineLabel}: cor da tira não pôde ser levada do PV origem `
          + '(legado sem UUID). Abra o item no pedido original, escolha a cor canônica e salve; '
          + 'depois tente duplicar de novo.',
      );
    }

    const preservedPvOrigem = snapshot?.pv_origem === 'fabrica'
      || snapshot?.pv_origem === 'prestador'
      || snapshot?.pv_origem === 'sku_acabado'
      ? snapshot.pv_origem
      : undefined;

    const next: DuplicateStrapLineLike = {
      ...tech,
      id: lineId,
      technical_strap_line_id: lineId,
      identity_basis: basis,
      identity_group_id: basis === 'finished_product_group'
        ? tech.identity_group_id || null
        : null,
      color_mode: mode,
      color: mode === 'select_on_order' ? color : (color || ''),
      color_id: mode === 'select_on_order' ? color_id : (color_id || null),
      ...(preservedPvOrigem ? { pv_origem: preservedPvOrigem } : {}),
    };
    lines.push(next);
  }

  return { lines, remapped: needsRemap };
}
