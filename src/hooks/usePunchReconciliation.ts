import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// Fase 1 — reconciliação de prestadores e vínculo do ponto.
// As RPCs (get_punch_reconciliation / punch_map_resolve) foram criadas na
// migration 20260627120000 e ainda NÃO estão no types.ts gerado, por isso o
// cast `(supabase as any).rpc(...)`. Regenerar os tipos depois remove o cast.

export type PunchStatus = 'pendente' | 'vinculado' | 'ignorado';

export interface PunchReconRow {
  device_id: string;
  device_label: string | null;
  batidas: number;
  primeira_batida: string | null;
  ultima_batida: string | null;
  status: PunchStatus;
  employee_id: string | null;
  employee_name: string | null;
  suggested_employee_id: string | null;
  suggested_name: string | null;
  suggestion_score: number | null;
}

export function usePunchReconciliation() {
  return useQuery({
    queryKey: ['punch-reconciliation'],
    queryFn: async (): Promise<PunchReconRow[]> => {
      const { data, error } = await (supabase as any).rpc('get_punch_reconciliation');
      if (error) throw error;
      return (data ?? []) as PunchReconRow[];
    },
    staleTime: 60_000,
  });
}

interface ResolveInput {
  device_id: string;
  employee_id: string | null;
  device_label: string | null;
  status: PunchStatus;
  notes?: string | null;
}

export function usePunchMapResolve() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: ResolveInput) => {
      const { error } = await (supabase as any).rpc('punch_map_resolve', {
        p_device_id: p.device_id,
        p_employee_id: p.employee_id,
        p_device_label: p.device_label,
        p_status: p.status,
        p_notes: p.notes ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['punch-reconciliation'] });
      qc.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (e: unknown) =>
      toast.error(`Falha ao salvar vínculo: ${e instanceof Error ? e.message : String(e)}`),
  });
}

export interface CreateProviderInput {
  device_id: string;
  device_label: string | null;
  name: string;
  // Mantém os valores EXISTENTES de payment_type (a normalização p/
  // diaria/mensal/producao foi adiada pra Fase 2, junto do motor de pagamento).
  payment_type: 'mensalista' | 'diarista' | 'remoto';
  salary: number;
  daily_rate: number;
  department: string;
}

// Cria o prestador (cadastro mínimo; o restante cai nos defaults do banco) e
// já vincula o device. Não-atômico: se o vínculo falhar, o cadastro fica e o
// operador religa depois — sem perda.
export function useCreateProviderAndLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: CreateProviderInput) => {
      const { data, error } = await supabase
        .from('employees')
        .insert({
          name: p.name,
          payment_type: p.payment_type,
          salary: p.salary,
          daily_rate: p.daily_rate,
          department: p.department,
          active: true,
        } as never)
        .select('id')
        .single();
      if (error) throw error;
      const empId = (data as { id: string }).id;

      const { error: linkErr } = await (supabase as any).rpc('punch_map_resolve', {
        p_device_id: p.device_id,
        p_employee_id: empId,
        p_device_label: p.device_label,
        p_status: 'vinculado',
        p_notes: 'criado na reconciliação',
      });
      if (linkErr) throw linkErr;
      return empId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['punch-reconciliation'] });
      qc.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (e: unknown) =>
      toast.error(`Falha ao criar cadastro: ${e instanceof Error ? e.message : String(e)}`),
  });
}
