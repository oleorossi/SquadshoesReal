import type { QueryClient } from '@tanstack/react-query';

const FINANCE_DERIVED_QUERY_KEYS = [
  'finance-kpis',
  'finance-alerts',
  'cash-flow-projection',
  'dre-auto-cash',
  'notifications_aggregated',
] as const;

/**
 * Atualiza todas as leituras calculadas depois de uma mutação financeira.
 * As listas-base continuam sendo invalidadas pelo hook dono da entidade.
 */
export function invalidateFinanceDerivedQueries(queryClient: QueryClient) {
  FINANCE_DERIVED_QUERY_KEYS.forEach((queryKey) => {
    void queryClient.invalidateQueries({ queryKey: [queryKey] });
  });
}
