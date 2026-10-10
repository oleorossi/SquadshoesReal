// ═══════════════════════════════════════════════════════════════════════════
// ROLLUP DE NAPA — por família+cor, com destino (cabedal / forração / tira)
// ═══════════════════════════════════════════════════════════════════════════
// Decisão do dono (27/09/2026): o total de material base INCLUI napa convertida
// de tiras artesanais. Cada família+cor lista os destinos e soma no fim.
// Pendência de rendimento aparece sem metros de napa até o cadastro.

import {
  BASE_LINEAR_UNITS,
  BASE_MATERIAL_COMPONENTS,
  normalizeBaseFamilyName,
  type BaseMaterialInput,
  type BaseMaterialTotal,
} from '@/lib/baseMaterialTotal';

export type NapaDestinationKind =
  | 'Cabedal'
  | 'Forração'
  | 'Forração Palmilha'
  | 'Fachete'
  | 'Tira';

export type NapaDestination = {
  kind: NapaDestinationKind;
  /** Rótulo exibido (ex.: "Tira chata 8mm" ou "Forração"). */
  label: string;
  /** Metros de tira quando kind === 'Tira'. */
  strapMeters?: number;
  /** Metros de napa-rolo atribuídos a este destino (0 se pending). */
  napaMeters: number;
  pending?: boolean;
  yieldPerMeter?: number;
};

export type NapaFamilyColor = {
  family: string;
  color: string;
  total: number;
  destinations: NapaDestination[];
};

export type NapaRollup = {
  /** Soma de napa (m) com rendimento confirmado. */
  total: number;
  /** Famílias+cores, maior total primeiro. */
  byFamilyColor: NapaFamilyColor[];
  /** Partes planas pra KPI legado (família agregada, sem cor). */
  parts: { name: string; qty: number }[];
  /** Linhas fora do total (largura faltando, warning, rendimento pendente). */
  skipped: number;
  /** Quantas linhas de tira ainda sem receita. */
  pendingCount: number;
};

const DIRECT_LABEL: Record<string, NapaDestinationKind> = {
  Cabedal: 'Cabedal',
  Forração: 'Forração',
  'Forração Palmilha': 'Forração Palmilha',
  Fachete: 'Fachete',
};

function familyColorKey(family: string, color: string): string {
  return `${family.toLowerCase()}::${(color || '—').toLowerCase()}`;
}

function mergeDestination(
  list: NapaDestination[],
  next: NapaDestination,
): void {
  const same = list.find(
    (d) =>
      d.kind === next.kind
      && d.label === next.label
      && Boolean(d.pending) === Boolean(next.pending),
  );
  if (!same) {
    list.push({ ...next });
    return;
  }
  same.napaMeters += next.napaMeters;
  if (next.strapMeters != null) {
    same.strapMeters = (same.strapMeters || 0) + next.strapMeters;
  }
}

/**
 * Monta o rollup canônico de napa a partir das linhas de consumo
 * (mesmo shape que `computeBaseMaterialTotal`).
 */
export function buildNapaRollup(rows: BaseMaterialInput[]): NapaRollup | null {
  const buckets = new Map<string, NapaFamilyColor>();
  let skipped = 0;
  let pendingCount = 0;

  const ensure = (family: string, color: string): NapaFamilyColor => {
    const key = familyColorKey(family, color);
    let b = buckets.get(key);
    if (!b) {
      b = { family, color: color || '—', total: 0, destinations: [] };
      buckets.set(key, b);
    }
    return b;
  };

  for (const r of rows) {
    if (r.artisanal) {
      const family = normalizeBaseFamilyName(r.artisanal.baseName, r.color);
      const color = (r.color || '—').toString().trim() || '—';
      const label = (r.groupName || 'Tira').toString().trim() || 'Tira';
      if (r.artisanal.pending) {
        pendingCount++;
        skipped++;
        const b = ensure(family, color);
        mergeDestination(b.destinations, {
          kind: 'Tira',
          label,
          strapMeters: r.totalQuantity > 0 ? r.totalQuantity : undefined,
          napaMeters: 0,
          pending: true,
        });
        continue;
      }
      if (!(r.artisanal.baseQty > 0)) continue;
      const b = ensure(family, color);
      mergeDestination(b.destinations, {
        kind: 'Tira',
        label,
        strapMeters: r.totalQuantity > 0 ? r.totalQuantity : undefined,
        napaMeters: r.artisanal.baseQty,
        yieldPerMeter: r.artisanal.yieldPerMeter,
      });
      b.total += r.artisanal.baseQty;
      continue;
    }

    if (!BASE_MATERIAL_COMPONENTS.has(r.componentType)) continue;
    if (!BASE_LINEAR_UNITS.has((r.productUnit || '').toLowerCase())) continue;
    if (r.widthMissing || r.warning) {
      skipped++;
      continue;
    }
    if (!(r.totalQuantity > 0)) continue;

    const kind = DIRECT_LABEL[r.componentType];
    if (!kind) continue;

    const family = normalizeBaseFamilyName(r.groupName, r.color);
    const color = (r.color || '—').toString().trim() || '—';
    const b = ensure(family, color);
    mergeDestination(b.destinations, {
      kind,
      label: kind,
      napaMeters: r.totalQuantity,
    });
    b.total += r.totalQuantity;
  }

  const byFamilyColor = Array.from(buckets.values())
    .map((b) => ({
      ...b,
      destinations: b.destinations
        .slice()
        .sort((a, c) => c.napaMeters - a.napaMeters || a.label.localeCompare(c.label, 'pt-BR')),
    }))
    .filter((b) => b.total > 0 || b.destinations.some((d) => d.pending))
    .sort((a, b) => b.total - a.total || a.family.localeCompare(b.family, 'pt-BR'));

  if (byFamilyColor.length === 0) return null;

  const partsMap = new Map<string, number>();
  for (const b of byFamilyColor) {
    if (!(b.total > 0)) continue;
    partsMap.set(b.family, (partsMap.get(b.family) || 0) + b.total);
  }
  const parts = Array.from(partsMap.entries())
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty);

  return {
    total: parts.reduce((s, p) => s + p.qty, 0),
    byFamilyColor,
    parts,
    skipped,
    pendingCount,
  };
}

/** KPI plano a partir do rollup — espelha `computeBaseMaterialTotal`. */
export function rollupToBaseTotal(rollup: NapaRollup | null): BaseMaterialTotal | null {
  if (!rollup || rollup.parts.length === 0) return null;
  return {
    total: rollup.total,
    parts: rollup.parts,
    skipped: rollup.skipped,
  };
}
