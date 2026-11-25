/**
 * Gestão · Setores — derivação PURA do panorama de setores.
 *
 * Fonte única: `get_sector_panorama` (mig 20270101060000), que devolve a fila
 * do motor NA ORDEM DO MOTOR (`queue_position`), a agenda setor×dia do último
 * run, as etapas abertas de cada OP, o gate de material e os jobs do Ateliê.
 *
 * Regras desta camada:
 *   • NÃO reordena a fila nem recalcula agenda — só agrega e sinaliza.
 *   • Pares reais = `remaining_pairs_net` / `remaining` da etapa. Nunca a carga
 *     pares·setor (`remaining_pairs` da view).
 *   • Sugestões são TEXTO de apoio à decisão: nada aqui executa movimento.
 */

// ── Tipos do RPC ────────────────────────────────────────────────────────────

export interface PanoramaSector {
  sector: string;
  flow_order: number;
  enabled: boolean;
  parallel_group: string | null;
  daily_capacity_pairs: number;
}

export interface PanoramaAtelierJob {
  sector: string;
  status: string;
  mode: string | null;
  pairs: number;
  received_pairs: number;
  target_end: string | null;
}

export interface PanoramaOpenStage {
  sector: string;
  stage_order: number;
  status: string;
  remaining: number;
  blocked_until: string | null;
}

export interface PanoramaOp {
  order_id: string;
  order_number: string;
  order_status: string | null;
  queue_status: string | null;
  queue_position: number;
  pinned_position: number | null;
  sale_order_id: string | null;
  sale_order_number: string | null;
  sale_order_status: string | null;
  sale_order_deleted_at: string | null;
  client_name: string | null;
  reference_id: string | null;
  reference_name: string | null;
  color: string | null;
  quantity: number;
  remaining_pairs_net: number;
  due_date: string | null;
  projected_completion: string | null;
  next_scheduled_date: string | null;
  late_days: number;
  route_progress_pct: number;
  is_ahead_of_schedule: boolean;
  material_ready_date: string | null;
  material_gate_reason: string | null;
  atelier: PanoramaAtelierJob[];
  open_stages: PanoramaOpenStage[];
}

export interface PanoramaScheduleRow {
  order_id: string;
  sector: string;
  date: string;
  planned_pairs: number;
  carryover_pairs: number;
  day_fraction: number;
}

export interface SectorPanoramaData {
  from: string;
  to: string;
  generated_at: string;
  last_run: { ran_at: string; ran_on: string } | null;
  sectors: PanoramaSector[];
  ops: PanoramaOp[];
  schedule: PanoramaScheduleRow[];
}

// ── Datas (ISO yyyy-mm-dd, sem fuso) ────────────────────────────────────────

function parseISO(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addDaysISO(iso: string, n: number): string {
  const d = parseISO(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}
export function isWorkday(iso: string): boolean {
  const wd = parseISO(iso).getUTCDay();
  return wd !== 0 && wd !== 6;
}
/** Segunda-feira da semana do dia (semana de faturamento começa na segunda). */
export function weekStartISO(iso: string): string {
  const d = parseISO(iso);
  const wd = d.getUTCDay(); // 0=dom
  const back = wd === 0 ? 6 : wd - 1;
  d.setUTCDate(d.getUTCDate() - back);
  return toISO(d);
}
export function nextWorkdayISO(iso: string): string {
  let d = addDaysISO(iso, 1);
  while (!isWorkday(d)) d = addDaysISO(d, 1);
  return d;
}
/** Dias úteis (seg–sex) de [from, to). Feriados não entram — a agenda do motor já os pula. */
export function workdaysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d < to; d = addDaysISO(d, 1)) if (isWorkday(d)) out.push(d);
  return out;
}
export function fmtDM(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}`;
}

// ── Classificação da OP ─────────────────────────────────────────────────────

/** Setor do Ateliê → nome do setor no motor. */
export const ATELIER_SECTOR_TO_ENGINE: Record<string, string> = {
  costura_cabedal: 'Costura Cabedal',
  aviamento: 'Aviamento',
  corte_cabedal: 'Corte Cabedal',
};

const AWAITING_CUT = new Set(['awaiting_cut', 'cut']);
const AT_CONTRACTOR = new Set(['partially_sent', 'sent_to_contractor', 'realized', 'partially_received']);
const ATELIER_DONE = new Set(['received_at_factory', 'done']);

export type CabedalKind = 'complexo' | 'simples';
export type AtelierState = 'aguardando_corte' | 'no_prestador' | 'em_atelie' | 'concluido' | null;

export interface OpFlags {
  kind: CabedalKind;
  atelierState: AtelierState;
  /** Cabedal ainda não voltou do prestador/Ateliê: montagem não pode puxar. */
  waitingAtelier: boolean;
  /** Material sem data de chegada ou chegando depois de hoje. */
  waitingMaterial: boolean;
  materialReason: string | null;
  late: boolean;
  /** Setores onde a OP está AGORA (primeira etapa aberta + paralelas do mesmo grupo). */
  currentSectors: string[];
  /** Setores executados fora da fábrica (prestador) para esta OP. */
  outsourcedSectors: Set<string>;
}

export function cabedalKind(op: Pick<PanoramaOp, 'atelier'>): CabedalKind {
  return op.atelier && op.atelier.length > 0 ? 'complexo' : 'simples';
}

export function atelierState(op: Pick<PanoramaOp, 'atelier'>): AtelierState {
  const jobs = (op.atelier || []).filter(j => j.status !== 'cancelled');
  if (jobs.length === 0) return null;
  if (jobs.some(j => AT_CONTRACTOR.has(j.status))) return 'no_prestador';
  if (jobs.some(j => AWAITING_CUT.has(j.status))) return 'aguardando_corte';
  if (jobs.every(j => ATELIER_DONE.has(j.status))) return 'concluido';
  return 'em_atelie';
}

export function opFlags(
  op: PanoramaOp,
  today: string,
  groupOf: Map<string, string | null>,
  materialShortPv?: Set<string>,
): OpFlags {
  const kind = cabedalKind(op);
  const aState = atelierState(op);
  const outsourced = new Set<string>();
  for (const j of op.atelier || []) {
    if (j.status === 'cancelled') continue;
    if (j.mode === 'internal') continue; // regra da fábrica: complexo vai pro prestador
    const eng = ATELIER_SECTOR_TO_ENGINE[j.sector];
    if (eng && eng !== 'Corte Cabedal') outsourced.add(eng);
  }
  const gateBlocks = !!op.material_gate_reason
    && (!op.material_ready_date || op.material_ready_date > today);
  const pvShort = !!op.sale_order_id && !!materialShortPv?.has(op.sale_order_id);

  const stages = [...(op.open_stages || [])].sort((a, b) => a.stage_order - b.stage_order);
  const current: string[] = [];
  if (stages.length) {
    const first = stages[0];
    const grp = groupOf.get(first.sector) ?? null;
    current.push(first.sector);
    if (grp) {
      for (const s of stages.slice(1)) {
        if ((groupOf.get(s.sector) ?? null) === grp) current.push(s.sector);
      }
    }
  }
  return {
    kind,
    atelierState: aState,
    waitingAtelier: aState === 'aguardando_corte' || aState === 'no_prestador' || aState === 'em_atelie',
    waitingMaterial: gateBlocks || pvShort,
    materialReason: op.material_gate_reason ?? (pvShort ? 'Falta de material no PV' : null),
    late: (op.late_days ?? 0) > 0,
    currentSectors: current,
    outsourcedSectors: outsourced,
  };
}

// ── Filtros ─────────────────────────────────────────────────────────────────

export interface PanoramaFilters {
  /** Segunda-feira da semana (agenda OU faturamento) ou 'todas'. */
  week: string;
  pv: string;
  reference: string;
  color: string;
  kind: 'todos' | CabedalKind;
  onlyLate: boolean;
  onlyBlocked: boolean;
}

export const EMPTY_FILTERS: PanoramaFilters = {
  week: 'todas', pv: 'todos', reference: 'todas', color: 'todas', kind: 'todos', onlyLate: false, onlyBlocked: false,
};

export function filterOps(
  ops: PanoramaOp[],
  flags: Map<string, OpFlags>,
  schedule: PanoramaScheduleRow[],
  f: PanoramaFilters,
): PanoramaOp[] {
  let weekOps: Set<string> | null = null;
  if (f.week !== 'todas') {
    weekOps = new Set();
    for (const r of schedule) if (weekStartISO(r.date) === f.week) weekOps.add(r.order_id);
    for (const op of ops) if (op.due_date && weekStartISO(op.due_date) === f.week) weekOps.add(op.order_id);
  }
  return ops.filter(op => {
    const fl = flags.get(op.order_id);
    if (weekOps && !weekOps.has(op.order_id)) return false;
    if (f.pv !== 'todos' && (op.sale_order_number ?? '') !== f.pv) return false;
    if (f.reference !== 'todas' && (op.reference_name ?? '') !== f.reference) return false;
    if (f.color !== 'todas' && (op.color ?? '') !== f.color) return false;
    if (f.kind !== 'todos' && fl?.kind !== f.kind) return false;
    if (f.onlyLate && !fl?.late) return false;
    if (f.onlyBlocked && !(fl?.waitingAtelier || fl?.waitingMaterial)) return false;
    return true;
  });
}

// ── Carga × capacidade ──────────────────────────────────────────────────────

export interface LoadCell {
  sector: string;
  key: string; // dia ISO ou segunda-feira da semana
  plannedPairs: number;
  /** Fração de dia usada pelo motor (1 = dia cheio). Soma das frações das OPs. */
  load: number;
  /** Dias úteis cobertos pela célula (1 no modo dia). */
  days: number;
  capacityPairs: number;
  /** load / days × 100 — ocupação planejada da FÁBRICA. */
  occupancyPct: number;
  /** Pares agendados no setor que na verdade rodam no prestador (fora da fábrica). */
  outsourcedPairs: number;
  ops: number;
}

export function occupancyTone(pct: number): 'idle' | 'ok' | 'high' | 'over' {
  if (pct > 100) return 'over';
  if (pct >= 85) return 'high';
  if (pct >= 40) return 'ok';
  return 'idle';
}

export function buildLoadMatrix(
  sectors: PanoramaSector[],
  schedule: PanoramaScheduleRow[],
  opIds: Set<string>,
  flags: Map<string, OpFlags>,
  days: string[],
  mode: 'dia' | 'semana',
): { columns: string[]; cells: Map<string, LoadCell> } {
  const columns = mode === 'dia' ? days : [...new Set(days.map(weekStartISO))];
  const daysPerCol = new Map<string, number>();
  for (const d of days) {
    const k = mode === 'dia' ? d : weekStartISO(d);
    daysPerCol.set(k, (daysPerCol.get(k) || 0) + 1);
  }
  const capOf = new Map(sectors.map(s => [s.sector, s.daily_capacity_pairs || 0]));
  const cells = new Map<string, LoadCell>();
  const opsPer = new Map<string, Set<string>>();
  const cellKey = (s: string, k: string) => `${s}|${k}`;
  for (const s of sectors) {
    for (const k of columns) {
      const n = daysPerCol.get(k) || 0;
      cells.set(cellKey(s.sector, k), {
        sector: s.sector, key: k, plannedPairs: 0, load: 0, days: n,
        capacityPairs: (capOf.get(s.sector) || 0) * n, occupancyPct: 0, outsourcedPairs: 0, ops: 0,
      });
    }
  }
  for (const r of schedule) {
    if (!opIds.has(r.order_id)) continue;
    const k = mode === 'dia' ? r.date : weekStartISO(r.date);
    const c = cells.get(cellKey(r.sector, k));
    if (!c) continue;
    if (flags.get(r.order_id)?.outsourcedSectors.has(r.sector)) {
      c.outsourcedPairs += r.planned_pairs || 0;
      continue;
    }
    c.plannedPairs += r.planned_pairs || 0;
    c.load += Number(r.day_fraction) || 0;
    const set = opsPer.get(cellKey(r.sector, k)) ?? new Set<string>();
    set.add(r.order_id);
    opsPer.set(cellKey(r.sector, k), set);
  }
  for (const [k, c] of cells) {
    c.occupancyPct = c.days > 0 ? Math.round((c.load / c.days) * 100) : 0;
    c.ops = opsPer.get(k)?.size ?? 0;
  }
  return { columns, cells };
}

/**
 * Pressão de PRAZO por setor×semana (acumulada): pares que ainda faltam passar
 * pelo setor para OPs que faturam até o fim da semana W, sobre a capacidade
 * de dias úteis de hoje até o fim de W. É aqui que aparece "120%": a agenda do
 * motor nunca passa de 100% num dia — ela empurra a data, e o excesso vira atraso.
 * OP com prazo vencido conta na primeira semana. Etapa no prestador não conta.
 */
export interface DeadlinePressure {
  sector: string;
  week: string;
  requiredPairs: number;
  capacityPairs: number;
  pct: number;
}

export function buildDeadlinePressure(
  sectors: PanoramaSector[],
  ops: PanoramaOp[],
  flags: Map<string, OpFlags>,
  today: string,
  weeks: string[],
): Map<string, DeadlinePressure> {
  const out = new Map<string, DeadlinePressure>();
  for (const s of sectors) {
    if (!s.enabled) continue;
    for (const w of weeks) {
      const weekEnd = addDaysISO(w, 7);
      let required = 0;
      for (const op of ops) {
        if (!op.due_date) continue;
        if (op.due_date >= weekEnd) continue;
        if (flags.get(op.order_id)?.outsourcedSectors.has(s.sector)) continue;
        const st = op.open_stages.find(x => x.sector === s.sector);
        if (st) required += st.remaining || 0;
      }
      const capDays = workdaysBetween(today, weekEnd).length;
      const cap = capDays * (s.daily_capacity_pairs || 0);
      out.set(`${s.sector}|${w}`, {
        sector: s.sector, week: w, requiredPairs: required, capacityPairs: cap,
        pct: cap > 0 ? Math.round((required / cap) * 100) : (required > 0 ? 999 : 0),
      });
    }
  }
  return out;
}

// ── Fila por setor (ordem do motor) ─────────────────────────────────────────

export interface SectorQueueItem {
  op: PanoramaOp;
  flags: OpFlags;
  pairsAtSector: number;
  isCurrent: boolean;
  firstDate: string | null;
  lastDate: string | null;
  outsourced: boolean;
}

export function buildSectorQueues(
  sectors: PanoramaSector[],
  ops: PanoramaOp[],
  flags: Map<string, OpFlags>,
  schedule: PanoramaScheduleRow[],
): Map<string, SectorQueueItem[]> {
  const span = new Map<string, { first: string; last: string }>();
  for (const r of schedule) {
    const k = `${r.order_id}|${r.sector}`;
    const cur = span.get(k);
    if (!cur) span.set(k, { first: r.date, last: r.date });
    else {
      if (r.date < cur.first) cur.first = r.date;
      if (r.date > cur.last) cur.last = r.date;
    }
  }
  const out = new Map<string, SectorQueueItem[]>();
  for (const s of sectors) out.set(s.sector, []);
  // `ops` já chega na ordem do motor; ordena de novo por segurança.
  const ordered = [...ops].sort((a, b) => a.queue_position - b.queue_position);
  for (const op of ordered) {
    const fl = flags.get(op.order_id)!;
    for (const st of op.open_stages) {
      const list = out.get(st.sector);
      if (!list) continue;
      const sp = span.get(`${op.order_id}|${st.sector}`);
      list.push({
        op, flags: fl, pairsAtSector: st.remaining,
        isCurrent: fl.currentSectors.includes(st.sector),
        firstDate: sp?.first ?? null, lastDate: sp?.last ?? null,
        outsourced: fl.outsourcedSectors.has(st.sector),
      });
    }
  }
  return out;
}

// ── Sugestões do motor (apoio à decisão — nada é executado) ─────────────────

export type SuggestionKind = 'sobrecarga' | 'ocioso' | 'atraso' | 'prestador' | 'material' | 'gargalo';

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  severity: 1 | 2 | 3; // 3 = mais urgente
  sector?: string;
  orderId?: string;
  title: string;
  detail: string;
}

export interface SuggestionInput {
  today: string;
  sectors: PanoramaSector[];
  ops: PanoramaOp[];
  flags: Map<string, OpFlags>;
  schedule: PanoramaScheduleRow[];
  dayCells: Map<string, LoadCell>;
  pressure: Map<string, DeadlinePressure>;
  weeks: string[];
}

const fmtPairs = (n: number) => Math.round(n).toLocaleString('pt-BR');

export function buildSuggestions(inp: SuggestionInput, limit = 10): Suggestion[] {
  const out: Suggestion[] = [];
  const enabled = inp.sectors.filter(s => s.enabled);

  // 1) Sobrecarga de prazo: UM alerta por semana, com os setores estourados
  //    (antes da agregação, 9 setores iguais viravam 9 cartões idênticos).
  for (const w of inp.weeks) {
    const over = enabled
      .map(s => inp.pressure.get(`${s.sector}|${w}`))
      .filter((p): p is DeadlinePressure => !!p && p.pct > 100 && p.requiredPairs > 0)
      .sort((a, b) => b.pct - a.pct);
    if (over.length === 0) continue;
    const worst = over[0];
    const names = over.slice(0, 4).map(p => `${p.sector} ${p.pct}%`).join(', ');
    const more = over.length > 4 ? ` e mais ${over.length - 4}` : '';
    const excess = worst.requiredPairs - worst.capacityPairs;
    out.push({
      id: `sobrecarga:${w}`, kind: 'sobrecarga', severity: worst.pct >= 120 ? 3 : 2,
      sector: over.length === 1 ? worst.sector : undefined,
      title: over.length === 1
        ? `${worst.sector} a ${worst.pct}% até a semana de ${fmtDM(w)}`
        : `${over.length} setores acima de 100% até a semana de ${fmtDM(w)}`,
      detail: `Para faturar o que vence até ${fmtDM(addDaysISO(w, 6))}: ${names}${more}. No pior, faltam ${fmtPairs(worst.requiredPairs)} pares para ${fmtPairs(worst.capacityPairs)} de capacidade (${fmtPairs(excess)} acima). Avaliar hora extra, reforço de equipe ou renegociar prazo.`,
    });
  }

  // 2) Setor ocioso no próximo dia útil que pode puxar OP liberada
  const tomorrow = nextWorkdayISO(inp.today);
  const scheduledTomorrow = new Set(
    inp.schedule.filter(r => r.date === tomorrow).map(r => `${r.order_id}|${r.sector}`),
  );
  const ordered = [...inp.ops].sort((a, b) => a.queue_position - b.queue_position);
  for (const s of enabled) {
    const cell = inp.dayCells.get(`${s.sector}|${tomorrow}`);
    const occ = cell?.occupancyPct ?? 0;
    if (occ >= 60) continue;
    const candidate = ordered.find(op => {
      const fl = inp.flags.get(op.order_id);
      if (!fl || fl.waitingMaterial) return false;
      if (fl.outsourcedSectors.has(s.sector)) return false;
      if (!fl.currentSectors.includes(s.sector)) return false;
      if (scheduledTomorrow.has(`${op.order_id}|${s.sector}`)) return false;
      const st = op.open_stages.find(x => x.sector === s.sector);
      return !!st && st.remaining > 0;
    });
    if (candidate) {
      const st = candidate.open_stages.find(x => x.sector === s.sector)!;
      const free = Math.max(0, Math.round(((100 - occ) / 100) * (s.daily_capacity_pairs || 0)));
      out.push({
        id: `ocioso:${s.sector}:${candidate.order_id}`, kind: 'ocioso', severity: 2, sector: s.sector, orderId: candidate.order_id,
        title: `${s.sector} a ${occ}% em ${fmtDM(tomorrow)}: pode puxar ${candidate.order_number}`,
        detail: `${candidate.sale_order_number ?? 's/ PV'} · ${candidate.reference_name ?? ''} ${candidate.color ?? ''} — ${fmtPairs(st.remaining)} pares já liberados neste setor, ~${fmtPairs(free)} pares de folga no dia. Primeira na ordem do motor.`,
      });
    }
  }

  // 3) OPs atrasadas: prazo de faturamento × previsão do motor
  for (const op of ordered) {
    const fl = inp.flags.get(op.order_id);
    if (!fl?.late) continue;
    const why = fl.waitingAtelier
      ? ' Cabedal complexo ainda não voltou do Ateliê/prestador.'
      : fl.waitingMaterial ? ` Material: ${fl.materialReason ?? 'pendente'}.` : '';
    out.push({
      id: `atraso:${op.order_id}`, kind: 'atraso', severity: op.late_days >= 7 ? 3 : 2, orderId: op.order_id,
      title: `${op.order_number} atrasa ${op.late_days} dia${op.late_days === 1 ? '' : 's'} (${op.sale_order_number ?? 's/ PV'})`,
      detail: `Fatura ${fmtDM(op.due_date)}, previsão ${fmtDM(op.projected_completion)}.${fl.currentSectors.length ? ` Hoje em ${fl.currentSectors.join(' + ')}.` : ''}${why}`,
    });
  }

  // 4) Cabedal complexo sem corte com prazo perto (prestador precisa de tempo)
  for (const op of ordered) {
    const fl = inp.flags.get(op.order_id);
    if (!fl || fl.atelierState !== 'aguardando_corte' || !op.due_date) continue;
    const daysToDue = workdaysBetween(inp.today, op.due_date).length;
    if (daysToDue > 15) continue;
    out.push({
      id: `prestador:${op.order_id}`, kind: 'prestador', severity: daysToDue <= 5 ? 3 : 2, orderId: op.order_id,
      title: `Cabedal complexo de ${op.order_number} ainda aguardando corte`,
      detail: `${op.reference_name ?? ''} ${op.color ?? ''} · ${fmtPairs(op.remaining_pairs_net)} pares · faltam ${daysToDue} dias úteis para ${fmtDM(op.due_date)}. Cortar e enviar ao prestador antes de puxar a montagem; intercalar com cabedal simples nesse intervalo.`,
    });
  }

  // 5) Material travando OP
  for (const op of ordered) {
    const fl = inp.flags.get(op.order_id);
    if (!fl?.waitingMaterial) continue;
    out.push({
      id: `material:${op.order_id}`, kind: 'material', severity: fl.late ? 3 : 1, orderId: op.order_id,
      title: `${op.order_number} aguardando material`,
      detail: `${fl.materialReason ?? 'Material pendente'}${op.material_ready_date ? ` · previsto ${fmtDM(op.material_ready_date)}` : ' · sem data de chegada'}.`,
    });
  }

  // 6) Gargalo: setor com mais dias de trabalho na fila (pares da fábrica ÷ capacidade)
  const bn = bottleneckSectors(inp.sectors, inp.ops, inp.flags);
  if (bn.sectors.length > 0 && bn.days >= 1) {
    const tied = bn.sectors.length > 1;
    out.push({
      id: `gargalo:${bn.sectors.join(',')}`, kind: 'gargalo', severity: 1,
      sector: tied ? undefined : bn.sectors[0],
      title: tied
        ? `Carga equilibrada: ${bn.sectors.length} setores com ~${bn.days.toFixed(1)} dias de fila`
        : `Gargalo: ${bn.sectors[0]} (${bn.days.toFixed(1)} dias de fila)`,
      detail: tied
        ? 'Nenhum setor isolado segura a fábrica; o ritmo é dado pela capacidade igual de todos. Reforçar um setor só ajuda se os vizinhos acompanharem.'
        : 'É o setor que dita o ritmo da fábrica. Proteger a capacidade dele (sem parada por falta de material ou de cabedal) rende mais que acelerar os outros.',
    });
  }

  return out
    .sort((a, b) => b.severity - a.severity)
    .slice(0, limit);
}

/**
 * Gargalo = setor com mais DIAS DE TRABALHO na fila: pares que ainda vão
 * passar por ele (só na fábrica; etapa no prestador não conta) ÷ capacidade
 * diária. Setores a menos de 5% do maior empatam — com capacidades iguais e
 * todas as etapas abertas, apontar UM gargalo seria inventar.
 */
export function bottleneckSectors(
  sectors: PanoramaSector[],
  ops: PanoramaOp[],
  flags: Map<string, OpFlags>,
): { sectors: string[]; days: number } {
  const daysOf = new Map<string, number>();
  for (const s of sectors) {
    if (!s.enabled || !(s.daily_capacity_pairs > 0)) continue;
    let pairs = 0;
    for (const op of ops) {
      if (flags.get(op.order_id)?.outsourcedSectors.has(s.sector)) continue;
      for (const st of op.open_stages) if (st.sector === s.sector) pairs += st.remaining || 0;
    }
    if (pairs > 0) daysOf.set(s.sector, pairs / s.daily_capacity_pairs);
  }
  const max = Math.max(0, ...daysOf.values());
  if (max <= 0) return { sectors: [], days: 0 };
  const tied = sectors.filter(s => (daysOf.get(s.sector) ?? 0) >= max * 0.95).map(s => s.sector);
  return { sectors: tied, days: max };
}
