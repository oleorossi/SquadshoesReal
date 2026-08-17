import { searchMatchesAllTerms } from '@/lib/searchUtils';

export type LabelJobFilter = 'attention' | 'confirmed' | 'failed' | 'all';

export interface LabelPrintJobLike {
  batch_name: string | null;
  status: string | null;
  total_labels: number | null;
  order_ids: unknown;
}

export interface LabelScanGroupLike {
  groupKey: string;
  refCode: string;
  refName: string;
  saleOrderNumber: string;
  clientOrderNumber?: string;
  orderNumbers: string[];
}

export function summarizePrintJobs(jobs: LabelPrintJobLike[]) {
  const summary = {
    confirmedLabels: 0,
    awaitingConfirmation: 0,
    generating: 0,
    failed: 0,
  };

  for (const job of jobs) {
    if (job.status === 'confirmed') summary.confirmedLabels += job.total_labels || 0;
    if (job.status === 'generated') summary.awaitingConfirmation += 1;
    if (job.status === 'pending') summary.generating += 1;
    if (job.status === 'failed') summary.failed += 1;
  }

  return summary;
}

export function filterPrintJobs<T extends LabelPrintJobLike>(
  jobs: T[],
  filter: LabelJobFilter,
  search: string,
): T[] {
  return jobs.filter(job => {
    const status = job.status || 'pending';
    const matchesFilter = filter === 'all'
      || (filter === 'attention' && ['generated', 'pending', 'failed'].includes(status))
      || (filter === 'confirmed' && status === 'confirmed')
      || (filter === 'failed' && status === 'failed');
    if (!matchesFilter) return false;

    const orderIds = Array.isArray(job.order_ids) ? job.order_ids.join(' ') : '';
    return searchMatchesAllTerms(search, job.batch_name, status, orderIds);
  });
}

function normalizeScan(value: string): string {
  return value.trim().toLocaleUpperCase('pt-BR').replace(/[^A-Z0-9]/g, '');
}

export function findLabelGroupForScan<T extends LabelScanGroupLike>(groups: T[], rawCode: string): T | undefined {
  const code = normalizeScan(rawCode);
  if (!code) return undefined;

  return groups.find(group => {
    const identifiers = [
      group.groupKey,
      group.refCode,
      group.refName,
      group.saleOrderNumber,
      group.clientOrderNumber || '',
      ...group.orderNumbers,
    ].map(normalizeScan).filter(Boolean);

    return identifiers.some(identifier => identifier === code)
      || identifiers.some(identifier => identifier.length >= 4 && code.includes(identifier));
  });
}
