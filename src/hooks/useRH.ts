import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { BenefitsConfig } from '@/lib/payrollCalc';

// ── benefits_config ──────────────────────────────────────────────────
export function useBenefitsConfig() {
  return useQuery({
    queryKey: ['benefits_config'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('benefits_config').select('*').limit(1);
      if (error) throw error;
      return (data?.[0] || null) as BenefitsConfig & { id: string; notes: string } | null;
    },
    staleTime: 5 * 60_000,
  });
}

export function useSaveBenefitsConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<BenefitsConfig> & { id?: string; notes?: string }) => {
      const { id, ...rest } = payload;
      // CLT minimum rates (Brazilian labor law)
      if (rest.overtime_50_pct !== undefined && (rest.overtime_50_pct < 50)) throw new Error('Hora extra 50% deve ser de no mínimo 50% (CLT art. 59).');
      if (rest.overtime_100_pct !== undefined && (rest.overtime_100_pct < 100)) throw new Error('Hora extra 100% deve ser de no mínimo 100% (CLT art. 59).');
      if (rest.night_bonus_pct !== undefined && (rest.night_bonus_pct < 20)) throw new Error('Adicional noturno deve ser de no mínimo 20% (CLT art. 73).');
      if (id) {
        const { error } = await (supabase as any).from('benefits_config').update(rest).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from('benefits_config').insert(rest);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['benefits_config'] });
      toast.success('Configuração de benefícios salva.');
    },
    onError: (err: any) => toast.error(`Erro ao salvar configuração: ${err.message}`),
  });
}

// ── bank_hours_movements + saldo ─────────────────────────────────────
export interface BankHoursMovement {
  id: string;
  employee_id: string;
  movement_date: string;
  /**
   * Tipo do lançamento:
   * - credit/debit/adjustment/compensation/payout — legados
   * - 'pay' — RH marca HE pra pagamento na folha do mês (decisão 2026-05-21).
   *   Quando 'pay', payrollCalc lê esses minutos via overtime_pct (50/100).
   */
  movement_type: 'credit' | 'debit' | 'adjustment' | 'compensation' | 'payout' | 'pay';
  minutes: number;
  reason: string;
  reference_id: string | null;
  /** Adicional HE (50 ou 100) — apenas quando movement_type='pay'. */
  overtime_pct: number | null;
  created_at: string;
}

export function useBankHoursMovements(
  employeeId?: string,
  filters?: { from?: string | null; to?: string | null },
) {
  const from = filters?.from || null;
  const to = filters?.to || null;
  return useQuery({
    queryKey: ['bank_hours_movements', employeeId, from, to],
    queryFn: async () => {
      let q = (supabase as any).from('bank_hours_movements').select('*').order('movement_date', { ascending: false });
      if (employeeId) q = q.eq('employee_id', employeeId);
      else q = q.limit(2000);
      if (from) q = q.gte('movement_date', from);
      if (to)   q = q.lte('movement_date', to);
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
      const period = m.movement_date.slice(0, 7);
      const { data: pr, error: prErr } = await (supabase as any).from('payroll_runs').select('id, status').eq('employee_id', m.employee_id).eq('period', period).maybeSingle();
      if (prErr) throw new Error(`Falha ao verificar folha de pagamento: ${prErr.message}`);
      if (pr && pr.status !== 'rascunho') throw new Error(`Folha do período ${period} já ${pr.status === 'pago' ? 'paga' : 'aprovada'} — desfaça antes de adicionar lançamento.`);
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
      const { data: mov, error: movErr } = await (supabase as any).from('bank_hours_movements').select('employee_id, movement_date').eq('id', id).single();
      if (movErr) throw new Error(`Falha ao carregar lançamento: ${movErr.message}`);
      const period = (mov.movement_date as string).slice(0, 7);
      const { data: pr, error: prErr } = await (supabase as any).from('payroll_runs').select('id, status').eq('employee_id', mov.employee_id).eq('period', period).maybeSingle();
      if (prErr) throw new Error(`Falha ao verificar folha de pagamento: ${prErr.message}`);
      if (pr && pr.status !== 'rascunho') throw new Error(`Folha do período ${period} já ${pr.status === 'pago' ? 'paga' : 'aprovada'} — desfaça antes de remover o lançamento de banco de horas.`);
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

/**
 * Registra pagamento de horas extras: cria movement `payout` (débito do banco
 * de horas) e financial_entries (despesa pendente) atomicamente via RPC.
 * Retorna o detalhe do pagamento — UI pode mostrar "X h pagas (R$ Y) em DD/MM".
 */
export function usePayBankHours() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      employee_id: string;
      hours: number;
      hourly_rate: number;
      payment_date?: string;          // ISO YYYY-MM-DD; default = hoje
      notes?: string;
      bank_account_id?: string | null;
    }) => {
      if (!Number.isFinite(input.hours) || input.hours <= 0) {
        throw new Error('Quantidade de horas deve ser maior que zero.');
      }
      if (!Number.isFinite(input.hourly_rate) || input.hourly_rate <= 0) {
        throw new Error('Valor da hora deve ser maior que zero.');
      }
      const { data, error } = await (supabase as any).rpc('pay_bank_hours', {
        p_employee_id:     input.employee_id,
        p_hours:           input.hours,
        p_hourly_rate:     input.hourly_rate,
        p_payment_date:    input.payment_date || new Date().toISOString().slice(0, 10),
        p_notes:           input.notes || null,
        p_bank_account_id: input.bank_account_id || null,
      });
      if (error) throw error;
      return data as {
        movement_id: string;
        financial_entry_id: string;
        employee_name: string;
        hours: number;
        minutes: number;
        hourly_rate: number;
        amount: number;
        payment_date: string;
        created_at: string;
      };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['bank_hours_movements'] });
      qc.invalidateQueries({ queryKey: ['bank_hours_balance'] });
      qc.invalidateQueries({ queryKey: ['employee_bank_balance'] });
      qc.invalidateQueries({ queryKey: ['financial_entries'] });
      const fmt = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      toast.success(`Pagamento registrado — ${data.hours}h × R$ ${data.hourly_rate} = ${fmt(data.amount)}`);
    },
    onError: (err: any) => toast.error(`Erro ao registrar pagamento: ${err.message}`),
  });
}

// ── absences ─────────────────────────────────────────────────────────
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
      let q = (supabase as any).from('employee_absences').select('*').order('start_date', { ascending: false });
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
      const period = a.start_date.slice(0, 7);
      const { data: pr, error: prErr } = await (supabase as any)
        .from('payroll_runs').select('id, status')
        .eq('employee_id', a.employee_id).eq('period', period).maybeSingle();
      if (prErr) throw new Error(`Falha ao verificar folha do período: ${prErr.message}`);
      if (pr && pr.status !== 'rascunho') {
        throw new Error(`Folha do período ${period} já ${pr.status === 'pago' ? 'paga' : 'aprovada'} — desfaça antes de alterar ausências.`);
      }
      if (id) {
        const { error } = await (supabase as any).from('employee_absences').update(rest).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from('employee_absences').insert(rest);
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
      // Block delete if a non-draft payroll run for the absence's period already exists,
      // to prevent retroactive edits to closed/paid payroll history.
      const { data: abs, error: absErr } = await (supabase as any)
        .from('employee_absences').select('employee_id, start_date').eq('id', id).single();
      if (absErr) throw absErr;
      const period = (abs.start_date as string).slice(0, 7);
      // CRITICAL: capture the error. A silent SELECT failure (RLS / network) yielded
      // pr===null, bypassing the closed-payroll guard and allowing retroactive edits
      // to a paid/approved payroll period.
      const { data: pr, error: prErr } = await (supabase as any)
        .from('payroll_runs').select('id, status')
        .eq('employee_id', abs.employee_id).eq('period', period).maybeSingle();
      if (prErr) throw new Error(`Falha ao verificar folha do período: ${prErr.message}`);
      if (pr && pr.status !== 'rascunho') {
        throw new Error(`Folha do período ${period} já ${pr.status === 'pago' ? 'paga' : 'aprovada'} — desfaça antes de remover ausência.`);
      }
      const { error } = await (supabase as any).from('employee_absences').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['absences'] });
      toast.success('Ausência removida.');
    },
    onError: (err: any) => toast.error(`Erro: ${err.message}`),
  });
}

// ── payroll_runs ─────────────────────────────────────────────────────
export interface PayrollRun {
  id: string;
  employee_id: string;
  period: string;
  base_salary: number;
  hourly_rate: number;
  worked_minutes: number;
  expected_minutes: number;
  business_days: number;
  business_days_worked: number;
  absent_days: number;
  overtime_50_minutes: number;
  overtime_100_minutes: number;
  night_minutes: number;
  overtime_50_value: number;
  overtime_100_value: number;
  night_bonus_value: number;
  dsr_value: number;
  vr_value: number;
  va_value: number;
  vt_total_value: number;
  vt_employee_discount: number;
  health_plan_discount: number;
  inss_value: number;
  irrf_value: number;
  absence_discount: number;
  advances_total: number;
  total_proventos: number;
  total_descontos: number;
  total_liquido: number;
  status: 'rascunho' | 'aprovado' | 'pago';
  notes: string;
  approved_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export function usePayrollRuns(period?: string) {
  return useQuery({
    queryKey: ['payroll_runs', period],
    queryFn: async () => {
      let q = (supabase as any).from('payroll_runs').select('*').order('period', { ascending: false });
      if (period) q = q.eq('period', period);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as PayrollRun[];
    },
    staleTime: 30_000,
  });
}

export function useUpsertPayrollRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: Partial<PayrollRun> & { employee_id: string; period: string }) => {
      const { id, created_at, updated_at, ...rest } = p as any;
      // Guard: refuse to overwrite an already-approved or paid payroll run.
      // The upsert ON CONFLICT would reset status→'rascunho' and zero paid_at,
      // destroying the audit trail of an already-issued payment.
      const { data: existing, error: existingErr } = await (supabase as any)
        .from('payroll_runs')
        .select('status')
        .eq('employee_id', p.employee_id)
        .eq('period', p.period)
        .maybeSingle();
      if (existingErr) throw new Error(`Falha ao verificar folha existente: ${existingErr.message}`);
      if (existing && !['rascunho'].includes(existing.status)) {
        throw new Error(`Folha já ${existing.status === 'pago' ? 'paga' : 'aprovada'} — desbloqueie antes de recalcular.`);
      }
      // upsert por (employee_id, period) — chave única no schema.
      // Atomic guard: if a race between two tabs both passed the SELECT check,
      // the conflicting update only proceeds when status IS 'rascunho'; the
      // second writer gets 0 rows and throws, preventing silent overwrite.
      const { data: upsertRows, error } = await (supabase as any)
        .from('payroll_runs')
        .upsert(rest, { onConflict: 'employee_id,period' })
        .select('id');
      if (error) throw error;
      if (existing && (!upsertRows || upsertRows.length === 0)) {
        throw new Error('Folha já aprovada ou paga por outro usuário — recarregue a página.');
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll_runs'] });
    },
    onError: (err: any) => toast.error(`Erro ao salvar folha: ${err.message}`),
  });
}

export function useUpdatePayrollStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: PayrollRun['status'] }) => {
      const patch: Record<string, any> = { status };
      if (status === 'aprovado') patch.approved_at = new Date().toISOString();
      if (status === 'pago')     patch.paid_at = new Date().toISOString();
      // Enforce valid predecessor so double-click or stale UI can't
      // double-stamp paid_at or reverse a terminal 'pago' state.
      const validPrev: string | null =
        status === 'aprovado' ? 'rascunho' :
        status === 'pago'     ? 'aprovado' :
        null;
      let q = (supabase as any).from('payroll_runs').update(patch).eq('id', id);
      if (validPrev) q = q.eq('status', validPrev);
      const { data: updated, error } = await q.select('id');
      if (error) throw error;
      if (validPrev && (!updated || updated.length === 0)) {
        throw new Error('Status atual não permite essa transição — recarregue a página.');
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll_runs'] });
      toast.success('Status da folha atualizado.');
    },
    onError: (err: any) => toast.error(`Erro: ${err.message}`),
  });
}
