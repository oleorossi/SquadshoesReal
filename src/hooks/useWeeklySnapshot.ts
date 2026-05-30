import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface WeeklySnapshot {
  id: string;
  employee_id: string;
  week_start: string;
  week_end: string;
  worked_min: number;
  expected_min: number;
  diff_min: number;
  days_worked: number;
  days_partial: number;
  days_absent: number;
  he_50_min: number;
  he_100_min: number;
  locked_at: string | null;
  locked_by: string | null;
  locked_reason: string | null;
  computed_at: string;
  apuracao_label: string | null;
  /** Nome do funcionário (resolvido via JOIN com employees pela FK).
   *  Não é coluna da tabela — vem do select embedded. */
  employees?: { name: string | null } | null;
}

export function useWeeklySnapshots(employeeId?: string | null) {
  return useQuery({
    queryKey: ['weekly_balance_snapshot', employeeId ?? '__all__'],
    queryFn: async () => {
      let q = (supabase as any)
        .from('weekly_balance_snapshot')
        // Embedded resource via FK weekly_balance_snapshot_employee_id_fkey →
        // traz full_name do funcionário pra UI exibir nome em vez de UUID.
        .select('*, employees(name)')
        .order('week_start', { ascending: false });
      if (employeeId) q = q.eq('employee_id', employeeId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as WeeklySnapshot[];
    },
    staleTime: 60_000,
  });
}

/**
 * Cria/atualiza snapshot de UM funcionário numa semana específica.
 */
export function useSnapshotEmployeeWeek() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      employeeId, weekStart, lock = true, reason,
    }: { employeeId: string; weekStart: string; lock?: boolean; reason?: string }) => {
      const { data, error } = await (supabase as any).rpc('snapshot_employee_week', {
        p_employee_id: employeeId,
        p_week_start: weekStart,
        p_lock: lock,
        p_reason: reason ?? null,
      });
      if (error) throw new Error(error.message);
      return data as WeeklySnapshot;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['weekly_balance_snapshot'] });
      qc.invalidateQueries({ queryKey: ['weekly_balance_audit_log'] });
      toast.success('Semana fechada e travada.');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Falha ao fechar semana.');
    },
  });
}

/**
 * Fecha semana para TODOS os funcionários ativos. Usado pelo botão "fechar semana".
 */
export function useSnapshotAllEmployeesWeek() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ weekStart, lock = true }: { weekStart: string; lock?: boolean }) => {
      const { data, error } = await (supabase as any).rpc('snapshot_all_employees_week', {
        p_week_start: weekStart,
        p_lock: lock,
      });
      if (error) throw new Error(error.message);
      return (data || []) as Array<{ employee_id: string; status: string; diff_min: number | null }>;
    },
    onSuccess: (rows) => {
      qc.invalidateQueries({ queryKey: ['weekly_balance_snapshot'] });
      qc.invalidateQueries({ queryKey: ['weekly_balance_audit_log'] });
      const ok = rows.filter((r) => r.status === 'ok').length;
      const errors = rows.length - ok;
      toast.success(
        errors === 0
          ? `Semana fechada para ${ok} ${ok === 1 ? 'funcionário' : 'funcionários'}.`
          : `Semana fechada para ${ok}; ${errors} com erro.`,
      );
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Falha ao fechar semana.');
    },
  });
}

export function useUnlockWeek() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      employeeId, weekStart, reason,
    }: { employeeId: string; weekStart: string; reason: string }) => {
      if (!reason || reason.trim().length < 8) {
        throw new Error('Justificativa precisa ter no mínimo 8 caracteres.');
      }
      const { error } = await (supabase as any).rpc('unlock_week', {
        p_employee_id: employeeId,
        p_week_start: weekStart,
        p_reason: reason.trim(),
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['weekly_balance_snapshot'] });
      qc.invalidateQueries({ queryKey: ['weekly_balance_audit_log'] });
      toast.success('Semana destravada. Lembre de fechar novamente após corrigir.');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Falha ao destravar semana.');
    },
  });
}

export interface AuditLogEntry {
  id: string;
  snapshot_id: string | null;
  employee_id: string | null;
  week_start: string;
  action: 'snapshot' | 'unlock' | 'retroactive_edit' | 'retroactive_insert' | 'retroactive_delete' | 'recompute';
  before_diff_min: number | null;
  after_diff_min: number | null;
  reason: string | null;
  changed_at: string;
  changed_by: string | null;
  metadata: Record<string, any>;
  /** Nome do funcionário via FK (embedded resource). */
  employees?: { name: string | null } | null;
}

export function useWeeklyAuditLog(filters?: { employeeId?: string | null; weekStart?: string | null }) {
  return useQuery({
    queryKey: ['weekly_balance_audit_log', filters?.employeeId ?? '__all__', filters?.weekStart ?? ''],
    queryFn: async () => {
      let q = (supabase as any)
        .from('weekly_balance_audit_log')
        // Resolve nome via FK weekly_balance_audit_log_employee_id_fkey
        .select('*, employees(name)')
        .order('changed_at', { ascending: false })
        .limit(200);
      if (filters?.employeeId) q = q.eq('employee_id', filters.employeeId);
      if (filters?.weekStart) q = q.eq('week_start', filters.weekStart);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as AuditLogEntry[];
    },
    staleTime: 30_000,
  });
}
