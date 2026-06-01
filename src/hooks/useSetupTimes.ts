import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// ════════════════════════════════════════════════════════════════════════
// Tempos de Setup (paridade Tutor32 · PCP)
//
// CRUD da tabela production_setup_times (já existia no banco, vazia e sem UI):
// tempo de preparação ao TROCAR de referência/cor dentro de um setor. Aqui é
// só o CADASTRO — a integração no sequenciamento (compute_wave_timeline) fica
// pra uma etapa separada por mexer no motor de ondas (risco maior).
//
// Referências (from/to) são opcionais → permite setup genérico só por cor
// (ex.: "troca de cor no Silk = 10 min" sem fixar referência).
// ════════════════════════════════════════════════════════════════════════

export interface SetupTime {
  id: string;
  stage_name: string;
  from_color: string | null;
  to_color: string | null;
  from_reference_id: string | null;
  to_reference_id: string | null;
  setup_minutes: number;
  notes: string | null;
  created_at: string;
}

export interface SetupTimeFormData {
  id?: string;
  stage_name: string;
  from_reference_id: string | null;
  from_color: string;
  to_reference_id: string | null;
  to_color: string;
  setup_minutes: number;
  notes: string;
}

export interface SheetOption {
  id: string;
  name: string;
  code: string | null;
}

/** Opções de ficha técnica (referência) pros selects de/para. */
export function useTechnicalSheetOptions() {
  return useQuery({
    queryKey: ['technical_sheets_options_setup'],
    queryFn: async (): Promise<SheetOption[]> => {
      const { data, error } = await supabase
        .from('technical_sheets')
        .select('id, name, code')
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as SheetOption[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useSetupTimes() {
  return useQuery({
    queryKey: ['production_setup_times'],
    queryFn: async (): Promise<SetupTime[]> => {
      const { data, error } = await supabase
        .from('production_setup_times')
        .select('*')
        .order('stage_name', { ascending: true })
        .order('setup_minutes', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as SetupTime[];
    },
  });
}

export function useSaveSetupTime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: SetupTimeFormData) => {
      const payload = {
        stage_name: form.stage_name,
        from_reference_id: form.from_reference_id || null,
        from_color: form.from_color?.trim() || '',
        to_reference_id: form.to_reference_id || null,
        to_color: form.to_color?.trim() || '',
        setup_minutes: Math.max(0, Math.round(Number(form.setup_minutes) || 0)),
        notes: form.notes?.trim() || '',
      };
      if (form.id) {
        const { error } = await supabase.from('production_setup_times').update(payload as never).eq('id', form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('production_setup_times').insert(payload as never);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production_setup_times'] });
      toast.success('Tempo de setup salvo.');
    },
    onError: (e: Error) => toast.error(`Erro ao salvar setup: ${e.message}`),
  });
}

export function useDeleteSetupTime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('production_setup_times').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production_setup_times'] });
      toast.success('Tempo de setup removido.');
    },
    onError: (e: Error) => toast.error(`Erro ao remover setup: ${e.message}`),
  });
}
