import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type NfeCCeStatus = 'rascunho' | 'emitida' | 'rejeitada' | 'erro' | 'cancelada';

export interface NfeCCe {
  id: string;
  nfe_id: string | null;
  nfe_number: string;
  nfe_chave: string;
  sequencia: number;
  correction_text: string;
  protocol: string | null;
  sefaz_response: string | null;
  status: NfeCCeStatus;
  emitted_at: string | null;
  emitted_by: string | null;
  xml: string | null;
  created_at: string;
}

export function useNfeCCes(filters?: { nfeId?: string; status?: NfeCCeStatus }) {
  return useQuery({
    queryKey: ['nfe_cce', filters],
    staleTime: 0,
    queryFn: async () => {
      // Embed aninhado (cce → nfe → sale_orders) quebra a query quando há
      // CCes apontando pra NFs sem sale_order — simplificado pra 1 nível.
      let query = supabase
        .from('nfe_cce' as any)
        .select('*, nfe_emitidas(numero, serie, chave_acesso, sale_order_id)')
        .order('created_at', { ascending: false });
      if (filters?.nfeId) query = query.eq('nfe_id', filters.nfeId);
      if (filters?.status) query = query.eq('status', filters.status);
      const { data, error } = await query;
      if (error) {
        console.error('[useNfeCCes] error:', error);
        throw error;
      }
      return (data || []) as unknown as Array<NfeCCe & { nfe_emitidas?: any }>;
    },
  });
}

export function useNextCCeSequence(nfeId: string | null) {
  return useQuery({
    queryKey: ['nfe_cce_next_seq', nfeId],
    enabled: !!nfeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('nfe_cce' as any)
        .select('sequencia')
        .eq('nfe_id', nfeId)
        .order('sequencia', { ascending: false })
        .limit(1);
      if (error) throw error;
      const last = (data?.[0] as any)?.sequencia ?? 0;
      return last + 1;
    },
  });
}

export function useSaveCCe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cce: Partial<NfeCCe> & { id?: string }) => {
      const { id, created_at, ...payload } = cce as any;
      if (id) {
        const { error } = await supabase.from('nfe_cce' as any).update(payload).eq('id', id);
        if (error) throw error;
      } else {
        let { error } = await supabase.from('nfe_cce' as any).insert(payload);
        // Race na sequência (unique nfe_chave+sequencia): se dois rascunhos da
        // mesma NF calcularam o mesmo número, recomputa o próximo e tenta uma
        // vez antes de propagar o erro cru do Postgres ao usuário.
        if (error && (error as { code?: string }).code === '23505' && payload.nfe_id) {
          const { data: maxRow } = await supabase
            .from('nfe_cce' as any)
            .select('sequencia')
            .eq('nfe_id', payload.nfe_id)
            .order('sequencia', { ascending: false })
            .limit(1);
          const nextSeq = (((maxRow?.[0] as { sequencia?: number })?.sequencia) ?? 0) + 1;
          ({ error } = await supabase.from('nfe_cce' as any).insert({ ...payload, sequencia: nextSeq }));
        }
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nfe_cce'] });
      toast.success('Carta de Correção salva.');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteCCe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('nfe_cce' as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nfe_cce'] });
      toast.success('Rascunho removido.');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useMarkCCeEmitted() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; protocol: string; sefazResponse?: string }) => {
      const { error } = await supabase
        .from('nfe_cce' as any)
        .update({
          status: 'emitida',
          protocol: args.protocol,
          sefaz_response: args.sefazResponse || '',
          emitted_at: new Date().toISOString(),
        })
        .eq('id', args.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nfe_cce'] });
      toast.success('CCe marcada como emitida.');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useAuthorizedNfes(enabled = true) {
  return useQuery({
    queryKey: ['nfe_authorized_for_cce'],
    enabled,
    staleTime: 0,
    queryFn: async () => {
      // Embed sale_orders removido — NF sincronizada do GestaoClick não tem
      // sale_order_id, e PostgREST estava falhando o embed em alguns casos.
      const { data, error } = await supabase
        .from('nfe_emitidas')
        .select('id, numero, serie, chave_acesso, data_emissao, sale_order_id, cnpj_emitente')
        .eq('status', 'autorizada')
        .order('data_emissao', { ascending: false })
        .limit(200);
      if (error) {
        console.error('[useAuthorizedNfes] error:', error);
        throw error;
      }
      console.info(`[useAuthorizedNfes] ${data?.length ?? 0} NF-es autorizadas`);
      return data || [];
    },
  });
}
