import { isCancelledOrDraftOrder } from '@/lib/orderStatus';

interface ProductionLinkedOrder {
  status?: unknown;
  sale_order_item_id?: string | null;
  sale_order_items?: { production_excluded_at?: string | null } | null;
}

interface ProductionSaleOrderItem {
  production_excluded_at?: string | null;
}

/**
 * Uma ficha de operador só pode nascer de uma OP ainda pertencente ao fluxo
 * produtivo. OP manual (sem item de PV) continua válida; OP vinculada sem a
 * respectiva linha de origem falha fechada, pois não há como confirmar que o
 * item não foi retirado da produção.
 */
export function isOperationalOperatorOrder(row: ProductionLinkedOrder): boolean {
  if (isCancelledOrDraftOrder(row.status)) return false;
  if (!row.sale_order_item_id) return true;
  return !!row.sale_order_items && row.sale_order_items.production_excluded_at == null;
}

export function filterOperationalOperatorOrders<T extends ProductionLinkedOrder>(rows: T[]): T[] {
  return rows.filter(isOperationalOperatorOrder);
}

/** Mantém o documento comercial intacto e recorta somente sua emissão fabril. */
export function filterOperationalOperatorItems<T extends ProductionSaleOrderItem>(items: T[]): T[] {
  return items.filter(item => item.production_excluded_at == null);
}
