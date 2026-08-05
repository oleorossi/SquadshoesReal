/**
 * Regra CANÔNICA de "estoque crítico" (alerta escalar de material).
 *
 * Fonte ÚNICA do predicado usado por:
 *   - a tela /estoque?tab=alerts (`NotificationsTab`) — lista os itens;
 *   - o card "Estoque Crítico" do Painel (`Dashboard.tsx`) — conta os itens.
 * Os dois PRECISAM bater, porque o card abre exatamente essa tela. Antes desta
 * extração cada lado tinha o seu predicado: o card contava `quantity < 10`
 * (número mágico, sem `active`, sem excluir solado) e mostrava 142 enquanto a
 * tela que ele abria listava 126.
 *
 * Regra (aprovada pelo dono em 05/08/2026): estoque ZERADO **ou** no/abaixo do
 * mínimo, considerando só produtos ATIVOS e que não sejam SOLADO.
 *   - Solado fica de fora porque é gerido por grade (`stock_grade`) em
 *     /solados, não pelo `quantity` escalar (mesmo motivo do PR 2026-05-23).
 *   - Zerado entra MESMO sem mínimo cadastrado: hoje há 41 produtos com saldo
 *     0 e `min_stock` 0 — sob `quantity < min_stock` puro eles sumiriam do
 *     radar justamente quando acabaram.
 *   - O limite é `<=`: item exatamente no mínimo JÁ é alerta. Mesma convenção
 *     de `exportReports.ts` e `useExpedicaoStats.ts`.
 *
 * ⚠ Por que a contagem não é feita no servidor: PostgREST não compara duas
 * COLUNAS num filtro — `quantity=lte.min_stock` devolve 400 / 22P02
 * ("invalid input syntax for type numeric: \"min_stock\""), e dentro de
 * `or=(...)` dá o mesmo erro. Sem uma view/RPC no banco, o consumidor filtra
 * no servidor o que dá (`active`) e aplica este predicado sobre uma projeção
 * mínima — é o mesmo desenho já usado em `useLowStockAlerts.ts`.
 */

/** Campos que o predicado lê. `passthrough` — o resto do produto é ignorado. */
export interface StockAlertProduct {
  quantity: number;
  min_stock: number;
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

/** Está no mínimo ou abaixo dele (mas ainda tem saldo). */
export function isLowStock(p: StockAlertProduct): boolean {
  return !isSoleProduct(p) && p.quantity > 0 && p.quantity <= p.min_stock && !!p.active;
}

/** Zerado OU no/abaixo do mínimo — o que o card "Estoque Crítico" conta. */
export function isCriticalStock(p: StockAlertProduct): boolean {
  return isZeroStock(p) || isLowStock(p);
}

/** Conta os itens críticos de uma lista de produtos. */
export function countCriticalStock(products: StockAlertProduct[]): number {
  return products.filter(isCriticalStock).length;
}
