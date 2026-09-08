import type { QueryClient } from '@tanstack/react-query';

/**
 * Query keys canônicas dos três setores principais (Fase 2.3).
 *
 * Invalidação por PREFIXO do React Query: `invalidateQueries({ queryKey: productsKeys.all })`
 * casa `['products']`, `['products','paginated',…]`, etc. Sub-keys nomeadas abaixo
 * existem pra setQueryData pontual (lite/catalog/detail) sem refetch global.
 *
 * ⚠ Não invente string solta nova pra estas entidades — use estes helpers.
 * Padrão espelha `dataListPageKey` (prefixo estável + teste de contrato).
 */

export const productsKeys = {
  all: ['products'] as const,
  detail: (id: string) => ['product-detail', id] as const,
};

export const technicalSheetsKeys = {
  all: ['technical_sheets'] as const,
  catalog: ['technical_sheets', 'catalog'] as const,
  lite: ['technical_sheets', 'lite'] as const,
  editor: ['technical_sheets', 'editor'] as const,
  detail: (id: string) => ['technical_sheets', 'detail', id] as const,
  cabedalParPeAudit: ['technical_sheets', 'cabedal-par-pe-audit'] as const,
};

export const saleOrdersKeys = {
  all: ['sale_orders'] as const,
  detail: (id: string) => ['sale_order', id] as const,
  items: (id: string) => ['sale_order_items', id] as const,
};

export function invalidateProducts(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: productsKeys.all });
}

export function invalidateTechnicalSheets(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: technicalSheetsKeys.all });
}

export function invalidateSaleOrders(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: saleOrdersKeys.all });
}
