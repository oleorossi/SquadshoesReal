import {
  businessDaysBetween,
  categoryDefaultsFor,
  computeParallelWindows,
  type SectorOffsets,
} from '@/lib/sectorCapacity';

export const CUT_SECTORS = ['Corte Fibra', 'Corte Palmilha', 'Corte Forração', 'Corte Cabedal'] as const;
export const AVIAMENTO_SECTORS = ['Aviamento', 'Mesa'] as const;
export const CABEDAL_SECTORS = ['Costura Cabedal'] as const;

export type EarlyLaneKey = 'aviamento' | 'cabedal' | 'cortes';

export interface EarlyLane {
  key: EarlyLaneKey;
  label: string;
  start: string | null;
  end: string | null;
  pairs: number;
}

export interface EarlyReleaseOp {
  order_id: string;
  order_number: string | null;
  reference_id: string;
  reference_name: string | null;
  photo_url: string | null;
  color: string | null;
  quantity: number;
  planned_delivery: string | null;
  sale_order_id: string | null;
  sale_order_number: string | null;
}

export interface EarlyReleaseScheduleRow {
  order_id: string;
  sector: string;
  date: string;
  planned_pairs: number;
}

export interface EarlyReleaseRow {
  reference_id: string;
  reference_name: string;
  photo_url: string | null;
  colors: string[];
  pairs: number;
  opCount: number;
  pvCount: number;
  opNumbers: string[];
  lanes: EarlyLane[];
  /** Dias úteis que o setor mais antecipado sai na frente dos cortes. */
  daysAhead: number;
  source: 'agenda' | 'cascata' | 'misto';
}

export interface EarlyReleaseBoard {
  rows: EarlyReleaseRow[];
  horizonStart: string | null;
  horizonEnd: string | null;
  totals: {
    references: number;
    pairs: number;
    ops: number;
    avgDaysAhead: number;
    aviamentoPairs: number;
    cabedalPairs: number;
  };
}

const LANE_DEFS: { key: EarlyLaneKey; label: string; sectors: readonly string[] }[] = [
  { key: 'aviamento', label: 'Aviamento', sectors: AVIAMENTO_SECTORS },
  { key: 'cabedal', label: 'Costura Cabedal', sectors: CABEDAL_SECTORS },
  { key: 'cortes', label: 'Cortes (produção)', sectors: CUT_SECTORS },
];

function localISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function parseISODate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function minIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

function laneFromSchedule(
  ops: EarlyReleaseOp[],
  schedule: EarlyReleaseScheduleRow[],
  sectors: readonly string[],
): { start: string | null; end: string | null; pairs: number } {
  const ids = new Set(ops.map((o) => o.order_id));
  const sectorSet = new Set(sectors);
  let start: string | null = null;
  let end: string | null = null;
  let pairs = 0;
  for (const row of schedule) {
    if (!ids.has(row.order_id) || !sectorSet.has(row.sector)) continue;
    const qty = Number(row.planned_pairs) || 0;
    if (qty <= 0 || !row.date) continue;
    const day = row.date.slice(0, 10);
    start = minIso(start, day);
    end = maxIso(end, day);
    pairs += qty;
  }
  return { start, end, pairs };
}

function laneFromWindows(
  sheet: any,
  qty: number,
  deadlineISO: string,
  categoryDefaults: any,
  offsets: SectorOffsets,
  key: EarlyLaneKey,
): { start: string | null; end: string | null; pairs: number } {
  const deadline = parseISODate(deadlineISO);
  if (!deadline || qty <= 0 || !sheet) return { start: null, end: null, pairs: 0 };
  const w = computeParallelWindows(sheet, qty, deadline, categoryDefaults, offsets);
  if (key === 'aviamento') {
    if (!w.mesa.required) return { start: null, end: null, pairs: 0 };
    return { start: localISO(w.mesa.start), end: localISO(w.mesa.end), pairs: qty };
  }
  if (key === 'cabedal') {
    if (!w.costura_cabedal.required) return { start: null, end: null, pairs: 0 };
    return { start: localISO(w.costura_cabedal.start), end: localISO(w.costura_cabedal.end), pairs: qty };
  }
  const cortes = [w.corte_palmilha, w.corte_forracao].filter((lane) => lane.required);
  if (cortes.length === 0) return { start: null, end: null, pairs: 0 };
  const start = cortes.reduce((m, lane) => (lane.start < m ? lane.start : m), cortes[0].start);
  const end = cortes.reduce((m, lane) => (lane.end > m ? lane.end : m), cortes[0].end);
  return { start: localISO(start), end: localISO(end), pairs: qty };
}

function daysAheadOf(early: string | null, cortes: string | null): number {
  const a = parseISODate(early);
  const b = parseISODate(cortes);
  if (!a || !b || a >= b) return 0;
  return businessDaysBetween(a, b);
}

export function buildEarlyReleaseBoard(input: {
  ops: EarlyReleaseOp[];
  schedule: EarlyReleaseScheduleRow[];
  sheetMap: Map<string, any>;
  categoryDefaultsMap?: Map<string, any> | null;
  offsets?: SectorOffsets;
}): EarlyReleaseBoard {
  const { ops, schedule, sheetMap, categoryDefaultsMap, offsets = {} } = input;
  const byRef = new Map<string, EarlyReleaseOp[]>();
  for (const op of ops) {
    if (!op.reference_id || op.quantity <= 0) continue;
    const list = byRef.get(op.reference_id) ?? [];
    list.push(op);
    byRef.set(op.reference_id, list);
  }

  const rows: EarlyReleaseRow[] = [];
  for (const [reference_id, group] of byRef) {
    const pairs = group.reduce((s, o) => s + o.quantity, 0);
    const sheet = sheetMap.get(reference_id);
    const earliestDue = group
      .map((o) => o.planned_delivery)
      .filter((d): d is string => !!d)
      .sort()[0] ?? null;
    const defaults = categoryDefaultsFor(sheet, categoryDefaultsMap);

    let usedAgenda = false;
    let usedCascata = false;
    const lanes: EarlyLane[] = LANE_DEFS.map((def) => {
      const fromAgenda = laneFromSchedule(group, schedule, def.sectors);
      if (fromAgenda.start) {
        usedAgenda = true;
        return { key: def.key, label: def.label, ...fromAgenda };
      }
      const fromWindows = laneFromWindows(sheet, pairs, earliestDue ?? '', defaults, offsets, def.key);
      if (fromWindows.start) usedCascata = true;
      return { key: def.key, label: def.label, ...fromWindows };
    });

    const aviamento = lanes.find((l) => l.key === 'aviamento');
    const cabedal = lanes.find((l) => l.key === 'cabedal');
    const cortes = lanes.find((l) => l.key === 'cortes');
    const earliestEarly = minIso(aviamento?.start ?? null, cabedal?.start ?? null);
    const daysAhead = daysAheadOf(earliestEarly, cortes?.start ?? null);

    const colors = [...new Set(group.map((o) => (o.color || '').trim()).filter(Boolean))];
    const pvs = new Set(group.map((o) => o.sale_order_id).filter(Boolean));
    const opNumbers = group.map((o) => o.order_number).filter((n): n is string => !!n);

    rows.push({
      reference_id,
      reference_name: group.find((o) => o.reference_name)?.reference_name || sheet?.name || sheet?.code || 'Referência',
      photo_url: group.find((o) => o.photo_url)?.photo_url || sheet?.image_url || null,
      colors,
      pairs,
      opCount: group.length,
      pvCount: pvs.size,
      opNumbers,
      lanes,
      daysAhead,
      source: usedAgenda && usedCascata ? 'misto' : usedAgenda ? 'agenda' : 'cascata',
    });
  }

  rows.sort((a, b) => b.daysAhead - a.daysAhead || b.pairs - a.pairs || a.reference_name.localeCompare(b.reference_name, 'pt-BR'));

  let horizonStart: string | null = null;
  let horizonEnd: string | null = null;
  for (const row of rows) {
    for (const lane of row.lanes) {
      horizonStart = minIso(horizonStart, lane.start);
      horizonEnd = maxIso(horizonEnd, lane.end);
    }
  }

  const withAhead = rows.filter((r) => r.daysAhead > 0);
  const totals = {
    references: rows.length,
    pairs: rows.reduce((s, r) => s + r.pairs, 0),
    ops: rows.reduce((s, r) => s + r.opCount, 0),
    avgDaysAhead: withAhead.length
      ? Math.round(withAhead.reduce((s, r) => s + r.daysAhead, 0) / withAhead.length)
      : 0,
    aviamentoPairs: rows.reduce((s, r) => s + (r.lanes.find((l) => l.key === 'aviamento')?.pairs ?? 0), 0),
    cabedalPairs: rows.reduce((s, r) => s + (r.lanes.find((l) => l.key === 'cabedal')?.pairs ?? 0), 0),
  };

  return { rows, horizonStart, horizonEnd, totals };
}

/** Posição percentual de uma data ISO no horizonte [start, end]. */
export function horizonPct(iso: string | null, start: string | null, end: string | null): number {
  const a = parseISODate(start);
  const b = parseISODate(end);
  const t = parseISODate(iso);
  if (!a || !b || !t || b.getTime() <= a.getTime()) return 0;
  const pct = ((t.getTime() - a.getTime()) / (b.getTime() - a.getTime())) * 100;
  return Math.max(0, Math.min(100, pct));
}
