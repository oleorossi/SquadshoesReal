import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type AbsenceKind = 'ferias' | 'atestado' | 'licenca' | 'folga_compensatoria' | 'suspensao' | 'outro';

export interface EmployeeAbsence {
  id: string;
  employee_id: string;
  start_date: string;
  end_date: string;
  absence_type: AbsenceKind | string;
  justified: boolean | null;
  notes: string | null;
  document_url: string | null;
  created_at: string;
  updated_at: string;
}

export const ABSENCE_LABEL: Record<string, string> = {
  ferias: 'Férias',
  atestado: 'Atestado',
  licenca: 'Licença',
  folga_compensatoria: 'Folga compensatória',
  suspensao: 'Suspensão',
  outro: 'Outro',
};

export function useEmployeeAbsences(employeeId?: string | null) {
  return useQuery({
    queryKey: ['employee_absences', employeeId ?? '__all__'],
    queryFn: async () => {
      let q = (supabase as any)
        .from('employee_absences')
        .select('*, employees(name, department)')
        .order('start_date', { ascending: false });
      if (employeeId) q = q.eq('employee_id', employeeId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as (EmployeeAbsence & { employees: { name: string; department: string } | null })[];
    },
    staleTime: 60_000,
  });
}

export function useCreateAbsence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      employee_id: string;
      start_date: string;
      end_date: string;
      absence_type: AbsenceKind;
      notes?: string;
    }) => {
      if (!input.employee_id || !input.start_date || !input.end_date) {
        throw new Error('Funcionário, início e fim são obrigatórios.');
      }
      if (input.end_date < input.start_date) {
        throw new Error('Data final deve ser igual ou posterior ao início.');
      }
      const { data, error } = await (supabase as any)
        .from('employee_absences')
        .insert({
          employee_id: input.employee_id,
          start_date: input.start_date,
          end_date: input.end_date,
          absence_type: input.absence_type,
          justified: true,
          notes: input.notes?.trim() || null,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as EmployeeAbsence;
    },
    onSuccess: () => {
      // ['employee_absences'] agora também atinge o useAbsences de useRH (key unificada,
      // D9) — é o que faz o abono chegar em RelatorioFaltas/Atrasos e no Espelho.
      qc.invalidateQueries({ queryKey: ['employee_absences'] });
      qc.invalidateQueries({ queryKey: ['v_time_pendings'] });
      qc.invalidateQueries({ queryKey: ['get_pending_count_by_employee'] });
      toast.success('Ausência cadastrada — dias isentados do cálculo.');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Falha ao cadastrar ausência.');
    },
  });
}

export function useDeleteAbsence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('employee_absences').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee_absences'] });
      qc.invalidateQueries({ queryKey: ['v_time_pendings'] });
      toast.success('Ausência removida — dias voltam a contar.');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Falha ao remover ausência.');
    },
  });
}
