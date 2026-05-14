import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface TimesheetPeriod {
  id: string;
  label: string;
  start_date: string;
  end_date: string;
  status: 'aberto' | 'importado' | 'fechado';
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function useTimesheetPeriods() {
  return useQuery({
    queryKey: ['timesheet_periods'],
    queryFn: async (): Promise<TimesheetPeriod[]> => {
      const { data, error } = await (supabase as any)
        .from('timesheet_periods')
        .select('*')
        .order('start_date', { ascending: false });
      if (error) throw error;
      return (data || []) as TimesheetPeriod[];
    },
    staleTime: 60_000,
  });
}

export function useCreateTimesheetPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { label: string; start_date: string; end_date: string; notes?: string }) => {
      if (!input.label.trim()) throw new Error('Informe um nome pro período.');
      if (!input.start_date || !input.end_date) throw new Error('Informe início e fim do período.');
      if (input.end_date < input.start_date) throw new Error('A data fim não pode ser anterior ao início.');
      const { data, error } = await (supabase as any)
        .from('timesheet_periods')
        .insert({
          label: input.label.trim(),
          start_date: input.start_date,
          end_date: input.end_date,
          notes: input.notes?.trim() || null,
        })
        .select('*')
        .single();
      if (error) {
        if (error.code === '23505') throw new Error('Já existe um período com exatamente esse intervalo de datas.');
        if (error.message?.includes('timesheet_periods_max_30d')) {
          throw new Error('O período não pode passar de 31 dias (o relógio grava no máximo 30 em 30 dias).');
        }
        throw error;
      }
      return data as TimesheetPeriod;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timesheet_periods'] });
      toast.success('Período cadastrado.');
    },
    onError: (err: any) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateTimesheetPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; label?: string; status?: TimesheetPeriod['status']; notes?: string }) => {
      const patch: Record<string, unknown> = {};
      if (input.label !== undefined) patch.label = input.label.trim();
      if (input.status !== undefined) patch.status = input.status;
      if (input.notes !== undefined) patch.notes = input.notes?.trim() || null;
      const { error } = await (supabase as any)
        .from('timesheet_periods')
        .update(patch)
        .eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timesheet_periods'] });
      toast.success('Período atualizado.');
    },
    onError: (err: any) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteTimesheetPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('timesheet_periods').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timesheet_periods'] });
      toast.success('Período removido.');
    },
    onError: (err: any) => toast.error(`Erro: ${err.message}`),
  });
}
