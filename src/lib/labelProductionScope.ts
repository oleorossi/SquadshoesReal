import { isDeletedSaleOrder, isTerminalSaleOrderStatus } from '@/lib/operationalScope';

/**
 * Quem entra na Central de Etiquetagem.
 *
 * A fila e as ondas legadas são a porta histórica. Um PV em `Em Produção`
 * também entra, mesmo sem linha na fila. PV terminal (Faturado, Concluído,
 * Finalizado s/ NF, Cancelado, Expedido) e PV com deleted_at não entram
 * nem pela onda.
 */
export function saleOrderEligibleForLabels(input: {
  saleOrderId: string | null | undefined;
  scheduled: boolean;
  saleOrderStatus: unknown;
  saleOrderDeletedAt?: unknown;
}): boolean {
  if (!input.saleOrderId) return false;
  if (isDeletedSaleOrder(input.saleOrderDeletedAt)) return false;
  if (isTerminalSaleOrderStatus(input.saleOrderStatus)) return false;
  if (input.scheduled) return true;
  return String(input.saleOrderStatus ?? '').trim() === 'Em Produção';
}

/** PV em produção cuja nenhuma OP chegou na lista visível da etiquetagem. */
export function productionOrdersMissingFromLabels(
  saleOrders: Array<{
    id: string;
    order_number?: string | null;
    status?: string | null;
    deleted_at?: unknown;
  }>,
  visibleSaleOrderIds: ReadonlySet<string>,
): string[] {
  return saleOrders
    .filter((order) => String(order.status ?? '').trim() === 'Em Produção'
      && !isDeletedSaleOrder(order.deleted_at)
      && !visibleSaleOrderIds.has(order.id))
    .map((order) => order.order_number || order.id);
}
