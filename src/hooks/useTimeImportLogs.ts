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
  // Adicionados em 20260525130000 — vínculo com Supabase Storage do arquivo bruto
  file_path?: string | null;
  file_size_bytes?: number | null;
  mime_type?: string | null;
}

/**
 * Gera URL temporária (signed) pra download do arquivo bruto de uma importação.
 * Validade default 60s — suficiente pra acionar download imediato.
 */
export async function getImportFileUrl(filePath: string, expiresInSec = 60): Promise<string> {
  const { data, error } = await supabase.storage
    .from('timesheet-imports')
    .createSignedUrl(filePath, expiresInSec);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error('URL não pôde ser gerada');
  return data.signedUrl;
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
      // Antes de deletar o log, tenta remover o arquivo bruto do bucket pra
      // não deixar lixo. Falha silenciosa — log órfão é melhor do que log
      // inacessível por falha de Storage.
      const { data: log } = await supabase
        .from('time_import_logs' as any)
        .select('file_path')
        .eq('id', id)
        .maybeSingle();
      const filePath = (log as any)?.file_path;
      if (filePath) {
        try {
          await supabase.storage.from('timesheet-imports').remove([filePath]);
        } catch (err) {
          console.warn('[useDeleteTimeImportLog] falha ao remover arquivo do bucket:', err);
        }
      }
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