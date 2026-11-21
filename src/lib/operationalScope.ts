import { isCancelledOrDraftOrder } from '@/lib/orderStatus';

/**
 * Pedido que já saiu do chão. Não volta para etiquetagem, Gestão, fila
 * nem quadro — nem por onda legada, nem por OP cancelada ou apagada.
 *
 * Grafias: o PV usa Cancelado/Concluído/Expedido; o histórico tem sem acento.
 */
export const TERMINAL_SALE_ORDER_STATUSES = [
  'Faturado',
  'Concluído',
  'Concluido',
  'Finalizado s/ NF',
  'Finalizado',
  'Cancelado',
  'Expedido',
  'Entregue',
] as const;

const TERMINAL_SALE_ORDER_SET = new Set(
  TERMINAL_SALE_ORDER_STATUSES.map((status) => status.toLowerCase()),
);

export function isTerminalSaleOrderStatus(status: unknown): boolean {
  return TERMINAL_SALE_ORDER_SET.has(String(status ?? '').trim().toLowerCase());
}

export function isDeletedProductionOrder(deletedAt: unknown): boolean {
  return deletedAt != null && String(deletedAt).trim() !== '';
}

/** OP que ainda é trabalho de fábrica. PV terminal, cancelada ou apagada sai. */
export function productionOrderVisibleOperationally(input: {
  orderStatus: unknown;
  deletedAt?: unknown;
  saleOrderStatus?: unknown;
}): boolean {
  if (isDeletedProductionOrder(input.deletedAt)) return false;
  if (isCancelledOrDraftOrder(input.orderStatus)) return false;
  if (isTerminalSaleOrderStatus(input.saleOrderStatus)) return false;
  return true;
}

/** Linha da fila/Gestão. O status do PV, quando conhecido, vence a onda. */
export function queueRowVisibleOperationally(input: {
  orderStatus: unknown;
  saleOrderStatus?: unknown;
}): boolean {
  return productionOrderVisibleOperationally({
    orderStatus: input.orderStatus,
    saleOrderStatus: input.saleOrderStatus,
  });
}
