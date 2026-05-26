import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface RevertInvoiceResult {
  sale_order_id: string;
  order_number: string;
  ops_updated: number;
  ar_cancelled: number;
  fe_estornado: number;
  nfe_proc_killed: number;
}

/**
 * Reverte um PV erroneamente marcado como "Faturado" quando a NF NÃO foi
 * efetivamente emitida na SEFAZ. RPC backend é atômica e bloqueia se houver
 * NF autorizada. Veja migration 20260526120000_revert_invoiced_sale_order.
 */
export function useRevertInvoicedSaleOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ saleOrderId, reason }: { saleOrderId: string; reason: string }) => {
      const { data, error } = await (supabase as any).rpc('revert_invoiced_sale_order', {
        p_sale_order_id: saleOrderId,
        p_reason: reason,
      });
      if (error) throw error;
      return data as RevertInvoiceResult;
    },
    onSuccess: (result) => {
      // Invalida tudo que pode estar mostrando estado antigo
      qc.invalidateQueries({ queryKey: ['sale_orders'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order_stages'] });
      qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
      qc.invalidateQueries({ queryKey: ['financial_entries'] });
      qc.invalidateQueries({ queryKey: ['nfe_emitidas'] });
      qc.invalidateQueries({ queryKey: ['notifications_aggregated'] });
      toast.success(
        `${result.order_number} voltou pra produção · ${result.ops_updated} OP(s) reabertas, ${result.ar_cancelled} duplicata(s) cancelada(s).`
      );
    },
    onError: (err: any) => {
      toast.error(err.message || 'Falha ao reverter faturamento.');
    },
  });
}
