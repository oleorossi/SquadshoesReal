import { supabase } from '@/integrations/supabase/client';
import type { PendingOrderPayload } from './offlineQueue';

export interface AtomicSaleOrderResult {
  order_id: string;
  item_ids: string[];
  idempotent_replay: boolean;
}

interface AtomicRpcResponse {
  data: unknown;
  error: Error | null;
}

/**
 * Único escritor do PV mobile, tanto online quanto no replay da fila. A RPC
 * confirma cabeçalho + todos os itens na mesma transação; replay parcial nunca
 * é tratado como sucesso e, portanto, nunca é removido silenciosamente da fila.
 */
export async function submitMobileSaleOrderAtomic(payload: PendingOrderPayload) {
  const total = payload.items.reduce(
    (sum, item) => sum + (Number(item.unit_price) || 0) * (Number(item.quantity) || 0),
    0,
  );
  const header = {
    ...payload.order,
    total,
    client_id: payload.client_id ?? payload.order.client_id ?? null,
    representative_id: payload.representative_id ?? null,
  };
  const callRpc = supabase.rpc as unknown as (
    functionName: string,
    args: Record<string, unknown>,
  ) => Promise<AtomicRpcResponse>;
  const { data, error } = await callRpc('create_sale_order_atomic', {
    p_header: header,
    p_items: payload.items,
    p_client_request_id: payload.order.client_request_id,
  });
  if (error) throw error;
  const result = (data || {}) as AtomicSaleOrderResult;
  if (!result.order_id) throw new Error('A criação atômica não retornou o identificador do PV.');
  if (!Array.isArray(result.item_ids) || result.item_ids.length !== payload.items.length) {
    throw new Error(
      `Replay atômico incompleto: o servidor confirmou ${Array.isArray(result.item_ids) ? result.item_ids.length : 0} de ${payload.items.length} item(ns). A fila foi preservada para correção.`,
    );
  }
  return result;
}
