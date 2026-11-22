/**
 * Leitura da fonte única `outsourced_pair_ledger`.
 * Os totais somam pares. Capacidade e excedente já vêm fechados por
 * prestador e período: cada par prestador+período entra uma vez.
 */

export type OutsourcedGrain = 'week' | 'fortnight' | 'month';

export type OutsourcedRegistration = 'ok' | 'sem_capacidade' | 'sem_prestador';

export interface OutsourcedPairLine {
  periodStart: string | null;
  periodLabel: string;
  anchorDate: string | null;
  anchorSource: string | null;
  saleOrderId: string | null;
  orderNumber: string | null;
  orderStatus: string | null;
  clientName: string | null;
  itemId: string | null;
  jobId: string | null;
  serviceOrderId: string | null;
  referenceId: string | null;
  referenceCode: string | null;
  color: string | null;
  sectorKey: string | null;
  sectorLabel: string | null;
  contractorId: string | null;
  contractorName: string | null;
  openInternal: boolean;
  demandPairs: number;
  sentPairs: number;
  receivedPairs: number;
  balancePairs: number;
  streetPairs: number;
  capacityPerDay: number | null;
  capacityPeriod: number | null;
  periodExcess: number | null;
  registration: OutsourcedRegistration;
}

export interface OutsourcedPairTotals {
  demand: number;
  sent: number;
  received: number;
  balance: number;
  street: number;
  capacity: number;
  excess: number;
  withoutRegistration: number;
  openInternal: number;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseOutsourcedPairLine(row: Record<string, unknown>): OutsourcedPairLine {
  const registration = row.registration === 'sem_capacidade' || row.registration === 'sem_prestador'
    ? row.registration
    : 'ok';
  return {
    periodStart: row.period_start == null ? null : String(row.period_start).slice(0, 10),
    periodLabel: String(row.period_label ?? 'Sem data de produção'),
    anchorDate: row.anchor_date == null ? null : String(row.anchor_date).slice(0, 10),
    anchorSource: row.anchor_source == null ? null : String(row.anchor_source),
    saleOrderId: row.sale_order_id == null ? null : String(row.sale_order_id),
    orderNumber: row.order_number == null ? null : String(row.order_number),
    orderStatus: row.order_status == null ? null : String(row.order_status),
    clientName: row.client_name == null ? null : String(row.client_name),
    itemId: row.item_id == null ? null : String(row.item_id),
    jobId: row.job_id == null ? null : String(row.job_id),
    serviceOrderId: row.service_order_id == null ? null : String(row.service_order_id),
    referenceId: row.reference_id == null ? null : String(row.reference_id),
    referenceCode: row.reference_code == null ? null : String(row.reference_code),
    color: row.color == null ? null : String(row.color),
    sectorKey: row.sector_key == null ? null : String(row.sector_key),
    sectorLabel: row.sector_label == null ? null : String(row.sector_label),
    contractorId: row.contractor_id == null ? null : String(row.contractor_id),
    contractorName: row.contractor_name == null ? null : String(row.contractor_name),
    openInternal: row.open_internal === true,
    demandPairs: num(row.demand_pairs),
    sentPairs: num(row.sent_pairs),
    receivedPairs: num(row.received_pairs),
    balancePairs: num(row.balance_pairs),
    streetPairs: num(row.street_pairs),
    capacityPerDay: numOrNull(row.capacity_per_day),
    capacityPeriod: numOrNull(row.capacity_period),
    periodExcess: numOrNull(row.period_excess),
    registration,
  };
}

/** Capacidade e excedente: uma vez por prestador no período. Pares: soma das linhas. */
export function totalsFromLedger(lines: readonly OutsourcedPairLine[]): OutsourcedPairTotals {
  const capacityKeys = new Map<string, number>();
  const excessKeys = new Map<string, number>();
  const totals: OutsourcedPairTotals = {
    demand: 0,
    sent: 0,
    received: 0,
    balance: 0,
    street: 0,
    capacity: 0,
    excess: 0,
    withoutRegistration: 0,
    openInternal: 0,
  };
  for (const line of lines) {
    totals.demand += line.demandPairs;
    totals.sent += line.sentPairs;
    totals.received += line.receivedPairs;
    totals.balance += line.balancePairs;
    totals.street += line.streetPairs;
    if (line.registration !== 'ok') totals.withoutRegistration += line.balancePairs;
    if (line.openInternal) totals.openInternal += line.balancePairs;
    if (line.contractorId && line.capacityPeriod != null) {
      capacityKeys.set(`${line.periodStart ?? ''}|${line.contractorId}`, line.capacityPeriod);
    }
    if (line.contractorId && line.periodExcess != null) {
      excessKeys.set(`${line.periodStart ?? ''}|${line.contractorId}`, line.periodExcess);
    }
  }
  totals.capacity = [...capacityKeys.values()].reduce((sum, value) => sum + value, 0);
  totals.excess = [...excessKeys.values()].reduce((sum, value) => sum + value, 0);
  return totals;
}

export function lineMatchesStatus(
  line: OutsourcedPairLine,
  status: '' | 'a_enviar' | 'na_rua' | 'recebido',
): boolean {
  if (status === 'a_enviar') return line.balancePairs > 0;
  if (status === 'na_rua') return line.streetPairs > 0;
  if (status === 'recebido') return line.receivedPairs > 0;
  return true;
}

export const GRAIN_LABEL: Record<OutsourcedGrain, string> = {
  week: 'Semana',
  fortnight: 'Quinzena',
  month: 'Mês',
};

export const ANCHOR_LABEL: Record<string, string> = {
  ready_date: 'pronto para produção',
  billing_week: 'semana de faturamento',
  service_date: 'data da OS',
};
