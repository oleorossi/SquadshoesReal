/**
 * Projeção semanal de compras (spec: projecao-compras-semanal-integrada).
 *
 * Balde operacional = semana civil segunda–domingo.
 * Grade por semana de USO; R$ de caixa na semana de COMPRA (uso − lead time).
 * Forecast só após a 4ª semana do horizonte.
 */

export const FIRM_HORIZON_WEEKS = 4;

/** Status de OC que reduzem necessidade líquida / entram em "OC aberta". */
export const OPEN_PO_STATUSES = [
  'pending',
  'approved',
  'sent',
  'parcial',
] as const;

export type PeriodMode = 'semana' | 'quinzena1' | 'quinzena2' | 'mes';

export interface CalendarWeek {
  /** Segunda-feira YYYY-MM-DD (local) */
  weekStart: string;
  /** Domingo YYYY-MM-DD */
  weekEnd: string;
  /** Índice 0-based no horizonte */
  index: number;
  /** true se index >= FIRM_HORIZON_WEEKS — zona onde forecast pode entrar */
  allowsForecast: boolean;
}

export interface ProjectionNeedInput {
  productId: string;
  productName: string;
  sku?: string | null;
  color?: string | null;
  unit: string;
  /** Necessidade bruta na unidade de estoque (antes do líquido, se disponível) */
  qtyGross?: number;
  /** Estoque disponível líquido (on_hand − reserved) */
  availableNow?: number;
  /** Qtd em OC aberta (já filtrada no servidor; client ainda valida status se vier cru) */
  qtyOnOrder?: number;
  /** Necessidade líquida sugerida (canônica de v_mrp_needs.suggested_qty) */
  qtyNet: number;
  /** Data de uso na fábrica (ISO date) */
  useDate: string | null;
  /** Comprar até (ISO date) — se null, deriva de useDate − leadTimeDays */
  buyByDate?: string | null;
  leadTimeDays?: number | null;
  purchasePrice?: number | null;
  sector?: string | null;
  groupId?: string | null;
  groupName?: string | null;
  isPackaging?: boolean;
  isArtisanal?: boolean;
  /** true = demanda de forecast (não firme) */
  isForecast?: boolean;
}

export interface ProjectionWeeklyRow {
  key: string;
  productId: string;
  productName: string;
  sku: string | null;
  color: string | null;
  unit: string;
  sector: string;
  groupId: string | null;
  groupName: string | null;
  useDate: string | null;
  buyByDate: string | null;
  useWeekStart: string | null;
  buyWeekStart: string | null;
  qtyGross: number;
  qtyOnOrder: number;
  availableNow: number;
  qtyNet: number;
  purchasePrice: number | null;
  amountNeed: number;
  noPrice: boolean;
  overdue: boolean;
  leadTimeMissing: boolean;
  isForecast: boolean;
  isPackaging: boolean;
  isArtisanal: boolean;
  /** Selecionável para gerar OC (firme, qty > 0, não embalagem/artesanal) */
  selectable: boolean;
}

export interface MonthlyEvalRow {
  productId: string;
  productName: string;
  unit: string;
  sector: string;
  groupId: string | null;
  groupName: string | null;
  needQty: number;
  needBrl: number;
  ocOpenQty: number;
  ocOpenBrl: number;
  receivedQty: number;
  receivedBrl: number;
  gap: number;
  coveragePct: number;
  overdue: boolean;
  noPrice: boolean;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** YYYY-MM-DD em calendário local (evita drift de UTC). */
export function toLocalISODate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function parseLocalISODate(iso: string): Date {
  const [y, m, day] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, day);
}

/** Segunda-feira da semana civil que contém `date`. */
export function startOfCalendarWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay(); // 0=dom … 6=sáb
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

export function endOfCalendarWeek(weekStart: Date): Date {
  const d = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate());
  d.setDate(d.getDate() + 6);
  return d;
}

export function weekStartISO(date: Date | string): string {
  const d = typeof date === 'string' ? parseLocalISODate(date) : date;
  return toLocalISODate(startOfCalendarWeek(d));
}

/** Subtrai N dias corridos (lead time no client; espelha offset simples quando buy_by já vem do servidor). */
export function subtractCalendarDays(isoDate: string, days: number): string {
  const d = parseLocalISODate(isoDate);
  d.setDate(d.getDate() - Math.max(0, Math.floor(days || 0)));
  return toLocalISODate(d);
}

export function addCalendarDays(isoDate: string, days: number): string {
  const d = parseLocalISODate(isoDate);
  d.setDate(d.getDate() + Math.max(0, Math.floor(days || 0)));
  return toLocalISODate(d);
}

/**
 * Monta N semanas a partir da segunda da semana de `from` (default: hoje).
 * Semanas com index >= FIRM_HORIZON_WEEKS permitem forecast.
 */
export function buildCalendarWeeks(
  horizonWeeks: number,
  from: Date = new Date(),
): CalendarWeek[] {
  const n = Math.max(1, Math.floor(horizonWeeks || FIRM_HORIZON_WEEKS));
  const start = startOfCalendarWeek(from);
  const weeks: CalendarWeek[] = [];
  for (let i = 0; i < n; i++) {
    const ws = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    ws.setDate(ws.getDate() + i * 7);
    const we = endOfCalendarWeek(ws);
    weeks.push({
      weekStart: toLocalISODate(ws),
      weekEnd: toLocalISODate(we),
      index: i,
      allowsForecast: i >= FIRM_HORIZON_WEEKS,
    });
  }
  return weeks;
}

/** Quinzena civil: 1 = dias 1–15; 2 = 16–fim. */
export function quinzenaOfDate(isoDate: string): 1 | 2 {
  const day = parseLocalISODate(isoDate).getDate();
  return day <= 15 ? 1 : 2;
}

export function monthKeyOfDate(isoDate: string): string {
  return isoDate.slice(0, 7); // YYYY-MM
}

/**
 * Preço de cadastro: null/undefined/<=0 ⇒ ausente (R$ 0 + alerta).
 * Spec: purchase_price do cadastro.
 */
export function resolvePurchasePrice(price: number | null | undefined): {
  price: number | null;
  noPrice: boolean;
  amount: (qty: number) => number;
} {
  const ok = price != null && Number.isFinite(price) && price > 0;
  const p = ok ? Number(price) : null;
  return {
    price: p,
    noPrice: !ok,
    amount: (qty: number) => (ok ? Math.max(0, qty) * (p as number) : 0),
  };
}

/**
 * Necessidade líquida.
 * Se `qtyNet` veio do motor, usa-o.
 * Senão: max(0, gross − available − onOrder).
 * OC draft/cancelled NÃO devem entrar em onOrder (filtrar antes de chamar).
 */
export function computeQtyNet(input: {
  qtyNet?: number | null;
  qtyGross?: number | null;
  availableNow?: number | null;
  qtyOnOrder?: number | null;
}): number {
  if (input.qtyNet != null && Number.isFinite(input.qtyNet)) {
    return Math.max(0, Number(input.qtyNet));
  }
  const gross = Number(input.qtyGross) || 0;
  const avail = Number(input.availableNow) || 0;
  const onOrder = Number(input.qtyOnOrder) || 0;
  return Math.max(0, gross - avail - onOrder);
}

export function isOpenPoStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return (OPEN_PO_STATUSES as readonly string[]).includes(status);
}

/**
 * Resolve datas de uso e compra.
 * Preferência: buyByDate explícito (order_by_date do MRP); useDate explícito;
 * senão use = buy + lead; senão buy = use − lead.
 */
export function resolveUseAndBuyDates(input: {
  useDate?: string | null;
  buyByDate?: string | null;
  leadTimeDays?: number | null;
}): { useDate: string | null; buyByDate: string | null; leadTimeMissing: boolean } {
  const lead = input.leadTimeDays != null && Number.isFinite(input.leadTimeDays)
    ? Math.max(0, Number(input.leadTimeDays))
    : null;
  const leadTimeMissing = lead == null;

  let buy = input.buyByDate ? input.buyByDate.slice(0, 10) : null;
  let use = input.useDate ? input.useDate.slice(0, 10) : null;

  if (buy && !use) {
    use = lead != null ? addCalendarDays(buy, lead) : buy;
  } else if (use && !buy) {
    buy = lead != null ? subtractCalendarDays(use, lead) : use;
  } else if (!use && !buy) {
    return { useDate: null, buyByDate: null, leadTimeMissing };
  }

  return { useDate: use, buyByDate: buy, leadTimeMissing };
}

export function buildProjectionRow(
  input: ProjectionNeedInput,
  todayISO: string = toLocalISODate(new Date()),
): ProjectionWeeklyRow {
  const { useDate, buyByDate, leadTimeMissing } = resolveUseAndBuyDates({
    useDate: input.useDate,
    buyByDate: input.buyByDate,
    leadTimeDays: input.leadTimeDays,
  });
  const qtyNet = computeQtyNet({
    qtyNet: input.qtyNet,
    qtyGross: input.qtyGross,
    availableNow: input.availableNow,
    qtyOnOrder: input.qtyOnOrder,
  });
  const priced = resolvePurchasePrice(input.purchasePrice);
  const isForecast = Boolean(input.isForecast);
  const isPackaging = Boolean(input.isPackaging);
  const isArtisanal = Boolean(input.isArtisanal);
  const overdue = Boolean(buyByDate && buyByDate < todayISO && qtyNet > 0);
  const selectable =
    qtyNet > 0 && !isForecast && !isPackaging && !isArtisanal;

  return {
    key: `${input.productId}:${useDate ?? 'na'}:${isForecast ? 'f' : 'firm'}`,
    productId: input.productId,
    productName: input.productName,
    sku: input.sku ?? null,
    color: input.color ?? null,
    unit: input.unit || 'un',
    sector: (input.sector && input.sector.trim()) || '—',
    groupId: input.groupId ?? null,
    groupName: input.groupName ?? null,
    useDate,
    buyByDate,
    useWeekStart: useDate ? weekStartISO(useDate) : null,
    buyWeekStart: buyByDate ? weekStartISO(buyByDate) : null,
    qtyGross: Number(input.qtyGross) || qtyNet,
    qtyOnOrder: Number(input.qtyOnOrder) || 0,
    availableNow: Number(input.availableNow) || 0,
    qtyNet,
    purchasePrice: priced.price,
    amountNeed: priced.amount(qtyNet),
    noPrice: priced.noPrice,
    overdue,
    leadTimeMissing,
    isForecast,
    isPackaging,
    isArtisanal,
    selectable,
  };
}

/**
 * Filtra linhas pelo horizonte: forecast só em semanas com allowsForecast.
 * Linhas firmes sem useWeek no horizonte são excluídas se weeks for passado.
 */
export function filterRowsForHorizon(
  rows: ProjectionWeeklyRow[],
  weeks: CalendarWeek[],
): ProjectionWeeklyRow[] {
  const byStart = new Map(weeks.map((w) => [w.weekStart, w]));
  return rows.filter((r) => {
    if (!r.useWeekStart) return r.qtyNet > 0; // sem data: ainda listar se há necessidade
    const w = byStart.get(r.useWeekStart);
    if (!w) {
      // fora do horizonte de uso — incluir se buy week está no horizonte (atrasados recentes)
      if (r.buyWeekStart && byStart.has(r.buyWeekStart)) return true;
      return false;
    }
    if (r.isForecast && !w.allowsForecast) return false;
    return true;
  });
}

export function filterBySectorGroup(
  rows: ProjectionWeeklyRow[],
  sector: string | null | undefined,
  groupId: string | null | undefined,
): ProjectionWeeklyRow[] {
  let out = rows;
  if (sector && sector !== 'Todos') {
    if (sector === 'Sem setor' || sector === '—') {
      out = out.filter((r) => !r.sector || r.sector === '—');
    } else {
      out = out.filter((r) => r.sector === sector);
    }
  }
  if (groupId) {
    out = out.filter((r) => r.groupId === groupId);
  }
  return out;
}

export function filterByPeriodMode(
  rows: ProjectionWeeklyRow[],
  mode: PeriodMode,
  anchor: Date = new Date(),
): ProjectionWeeklyRow[] {
  if (mode === 'semana') return rows;
  const anchorISO = toLocalISODate(anchor);
  const month = monthKeyOfDate(anchorISO);
  if (mode === 'mes') {
    return rows.filter((r) => {
      const d = r.useDate || r.buyByDate;
      return d ? monthKeyOfDate(d) === month : true;
    });
  }
  const q = mode === 'quinzena1' ? 1 : 2;
  return rows.filter((r) => {
    const d = r.useDate || r.buyByDate;
    if (!d) return true;
    return monthKeyOfDate(d) === month && quinzenaOfDate(d) === q;
  });
}

/** Totais de R$ de caixa por semana de COMPRA. */
export function cashTotalsByBuyWeek(rows: ProjectionWeeklyRow[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const r of rows) {
    if (!r.buyWeekStart || r.amountNeed <= 0) continue;
    totals[r.buyWeekStart] = (totals[r.buyWeekStart] || 0) + r.amountNeed;
  }
  return totals;
}

/** Qtd líquida agregada por semana de USO (por productId). */
export function qtyByUseWeek(rows: ProjectionWeeklyRow[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    if (!r.useWeekStart || r.qtyNet <= 0) continue;
    if (!out[r.productId]) out[r.productId] = {};
    out[r.productId][r.useWeekStart] =
      (out[r.productId][r.useWeekStart] || 0) + r.qtyNet;
  }
  return out;
}

/**
 * % cobertura sugerido na spec:
 * min(1, (available + on_order) / gross) quando gross > 0.
 */
export function coveragePct(available: number, onOrder: number, gross: number): number {
  if (!gross || gross <= 0) return 1;
  return Math.min(1, (Math.max(0, available) + Math.max(0, onOrder)) / gross);
}

export function buildMonthlyEvalRows(
  rows: ProjectionWeeklyRow[],
  receivedByProduct: Record<string, { qty: number; brl: number }> = {},
): MonthlyEvalRow[] {
  const map = new Map<string, MonthlyEvalRow>();
  for (const r of rows) {
    const cur = map.get(r.productId) ?? {
      productId: r.productId,
      productName: r.productName,
      unit: r.unit,
      sector: r.sector,
      groupId: r.groupId,
      groupName: r.groupName,
      needQty: 0,
      needBrl: 0,
      ocOpenQty: 0,
      ocOpenBrl: 0,
      receivedQty: 0,
      receivedBrl: 0,
      gap: 0,
      coveragePct: 0,
      overdue: false,
      noPrice: false,
    };
    cur.needQty += r.qtyNet;
    cur.needBrl += r.amountNeed;
    cur.ocOpenQty += r.qtyOnOrder;
    const unitPrice = r.purchasePrice ?? 0;
    cur.ocOpenBrl += r.qtyOnOrder * unitPrice;
    cur.overdue = cur.overdue || r.overdue;
    cur.noPrice = cur.noPrice || r.noPrice;
    map.set(r.productId, cur);
  }
  for (const row of map.values()) {
    const recv = receivedByProduct[row.productId];
    if (recv) {
      row.receivedQty = recv.qty;
      row.receivedBrl = recv.brl;
    }
    const gross = row.needQty + row.ocOpenQty; // aproximação: líquido + já pedido
    row.coveragePct = coveragePct(0, row.ocOpenQty + row.receivedQty, Math.max(gross, row.needQty));
    row.gap = Math.max(0, row.needQty - row.receivedQty);
  }
  return [...map.values()].sort((a, b) => a.productName.localeCompare(b.productName, 'pt-BR'));
}

export function filterMonthlyRows(
  rows: MonthlyEvalRow[],
  opts: {
    onlyOverdue?: boolean;
    onlyGap?: boolean;
    onlyNoPrice?: boolean;
    minCoverage?: number | null;
    maxCoverage?: number | null;
  } = {},
): MonthlyEvalRow[] {
  return rows.filter((r) => {
    if (opts.onlyOverdue && !r.overdue) return false;
    if (opts.onlyGap && !(r.gap > 0)) return false;
    if (opts.onlyNoPrice && !r.noPrice) return false;
    if (opts.minCoverage != null && r.coveragePct < opts.minCoverage) return false;
    if (opts.maxCoverage != null && r.coveragePct > opts.maxCoverage) return false;
    return true;
  });
}
