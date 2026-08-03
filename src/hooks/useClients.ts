import { useQuery, useMutation, useQueryClient, keepPreviousData, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { sanitizeUuidFields } from '@/lib/utils';
import { searchNormOrFilter } from '@/lib/searchUtils';
import { fetchPage } from '@/lib/pagination';

/**
 * Invalida TODAS as queries cuja queryKey começa com 'clients' (em qualquer
 * lugar do app). Cobre keys derivadas como ['clients_by_group', id],
 * ['clients_by_cnpj_for_labels'], ['clients_for_expedicao_v3'], etc.
 *
 * Pq isso existe: o invalidate padrão `{ queryKey: ['clients'] }` só casa
 * com EXATAMENTE essa key — não pega as variantes. Resultado: editava
 * CNPJ/dados em /clients e ao navegar pra /grupos-economicos, /label-system,
 * /expedicao etc, o cliente aparecia desatualizado (cache stale).
 *
 * Reportado pelo user em 19/05/2026 (caso grupo Vivian Ferreira).
 */
export function invalidateAllClientQueries(qc: QueryClient) {
  qc.invalidateQueries({
    predicate: (q) => {
      const k = q.queryKey[0];
      return typeof k === 'string' && (k === 'clients' || k.startsWith('clients_') || k.startsWith('clients-'));
    },
  });
}

export type Client = {
  id: string;
  client_number: string;
  razao_social: string;
  nome_fantasia: string;
  cnpj: string;
  inscricao_estadual: string;
  endereco: string;
  numero: string;
  bairro: string;
  cidade: string;
  estado: string;
  cep: string;
  codigo_municipio: string;
  email: string;
  telefone: string;
  contato: string;
  notes: string;
  economic_group_id: string | null;
  active: boolean;
  logo_url: string;
  silk_url: string | null;
  is_favorite: boolean;
  accepts_bundled_packaging: boolean;
  credit_limit: number;
  branch_code: string | null;
  branch_name: string | null;
  // Flag explícita de contribuição de ICMS. true=contribuinte (precisa IE
  // numérica), false=isento/não contribuinte (IE pode ser "ISENTO"), null=
  // não definido (emit-nfe cai no fallback de inferir do campo IE).
  // Adicionado em 16/05/2026 — backfill derivou do IE pra clientes existentes.
  icms_contribuinte: boolean | null;
  created_at: string;
  updated_at: string;
};

export type ClientFormData = Omit<Client, 'id' | 'client_number' | 'created_at' | 'updated_at'>;

export type EconomicGroup = {
  id: string;
  group_number: string;
  name: string;
  description: string;
  logo_url: string;
  silk_url: string | null;
  billing_email: string | null;
  finance_contact_name: string | null;
  important_info: string | null;
  is_favorite: boolean;
  created_at: string;
  updated_at: string;
};

export function useClients() {
  return useQuery({
    queryKey: ['clients'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .order('razao_social');
      if (error) throw error;
      return (data || []) as unknown as Client[];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

/**
 * Listagem de clientes com busca NO BANCO (2026-08-03).
 *
 * `useClients()` continua existindo e devolvendo a carteira inteira — os
 * seletores de cliente, o editor de grupo econômico e os KPIs precisam do
 * universo completo, não de uma página. Este hook é só pra LISTA.
 *
 * A busca usa `clients.search_norm`, ampliada na migration `20261112120200`
 * pra cobrir os mesmos campos que o filtro em JS cobria (inclusive CNPJ,
 * cidade, estado, telefone e email) — sem isso, procurar cliente por CNPJ
 * teria parado de funcionar ao mover a busca pro servidor.
 *
 * Com 43 clientes o total fica abaixo do limiar, então `fetchPage` devolve a
 * carteira inteira e o pager nem aparece. A paginação entra sozinha se a
 * carteira crescer.
 */
export function usePaginatedClients(params: { search?: string; page?: number } = {}) {
  const { search = '', page = 1 } = params;
  return useQuery({
    queryKey: ['clients', 'paginated', search.trim(), page],
    placeholderData: keepPreviousData,
    queryFn: () =>
      fetchPage<Client>((from, to) => {
        let q = supabase
          .from('clients')
          .select('*', { count: 'exact' })
          .order('razao_social')
          // Desempate: há razão social repetida (matriz/filial) — sem 2ª chave
          // a mesma linha pode repetir ou sumir entre páginas.
          .order('id');
        const orFilter = searchNormOrFilter(search);
        if (orFilter) q = q.or(orFilter) as typeof q;
        return q.range(from, to) as any;
      }, { page }),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useEconomicGroups() {
  return useQuery({
    queryKey: ['economic_groups'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('economic_groups')
        .select('*')
        .order('name');
      if (error) throw error;
      return data as EconomicGroup[];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useCreateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: ClientFormData) => {
      const { data, error } = await supabase.from('clients').insert(sanitizeUuidFields(form) as any).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateAllClientQueries(qc);
      toast.success('Cliente cadastrado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ClientFormData> }) => {
      const { error } = await supabase.from('clients').update(sanitizeUuidFields(data) as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAllClientQueries(qc);
      toast.success('Cliente atualizado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Block deletion when the client has authorized/in-flight NF-es to preserve
      // fiscal audit trail. Must resolve client → sale_orders → nfe_emitidas because
      // nfe_emitidas has no client_id column; the previous direct .eq('sale_order_id', id)
      // was filtering by client id against sale_order_id — a no-op that never matched.
      // Capture the SELECT errors: silently swallowing them would let the delete proceed
      // even when the NF-e check failed (RLS denial, network glitch), leaking past the guard.
      const { data: clientSos, error: sosErr } = await supabase
        .from('sale_orders')
        .select('id')
        .eq('client_id', id);
      if (sosErr) throw new Error(`Falha ao consultar pedidos do cliente: ${sosErr.message}`);
      const soIds = (clientSos || []).map((s: { id: string }) => s.id);
      if (soIds.length > 0) {
        const { data: blockingNfe, error: nfeErr } = await supabase
          .from('nfe_emitidas')
          .select('id, ref_nfe, status')
          .in('sale_order_id', soIds)
          .in('status', ['autorizada', 'processando', 'cancelando'])
          .limit(1);
        if (nfeErr) throw new Error(`Falha ao consultar NF-e do cliente: ${nfeErr.message}`);
        if (blockingNfe && blockingNfe.length > 0) {
          throw new Error(
            `Cliente tem NF-e ${blockingNfe[0].status} vinculada. Cancele a NF-e antes de excluir o cliente.`
          );
        }
      }
      // Also block if any sale_order references this client (historical fiscal record)
      const { data: linkedOrders, error: linkedErr } = await supabase
        .from('sale_orders')
        .select('id, order_number')
        .eq('client_id', id)
        .limit(1);
      if (linkedErr) throw new Error(`Falha ao verificar pedidos vinculados: ${linkedErr.message}`);
      if (linkedOrders && linkedOrders.length > 0) {
        throw new Error(
          `Cliente possui pedidos de venda vinculados (ex: ${(linkedOrders[0] as any).order_number}). Exclua ou transfira os pedidos antes de excluir o cliente.`
        );
      }
      const { error } = await supabase.from('clients').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAllClientQueries(qc);
      toast.success('Cliente excluído!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useCreateEconomicGroup() {
  const qc = useQueryClient();
  return useMutation({
   mutationFn: async (form: { name: string; description: string; logo_url?: string; silk_url?: string; billing_email?: string; finance_contact_name?: string; important_info?: string }) => {
      const { data, error } = await supabase.from('economic_groups').insert(form as any).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['economic_groups'] });
      toast.success('Grupo econômico criado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateEconomicGroup() {
  const qc = useQueryClient();
  return useMutation({
   mutationFn: async ({ id, data }: { id: string; data: { name: string; description: string; logo_url?: string; silk_url?: string; billing_email?: string; finance_contact_name?: string; important_info?: string } }) => {
      const { error } = await supabase.from('economic_groups').update(data as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['economic_groups'] });
      toast.success('Grupo econômico atualizado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteEconomicGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Preflight: refuse delete when clients still reference this group.
      // FK is ON DELETE SET NULL by default — silently nulling economic_group_id
      // on dozens of clients destroys consolidated billing/reporting context.
      const { count, error: countErr } = await supabase
        .from('clients')
        .select('id', { count: 'exact', head: true })
        .eq('economic_group_id', id);
      if (countErr) throw new Error(`Falha ao verificar clientes vinculados: ${countErr.message}`);
      if ((count ?? 0) > 0) {
        throw new Error(
          `Grupo econômico tem ${count} ${count === 1 ? 'cliente vinculado' : 'clientes vinculados'}. Desvincule antes de excluir.`,
        );
      }
      const { error } = await supabase.from('economic_groups').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['economic_groups'] });
      invalidateAllClientQueries(qc);
      toast.success('Grupo econômico excluído!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}
