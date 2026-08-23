/**
 * Conversão entre representação de faturamento (mês + semana) e data ISO.
 *
 * Por que duas representações?
 * - Mês + Semana ("2026-05" + "S4") é como o usuário/comercial raciocina:
 *   "vamos faturar esse pedido na 4ª semana de maio".
 * - delivery_deadline ISO ("2026-05-22") é o que triggers, queries e
 *   funções SQL consomem (cálculo de prazos, ordenação, filtros de data).
 *
 * A regra de conversão: a segunda-feira da semana N do mês. Se a segunda
 * cai no mês anterior, usa o primeiro dia do mês.
 *
 * Antes esta lógica vivia DUPLICADA em SaleOrderFormPanel + MinBillingDateSuggestionDialog,
 * com risco de drift. Centralizado aqui.
 */
export function monthWeekToISODate(monthValue: string, weekValue: string): string | null {
  if (!monthValue || !weekValue) return null;
  const [year, month] = monthValue.split('-').map(Number);
  const weekNum = parseInt(String(weekValue).replace(/\D/g, ''), 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(weekNum)) return null;

  const firstDay = new Date(year, month - 1, 1);
  const weekStart = new Date(firstDay);
  const dayOfWeek = weekStart.getDay();
  // Alinha pra segunda-feira da semana 1
  if (dayOfWeek !== 1) {
    weekStart.setDate(weekStart.getDate() - ((dayOfWeek + 6) % 7));
  }
  // Avança N-1 semanas
  weekStart.setDate(weekStart.getDate() + (weekNum - 1) * 7);
  // Clampa: se a segunda cair no mês anterior, usa dia 1 do mês selecionado
  if (weekStart < firstDay) {
    return `${year}-${String(month).padStart(2, '0')}-${String(firstDay.getDate()).padStart(2, '0')}`;
  }
  return `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
}

/**
 * Converte uma data ISO (YYYY-MM-DD) para o par { month: "YYYY-MM", week: "Sn" }
 * que o formulário usa nos campos delivery_month / delivery_week. Inverso de
 * monthWeekToISODate. Necessário porque os handlers de confirmação/override
 * da semana mínima recebem só uma data ISO mas têm que recompor os 2 campos
 * pra não disparar o "selecione o mês de faturamento" no submit subsequente.
 */
export function isoToMonthWeek(iso: string): { month: string; week: string } | null {
  if (!iso) return null;
  const [yStr, mStr, dStr] = iso.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

  const target = new Date(year, month - 1, day);
  const firstDay = new Date(year, month - 1, 1);
  // Segunda-feira da semana 1 (mesma regra do monthWeekToISODate).
  const week1 = new Date(firstDay);
  const dow = week1.getDay();
  if (dow !== 1) week1.setDate(week1.getDate() - ((dow + 6) % 7));

  const daysDelta = Math.floor((target.getTime() - week1.getTime()) / 86_400_000);
  const weekNum = Math.max(1, Math.floor(daysDelta / 7) + 1);
  return {
    month: `${year}-${String(month).padStart(2, '0')}`,
    week: `S${weekNum}`,
  };
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_WEEK_TOKEN_RE = /^(\d{4}-\d{2})-(S\d{1,2})$/i;

/**
 * Converte qualquer token de faturamento que o PV possa carregar em
 * `delivery_deadline` (ISO, "2026-09-S3", vazio) para YYYY-MM-DD.
 *
 * Sem isto o writer atômico faz `jsonb_populate_record` numa coluna `date` e
 * o Postgres recusa com `invalid input syntax for type date: "2026-09-S3"`.
 */
export function coerceToISODate(
  value: string | null | undefined,
  month?: string | null,
  week?: string | null,
): string | null {
  const raw = String(value ?? '').trim();
  if (ISO_DATE_RE.test(raw)) return raw;

  const monthWeek = raw.match(MONTH_WEEK_TOKEN_RE);
  if (monthWeek) return monthWeekToISODate(monthWeek[1], monthWeek[2].toUpperCase());

  if (raw) return null;

  const derived = monthWeekToISODate(String(month ?? '').trim(), String(week ?? '').trim());
  if (derived) return derived;
  return null;
}

/**
 * Chave canônica persistida em `sale_orders.billing_week` (texto): "YYYY-MM-S#".
 * Espelha o que `useCreateSaleOrder` já gravava; a edição precisava da mesma
 * regra pra não deixar a semana do header defasada do mês/semana do form.
 */
export function billingWeekFromMonthWeek(
  month?: string | null,
  week?: string | null,
): string | null {
  const m = String(month ?? '').trim();
  const w = String(week ?? '').trim();
  if (m && w) {
    const already = w.match(MONTH_WEEK_TOKEN_RE);
    if (already) return `${already[1]}-${already[2].toUpperCase()}`;
    return `${m}-${w}`;
  }
  if (w && MONTH_WEEK_TOKEN_RE.test(w)) {
    const already = w.match(MONTH_WEEK_TOKEN_RE)!;
    return `${already[1]}-${already[2].toUpperCase()}`;
  }
  return w || null;
}

const DATE_HEADER_KEYS = [
  'delivery_deadline',
  'original_min_billing_date',
  'nfe_first_due_date',
] as const;

/**
 * Normaliza o header do PV antes de ir pra RPC. Colunas `date` só saem como
 * ISO ou null — nunca como "2026-09-S3".
 */
export function sanitizeSaleOrderHeaderDates<T extends Record<string, unknown>>(
  header: T,
): T & {
  delivery_deadline: string | null;
  billing_week?: string | null;
  original_min_billing_date?: string | null;
  nfe_first_due_date?: string | null;
} {
  const month = typeof header.delivery_month === 'string' ? header.delivery_month : '';
  const week = typeof header.delivery_week === 'string' ? header.delivery_week : '';
  const next: Record<string, unknown> = { ...header };

  for (const key of DATE_HEADER_KEYS) {
    if (!(key in next)) continue;
    next[key] = coerceToISODate(
      typeof next[key] === 'string' || next[key] == null ? (next[key] as string | null) : String(next[key]),
      month,
      week,
    );
  }

  if (!('delivery_deadline' in next) || !next.delivery_deadline) {
    const derived = coerceToISODate(null, month, week);
    if (derived) next.delivery_deadline = derived;
    else next.delivery_deadline = null;
  }

  const billing = billingWeekFromMonthWeek(month, week);
  if (billing) next.billing_week = billing;

  return next as T & {
    delivery_deadline: string | null;
    billing_week?: string | null;
    original_min_billing_date?: string | null;
    nfe_first_due_date?: string | null;
  };
}
