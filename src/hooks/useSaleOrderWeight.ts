import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface IncompleteWeightItem {
  reference_id: string;
  code: string | null;
  name: string | null;
  pairs: number;
  /** Peso/par estimado via AVG das fichas com mesmo solado (null se nem estimativa achou). */
  estimated_kg_per_pair?: number | null;
  /** 'sole_group_avg' | 'sole_id_avg' | null */
  estimate_source?: 'sole_group_avg' | 'sole_id_avg' | null;
}

export interface SaleOrderWeight {
  saleOrderId: string;
  totalPairs: number;
  netWeightKg: number;
  /** Soma só dos itens com weight_per_pair_kg cadastrado na ficha. */
  netWeightRealKg: number;
  /** Soma dos itens estimados via média do solado (preenchido pelo backend). */
  netWeightEstimatedKg: number;
  boxWeightKg: number;
  grossWeightKg: number;
  incompleteItems: IncompleteWeightItem[];
  isComplete: boolean;
}

interface RawResult {
  sale_order_id: string;
  total_pairs: number;
  net_weight_kg: number;
  net_weight_real_kg?: number;
  net_weight_estimated_kg?: number;
  box_weight_kg: number;
  gross_weight_kg: number;
  incomplete_items: IncompleteWeightItem[];
  is_complete: boolean;
}

/**
 * Calcula peso de um PV via RPC `calculate_sale_order_weight`. Usado em
 * /manifests, /nfe, /mdfe e /entregas para auto-popular peso bruto/líquido
 * no lugar dos inputs manuais.
 *
 * Quando algum item não tem `weight_per_pair_kg` cadastrado na ficha
 * técnica, retorna em `incompleteItems` para a UI mostrar warning âmbar
 * sem bloquear a operação.
 */
export function useSaleOrderWeight(saleOrderId: string | null | undefined) {
  return useQuery({
    queryKey: ['sale_order_weight', saleOrderId],
    queryFn: async (): Promise<SaleOrderWeight | null> => {
      if (!saleOrderId) return null;
      const { data, error } = await (supabase.rpc as any)(
        'calculate_sale_order_weight',
        { p_sale_order_id: saleOrderId },
      );
      if (error) throw error;
      const r = data as RawResult;
      return {
        saleOrderId: r.sale_order_id,
        totalPairs: r.total_pairs,
        netWeightKg: Number(r.net_weight_kg) || 0,
        netWeightRealKg: Number(r.net_weight_real_kg) || 0,
        netWeightEstimatedKg: Number(r.net_weight_estimated_kg) || 0,
        boxWeightKg: Number(r.box_weight_kg) || 0,
        grossWeightKg: Number(r.gross_weight_kg) || 0,
        incompleteItems: r.incomplete_items || [],
        isComplete: r.is_complete,
      };
    },
    enabled: !!saleOrderId,
    staleTime: 15 * 1000,
  });
}

/**
 * Versão batch — para MDF-e e Entregas que precisam somar vários PVs.
 * Faz N chamadas em paralelo (Promise.all). Para volumes maiores poderia
 * virar uma RPC array, mas pra dezenas de PVs isso é OK.
 */
export function useSaleOrdersWeightBatch(saleOrderIds: string[]) {
  return useQuery({
    queryKey: ['sale_orders_weight_batch', [...saleOrderIds].sort()],
    queryFn: async (): Promise<SaleOrderWeight[]> => {
      if (saleOrderIds.length === 0) return [];
      const results = await Promise.all(
        saleOrderIds.map(async (id) => {
          const { data, error } = await (supabase.rpc as any)(
            'calculate_sale_order_weight',
            { p_sale_order_id: id },
          );
          if (error) {
            // Log explícito pra operador notar quando peso de algum PV
            // não entrou no totalizador (antes era silenciado e o user
            // via peso parcial sem aviso).
            console.warn('[useSaleOrdersWeightBatch] calculate_sale_order_weight falhou para PV:', id, error);
            return null;
          }
          const r = data as RawResult;
          return {
            saleOrderId: r.sale_order_id,
            totalPairs: r.total_pairs,
            netWeightKg: Number(r.net_weight_kg) || 0,
            netWeightRealKg: Number(r.net_weight_real_kg) || 0,
            netWeightEstimatedKg: Number(r.net_weight_estimated_kg) || 0,
            boxWeightKg: Number(r.box_weight_kg) || 0,
            grossWeightKg: Number(r.gross_weight_kg) || 0,
            incompleteItems: r.incomplete_items || [],
            isComplete: r.is_complete,
          };
        }),
      );
      return results.filter((r): r is SaleOrderWeight => r !== null);
    },
    enabled: saleOrderIds.length > 0,
    // ⚠ PERF: cada refetch aqui custa N RPCs (uma por PV). 15s era curto demais pra um
    // dado que só muda quando alguém edita itens do PV — e essa edição já invalida a key
    // por realtime (o predicate de useRealtimeSaleOrders casa 'sale_orders_weight_batch').
    // Correção por tempo é redundante; 5min mata o refetch em rajada nas telas de MDF-e
    // e roteirização, que montam o hook com dezenas de PVs.
    staleTime: 5 * 60 * 1000,
  });
}
