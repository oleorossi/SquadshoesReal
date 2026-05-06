import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface TimeImportLog {
  id: string;
  file_name: string;
  batch_id: string | null;
  start_date: string | null;
  end_date: string | null;
  inserted_count: number;
  updated_count: number;
  skipped_count: number;
  error_count: number;
  total_rows: number;
  status: 'success' | 'partial' | 'error';
  error_messages: Array<{ row: string; error: string }> | null;
  notes: string | null;
  imported_by: string | null;
  created_at: string;
}

export function useTimeImportLogs() {
  return useQuery({
    queryKey: ['time_import_logs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('time_import_logs' as any)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data || []) as unknown as TimeImportLog[];
    },
    staleTime: 30_000,
  });
}

export function useDeleteTimeImportLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('time_import_logs' as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['time_import_logs'] });
      toast.success('Registro removido do histórico');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}