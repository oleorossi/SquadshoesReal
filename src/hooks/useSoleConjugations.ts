import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface SoleConjugation {
  id: string;
  sole_group_id: string;
  size_key: string;
  sizes: number[];
  display_order: number;
}

export function useSoleConjugations(soleGroupId: string | null) {
  return useQuery({
    queryKey: ['sole_size_conjugations', soleGroupId],
    queryFn: async () => {
      if (!soleGroupId) return [] as SoleConjugation[];
      const { data, error } = await (supabase as any)
        .from('sole_size_conjugations')
        .select('*')
        .eq('sole_group_id', soleGroupId)
        .order('display_order');
      if (error) throw error;
      return (data || []) as SoleConjugation[];
    },
    enabled: !!soleGroupId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpsertSoleConjugation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: Omit<SoleConjugation, 'id'> & { id?: string }) => {
      const { data, error } = await (supabase as any)
        .from('sole_size_conjugations')
        .upsert(row, { onConflict: 'sole_group_id,size_key' })
        .select()
        .single();
      if (error) throw error;
      return data as SoleConjugation;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['sole_size_conjugations', variables.sole_group_id] });
      // Trigger DB enfileira OPs afetadas em resync_queue. Processar agora.
      processResyncQueueSilently(qc);
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteSoleConjugation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, soleGroupId }: { id: string; soleGroupId: string }) => {
      const { error } = await (supabase as any)
        .from('sole_size_conjugations')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return soleGroupId;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['sole_size_conjugations', variables.soleGroupId] });
      processResyncQueueSilently(qc);
    },
    onError: (e: any) => toast.error(e.message),
  });
}

/**
 * Helper: chama process_resync_queue() para drenar OPs marcadas pelo trigger
 * de DB. Silencioso porque o usuário não precisa esperar; um resync que
 * fica na fila será pego no próximo polling ou quando alguém abrir SaleOrders.
 */
async function processResyncQueueSilently(qc: ReturnType<typeof useQueryClient>) {
  const { data: resyncData, error: resyncErr } = await (supabase as any).rpc('process_resync_queue', { p_limit: 50 });
  if (resyncErr) {
    if (!/does not exist|42883/i.test(resyncErr.message + (resyncErr.code ?? ''))) {
      console.error('[resync_queue] process_resync_queue failed:', resyncErr.message);
    }
    return;
  }
  const processed = Number(resyncData?.processed || 0);
  if (processed > 0) {
    qc.invalidateQueries({ queryKey: ['orders'] });
    qc.invalidateQueries({ queryKey: ['products'] });
    qc.invalidateQueries({ queryKey: ['stock_movements'] });
    toast.success(`${processed} ${processed === 1 ? 'OP resincronizada' : 'OPs resincronizadas'}`);
  }
}
