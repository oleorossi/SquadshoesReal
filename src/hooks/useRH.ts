import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// ── bank_hours_movements + saldo ─────────────────────────────────────
export interface BankHoursMovement {
  id: string;
  employee_id: string;
  movement_date: string;
  movement_type: 'credit' | 'debit' | 'adjustment' | 'compensation' | 'payout';
  minutes: number;
  reason: string;
  reference_id: string | null;
  created_at: string;
}

export function useBankHoursMovements(employeeId?: string) {
  return useQuery({
    queryKey: ['bank_hours_movements', employeeId],
    queryFn: async () => {
      let q = (supabase as any).from('bank_hours_movements').select('*').order('movement_date', { ascending: false });
      if (employeeId) q = q.eq('employee_id', employeeId);
      else q = q.limit(2000);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as BankHoursMovement[];
    },
    staleTime: 30_000,
  });
}

export interface BankHoursBalance {
  employee_id: string;
  employee_name: string;
  initial_min: number;
  movements_min: number;
  balance_min: number;
}

export function useBankHoursBalances() {
  return useQuery({
    queryKey: ['bank_hours_balance'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('bank_hours_balance').select('*');
      if (error) throw error;
      return (data || []) as BankHoursBalance[];
    },
    staleTime: 30_000,
  });
}

export function useAddBankHoursMovement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (m: Omit<BankHoursMovement, 'id' | 'created_at' | 'reference_id'> & { reference_id?: string | null }) => {
      const minutes = Number(m.minutes);
      if (!Number.isFinite(minutes) || Math.abs(minutes) > 60 * 24 * 365) {
        throw new Error('Quantidade de minutos inválida (máx 1 ano de trabalho).');
      }
      if ((m.movement_type === 'credit' || m.movement_type === 'compensation') && minutes < 0) {
        throw new Error('Crédito/compensação não pode ter minutos negativos.');
      }
      const { error } = await (supabase as any).from('bank_hours_movements').insert(m);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bank_hours_movements'] });
      qc.invalidateQueries({ queryKey: ['bank_hours_balance'] });
      toast.success('Lançamento registrado no banco de horas.');
    },
    onError: (err: any) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteBankHoursMovement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('bank_hours_movements').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bank_hours_movements'] });
      qc.invalidateQueries({ queryKey: ['bank_hours_balance'] });
      toast.success('Lançamento removido.');
    },
    onError: (err: any) => toast.error(`Erro: ${err.message}`),
  });
}

// ── pagamento de banco de horas ──────────────────────────────────────
// Saca horas do saldo acumulado: débito no banco + despesa no financeiro.
// Valor = (min/60) × hourly_rate × overtime_multiplier (calculado no RPC).
export interface PayBankHoursResult {
  employee_id: string;
  employee_name: string;
  paid_minutes: number;
  paid_hours: number;
  hourly_rate: number;
  multiplier: number;
  pay_amount: number;
  balance_before_min: number;
  balance_after_min: number;
  financial_entry_id: string;
  bank_movement_id: string;
}

export function usePayBankHours() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ employeeId, payMinutes, notes }: {
      employeeId: string;
      payMinutes: number;
      notes?: string;
    }): Promise<PayBankHoursResult> => {
      if (!Number.isFinite(payMinutes) || payMinutes <= 0) {
        throw new Error('Informe uma quantidade de horas positiva pra pagar.');
      }
      const { data, error } = await (supabase as any).rpc('pay_bank_hours_balance', {
        p_employee_id: employeeId,
        p_pay_minutes: Math.round(payMinutes),
        p_notes: notes ?? null,
      });
      if (error) throw error;
      return data as PayBankHoursResult;
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['bank_hours_movements'] });
      qc.invalidateQueries({ queryKey: ['bank_hours_balance'] });
      qc.invalidateQueries({ queryKey: ['employee_bank_detail'] });
      qc.invalidateQueries({ queryKey: ['financial_entries'] });
      toast.success(
        `Pagamento registrado: ${res.paid_hours}h por ${res.pay_amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}. ` +
        `Saldo restante: ${(res.balance_after_min / 60).toFixed(1)}h.`,
      );
    },
    onError: (err: any) => toast.error(`Erro ao pagar banco de horas: ${err.message}`),
  });
}


export type AbsenceType =
  | 'atestado' | 'licenca_maternidade' | 'licenca_paternidade'
  | 'licenca_obito' | 'licenca_casamento' | 'falta_justificada'
  | 'falta_injustificada' | 'ferias' | 'folga' | 'abono' | 'suspensao';

export const ABSENCE_TYPE_LABELS: Record<AbsenceType, string> = {
  atestado:             'Atestado médico',
  licenca_maternidade:  'Licença maternidade',
  licenca_paternidade:  'Licença paternidade',
  licenca_obito:        'Licença óbito',
  licenca_casamento:    'Licença casamento',
  falta_justificada:    'Falta justificada',
  falta_injustificada:  'Falta injustificada',
  ferias:               'Férias',
  folga:                'Folga compensada',
  abono:                'Abono',
  suspensao:            'Suspensão disciplinar',
};

export interface Absence {
  id: string;
  employee_id: string;
  start_date: string;
  end_date: string;
  absence_type: AbsenceType;
  paid: boolean;
  hours_per_day: number | null;
  document_url: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export function useAbsences(filters?: { employeeId?: string; from?: string; to?: string }) {
  return useQuery({
    queryKey: ['absences', filters],
    queryFn: async () => {
      let q = (supabase as any).from('absences').select('*').order('start_date', { ascending: false });
      if (filters?.employeeId) q = q.eq('employee_id', filters.employeeId);
      if (filters?.from) q = q.gte('end_date', filters.from);
      if (filters?.to)   q = q.lte('start_date', filters.to);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as Absence[];
    },
    staleTime: 30_000,
  });
}

export function useUpsertAbsence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: Partial<Absence> & { id?: string; employee_id: string; start_date: string; end_date: string; absence_type: AbsenceType }) => {
      const { id, ...rest } = a;
      if (id) {
        const { error } = await (supabase as any).from('absences').update(rest).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from('absences').insert(rest);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['absences'] });
      toast.success('Ausência salva.');
    },
    onError: (err: any) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteAbsence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('absences').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['absences'] });
      toast.success('Ausência removida.');
    },
    onError: (err: any) => toast.error(`Erro: ${err.message}`),
  });
}
