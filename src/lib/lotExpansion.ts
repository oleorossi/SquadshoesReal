/**
 * Lot expansion — transforma 1 OP com N lotes em N virtual orders, cada uma
 * com qty/grade do lote + metadata (_lot_number, _total_lots, _original_id).
 *
 * Usado em PrintWorkSheetsPage pra que cada lote vire ficha de operador
 * independente em cada setor.
 */
import type { OrderLot } from '@/hooks/useOrderLots';

export interface LotMetadata {
  /** Marca a order como produto da expansão (não veio direto do DB). */
  _virtual_lot?: boolean;
  /** UUID original da OP (sem o sufixo de lote). */
  _original_id?: string;
  /** 1, 2, 3... */
  _lot_number?: number;
  /** Quantos lotes a OP tem no total. */
  _total_lots?: number;
}

/**
 * Divide a grade proporcional ao ratio lot/total.
 *
 * ⚠️ DISPLAY-ONLY: usa Math.round() que pode causar pequena diferença (1-3
 * pares) entre `sum(grade[size])` e `lotQty` quando há vários tamanhos com
 * fração. Aceito porque o total exato continua em `order.total_pairs` /
 * `order_lots.quantity` — esta função alimenta apenas a renderização visual
 * das fichas de operador (TallyBox + tabela de numeração).
 *
 * NÃO usar pra: cálculo de custo, débito de materiais, projeção de estoque.
 * Pra esses, agregar lots pelo `quantity` real do banco.
 */
function splitGrade(
  grade: Record<string, number> | null | undefined,
  lotQty: number,
  totalQty: number,
): Record<string, number> {
  if (!grade || totalQty <= 0) return grade ?? {};
  const ratio = lotQty / totalQty;
  const result: Record<string, number> = {};
  for (const [size, qty] of Object.entries(grade)) {
    const v = Math.round((Number(qty) || 0) * ratio);
    if (v > 0) result[size] = v;
  }
  return result;
}

/**
 * Pra cada order, se tem lots > 1 retorna N virtual orders (com qty/grade
 * do lote). Caso contrário, devolve o original.
 *
 * O `id` da virtual order recebe sufixo `::L{n}` pra dedup em React keys,
 * mas o `_original_id` preserva o UUID pra qualquer query.
 */
export function expandOrderByLots<T extends { id: string; quantity?: number; grade?: any; total_pairs?: number | null }>(
  order: T,
  lots: OrderLot[] | undefined,
): Array<T & LotMetadata> {
  if (!lots || lots.length <= 1) return [order];
  const totalQty = Number(order.total_pairs ?? order.quantity ?? 0);
  return lots.map((lot) => ({
    ...order,
    id: `${order.id}::L${lot.lot_number}`,
    quantity: lot.quantity,
    total_pairs: lot.quantity,
    grade: splitGrade(order.grade, lot.quantity, totalQty),
    _virtual_lot: true,
    _original_id: order.id,
    _lot_number: lot.lot_number,
    _total_lots: lots.length,
  }));
}

/** Expande um array inteiro: para cada order, expande conforme lotsMap.
 *  lotsMap[orderId] = lots[] ou undefined (sem split). */
export function expandOrdersByLots<T extends { id: string; quantity?: number; grade?: any; total_pairs?: number | null }>(
  orders: T[],
  lotsMap: Map<string, OrderLot[]> | undefined,
): Array<T & LotMetadata> {
  if (!lotsMap || lotsMap.size === 0) return orders;
  return orders.flatMap((o) => expandOrderByLots(o, lotsMap.get(o.id)));
}
