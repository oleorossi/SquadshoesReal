/**
 * Regra CANÔNICA de "estoque crítico" (alerta escalar de material).
 *
 * Fonte ÚNICA do predicado usado por:
 *   - a tela /estoque?tab=alerts (`NotificationsTab`) — lista os itens;
 *   - o card "Estoque Zerado" do Painel (`Dashboard.tsx`) — conta os itens.
 * Os dois PRECISAM bater, porque o card abre exatamente essa tela. Antes da
 * extração cada lado tinha o seu predicado: o card contava `quantity < 10`
 * (número mágico, sem `active`, sem excluir solado) e mostrava 142 enquanto a
 * tela que ele abria listava 126.
 *
 * Regra: estoque ZERADO, considerando só produtos ATIVOS e que não sejam SOLADO.
 *   - Solado fica de fora porque é gerido por grade (`stock_grade`) em
 *     /solados, não pelo `quantity` escalar (mesmo motivo do PR 2026-05-23).
 *
 * ⚠ Estoque mínimo NÃO existe mais (decisão do dono, 10/10/2026 —
 * `specs/remover-estoque-minimo.md`): a compra é só sob demanda de PV. O antigo
 * `isLowStock` ("no/abaixo do mínimo") foi removido; não o reintroduza. Saldo
 * zero é um FATO do estoque, não uma política de reposição — por isso continua.
 */

/** Campos que o predicado lê. `passthrough` — o resto do produto é ignorado. */
export interface StockAlertProduct {
  quantity: number;
  category?: string | null;
  active?: boolean | null;
}

/** Solado é gerido por numeração em /solados — fora do alerta escalar. */
export function isSoleProduct(p: StockAlertProduct): boolean {
  return (p.category || '').toLowerCase() === 'solado';
}

/** Acabou: saldo zero em produto ativo não-solado. */
export function isZeroStock(p: StockAlertProduct): boolean {
  return !isSoleProduct(p) && p.quantity === 0 && !!p.active;
}

/** O que o card do Painel conta — hoje é exatamente "zerado". */
export function isCriticalStock(p: StockAlertProduct): boolean {
  return isZeroStock(p);
}

/** Conta os itens críticos de uma lista de produtos. */
export function countCriticalStock(products: StockAlertProduct[]): number {
  return products.filter(isCriticalStock).length;
}
