import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchFinancialRows } from '@/lib/financialPagination';
import {
  invoiceSummaryPeriod,
  summarizeIncomingInvoices,
  summarizeOutgoingInvoices,
  type InvoiceSummaryRow,
  type OutgoingInvoiceSummaryRow,
} from '@/lib/invoiceSummary';

/** Nunca apresentar um subtotal truncado como total financeiro. */
export async function readCompleteInvoiceSummaryRows<T extends { id: string }>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown; count: number | null }>,
) {
  return fetchFinancialRows<T>(page);
}

export function useInvoiceSummary(month: string) {
  // As chaves mantêm os prefixos das entidades: importar/excluir/sincronizar
  // uma nota invalida o resumo junto da listagem, sem cache paralelo esquecido.
  const incoming = useQuery({
    queryKey: ['invoices', 'monthly-summary', month],
    queryFn: async () => {
      const period = invoiceSummaryPeriod(month);
      const rows = await readCompleteInvoiceSummaryRows<InvoiceSummaryRow & { id: string }>((from, to) =>
        supabase.from('invoices').select('id,status,total_value', { count: 'exact' })
          .gte('issue_date', period.startDate).lt('issue_date', period.endDateExclusive)
          .order('id').range(from, to),
      );
      return summarizeIncomingInvoices(rows);
    },
  });
  const outgoing = useQuery({
    queryKey: ['nfe_emitidas', 'monthly-summary', month],
    queryFn: async () => {
      const period = invoiceSummaryPeriod(month);
      const rows = await readCompleteInvoiceSummaryRows<OutgoingInvoiceSummaryRow & { id: string }>((from, to) =>
        supabase.from('nfe_emitidas').select('id,status,valor_total,tp_amb_sefaz', { count: 'exact' })
          .gte('data_emissao', period.startTimestamp).lt('data_emissao', period.endTimestampExclusive)
          .order('id').range(from, to),
      );
      return summarizeOutgoingInvoices(rows);
    },
  });
  return { incoming, outgoing };
}
