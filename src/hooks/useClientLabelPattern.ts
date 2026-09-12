import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  collectionPatternKeys,
  normalizeClientLabelCollection,
  toPersistedLabelPattern,
  type ClientLabelPatternCollection,
} from '@/lib/clientLabelPattern';

export const clientLabelPatternQueryKey = (clientId: string | null | undefined) =>
  ['client-label-pattern', clientId] as const;

export type ClientLabelingOption = {
  id: string;
  razao_social: string;
  nome_fantasia: string | null;
  label_pattern: unknown;
};

async function fetchClientLabelCollection(
  clientId: string,
): Promise<ClientLabelPatternCollection> {
  const { data, error } = await supabase
    .from('clients')
    .select('label_pattern')
    .eq('id', clientId)
    .maybeSingle();
  if (error) throw error;
  const raw = (data as { label_pattern?: unknown } | null)?.label_pattern;
  return normalizeClientLabelCollection(raw);
}

export function useClientLabelPattern(clientId: string | null | undefined) {
  return useQuery({
    queryKey: clientLabelPatternQueryKey(clientId),
    enabled: Boolean(clientId),
    queryFn: () => fetchClientLabelCollection(clientId!),
    staleTime: 60_000,
  });
}

export function useSaveClientLabelPattern() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      clientId,
      collection,
    }: {
      clientId: string;
      collection: ClientLabelPatternCollection;
    }) => {
      const payload = toPersistedLabelPattern(collection);
      const { error } = await supabase
        .from('clients')
        .update({ label_pattern: payload } as never)
        .eq('id', clientId);
      if (error) throw error;
      return payload ?? normalizeClientLabelCollection(null);
    },
    onSuccess: (payload, vars) => {
      qc.setQueryData(clientLabelPatternQueryKey(vars.clientId), payload);
      void qc.invalidateQueries({ queryKey: ['clients'] });
      void qc.invalidateQueries({ queryKey: ['clients', 'for-labeling'] });
      const count = collectionPatternKeys(payload).length;
      toast.success(
        count > 1
          ? 'Padrões de etiqueta do cliente salvos.'
          : 'Padrão de etiqueta do cliente salvo.',
      );
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Não consegui salvar o padrão de etiqueta.');
    },
  });
}

export function useClientsForLabeling() {
  return useQuery({
    queryKey: ['clients', 'for-labeling'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, razao_social, nome_fantasia, label_pattern')
        .eq('active', true)
        .order('razao_social');
      if (error) throw error;
      return (data ?? []) as ClientLabelingOption[];
    },
    staleTime: 60_000,
  });
}
