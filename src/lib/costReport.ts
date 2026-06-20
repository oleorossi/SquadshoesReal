import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

/**
 * Modelo unificado pros relatórios de custos de Ordem de Compra (OC) e Ordem de
 * Serviço (OS). Cada listagem (PurchaseOrders / Contractors→OS) converte suas
 * linhas pra `CostReportRow` e reusa as agregações + o gerador de PDF
 * (`costReportPdf.ts`). Mantém a lógica de soma/quebra num só lugar, testável,
 * sem depender de jsPDF nem do DOM.
 */

export type CostReportKind = 'OC' | 'OS';

/** Base de data usada nos filtros de período e nas quebras por mês. */
export type DateBasis = 'criacao' | 'vencimento';

export interface CostReportRow {
  id: string;
  /** Nº da OC/OS (order_number). */
  number: string;
  /** Fornecedor (OC) ou prestador/contratada (OS). */
  provider: string;
  description: string;
  /** Valor total da ordem (na moeda, já numérico). */
  total: number;
  /** ISO de criação (created_at). */
  createdAt: string;
  /** Data de negócio exibida no detalhamento (created_at na OC, service_date na OS). */
  date: string;
  /** Vencimento do pagamento (accounts_payable na OC, overview na OS). null = sem AP. */
  dueDate: string | null;
  /** Status cru (do banco). */
  status: string;
  /** Rótulo de status pra exibição. */
  statusLabel: string;
  /** Pagamento liquidado (status=paid). */
  isPaid: boolean;
  /** Ordem cancelada — excluída das somas, mas listada no detalhamento. */
  isCancelled: boolean;
}

/** Normaliza qualquer data (ISO ou yyyy-MM-dd) pra yyyy-MM-dd. '' quando vazio. */
function toDay(d: string | null | undefined): string {
  if (!d) return '';
  return d.length >= 10 ? d.slice(0, 10) : d;
}

/** Data efetiva da linha conforme a base escolhida (criação ou vencimento). */
export function rowDateForBasis(row: CostReportRow, basis: DateBasis): string {
  if (basis === 'vencimento') return toDay(row.dueDate) || toDay(row.createdAt);
  return toDay(row.createdAt);
}

/** True se `day` (yyyy-MM-dd) está dentro de [from, to] inclusivo. Limites vazios = aberto. */
export function inDateRange(day: string, from: string | null, to: string | null): boolean {
  if (!day) return !from && !to ? true : false;
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

/** Filtra por período usando a base de data. Aplicado depois dos filtros de tela. */
export function filterRowsByPeriod(
  rows: CostReportRow[],
  from: string | null,
  to: string | null,
  basis: DateBasis,
): CostReportRow[] {
  if (!from && !to) return rows;
  return rows.filter((r) => inDateRange(rowDateForBasis(r, basis), from, to));
}

/** Dinheiro de uma linha, já tratando cancelada (zera) e pago/pendente (binário). */
export function rowMoney(row: CostReportRow): { total: number; paid: number; pending: number } {
  if (row.isCancelled) return { total: 0, paid: 0, pending: 0 };
  const total = Number(row.total) || 0;
  return row.isPaid
    ? { total, paid: total, pending: 0 }
    : { total, paid: 0, pending: total };
}

export interface CostSummary {
  /** Total financeiro (exclui canceladas). */
  total: number;
  /** Qtd de ordens consideradas (exclui canceladas). */
  count: number;
  /** Qtd total de linhas, incluindo canceladas (pro detalhamento). */
  rowCount: number;
  /** Ticket médio = total / count. */
  avgTicket: number;
  paid: number;
  pending: number;
  /** % do total já pago (0–100). */
  paidPct: number;
}

export function summarizeRows(rows: CostReportRow[]): CostSummary {
  let total = 0;
  let paid = 0;
  let pending = 0;
  let count = 0;
  for (const r of rows) {
    const m = rowMoney(r);
    if (r.isCancelled) continue;
    total += m.total;
    paid += m.paid;
    pending += m.pending;
    count += 1;
  }
  return {
    total,
    count,
    rowCount: rows.length,
    avgTicket: count > 0 ? total / count : 0,
    paid,
    pending,
    paidPct: total > 0 ? (paid / total) * 100 : 0,
  };
}

export interface ProviderBreakdownRow {
  provider: string;
  count: number;
  total: number;
  paid: number;
  pending: number;
}

/** Quebra por prestador, ordenada por total desc. Canceladas não somam. */
export function groupByProvider(rows: CostReportRow[]): ProviderBreakdownRow[] {
  const map = new Map<string, ProviderBreakdownRow>();
  for (const r of rows) {
    if (r.isCancelled) continue;
    const key = r.provider || '—';
    let g = map.get(key);
    if (!g) {
      g = { provider: key, count: 0, total: 0, paid: 0, pending: 0 };
      map.set(key, g);
    }
    const m = rowMoney(r);
    g.count += 1;
    g.total += m.total;
    g.paid += m.paid;
    g.pending += m.pending;
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

export interface MonthBreakdownRow {
  /** Chave yyyy-MM. */
  month: string;
  label: string;
  count: number;
  total: number;
  paid: number;
  pending: number;
}

/** Rótulo legível de um mês 'yyyy-MM' → 'mai/2026'. */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return format(new Date(y, m - 1, 1), 'MMM/yyyy', { locale: ptBR });
}

/** Quebra por mês (usando a base de data), ordenada cronologicamente. */
export function groupByMonth(rows: CostReportRow[], basis: DateBasis): MonthBreakdownRow[] {
  const map = new Map<string, MonthBreakdownRow>();
  for (const r of rows) {
    if (r.isCancelled) continue;
    const day = rowDateForBasis(r, basis);
    const ym = day ? day.slice(0, 7) : 'sem-data';
    let g = map.get(ym);
    if (!g) {
      g = { month: ym, label: ym === 'sem-data' ? 'Sem data' : monthLabel(ym), count: 0, total: 0, paid: 0, pending: 0 };
      map.set(ym, g);
    }
    const m = rowMoney(r);
    g.count += 1;
    g.total += m.total;
    g.paid += m.paid;
    g.pending += m.pending;
  }
  return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
}

/** Slug seguro pra nome de arquivo (sem acento/espaço/barra). */
export function slugForFilename(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 40) || 'todos';
}
