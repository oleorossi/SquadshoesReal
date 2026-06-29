import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export function useCogsEntries(saleOrderId?: string) {
  return useQuery({
    queryKey: ['cogs_entries', saleOrderId],
    queryFn: async () => {
      let query = supabase
        .from('cogs_entries')
        .select('*')
        .order('created_at', { ascending: false });
      if (saleOrderId) query = query.eq('sale_order_id', saleOrderId);
      const { data, error } = await query.limit(300);
      if (error) throw error;
      return data;
    },
    staleTime: 2 * 60 * 1000,
  });
}

// useCreateCogsEntry removido (M8, auditoria de sistema 2026-06-29): escrevia em
// cogs_entries + financial_entries com reference_type='cogs', um CPV paralelo ao
// sale_order_cmv automático (double-count latente por competência). Estava MORTO —
// nenhuma UI o chamava. O CMV oficial é o sale_order_cmv (calculate_order_cost +
// recompute_sale_order_cmv_recognition). Se precisar lançar CPV manual no futuro,
// unificar no caminho sale_order_cmv em vez de recriar este write paralelo.
