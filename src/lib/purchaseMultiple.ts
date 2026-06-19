/**
 * Múltiplo de compra (embalagem). Alguns itens só vendem em pacote fechado
 * (de 50 em 50, 100 em 100, 1000 em 1000). Ao gerar uma Ordem de Compra, a
 * quantidade deve arredondar PRA CIMA pro próximo múltiplo — ex.: precisa de
 * 187 com múltiplo 50 → pede 200.
 *
 * O valor mora em `products.purchase_multiple` (item) com fallback em
 * `product_groups.purchase_multiple` (grupo). Múltiplo 0/1/NULL = sem
 * arredondamento (mantém a quantidade como está).
 */

/** Resolve o múltiplo efetivo: item tem prioridade, grupo é fallback. */
export function effectivePurchaseMultiple(
  productMultiple: number | null | undefined,
  groupMultiple?: number | null | undefined,
): number {
  const p = Number(productMultiple);
  if (Number.isFinite(p) && p > 0) return p;
  const g = Number(groupMultiple);
  if (Number.isFinite(g) && g > 0) return g;
  return 0;
}

/**
 * Arredonda `qty` pra cima pro próximo múltiplo de `multiple`. Múltiplo ≤ 1
 * (ou inválido) retorna a quantidade inalterada — o recurso é opt-in por item.
 * Não mexe em quantidades ≤ 0.
 */
export function roundUpToPurchaseMultiple(qty: number, multiple: number | null | undefined): number {
  const m = Number(multiple);
  if (!Number.isFinite(qty) || qty <= 0) return qty;
  if (!Number.isFinite(m) || m <= 1) return qty;
  return Math.ceil(qty / m) * m;
}

/**
 * Conveniência: resolve o múltiplo (item→grupo) e arredonda numa tacada só.
 */
export function applyPurchaseMultiple(
  qty: number,
  productMultiple: number | null | undefined,
  groupMultiple?: number | null | undefined,
): number {
  return roundUpToPurchaseMultiple(qty, effectivePurchaseMultiple(productMultiple, groupMultiple));
}
