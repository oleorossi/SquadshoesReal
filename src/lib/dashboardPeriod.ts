/**
 * Filtros de período do Dashboard principal (Painel /dashboard).
 * Default = mês vigente. Cada período retorna ISO start/end pra filtrar
 * queries por created_at.
 */
import { startOfMonth, endOfMonth, subMonths, startOfYear, endOfYear, format } from 'date-fns';

export type DashboardPeriod = 'current_month' | 'last_3m' | 'last_6m' | 'current_year' | 'all';

export interface PeriodRange {
  startISO: string; // yyyy-mm-ddTHH:mm:ss.sssZ
  endISO: string;
  /** Quantidade de buckets mensais a renderizar nos charts. */
  bucketMonths: number;
  label: string;
  /** Identifier curto pro queryKey (cache busting). */
  cacheKey: string;
}

const SENTINEL_ALL_START = '2020-01-01T00:00:00.000Z';

export function getDashboardPeriodRange(period: DashboardPeriod): PeriodRange {
  const now = new Date();
  switch (period) {
    case 'current_month': {
      const s = startOfMonth(now);
      const e = endOfMonth(now);
      return {
        startISO: s.toISOString(),
        endISO:   e.toISOString(),
        bucketMonths: 1,
        label: format(now, 'MMMM/yyyy'),
        cacheKey: `cm:${format(now, 'yyyy-MM')}`,
      };
    }
    case 'last_3m': {
      const s = startOfMonth(subMonths(now, 2));
      const e = endOfMonth(now);
      return {
        startISO: s.toISOString(),
        endISO:   e.toISOString(),
        bucketMonths: 3,
        label: 'Últimos 3 meses',
        cacheKey: `l3m:${format(now, 'yyyy-MM')}`,
      };
    }
    case 'last_6m': {
      const s = startOfMonth(subMonths(now, 5));
      const e = endOfMonth(now);
      return {
        startISO: s.toISOString(),
        endISO:   e.toISOString(),
        bucketMonths: 6,
        label: 'Últimos 6 meses',
        cacheKey: `l6m:${format(now, 'yyyy-MM')}`,
      };
    }
    case 'current_year': {
      const s = startOfYear(now);
      const e = endOfYear(now);
      return {
        startISO: s.toISOString(),
        endISO:   e.toISOString(),
        bucketMonths: now.getMonth() + 1,
        label: format(now, 'yyyy'),
        cacheKey: `cy:${format(now, 'yyyy')}`,
      };
    }
    case 'all':
    default: {
      return {
        startISO: SENTINEL_ALL_START,
        endISO:   endOfYear(now).toISOString(),
        bucketMonths: 12,
        label: 'Tudo',
        cacheKey: 'all',
      };
    }
  }
}

export const PERIOD_OPTIONS: { value: DashboardPeriod; label: string }[] = [
  { value: 'current_month', label: 'Mês atual' },
  { value: 'last_3m',       label: 'Últimos 3 meses' },
  { value: 'last_6m',       label: 'Últimos 6 meses' },
  { value: 'current_year',  label: 'Ano vigente' },
  { value: 'all',           label: 'Tudo' },
];
