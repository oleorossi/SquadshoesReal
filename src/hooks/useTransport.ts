import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { Bau, BoxType, ItemType, TransportCompany, TransportCompanyRate } from '@/types/transport';

// ============= BAÚS =============

export function useBaus() {
  return useQuery({
    queryKey: ['baus'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('baus')
        .select('*')
        .order('nome');
      if (error) throw error;
      return data as Bau[];
    },
  });
}

export function useAddBau() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (bau: Omit<Bau, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase.from('baus').insert(bau).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['baus'] });
      toast.success('Baú cadastrado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateBau() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Bau> }) => {
      const { error } = await supabase.from('baus').update(data).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['baus'] });
      toast.success('Baú atualizado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteBau() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('baus').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['baus'] });
      toast.success('Baú excluído!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

// ============= BOX TYPES =============

export function useBoxTypes() {
  return useQuery({
    queryKey: ['box_types'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('box_types')
        .select('*')
        .order('nome');
      if (error) throw error;
      return data as BoxType[];
    },
  });
}

export function useAddBoxType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (boxType: Omit<BoxType, 'id' | 'created_at' | 'updated_at'>) => {
      // min_stock/quantity/unit_price são NOT NULL sem default no banco — a UI
      // não envia; sem estes defaults o insert falhava com 23502.
      const payload = { min_stock: 0, quantity: 0, unit_price: 0, ...(boxType as Record<string, unknown>) };
      const { data, error } = await supabase.from('box_types').insert(payload as never).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['box_types'] });
      toast.success('Tipo de caixa cadastrado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateBoxType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<BoxType> }) => {
      const { error } = await supabase.from('box_types').update(data).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['box_types'] });
      toast.success('Tipo de caixa atualizado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteBoxType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('box_types').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['box_types'] });
      toast.success('Tipo de caixa excluído!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

// ============= ITEM TYPES =============

export function useItemTypes() {
  return useQuery({
    queryKey: ['item_types'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('item_types')
        .select('*')
        .order('nome');
      if (error) throw error;
      return data as ItemType[];
    },
  });
}

export function useAddItemType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (itemType: Omit<ItemType, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase.from('item_types').insert(itemType).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['item_types'] });
      toast.success('Tipo de item cadastrado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteItemType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('item_types').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['item_types'] });
      toast.success('Tipo de item excluído!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

// ============= TRANSPORT COMPANIES =============

export function useTransportCompanies() {
  return useQuery({
    queryKey: ['transport_companies'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transport_companies')
        .select('*')
        .order('nome');
      if (error) throw error;
      return data as TransportCompany[];
    },
  });
}

export function useAddTransportCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (company: Omit<TransportCompany, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase.from('transport_companies').insert(company).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport_companies'] });
      toast.success('Transportadora cadastrada!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateTransportCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<TransportCompany> }) => {
      const { error } = await supabase.from('transport_companies').update(data).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport_companies'] });
      toast.success('Transportadora atualizada!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteTransportCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Preflight: refuse delete when rates exist for this company. The rates
      // table FK might CASCADE silently, destroying historical pricing data
      // referenced by past PVs/freight calculations.
      const { count, error: countErr } = await supabase
        .from('transport_company_rates')
        .select('id', { count: 'exact', head: true })
        .eq('transport_company_id', id);
      if (countErr) throw new Error(`Falha ao verificar tarifas vinculadas: ${countErr.message}`);
      if ((count ?? 0) > 0) {
        throw new Error(
          `Transportadora possui ${count} ${count === 1 ? 'tarifa cadastrada' : 'tarifas cadastradas'}. Remova-${count === 1 ? 'a' : 'as'} antes de excluir.`,
        );
      }
      const { error } = await supabase.from('transport_companies').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport_companies'] });
      qc.invalidateQueries({ queryKey: ['transport_company_rates'] });
      toast.success('Transportadora excluída!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

// ============= TRANSPORT COMPANY RATES =============

export function useTransportCompanyRates(companyId?: string) {
  return useQuery({
    queryKey: ['transport_company_rates', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transport_company_rates')
        .select('*')
        .eq('transport_company_id', companyId!)
        .order('estado');
      if (error) throw error;
      return data as TransportCompanyRate[];
    },
  });
}

export function useUpsertTransportCompanyRates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rates: Omit<TransportCompanyRate, 'id' | 'created_at' | 'updated_at'>[]) => {
      const { error } = await supabase
        .from('transport_company_rates')
        .upsert(rates, { onConflict: 'transport_company_id,estado' });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport_company_rates'] });
      toast.success('Tarifas atualizadas!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteTransportCompanyRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('transport_company_rates').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transport_company_rates'] });
      toast.success('Tarifa excluída!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}
