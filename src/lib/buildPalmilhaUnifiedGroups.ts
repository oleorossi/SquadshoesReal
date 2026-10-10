/**
 * Monta grupos da ficha Palmilha unificada a partir dos SoleSilkGroup
 * (mesmo builder da Forração) + consumo de placas.
 *
 * Soft ≠ Madrid: já vem separado via liningMaterial / liningBreakdown.
 */
import {
  classifyPalmilhaCardKind,
  cardKindMatchesMode,
  effectiveCardKindForMode,
  palmilhaCardKey,
  type PalmilhaPrintMode,
} from '@/lib/palmilhaUnifiedCard';
import type { PalmilhaUnifiedCard, PalmilhaUnifiedSoleGroup } from '@/components/production/PalmilhaUnifiedWorkSheet';
import type { ConsumptionRow } from '@/hooks/useBulkOrderConsumption';

/** Subconjunto do SilkColorGroup que o builder precisa. */
export interface PalmilhaSilkColorInput {
  color: string;
  colorHex?: string;
  liningMaterial?: string;
  requiresLiningCut?: boolean;
  combinedGrid: Record<string, number>;
  totalPairs: number;
  fichas?: number;
  baseGradeSum?: number;
  baseGrid?: Record<string, number>;
  mixedGrades?: boolean;
  corrugadosMistos?: boolean;
  fichasAproximadas?: boolean;
  opNumbers?: string[];
  pvNumbers?: string[];
  refs?: Array<{ key?: string; code: string; name: string; color?: string; image_url?: string | null; insolePerforated?: boolean }>;
  lotInfo?: { number: number; total: number };
  liningBreakdown?: Map<string, {
    material: string;
    combinedGrid: Record<string, number>;
    totalPairs: number;
    fichas?: number;
    baseGradeSum?: number;
    baseGrid?: Record<string, number>;
    mixedGrades?: boolean;
    corrugadosMistos?: boolean;
    fichasAproximadas?: boolean;
    opNumbers: string[];
    pvNumbers: string[];
  }>;
}

export interface PalmilhaSilkSoleInput {
  soleName: string;
  colorGroups: PalmilhaSilkColorInput[];
  totalPairs: number;
}

export interface BuildPalmilhaUnifiedArgs {
  mode: PalmilhaPrintMode;
  soleGroups: PalmilhaSilkSoleInput[];
  /** OPs com passo fibra no roteiro (e não 100% pronta). */
  opsNeedFibra: Set<string>;
  /** OPs com passo forração no roteiro. */
  opsNeedForracao: Set<string>;
  /** Resolve grupo da placa a partir dos opNumbers do card. */
  resolvePlateGroup: (opNumbers: string[]) => string;
  /** Consumo filtrado (placas + forração) para os OPs do card. */
  consumptionForOps: (opNumbers: string[]) => ConsumptionRow[];
  clientNamesForPvs: (pvNumbers?: string[]) => string[];
}

function expandByLining(cg: PalmilhaSilkColorInput): PalmilhaSilkColorInput[] {
  const bd = cg.liningBreakdown;
  if (bd && bd.size > 1) {
    return Array.from(bd.values()).map(lb => ({
      ...cg,
      liningMaterial: lb.material || undefined,
      combinedGrid: { ...lb.combinedGrid },
      totalPairs: lb.totalPairs,
      fichas: lb.fichas,
      baseGradeSum: lb.baseGradeSum,
      baseGrid: lb.baseGrid ? { ...lb.baseGrid } : undefined,
      mixedGrades: lb.mixedGrades,
      corrugadosMistos: lb.corrugadosMistos,
      fichasAproximadas: lb.fichasAproximadas,
      opNumbers: [...lb.opNumbers],
      pvNumbers: [...lb.pvNumbers],
      liningBreakdown: undefined,
    }));
  }
  if (bd && bd.size === 1) {
    const only = Array.from(bd.values())[0];
    return [{ ...cg, liningMaterial: only.material || cg.liningMaterial }];
  }
  return [cg];
}

function anyOpIn(ops: string[] | undefined, set: Set<string>): boolean {
  if (!ops || ops.length === 0) return false;
  return ops.some(op => set.has(op));
}

export function buildPalmilhaUnifiedGroups(
  args: BuildPalmilhaUnifiedArgs,
): { groups: PalmilhaUnifiedSoleGroup[]; allSizes: string[] } {
  const sizeSet = new Set<string>();
  const out: PalmilhaUnifiedSoleGroup[] = [];

  for (const sole of args.soleGroups) {
    const cardMap = new Map<string, PalmilhaUnifiedCard>();

    for (const raw of sole.colorGroups) {
      for (const cg of expandByLining(raw)) {
        const ops = cg.opNumbers || [];
        const needsFibra = anyOpIn(ops, args.opsNeedFibra);
        const needsForracao =
          cg.requiresLiningCut === true && anyOpIn(ops, args.opsNeedForracao);
        const kind0 = classifyPalmilhaCardKind({ needsFibra, needsForracao });
        if (!kind0) continue;
        if (!cardKindMatchesMode(kind0, args.mode)) continue;
        const kind = effectiveCardKindForMode(kind0, args.mode);

        const plateGroup = args.resolvePlateGroup(ops) || '∅';
        const liningGroup = (cg.liningMaterial || '').trim() || '∅';
        const key = palmilhaCardKey({
          soleName: sole.soleName,
          color: cg.color,
          plateGroup,
          liningGroup: kind === 'so_fibra' ? '∅' : liningGroup,
          lotPartition: cg.lotInfo && cg.lotInfo.total > 1
            ? `${cg.lotInfo.number}/${cg.lotInfo.total}`
            : undefined,
        });

        const consumption = args.consumptionForOps(ops);
        const plateOps = consumption
          .filter(r =>
            r.component === 'Palmilha'
            && (r.unit || '').toLowerCase() === 'placa'
            && (r.required || 0) > 0,
          )
          .map(r => ({
            name: r.product_name,
            qty: r.required,
            unit: r.unit || 'placa',
          }));

        const existing = cardMap.get(key);
        if (!existing) {
          const grade = { ...cg.combinedGrid };
          for (const [sz, q] of Object.entries(grade)) {
            if ((Number(q) || 0) > 0) sizeSet.add(sz);
          }
          cardMap.set(key, {
            kind,
            soleName: sole.soleName,
            color: cg.color,
            colorHex: cg.colorHex,
            plateGroup,
            liningGroup: kind === 'so_fibra' ? '' : (liningGroup === '∅' ? '' : liningGroup),
            totalPairs: cg.totalPairs,
            grade,
            baseGrade: cg.baseGrid ? { ...cg.baseGrid } : undefined,
            baseGradeSum: cg.baseGradeSum,
            fichas: cg.fichas,
            mixedGrades: cg.mixedGrades,
            corrugadosMistos: cg.corrugadosMistos,
            fichasAproximadas: cg.fichasAproximadas,
            refs: cg.refs ? [...cg.refs] : [],
            opNumbers: [...ops],
            pvNumbers: [...(cg.pvNumbers || [])],
            clientNames: args.clientNamesForPvs(cg.pvNumbers),
            lotInfo: cg.lotInfo,
            plateOps: kind === 'so_forracao' ? [] : plateOps,
            consumption: kind === 'so_fibra' ? [] : consumption,
          });
          continue;
        }

        // Fuse same key (refs agregam)
        existing.totalPairs += cg.totalPairs;
        existing.fichas = (existing.fichas || 0) + (cg.fichas || 0);
        if (cg.mixedGrades) existing.mixedGrades = true;
        if (cg.corrugadosMistos) existing.corrugadosMistos = true;
        if (cg.fichasAproximadas) existing.fichasAproximadas = true;
        if (existing.baseGradeSum && cg.baseGradeSum && existing.baseGradeSum !== cg.baseGradeSum) {
          existing.mixedGrades = true;
          existing.corrugadosMistos = true;
        }
        for (const [sz, q] of Object.entries(cg.combinedGrid || {})) {
          const n = Number(q) || 0;
          if (n > 0) {
            existing.grade[sz] = (existing.grade[sz] || 0) + n;
            sizeSet.add(sz);
          }
        }
        for (const op of ops) {
          if (op && !existing.opNumbers?.includes(op)) existing.opNumbers!.push(op);
        }
        for (const pv of cg.pvNumbers || []) {
          if (pv && !existing.pvNumbers?.includes(pv)) existing.pvNumbers!.push(pv);
        }
        if (cg.refs) {
          existing.refs = existing.refs || [];
          for (const r of cg.refs) {
            if (!existing.refs.some(x => (x.code || x.name) === (r.code || r.name))) {
              existing.refs.push(r);
            }
          }
        }
        if (kind !== 'so_forracao') {
          existing.plateOps = [...(existing.plateOps || []), ...plateOps];
        }
        if (kind !== 'so_fibra') {
          existing.consumption = [...(existing.consumption || []), ...consumption];
        }
        existing.clientNames = args.clientNamesForPvs(existing.pvNumbers);
      }
    }

    const cards = Array.from(cardMap.values()).sort((a, b) =>
      a.color.localeCompare(b.color, 'pt-BR') || a.liningGroup.localeCompare(b.liningGroup, 'pt-BR'),
    );
    if (cards.length > 0) {
      out.push({
        soleName: sole.soleName,
        cards,
        totalPairs: cards.reduce((s, c) => s + c.totalPairs, 0),
      });
    }
  }

  const allSizes = Array.from(sizeSet).sort((a, b) => {
    const na = parseInt(String(a).split('/')[0], 10);
    const nb = parseInt(String(b).split('/')[0], 10);
    if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
    return String(a).localeCompare(String(b), 'pt-BR');
  });

  return { groups: out, allSizes };
}

/** Normaliza deep-link legado Corte Palmilha/Forração → trio Palmilha. */
export function normalizePalmilhaPrintSectors(
  sectors: readonly string[],
): string[] {
  const out: string[] = [];
  let wantFibra = false;
  let wantForro = false;
  let wantCombined = false;
  for (const s of sectors) {
    if (s === 'Palmilha') { wantCombined = true; continue; }
    if (s === 'Só Fibra' || s === 'Corte Palmilha' || s === 'Corte Fibra') {
      wantFibra = true;
      continue;
    }
    if (s === 'Só Forração' || s === 'Corte Forração') {
      wantForro = true;
      continue;
    }
    out.push(s);
  }
  if (wantCombined || (wantFibra && wantForro)) out.unshift('Palmilha');
  else if (wantFibra) out.unshift('Só Fibra');
  else if (wantForro) out.unshift('Só Forração');
  return out;
}
