import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  normalizeClientLabelPattern,
  type ClientLabelPattern,
} from '@/lib/clientLabelPattern';

export const clientLabelPatternQueryKey = (clientId: string | null | undefined) =>
  ['client-label-pattern', clientId] as const;

export type ClientLabelingOption = {
  id: string;
  razao_social: string;
  nome_fantasia: string | null;
  label_pattern: unknown;
};

async function fetchClientLabelPattern(clientId: string): Promise<ClientLabelPattern | null> {
  const { data, error } = await supabase
    .from('clients')
    .select('label_pattern')
    .eq('id', clientId)
    .maybeSingle();
  if (error) throw error;
  const raw = (data as { label_pattern?: unknown } | null)?.label_pattern;
  if (raw == null) return null;
  return normalizeClientLabelPattern(raw);
}

export function useClientLabelPattern(clientId: string | null | undefined) {
  return useQuery({
    queryKey: clientLabelPatternQueryKey(clientId),
    enabled: Boolean(clientId),
    queryFn: () => fetchClientLabelPattern(clientId!),
    staleTime: 60_000,
  });
}

export function useSaveClientLabelPattern() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      clientId,
      pattern,
    }: {
      clientId: string;
      pattern: ClientLabelPattern;
    }) => {
      const payload = normalizeClientLabelPattern(pattern, pattern.key);
      const { error } = await supabase
        .from('clients')
        .update({ label_pattern: payload } as never)
        .eq('id', clientId);
      if (error) throw error;
      return payload;
    },
    onSuccess: (payload, vars) => {
      qc.setQueryData(clientLabelPatternQueryKey(vars.clientId), payload);
      void qc.invalidateQueries({ queryKey: ['clients'] });
      void qc.invalidateQueries({ queryKey: ['clients', 'for-labeling'] });
      toast.success('Padrão de etiqueta do cliente salvo.');
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
