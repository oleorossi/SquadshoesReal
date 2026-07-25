import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Furos de baixa — material que a ficha pedia e NÃO saiu do estoque.
 *
 * Fonte: `list_stock_debit_holes(p_days)` (migration 20260925133000). Duas
 * origens na mesma lista:
 *   'consumo_sem_debito'       — production_consumptions com standard > 0 e
 *                                actual = 0. É a detecção que o ERP já fazia
 *                                ("sem débito registrado (possível furo de
 *                                baixa)") e que ninguém enxergava.
 *   'reserva_parcial_pendente' — saldo de reserva preservado na finalização
 *                                (status 'pending_reconciliation'): a baixa não
 *                                coube no estoque e ficou devendo.
 *
 * ⚠ Varredura pesada (varre production_consumptions do período) — por isso o
 * hook nasce desabilitado; a tela liga sob demanda.
 */
export type StockDebitHoleOrigem = 'consumo_sem_debito' | 'reserva_parcial_pendente';

export interface StockDebitHole {
  origem: StockDebitHoleOrigem;
  order_id: string;
  order_number: string | null;
  sale_order_number: string | null;
  reference_name: string | null;
  op_status: string | null;
  product_id: string | null;
  product_name: string | null;
  unit: string | null;
  standard_quantity: number;
  actual_quantity: number;
  diferenca: number;
  valor_estimado: number;
  detectado_em: string | null;
}

export function useStockDebitHoles(dias = 90, enabled = false) {
  return useQuery({
    queryKey: ['stock-debit-holes', dias],
    queryFn: async () => {
      // list_stock_debit_holes ainda não está nos tipos gerados → cast.
      const { data, error } = await (supabase as any).rpc('list_stock_debit_holes', { p_days: dias });
      if (error) throw error;
      return (data ?? []) as StockDebitHole[];
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
}

/** Agregados prontos pro cabeçalho do card (OPs afetadas e valor total). */
export function summarizeStockDebitHoles(rows: StockDebitHole[] | undefined) {
  const list = rows ?? [];
  return {
    linhas: list.length,
    ops: new Set(list.map((r) => r.order_id)).size,
    pedidos: new Set(list.map((r) => r.sale_order_number).filter(Boolean)).size,
    valor: list.reduce((acc, r) => acc + (Number(r.valor_estimado) || 0), 0),
  };
}
