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
 * NF autorizada. O wrapper atual adiciona CAS/receipt e recusa NF-e avulsa,
 * que possui estorno fiscal próprio.
 */
export function useRevertInvoicedSaleOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ saleOrderId, reason }: { saleOrderId: string; reason: string }) => {
      const justification = reason.trim();
      if (justification.length < 10) throw new Error('Informe uma justificativa com pelo menos 10 caracteres.');
      const { data: current, error: currentError } = await (supabase as any)
        .from('sale_orders')
        .select('order_version, is_standalone_nfe')
        .eq('id', saleOrderId)
        .single();
      if (currentError) throw currentError;
      if (current?.is_standalone_nfe) {
        throw new Error('NF-e avulsa deve ser estornada pelo fluxo próprio de cancelamento da NF-e.');
      }
      const expectedVersion = Number(current?.order_version);
      if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
        throw new Error('Versão do PV indisponível. Recarregue antes de reverter.');
      }
      const requestId = crypto.randomUUID();
      const { data, error } = await (supabase as any).rpc('revert_invoiced_sale_order_command', {
        p_sale_order_id: saleOrderId,
        p_expected_order_version: expectedVersion,
        p_reason: justification,
        p_client_request_id: requestId,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error?.message || 'Reversão recusada pelo servidor.');
      return data.result as RevertInvoiceResult;
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
