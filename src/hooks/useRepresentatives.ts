import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type Representative = {
  id: string;
  name: string;
  email: string;
  phone: string;
  commission_pct: number;
  active: boolean;
  notes: string;
  cep: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  estado: string;
  created_at: string;
  updated_at: string;
};

export type RepresentativeFormData = {
  name: string;
  email: string;
  phone: string;
  commission_pct: number;
  active: boolean;
  notes: string;
  cep: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  estado: string;
};

export function useRepresentatives() {
  return useQuery({
    queryKey: ['representatives'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('representatives')
        .select('*')
        .order('name');
      if (error) throw error;
      return data as Representative[];
    },
  });
}

export function useCreateRepresentative() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: RepresentativeFormData) => {
      const { error } = await supabase.from('representatives').insert(form as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['representatives'] });
      toast.success('Representante cadastrado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateRepresentative() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...form }: RepresentativeFormData & { id: string }) => {
      const { error } = await supabase.from('representatives').update(form as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['representatives'] });
      toast.success('Representante atualizado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteRepresentative() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { count, error: countErr } = await supabase
        .from('sale_orders')
        .select('id', { count: 'exact', head: true })
        .eq('representative_id', id);
      if (countErr) throw new Error(`Falha ao verificar pedidos vinculados: ${countErr.message}`);
      if ((count ?? 0) > 0) throw new Error(`Não é possível excluir: representante possui ${count} pedido(s) vinculado(s). Inative o cadastro em vez de excluir.`);
      const { error } = await supabase.from('representatives').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['representatives'] });
      toast.success('Representante excluído!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}
