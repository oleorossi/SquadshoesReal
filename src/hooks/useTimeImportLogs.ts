import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

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
  status: 'processing' | 'success' | 'partial' | 'error';
  error_messages: Array<{ row: string; error: string }> | null;
  notes: string | null;
  imported_by: string | null;
  created_at: string;
  // Adicionados em 20260525130000 — vínculo com Supabase Storage do arquivo bruto
  file_path?: string | null;
  file_size_bytes?: number | null;
  mime_type?: string | null;
  archive_status?: 'pending' | 'available' | 'failed' | 'legacy';
  archived_at?: string | null;
}

/**
 * Baixa o arquivo bruto do bucket privado. Usar download() em vez de URL
 * assinada garante que o navegador salve o binário com o nome original.
 */
export async function downloadImportFile(filePath: string, fileName: string): Promise<void> {
  const { data, error } = await supabase.storage
    .from('timesheet-imports')
    .download(filePath);
  if (error) throw error;
  if (!data) throw new Error('Arquivo não encontrado no histórico');

  const url = URL.createObjectURL(data);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function useTimeImportLogs() {
  return useQuery({
    queryKey: ['time_import_logs'],
    queryFn: async () => {
      // O PostgREST limita respostas a 1.000 linhas. Paginar internamente evita
      // que importações antigas desapareçam do histórico conforme ele cresce.
      const PAGE_SIZE = 1000;
      const logs: TimeImportLog[] = [];
      let from = 0;

      while (true) {
        const { data, error } = await supabase
          .from('time_import_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;

        const page = (data || []) as unknown as TimeImportLog[];
        logs.push(...page);
        if (page.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }

      return logs;
    },
    staleTime: 30_000,
  });
}
