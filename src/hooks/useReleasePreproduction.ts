import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { saleOrderAtelierProductionHoldsRoot } from '@/hooks/useSaleOrderAtelierProductionHolds';

export interface ReleasePreproductionResult {
  created_ops?: number;
  reused_ops?: number;
  status?: string;
}

/** Texto do toast de sucesso. Pura para o teste: nunca promete "Em Produção". */
export function releasePreproductionMessage(result: ReleasePreproductionResult | null | undefined): string {
  const created = Number(result?.created_ops ?? 0);
  if (created === 0) return 'Nenhuma ordem nova: todos os itens já tinham ordem.';
  return `${created} ${created === 1 ? 'ordem gerada' : 'ordens geradas'}. O pedido continua Aguardando Cabedal.`;
}

/**
 * Botão "Gerar ordens e fichas" do PV Aguardando Cabedal.
 * Chama `release_preproduction_for_sale_order` (mig 20270101067200): cria as OPs
 * como Reservado, não muda o status do PV e não sai de Aprovado.
 */
export function useReleasePreproduction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (saleOrderId: string): Promise<ReleasePreproductionResult> => {
      const { data, error } = await supabase.rpc(
        'release_preproduction_for_sale_order' as never,
        { p_sale_order_id: saleOrderId } as never,
      );
      if (error) throw error;
      return (data ?? {}) as ReleasePreproductionResult;
    },
    onSuccess: (result) => {
      [
        ['sale_orders'], ['orders'], ['order_stages'], ['sale_orders_floor_progress'],
        ['material_reservations'], ['stock_movements'], ['production_queue'],
        saleOrderAtelierProductionHoldsRoot as unknown as string[],
      ].forEach((queryKey) => qc.invalidateQueries({ queryKey }));
      toast.success(releasePreproductionMessage(result));
    },
    onError: (err: Error) => toast.error(`Não foi possível gerar as ordens: ${err.message}`),
  });
}
