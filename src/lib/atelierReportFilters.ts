/**
 * Filtros do relatório operacional do Ateliê (cliente, prazo, semana, cor, material).
 */

export interface AtelierReportFilterInput {
  clientName: string | null | undefined;
  deliveryDeadline: string | null | undefined;
  billingWeek: string | null | undefined;
  color: string | null | undefined;
  /** Tipagens de material no kit (Cabedal, Forração, …) ou nome do cabedal da ficha. */
  materialLabels: readonly string[];
}

export interface AtelierReportFilters {
  client: string;
  /** ISO date yyyy-mm-dd inclusive start */
  dateFrom: string;
  /** ISO date yyyy-mm-dd inclusive end */
  dateTo: string;
  week: string;
  color: string;
  material: string;
}

export const EMPTY_ATELIER_REPORT_FILTERS: AtelierReportFilters = {
  client: '',
  dateFrom: '',
  dateTo: '',
  week: '',
  color: '',
  material: '',
};

function norm(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase();
}

function dayKey(iso: string | null | undefined): string {
  return String(iso ?? '').slice(0, 10);
}

/** Semana ISO aproximada a partir da data de entrega (quando não há billing_week). */
export function weekKeyFromDeadline(iso: string | null | undefined): string {
  const d = dayKey(iso);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  const dt = new Date(`${d}T12:00:00`);
  if (Number.isNaN(dt.getTime())) return '';
  // ISO week: Thursday-based
  const day = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - day + 3);
  const week1 = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((dt.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getUTCDay() + 6) % 7)) / 7,
    );
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function matchesAtelierReportFilters(
  row: AtelierReportFilterInput,
  filters: AtelierReportFilters,
): boolean {
  if (filters.client) {
    if (!norm(row.clientName).includes(norm(filters.client))) return false;
  }
  const deadline = dayKey(row.deliveryDeadline);
  if (filters.dateFrom && (!deadline || deadline < filters.dateFrom)) return false;
  if (filters.dateTo && (!deadline || deadline > filters.dateTo)) return false;
  if (filters.week) {
    const week = String(row.billingWeek ?? '').trim() || weekKeyFromDeadline(row.deliveryDeadline);
    if (!norm(week).includes(norm(filters.week))) return false;
  }
  if (filters.color) {
    if (!norm(row.color).includes(norm(filters.color))) return false;
  }
  if (filters.material) {
    const needle = norm(filters.material);
    const hit = row.materialLabels.some((m) => norm(m).includes(needle));
    if (!hit) return false;
  }
  return true;
}

export function collectFilterOptions(rows: readonly AtelierReportFilterInput[]): {
  clients: string[];
  colors: string[];
  materials: string[];
  weeks: string[];
} {
  const clients = new Set<string>();
  const colors = new Set<string>();
  const materials = new Set<string>();
  const weeks = new Set<string>();
  for (const r of rows) {
    if (r.clientName?.trim()) clients.add(r.clientName.trim());
    if (r.color?.trim()) colors.add(r.color.trim());
    for (const m of r.materialLabels) {
      if (m?.trim()) materials.add(m.trim());
    }
    const week = String(r.billingWeek ?? '').trim() || weekKeyFromDeadline(r.deliveryDeadline);
    if (week) weeks.add(week);
  }
  const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });
  return {
    clients: [...clients].sort(collator.compare),
    colors: [...colors].sort(collator.compare),
    materials: [...materials].sort(collator.compare),
    weeks: [...weeks].sort(),
  };
}
