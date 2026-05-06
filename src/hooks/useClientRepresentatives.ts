import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export function useClientRepresentatives(clientId: string | null) {
  return useQuery({
    queryKey: ['client_representatives', clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_representatives' as any)
        .select('*, representatives(*)')
        .eq('client_id', clientId!);
      if (error) throw error;
      return data as any[];
    },
  });
}

export function useEconomicGroupRepresentatives(groupId: string | null) {
  return useQuery({
    queryKey: ['economic_group_representatives', groupId],
    enabled: !!groupId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('economic_group_representatives' as any)
        .select('*, representatives(*)')
        .eq('economic_group_id', groupId!);
      if (error) throw error;
      return data as any[];
    },
  });
}

export function useAddClientRepresentative() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ clientId, representativeId }: { clientId: string; representativeId: string }) => {
      const { error } = await supabase
        .from('client_representatives' as any)
        .insert({ client_id: clientId, representative_id: representativeId } as any);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['client_representatives', vars.clientId] });
      toast.success('Representante vinculado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useRemoveClientRepresentative() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, clientId }: { id: string; clientId: string }) => {
      const { error } = await supabase
        .from('client_representatives' as any)
        .delete()
        .eq('id', id);
      if (error) throw error;
      return clientId;
    },
    onSuccess: (clientId) => {
      qc.invalidateQueries({ queryKey: ['client_representatives', clientId] });
      toast.success('Representante desvinculado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useAddGroupRepresentative() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ groupId, representativeId }: { groupId: string; representativeId: string }) => {
      const { error } = await supabase
        .from('economic_group_representatives' as any)
        .insert({ economic_group_id: groupId, representative_id: representativeId } as any);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['economic_group_representatives', vars.groupId] });
      toast.success('Representante vinculado ao grupo!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useRemoveGroupRepresentative() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, groupId }: { id: string; groupId: string }) => {
      const { error } = await supabase
        .from('economic_group_representatives' as any)
        .delete()
        .eq('id', id);
      if (error) throw error;
      return groupId;
    },
    onSuccess: (groupId) => {
      qc.invalidateQueries({ queryKey: ['economic_group_representatives', groupId] });
      toast.success('Representante desvinculado do grupo!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}
