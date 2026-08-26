import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
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
  coverage_scope?: 'all_employees' | 'listed_employees' | 'legacy_unverified';
  covered_employee_external_ids?: string[];
}

export interface TimeImportQuarantineEntry {
  id: string;
  import_log_id: string;
  batch_id: string;
  employee_external_id: string;
  employee_name: string;
  department: string;
  record_date: string;
  punches: unknown[];
  reason: string;
  created_at: string;
  resolution_status: 'pending' | 'linked' | 'dismissed';
  resolution_reason: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  time_record_id: string | null;
}

interface ResolveTimeImportQuarantineResult {
  resolved: boolean;
  idempotent: boolean;
  quarantine_id: string;
  time_record_id: string;
  employee_id?: string;
  inserted?: number;
  updated?: number;
}

interface DismissTimeImportQuarantineResult {
  dismissed: boolean;
  idempotent: boolean;
  quarantine_id: string;
}

interface TimeImportQuarantineQuery {
  select: (columns: string) => TimeImportQuarantineQuery;
  is: (column: string, value: null) => TimeImportQuarantineQuery;
  eq: (column: string, value: string) => TimeImportQuarantineQuery;
  neq: (column: string, value: string) => TimeImportQuarantineQuery;
  order: (column: string, options: { ascending: boolean }) => TimeImportQuarantineQuery;
  range: (from: number, to: number) => Promise<{ data: unknown[] | null; error: unknown }>;
}

interface TimeImportQuarantineDatabase {
  from: (table: 'time_import_quarantine') => TimeImportQuarantineQuery;
  rpc: (
    fn: 'resolve_time_import_quarantine' | 'dismiss_time_import_quarantine',
    args: { p_quarantine_id: string; p_reason?: string },
  ) => Promise<{ data: unknown; error: unknown }>;
}

// Remover o adaptador quando a migration estiver refletida nos tipos gerados.
const timeImportQuarantineDb = supabase as unknown as TimeImportQuarantineDatabase;

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'erro desconhecido';
};

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

export function useTimeImportQuarantine() {
  return useQuery({
    queryKey: ['time_import_quarantine'],
    queryFn: async () => {
      const PAGE_SIZE = 1000;
      const entries: TimeImportQuarantineEntry[] = [];
      let from = 0;

      while (true) {
        const { data, error } = await timeImportQuarantineDb
          .from('time_import_quarantine')
          .select('id, import_log_id, batch_id, employee_external_id, employee_name, department, record_date, punches, reason, created_at, resolution_status, resolution_reason, resolved_at, resolved_by, time_record_id')
          .eq('resolution_status', 'pending')
          .order('record_date', { ascending: false })
          .order('employee_external_id', { ascending: true })
          .order('id', { ascending: true })
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;

        const page = (data || []) as TimeImportQuarantineEntry[];
        entries.push(...page);
        if (page.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }

      return entries;
    },
    staleTime: 30_000,
  });
}

export function useTimeImportQuarantineHistory() {
  return useQuery({
    queryKey: ['time_import_quarantine_history'],
    queryFn: async () => {
      const PAGE_SIZE = 1000;
      const entries: TimeImportQuarantineEntry[] = [];
      let from = 0;

      while (true) {
        const { data, error } = await timeImportQuarantineDb
          .from('time_import_quarantine')
          .select('id, import_log_id, batch_id, employee_external_id, employee_name, department, record_date, punches, reason, created_at, resolution_status, resolution_reason, resolved_at, resolved_by, time_record_id')
          .neq('resolution_status', 'pending')
          .order('resolved_at', { ascending: false })
          .order('id', { ascending: true })
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;

        const page = (data || []) as TimeImportQuarantineEntry[];
        entries.push(...page);
        if (page.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }

      return entries;
    },
    staleTime: 30_000,
  });
}

export function useResolveTimeImportQuarantine() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (quarantineId: string) => {
      // A resolução é intencionalmente atômica no banco. Não substituir esta
      // RPC por UPDATE/DELETE direto na quarentena ou em time_records.
      const { data, error } = await timeImportQuarantineDb.rpc(
        'resolve_time_import_quarantine',
        { p_quarantine_id: quarantineId },
      );
      if (error) throw error;

      const result = (data || {}) as ResolveTimeImportQuarantineResult;
      if (!result.resolved) {
        throw new Error('A pendência não pôde ser resolvida.');
      }
      return result;
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['time_import_quarantine'] });
      qc.invalidateQueries({ queryKey: ['time_import_quarantine_history'] });
      qc.invalidateQueries({ queryKey: ['time_import_logs'] });
      qc.invalidateQueries({ queryKey: ['time_records'] });
      qc.invalidateQueries({ queryKey: ['timesheet_coverage'] });
      qc.invalidateQueries({ queryKey: ['payroll-comp-records'] });
      qc.invalidateQueries({ queryKey: ['payroll_runs'] });

      toast.success(
        result.idempotent
          ? 'Esta pendência já havia sido resolvida. Os dados foram atualizados.'
          : 'Pendência resolvida. O ponto e os cálculos da folha serão atualizados.',
      );
    },
    onError: (error: unknown) => {
      toast.error(`Não foi possível resolver a pendência: ${getErrorMessage(error)}`);
    },
  });
}

export function useDismissTimeImportQuarantine() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ quarantineId, reason }: { quarantineId: string; reason: string }) => {
      const normalizedReason = reason.trim();
      if (normalizedReason.length < 4) {
        throw new Error('Informe uma justificativa com pelo menos 4 caracteres.');
      }
      // A linha não é apagada: a RPC preserva arquivo, batidas, autor, data e
      // justificativa, e só permite ignorar quando não existe vínculo canônico.
      const { data, error } = await timeImportQuarantineDb.rpc(
        'dismiss_time_import_quarantine',
        { p_quarantine_id: quarantineId, p_reason: normalizedReason },
      );
      if (error) throw error;

      const result = (data || {}) as DismissTimeImportQuarantineResult;
      if (!result.dismissed) throw new Error('A pendência não pôde ser classificada.');
      return result;
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['time_import_quarantine'] });
      qc.invalidateQueries({ queryKey: ['time_import_quarantine_history'] });
      qc.invalidateQueries({ queryKey: ['time_import_logs'] });
      qc.invalidateQueries({ queryKey: ['timesheet_coverage'] });
      qc.invalidateQueries({ queryKey: ['payroll-comp-records'] });
      qc.invalidateQueries({ queryKey: ['payroll_runs'] });
      toast.success(result.idempotent
        ? 'Esta linha já estava classificada. A lista foi atualizada.'
        : 'Linha classificada como externa ao quadro. A evidência e a justificativa foram preservadas.');
    },
    onError: (error: unknown) => {
      toast.error(`Não foi possível classificar a pendência: ${getErrorMessage(error)}`);
    },
  });
}
