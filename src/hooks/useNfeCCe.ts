import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type NfeCCeStatus = 'rascunho' | 'emitida' | 'rejeitada' | 'erro';

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
        const { error } = await supabase.from('nfe_cce' as any).insert(payload);
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
      // Auditoria 2026-05-29: valida janela legal de 30 dias da emissão da NF
      // original. SEFAZ rejeita CCe após 720h (30 dias corridos) com erro 478.
      // Antes só havia texto informativo no painel — operador podia "marcar
      // emitida" CCe que a SEFAZ recusaria.
      const { data: cce, error: cceErr } = await supabase
        .from('nfe_cce' as any)
        .select('nfe_id, nfe_emitidas(data_emissao)')
        .eq('id', args.id)
        .maybeSingle();
      if (cceErr) throw cceErr;
      const dataEmissao = (cce as any)?.nfe_emitidas?.data_emissao;
      if (dataEmissao) {
        const diffMs = Date.now() - new Date(dataEmissao).getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        if (diffDays > 30) {
          throw new Error(
            `Prazo SEFAZ de 30 dias excedido (NF emitida há ${Math.floor(diffDays)} dias). ` +
            `CCe será rejeitada — emita NF substitutiva ou faça devolução.`
          );
        }
      }
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
