/**
 * Filtros da fila operacional do Ateliê (pedido + cor).
 * Cor casa entre referências diferentes; pedido isola um PV quando o lote junta vários.
 */

export interface AtelierFilaLotLike {
  color: string | null | undefined;
  orders: readonly {
    order_number: string;
    pairs?: number;
  }[];
}

export interface AtelierFilaFilters {
  /** Número do PV (ex. PV-00237). Vazio = todos. */
  orderNumber: string;
  /** Cor do lote (ex. NEW WHISKY). Vazio = todas. */
  color: string;
}

export const EMPTY_ATELIER_FILA_FILTERS: AtelierFilaFilters = {
  orderNumber: '',
  color: '',
};

export function normalizeFilaText(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase();
}

export function matchesAtelierFilaFilters(
  lot: AtelierFilaLotLike,
  filters: AtelierFilaFilters,
): boolean {
  if (filters.orderNumber) {
    const want = filters.orderNumber.trim();
    if (!lot.orders.some((o) => o.order_number === want)) return false;
  }
  if (filters.color) {
    const needle = normalizeFilaText(filters.color);
    if (!needle) return true;
    if (!normalizeFilaText(lot.color).includes(needle)) return false;
  }
  return true;
}

export function collectFilaFilterOptions(lots: readonly AtelierFilaLotLike[]): {
  orderNumbers: string[];
  colors: string[];
} {
  const orders = new Set<string>();
  const colors = new Set<string>();
  for (const lot of lots) {
    for (const o of lot.orders) {
      if (o.order_number) orders.add(o.order_number);
    }
    const c = String(lot.color ?? '').trim();
    if (c) colors.add(c);
  }
  return {
    orderNumbers: [...orders].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    colors: [...colors].sort((a, b) => a.localeCompare(b, 'pt-BR')),
  };
}
