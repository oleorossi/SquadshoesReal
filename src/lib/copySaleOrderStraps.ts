/**
 * Cópia de tiras para um PV novo — fonte única dos dois botões de cópia
 * ("Duplicar para lojas" e "Copiar p/ novo PV"). Spec:
 * specs/tiras-redesenho.md → R-Cópia / D4 / D5.
 *
 * A ficha ATUAL manda na estrutura. Do PV de origem atravessam só as escolhas
 * comerciais de cada tira: cor, material (napa-base escolhida no pedido) e
 * origem (pv_origem) — e só quando a tira é a mesma:
 *   1. mesmo UUID estável da linha da ficha; ou
 *   2. mesmo rótulo, quando ele aparece EXATAMENTE uma vez na ficha e uma vez
 *      no PV de origem (PV legado gravava id ordinal "1"/"2").
 * Nunca se casa por posição: com a ficha reordenada ou com tira nova, a
 * posição levava a cor para a tira errada sem aviso.
 *
 * O que não atravessa vira PENDÊNCIA nomeada (item + tira + o que falta), em
 * vez de exceção: "Copiar p/ novo PV" mostra no formulário pra escolher;
 * "Duplicar para lojas" vira o motivo da falha daquela loja.
 */

import { supabase } from '@/integrations/supabase/client';
import { isUuid, strapColorMode, technicalStrapLineId } from '@/lib/technicalStrapLines';
import { strapMaterialMode } from '@/lib/strapMaterialPolicy';
import {
  reconcileEditableStrapSnapshots,
  type ReconcileStrapLineLike,
} from '@/lib/reconcileStrapSnapshots';

export type CopyStrapLineLike = ReconcileStrapLineLike;

export interface CopyStrapLinesInput {
  snapshotLines: CopyStrapLineLike[] | null | undefined;
  technicalLines: CopyStrapLineLike[] | null | undefined;
  /** Nome de cor → UUID canônico (PV legado gravava só o texto). */
  resolveColorId: (colorName: string) => string | null | undefined;
  /** Cores canônicas ativas. `null` = não validar (sem catálogo carregado). */
  activeColorIds: ReadonlySet<string> | null;
  /** Rótulo do item nas pendências, ex.: "NL02 / CAPUCCINO". */
  itemLabel?: string;
}

export interface CopyStrapLinesResult {
  lines: CopyStrapLineLike[];
  /** Uma frase por tira que precisa de escolha no PV novo. Vazio = pronto. */
  pending: string[];
}

function normLabel(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function countLabels(lines: CopyStrapLineLike[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const label = normLabel(line.label);
    if (label) counts.set(label, (counts.get(label) || 0) + 1);
  }
  return counts;
}

function lineLabel(line: CopyStrapLineLike, ordinal: number): string {
  return String(line.label || '').trim() || `Tira ${ordinal + 1}`;
}

/** Cor do PV de origem, só se ainda existir e estiver ativa no catálogo. */
function carriedColor(
  snapshot: CopyStrapLineLike,
  resolveColorId: CopyStrapLinesInput['resolveColorId'],
  activeColorIds: ReadonlySet<string> | null,
): { color: string; color_id: string | null } {
  const text = String(snapshot.color || '').trim();
  const isActive = (id: string) => !activeColorIds || activeColorIds.has(id.toLowerCase());
  if (isUuid(snapshot.color_id) && isActive(snapshot.color_id)) {
    return { color: text, color_id: snapshot.color_id };
  }
  if (text) {
    const resolved = resolveColorId(text);
    if (isUuid(resolved) && isActive(resolved)) return { color: text, color_id: resolved };
  }
  return { color: '', color_id: null };
}

export function copyStrapLinesForNewOrder(input: CopyStrapLinesInput): CopyStrapLinesResult {
  const technical = input.technicalLines || [];
  const snapshots = input.snapshotLines || [];
  const itemLabel = input.itemLabel || 'Item';
  if (technical.length === 0) return { lines: [], pending: [] };

  const pending: string[] = [];
  technical.forEach((line, ordinal) => {
    if (!technicalStrapLineId(line)) {
      pending.push(`${itemLabel}, ${lineLabel(line, ordinal)}: a ficha tem tira sem identificador estável — corrija a ficha técnica`);
    }
  });
  if (pending.length > 0) return { lines: [], pending };

  const technicalIds = new Set(technical.map((line) => technicalStrapLineId(line)!));
  const technicalByLabel = new Map<string, CopyStrapLineLike>();
  const technicalLabelCount = countLabels(technical);
  for (const line of technical) {
    const label = normLabel(line.label);
    if (label && technicalLabelCount.get(label) === 1) technicalByLabel.set(label, line);
  }
  const snapshotLabelCount = countLabels(snapshots);

  // Reidentifica cada tira do PV de origem com o UUID da ficha atual (D5) e
  // limpa a cor que não pode mais ser usada. O resto da reconciliação (o que
  // a ficha permite de material/cor) é a mesma do formulário de edição.
  const claimed = new Set<string>();
  const relabeled: CopyStrapLineLike[] = [];
  for (const snapshot of snapshots) {
    let targetId: string | null = null;
    let byLabel: CopyStrapLineLike | null = null;
    const ownId = technicalStrapLineId(snapshot);
    if (ownId && technicalIds.has(ownId)) {
      targetId = ownId;
    } else {
      const label = normLabel(snapshot.label);
      if (label && snapshotLabelCount.get(label) === 1) {
        byLabel = technicalByLabel.get(label) || null;
        if (byLabel) targetId = technicalStrapLineId(byLabel);
      }
    }
    if (!targetId || claimed.has(targetId)) continue;
    claimed.add(targetId);
    const color = carriedColor(snapshot, input.resolveColorId, input.activeColorIds);
    // Casada por UUID: o snapshot é da mesma linha e a reconciliação decide o
    // que ainda vale. Casada por rótulo (PV legado, sem estrutura gravada):
    // a estrutura é a da ficha e só as escolhas comerciais vêm do PV.
    relabeled.push(byLabel
      ? {
        ...byLabel,
        ...color,
        ...(snapshot.base_group_id ? {
          base_group_id: snapshot.base_group_id,
          base_group_name: snapshot.base_group_name ?? null,
        } : {}),
        ...(snapshot.pv_origem ? { pv_origem: snapshot.pv_origem } : {}),
      }
      : { ...snapshot, ...color });
  }

  const { lines } = reconcileEditableStrapSnapshots<CopyStrapLineLike>({
    snapshotLines: relabeled,
    technicalLines: technical,
    sourcing: {},
  });

  lines.forEach((line, ordinal) => {
    const missing: string[] = [];
    if (strapColorMode(line) === 'select_on_order' && !isUuid(line.color_id)) missing.push('a cor');
    if (strapMaterialMode(line) === 'select_on_order' && !isUuid(line.base_group_id)) missing.push('o material');
    if (missing.length > 0) {
      pending.push(`${itemLabel}, ${lineLabel(line, ordinal)}: escolha ${missing.join(' e ')}`);
    }
  });

  return { lines, pending };
}

/** Linha mínima de item lida para a cópia. */
export interface CopyStrapSourceItem {
  reference_id: string | null | undefined;
  strap_colors?: unknown;
}

export interface StrapCopyContext {
  technicalLinesFor: (referenceId: string | null | undefined) => CopyStrapLineLike[];
  sheetCodeFor: (referenceId: string | null | undefined) => string | null;
  resolveColorId: (colorName: string) => string | null;
  activeColorIds: ReadonlySet<string> | null;
}

function snapshotOf(item: CopyStrapSourceItem): CopyStrapLineLike[] {
  return Array.isArray(item.strap_colors) ? (item.strap_colors as CopyStrapLineLike[]) : [];
}

/**
 * Carrega, uma vez por cópia, tudo que `copyStrapLinesForNewOrder` precisa:
 * tiras da ficha atual de cada referência, nomes de cor legados resolvidos
 * para UUID e o conjunto de cores ativas.
 */
export async function loadStrapCopyContext(items: CopyStrapSourceItem[]): Promise<StrapCopyContext> {
  const refIds = [...new Set(items.map((i) => i.reference_id).filter(Boolean))] as string[];
  const linesByRef = new Map<string, CopyStrapLineLike[]>();
  const codeByRef = new Map<string, string>();
  if (refIds.length > 0) {
    const { data, error } = await supabase
      .from('technical_sheets')
      .select('id, code, name, strap_colors')
      .in('id', refIds);
    if (error) throw new Error(`Erro ao ler fichas para copiar as tiras: ${error.message}`);
    for (const sheet of data || []) {
      linesByRef.set(sheet.id, Array.isArray(sheet.strap_colors) ? (sheet.strap_colors as CopyStrapLineLike[]) : []);
      codeByRef.set(sheet.id, String(sheet.code || sheet.name || '').trim());
    }
  }

  const colorIds = new Set<string>();
  const colorNames = new Set<string>();
  for (const item of items) {
    for (const line of snapshotOf(item)) {
      if (isUuid(line.color_id)) colorIds.add(line.color_id.toLowerCase());
      else if (String(line.color || '').trim()) colorNames.add(String(line.color).trim());
    }
  }

  const colorIdByName = new Map<string, string>();
  await Promise.all([...colorNames].map(async (name) => {
    const { data, error } = await supabase.rpc('resolve_strap_canonical_color_id', { p_label: name });
    if (!error && isUuid(data)) {
      colorIdByName.set(name.toUpperCase(), String(data).toLowerCase());
      colorIds.add(String(data).toLowerCase());
    }
  }));

  let activeColorIds: Set<string> | null = new Set();
  if (colorIds.size > 0) {
    const { data, error } = await supabase
      .from('canonical_colors')
      .select('id')
      .in('id', [...colorIds])
      .eq('active', true);
    // Sem leitura do catálogo, não validar — o writer do PV ainda barra cor inativa.
    activeColorIds = error ? null : new Set((data || []).map((c) => String(c.id).toLowerCase()));
  }

  return {
    technicalLinesFor: (referenceId) => (referenceId && linesByRef.get(referenceId)) || [],
    sheetCodeFor: (referenceId) => (referenceId && codeByRef.get(referenceId)) || null,
    resolveColorId: (name) => colorIdByName.get(String(name).trim().toUpperCase()) || null,
    activeColorIds,
  };
}

/** Atalho: copia as tiras de um item usando o contexto carregado. */
export function copyItemStraps(
  item: CopyStrapSourceItem,
  context: StrapCopyContext,
  itemLabel: string,
): CopyStrapLinesResult {
  return copyStrapLinesForNewOrder({
    snapshotLines: snapshotOf(item),
    technicalLines: context.technicalLinesFor(item.reference_id),
    resolveColorId: context.resolveColorId,
    activeColorIds: context.activeColorIds,
    itemLabel,
  });
}
