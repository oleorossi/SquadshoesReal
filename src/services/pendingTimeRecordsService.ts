import { supabase } from '@/integrations/supabase/client';

export type IssueType =
  | 'somente_uma_batida'
  | 'falta_saida_apos_almoco'
  | 'batida_extra'
  | 'punches_impar';

export const ISSUE_LABEL: Record<IssueType, string> = {
  somente_uma_batida:        'Só 1 batida (entrada ou saída)',
  falta_saida_apos_almoco:   'Falta saída final',
  batida_extra:              'Batida extra (5 marcações)',
  punches_impar:             'Quantidade ímpar de batidas',
};

export const ISSUE_HINT: Record<IssueType, string> = {
  somente_uma_batida:        'Funcionário só bateu 1 vez. Informe entrada OU saída faltante.',
  falta_saida_apos_almoco:   'Tem entrada, saída de almoço e volta. Falta a saída final.',
  batida_extra:              'Há uma batida a mais — provável erro de marcação. Reveja com cuidado.',
  punches_impar:             'Quantidade ímpar de batidas — falta uma marcação.',
};

export interface PendingTimeRecord {
  time_record_id: string;
  employee_name: string;
  employee_external_id: string | null;
  employee_id: string | null;
  department: string | null;
  record_date: string; // yyyy-mm-dd
  dow: number;         // 1..7 (ISO)
  punches: string[];
  punch_count: number;
  issue_type: IssueType;
  has_manual_override: boolean;
}

export interface EmployeePendingSummary {
  employee_id: string;
  name: string;
  department: string | null;
  pending_count: number;
  oldest_pending: string | null;
  newest_pending: string | null;
  only_one_punch: number;
  missing_exit: number;
  extra_punch: number;
}

export async function listEmployeePendingSummary(): Promise<EmployeePendingSummary[]> {
  const { data, error } = await supabase
    .from('v_employee_pending_summary' as any)
    .select('*')
    .order('pending_count', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as EmployeePendingSummary[];
}

export async function listPendingTimeRecords(employeeId?: string): Promise<PendingTimeRecord[]> {
  let q = supabase
    .from('v_pending_time_records' as any)
    .select('*')
    .order('record_date', { ascending: false });
  if (employeeId) q = q.eq('employee_id', employeeId);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as any[]).map((r) => ({
    ...r,
    punches: Array.isArray(r.punches) ? r.punches : [],
  })) as PendingTimeRecord[];
}

export async function applyManualPunchCompletion(args: {
  timeRecordId: string;
  punchTime: string; // HH:MM
  reason?: string;
}): Promise<{ success: boolean; new_punch_count: number; punches_after: string[] }> {
  const { data, error } = await supabase.rpc('apply_manual_punch_completion' as any, {
    p_time_record_id: args.timeRecordId,
    p_punch_time:     args.punchTime + ':00', // HH:MM:SS
    p_reason:         args.reason ?? 'completed-by-rh',
  });
  if (error) throw error;
  const r = data as any;
  return {
    success: Boolean(r?.success),
    new_punch_count: Number(r?.new_punch_count ?? 0),
    punches_after: Array.isArray(r?.punches_after) ? r.punches_after : [],
  };
}

export const DOW_LABEL: Record<number, string> = {
  1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sáb', 7: 'Dom',
};
