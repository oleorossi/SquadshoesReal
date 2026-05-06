import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { TimeException } from '@/types/timesheet';

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;

async function invokeTimeControl<T = unknown>(
  path: string,
  method: 'GET' | 'PATCH' | 'POST' = 'GET',
  body?: unknown,
  params?: Record<string, string | undefined>,
): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Não autenticado');

  const url = new URL(
    `https://${PROJECT_ID}.supabase.co/functions/v1/time-control/${path}`,
  );
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v) url.searchParams.set(k, v);
    });
  }

  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Erro desconhecido' }));
    throw new Error(err.error || `Erro ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// ---------- Records ----------
export function useTimeControlRecords(filters?: {
  employee_id?: string;
  date_from?: string;
  date_to?: string;
  department?: string;
}) {
  return useQuery({
    queryKey: ['time_control_records', filters],
    queryFn: () =>
      invokeTimeControl<Array<Record<string, unknown>>>(
        'records',
        'GET',
        undefined,
        filters as Record<string, string | undefined>,
      ),
  });
}

// ---------- Exceptions ----------
export function useTimeControlExceptions(filters?: {
  status?: string;
  severity?: string;
  date_from?: string;
  date_to?: string;
}) {
  return useQuery({
    queryKey: ['time_control_exceptions', filters],
    queryFn: () =>
      invokeTimeControl<TimeException[]>(
        'exceptions',
        'GET',
        undefined,
        filters as Record<string, string | undefined>,
      ),
  });
}

export function useApproveException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      exception_id: string;
      status: 'resolved' | 'ignored';
      resolution_notes: string;
    }) => {
      return invokeTimeControl(
        `exceptions/${params.exception_id}`,
        'PATCH',
        { status: params.status, resolution_notes: params.resolution_notes },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['time_control_exceptions'] });
      qc.invalidateQueries({ queryKey: ['time_exceptions'] });
      toast.success('Exceção processada!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ---------- Analytics ----------
export interface TimeControlAnalytics {
  total_employees: number;
  attendance_rate: number;
  punctuality_rate: number;
  avg_overtime_hours: number;
  total_exceptions: number;
  data_quality_score: number;
  trends: {
    late_arrivals: Array<{ date: string; count: number }>;
    overtime_by_department: Array<{ department: string; hours: number }>;
    exceptions_by_type: Array<{ type: string; count: number }>;
  };
}

export function useTimeControlAnalytics(params: { date_from: string; date_to: string }) {
  return useQuery({
    queryKey: ['time_control_analytics', params],
    queryFn: () =>
      invokeTimeControl<TimeControlAnalytics>('analytics', 'GET', undefined, params),
  });
}

// ---------- Work Days ----------
export function useTimeControlWorkDays(filters?: {
  employee_id?: string;
  date_from?: string;
  date_to?: string;
}) {
  return useQuery({
    queryKey: ['time_control_work_days', filters],
    queryFn: () =>
      invokeTimeControl<Array<Record<string, unknown>>>(
        'work-days',
        'GET',
        undefined,
        filters as Record<string, string | undefined>,
      ),
  });
}
