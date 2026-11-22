import { OutsourcingPlanPanel } from '@/components/contractors/OutsourcingPlanPanel';

/**
 * Aba Planejar. Os números vêm de `outsourced_pair_ledger`.
 * O cálculo antigo (toda ficha que passa por corte ou costura, pelo prazo
 * de entrega, somada nos dois setores) saiu daqui.
 */

export function filterOperationalOutsourcingItems<
  T extends { production_excluded_at?: string | null },
>(items: readonly T[]): T[] {
  return items.filter((item) => !item.production_excluded_at);
}

export function buildOutsourcingServiceOrderProvenance(
  cell: { pvIds: string[]; saleOrderItemIds: string[] },
) {
  return {
    linked_sale_order_ids: cell.pvIds,
    selected_sale_order_item_ids: cell.saleOrderItemIds,
  };
}

export function OutsourcingPlanningTab() {
  return <OutsourcingPlanPanel />;
}
