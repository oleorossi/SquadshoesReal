import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export type DayStatus =
  | 'normal' | 'overtime' | 'absent' | 'partial'
  | 'irregular' | 'inconsistent' | 'holiday' | 'weekend';
export type Urgency = 'fresh' | 'aging' | 'overdue';

export interface TimePending {
  id: string;                  // time_record id
  employee_external_id: string;
  employee_name: string;
  employee_id: string | null;
  department: string | null;
  record_date: string;         // ISO date
  punches: string[];           // ["HH:MM", ...]
  punches_count: number;
  dow: number;                 // 1..7 ISO
  days_since: number;
  day_summary: {
    status: DayStatus;
    worked_min?: number;
    expected_min?: number;
    [k: string]: unknown;
  };
  urgency: Urgency;
}

export interface PendingCount {
  employee_id: string;
  employee_name: string;
  department: string | null;
  pending_count: number;
  overdue_count: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hooks
// ─────────────────────────────────────────────────────────────────────────────

const PROBLEM_STATUSES: DayStatus[] = ['inconsistent', 'irregular', 'partial'];

/**
 * Lista de registros de ponto problemáticos (status inconsistent/irregular/partial)
 * nos últimos 90 dias úteis. View v_time_pendings já filtra fim de semana + feriados.
 */
export function useTimePendings(opts?: { onlyProblems?: boolean }) {
  return useQuery({
    queryKey: ['v_time_pendings', !!opts?.onlyProblems],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('v_time_pendings')
        .select('*')
        .order('days_since', { ascending: false });
      if (error) throw error;
      const rows = (data || []) as TimePending[];
      return opts?.onlyProblems
        ? rows.filter((r) => PROBLEM_STATUSES.includes(r.day_summary?.status))
        : rows;
    },
    staleTime: 60_000,
  });
}

/**
 * Agregado por funcionário pra badge no RH Hub.
 */
export function usePendingCountByEmployee(maxAgeDays = 30) {
  return useQuery({
    queryKey: ['get_pending_count_by_employee', maxAgeDays],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_pending_count_by_employee', {
        p_max_age_days: maxAgeDays,
      });
      if (error) throw error;
      return (data || []) as PendingCount[];
    },
    staleTime: 60_000,
  });
}

/**
 * Total agregado (soma de todos os funcionários) pra usar em badge global.
 */
export function usePendingTotal(maxAgeDays = 30) {
  const q = usePendingCountByEmployee(maxAgeDays);
  const total = (q.data || []).reduce((s, x) => s + x.pending_count, 0);
  const overdueTotal = (q.data || []).reduce((s, x) => s + x.overdue_count, 0);
  return { ...q, total, overdueTotal };
}

/**
 * RPC complete_punches — RH completa batidas faltantes.
 * Valida no servidor: formato HH:MM + número PAR de batidas.
 */
export function useCompletePunches() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      timeRecordId, punches, reason,
    }: { timeRecordId: string; punches: string[]; reason?: string }) => {
      const { error } = await (supabase as any).rpc('complete_punches', {
        p_time_record_id: timeRecordId,
        p_punches: punches,
        p_reason: reason ?? null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['v_time_pendings'] });
      qc.invalidateQueries({ queryKey: ['get_pending_count_by_employee'] });
      qc.invalidateQueries({ queryKey: ['bank_hours_balance'] });
      qc.invalidateQueries({ queryKey: ['time_records'] });
      toast.success('Batidas atualizadas. Banco de horas recalculado.');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Falha ao completar batidas.');
    },
  });
}
