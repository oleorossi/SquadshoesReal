import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type BomOperationFormData = {
  operation_name: string;
  stage: string;
  standard_time_minutes: number;
  resource_name: string;
  cost_per_hour: number;
  sort_order: number;
  notes: string;
  active: boolean;
};

export const emptyOperationForm: BomOperationFormData = {
  operation_name: '',
  stage: '',
  standard_time_minutes: 0,
  resource_name: '',
  cost_per_hour: 0,
  sort_order: 0,
  notes: '',
  active: true,
};

// Ordem canônica pós PR1-PR3 (Mesa→Aviamento, Costura PR2).
export const PRODUCTION_STAGES = [
  'Corte Palmilha',
  'Corte Forração',
  'Aviamento',
  'Costura',
  'Silk',
  'Colagem',
  'Montagem',
  'Solagem',
  'Acabamento',
  'Expedição',
  'Embalagem',
  'Inspeção',
] as const;

export function useBomOperations(sheetId: string | null) {
  return useQuery({
    queryKey: ['bom_operations', sheetId],
    enabled: !!sheetId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bom_operations')
        .select('*')
        .eq('sheet_id', sheetId!)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

export function useAddBomOperation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ sheetId, data }: { sheetId: string; data: BomOperationFormData }) => {
      if (!Number.isFinite(data.standard_time_minutes) || data.standard_time_minutes < 0) throw new Error('Tempo padrão deve ser um número não-negativo.');
      if (!Number.isFinite(data.cost_per_hour) || data.cost_per_hour < 0) throw new Error('Custo por hora deve ser um número não-negativo.');
      // Operação criada pela UI é sempre 'manual' — o generate_bom_operations v2
      // preserva manual/cronoanálise e só regenera capacidade/default/pendente.
      const { error } = await supabase
        .from('bom_operations')
        .insert({ sheet_id: sheetId, ...data, time_source: 'manual' } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bom_operations'] });
      toast.success('Operação adicionada!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateBomOperation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<BomOperationFormData> }) => {
      if (data.standard_time_minutes !== undefined && (!Number.isFinite(data.standard_time_minutes) || data.standard_time_minutes < 0)) throw new Error('Tempo padrão deve ser um número não-negativo.');
      if (data.cost_per_hour !== undefined && (!Number.isFinite(data.cost_per_hour) || data.cost_per_hour < 0)) throw new Error('Custo por hora deve ser um número não-negativo.');
      // Se o usuário mexeu em tempo/custo/ativação, a linha passa a ser 'manual'
      // (deixa de ser regenerável pelo generate_bom_operations v2).
      const takesOwnership =
        data.standard_time_minutes !== undefined ||
        data.cost_per_hour !== undefined ||
        data.active !== undefined;
      const payload = takesOwnership ? { ...data, time_source: 'manual' } : data;
      const { error } = await supabase
        .from('bom_operations')
        .update(payload as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bom_operations'] });
      toast.success('Operação atualizada!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteBomOperation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('bom_operations')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bom_operations'] });
      toast.success('Operação removida!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}
