/**
 * Resolução das ORDENS DE PRODUÇÃO (OPs) que uma ordem de serviço cobre.
 *
 * A OS guarda QUAIS itens do PV ela cobre (`service_orders.selected_sale_order_item_ids`,
 * migration 20261103120000). A OP é derivada na LEITURA, via
 * `orders.sale_order_item_id` — apoiado no UNIQUE parcial
 * `uq_orders_active_per_sale_order_item` (migration 20260429123049), que garante
 * 1 OP ativa por item do PV.
 *
 * Por que derivar em vez de gravar o id da OP na OS: a OS pode nascer ANTES das
 * OPs serem geradas ("Gerar OPs" é um passo manual do PV). Gravando o item, o
 * número da OP aparece sozinho assim que a OP nascer, e sobrevive a um resync
 * que recria a OP.
 */

export interface OpRef {
  id: string;
  order_number: string | null;
  sale_order_item_id: string | null;
  sale_order_id?: string | null;
  status?: string | null;
}

/**
 * OP "ativa" — mesma definição do UNIQUE parcial do banco: `status <> 'Cancelada'`.
 * Manter as duas alinhadas: é isso que garante 1 OP por item do PV e, portanto,
 * que o mapa abaixo não perca número por colisão.
 */
export const isActiveOp = (op: Pick<OpRef, 'status'>): boolean =>
  (op?.status || '') !== 'Cancelada';

/** Ordena números de OP de forma natural (OP-00009 antes de OP-00010). */
const byOpNumber = (a: string, b: string) =>
  a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' });

/** Mapa `sale_order_item_id` → nº da OP ativa daquele item. */
export function opNumberByPvItem(ops: OpRef[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const op of ops || []) {
    if (!op?.sale_order_item_id || !op.order_number || !isActiveOp(op)) continue;
    map.set(op.sale_order_item_id, op.order_number);
  }
  return map;
}

/**
 * Números das OPs de uma OS.
 *
 * `selectedItemIds` nulo/ausente = OS **sem seleção registrada** (criada antes da
 * migration 20261103120000, ou fora do atalho "Gerar OS" do PV). Nesse caso cai
 * em TODAS as OPs do pedido — o comportamento de sempre, sem inventar dado que
 * nunca foi gravado. Array vazio é diferente: é uma seleção vazia registrada.
 *
 * @param ops         OPs já filtradas pelo PV da OS (ou de vários PVs — o filtro
 *                    por `sale_order_id` acontece aqui quando informado).
 * @param saleOrderId PV da OS, usado só no caminho de fallback.
 */
export function opNumbersForServiceOrder(
  ops: OpRef[],
  selectedItemIds: string[] | null | undefined,
  saleOrderId?: string | null,
): string[] {
  const active = (ops || []).filter((op) => op?.order_number && isActiveOp(op));

  const pool = selectedItemIds && selectedItemIds.length > 0
    ? active.filter((op) => op.sale_order_item_id && selectedItemIds.includes(op.sale_order_item_id))
    // Sem registro (NULL/undefined) → todas as OPs do pedido. Seleção vazia
    // registrada (`[]`) não cai aqui: devolve lista vazia, que é o correto.
    : selectedItemIds == null
      ? active.filter((op) => !saleOrderId || op.sale_order_id === saleOrderId)
      : [];

  return Array.from(new Set(pool.map((op) => op.order_number as string))).sort(byOpNumber);
}

/**
 * Rótulo curto de OP pra linha de lista: "OP-00231" ou "OP-00231, OP-00232".
 * Devolve `null` quando não há OP — o chamador decide o fallback (nunca imprimir
 * "—" no papel, por exemplo).
 */
export function formatOpNumbers(opNumbers: string[]): string | null {
  return opNumbers.length > 0 ? opNumbers.join(', ') : null;
}
