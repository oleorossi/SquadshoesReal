import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { TimeException, TimeExceptionForm } from '@/types/timesheet';

export function useTimeExceptions(batch?: string) {
  return useQuery({
    queryKey: ['time_exceptions', batch],
    queryFn: async () => {
      let q = supabase
        .from('time_exceptions')
        .select('*')
        .order('record_date', { ascending: false })
        .order('employee_name');
      if (batch) q = q.eq('import_batch', batch);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as TimeException[];
    },
  });
}

export function useAddTimeException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: TimeExceptionForm) => {
      const { error } = await supabase.from('time_exceptions').insert(form as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['time_exceptions'] });
      toast.success('Exceção registrada!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateTimeException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<TimeExceptionForm> }) => {
      let q = supabase
        .from('time_exceptions')
        .update({ ...data, updated_at: new Date().toISOString() } as any)
        .eq('id', id);
      if (data.status === 'resolved' || data.status === 'ignored') {
        q = (q as any).eq('status', 'pending');
      }
      const { data: rows, error } = await (q as any).select('id');
      if (error) throw error;
      if (data.status === 'resolved' || data.status === 'ignored') {
        if (!rows || rows.length === 0) throw new Error('Exceção já foi processada por outro usuário ou não encontrada.');
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['time_exceptions'] });
      toast.success('Exceção atualizada!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteTimeException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('time_exceptions').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['time_exceptions'] });
      toast.success('Exceção removida!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useBulkCreateExceptions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (exceptions: TimeExceptionForm[]) => {
      if (exceptions.length === 0) return 0;
      for (let i = 0; i < exceptions.length; i += 100) {
        const chunk = exceptions.slice(i, i + 100);
        const { error } = await supabase.from('time_exceptions').insert(chunk as any[]);
        if (error) throw error;
      }
      return exceptions.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ['time_exceptions'] });
      if (count > 0) toast.success(`${count} exceções detectadas e registradas!`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
