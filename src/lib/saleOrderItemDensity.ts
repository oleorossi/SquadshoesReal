import type { SaleOrderItemFormData } from '@/hooks/useSaleOrders';
import { saleOrderItemQuantityFromGrade } from '@/hooks/useSaleOrders';

/** Chave estável pra expand/collapse (sobrevive a reordenação por índice). */
export function saleOrderItemUiKey(
  item: Pick<SaleOrderItemFormData, 'id' | 'clientKey'>,
  index: number,
): string {
  return item.id || item.clientKey || `idx-${index}`;
}

/**
 * Item "incompleto" pra auto-abrir no load do PV (contrato 8A):
 * sem referência, sem cor, ou grade zerada.
 * Pendências de cadastro (cor/tira) entram como chips na linha e expandem
 * quando o usuário clica — o seed inicial não espera o async do item.
 */
export function isSaleOrderItemStructurallyIncomplete(
  item: SaleOrderItemFormData,
): boolean {
  if (!item.reference_id) return true;
  if (!(item.color || '').trim()) return true;
  const pairs = saleOrderItemQuantityFromGrade(item.grade, item.fichas || 1);
  return pairs <= 0;
}
