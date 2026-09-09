import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { BenefitsConfig } from '@/lib/benefitsConfig';
import { assertNoClosedPayrollInRange } from '@/lib/ponto/absencePayrollGuard';
import type { Database } from '@/integrations/supabase/types';

type PayrollRunInsert = Database['public']['Tables']['payroll_runs']['Insert'];
type PayrollRunUpdate = Database['public']['Tables']['payroll_runs']['Update'];

const payrollCommandClient = supabase as unknown as {
  rpc: (
    name: 'cancel_payroll_run',
    args: { p_payroll_run_id: string; p_reason: string },
  ) => Promise<{ error: { message: string } | null }>;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  return 'Erro desconhecido';
}

// ── benefits_config ──────────────────────────────────────────────────
export function useBenefitsConfig() {
  return useQuery({
    queryKey: ['benefits_config'],
    queryFn: async () => {
      const { data, error } = await supabase.from('benefits_config').select('*').limit(1);
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
        const { error } = await supabase.from('benefits_config').update(rest).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('benefits_config').insert(rest);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['benefits_config'] });
      toast.success('Configuração de benefícios salva.');
    },
    onError: (err: unknown) => toast.error(`Erro ao salvar configuração: ${errorMessage(err)}`),
  });
}

// Banco de horas REMOVIDO (reforma Gestão de Pessoas 2026-07-09): hooks de
// movimentos/saldo descontinuados junto com as tabelas bank_hours_*.

// (Hooks de lançamento/pagamento de banco de horas removidos na reforma 2026-07-09.)

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
  justified: boolean | null;
  paid: boolean | null;
  hours_per_day: number | null;
  document_url: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export function useAbsences(filters?: { employeeId?: string; from?: string; to?: string }) {
  return useQuery({
    // Key unificada com useEmployeeAbsences: os DOIS hooks leem `employee_absences`,
    // mas cada um invalidava a sua própria key — registrar atestado numa tela deixava
    // RelatorioFaltas/RelatorioAtrasos/EspelhoPontoPage exibindo falta já abonada por
    // até 30s. O 'range' distingue esta query da que é por funcionário (queryFns
    // diferentes não podem dividir key idêntica) e o prefixo comum faz a invalidação
    // de qualquer um dos lados atingir o outro. (D9, auditoria RH 2026-07-29)
    queryKey: ['employee_absences', 'range', filters],
    queryFn: async () => {
      let q = supabase.from('employee_absences').select('*').order('start_date', { ascending: false });
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
      const unpaidType = rest.absence_type === 'falta_injustificada' || rest.absence_type === 'suspensao';
      const paid = rest.paid ?? !unpaidType;
      const payload = {
        ...rest,
        // Mantém as duas gerações do cadastro coerentes: `paid` é a flag
        // financeira atual; `justified` ainda é lida por rotinas legadas.
        paid,
        justified: paid && !unpaidType,
      };
      await assertNoClosedPayrollInRange(a.employee_id, a.start_date, a.end_date, 'alterar ausências');
      if (id) {
        const { error } = await supabase.from('employee_absences').update(payload).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('employee_absences').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee_absences'] });
      toast.success('Ausência salva.');
    },
    onError: (err: unknown) => toast.error(`Erro: ${errorMessage(err)}`),
  });
}

export function useDeleteAbsence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Block delete if a non-draft payroll run for the absence's period already exists,
      // to prevent retroactive edits to closed/paid payroll history.
      const { data: abs, error: absErr } = await supabase
        .from('employee_absences').select('employee_id, start_date, end_date').eq('id', id).single();
      if (absErr) throw absErr;
      await assertNoClosedPayrollInRange(abs.employee_id, abs.start_date as string, abs.end_date as string, 'remover ausências');
      const { error } = await supabase.from('employee_absences').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee_absences'] });
      toast.success('Ausência removida.');
    },
    onError: (err: unknown) => toast.error(`Erro: ${errorMessage(err)}`),
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
  /** Folha por hora (2026-06-01): minutos 1,0× (dia útil até 18h). */
  normal_minutes: number;
  /** Folha por hora: minutos 1,5× (após 18h / sáb / dom / feriado). */
  premium_minutes: number;
  /** Folha por hora: R$ das horas normais. */
  normal_value: number;
  /** Folha por hora: R$ das horas 1,5× (já com o multiplicador). */
  premium_value: number;
  expected_minutes: number;
  business_days: number;
  /** Dias trabalhados. No regime POR PAR guarda os DIAS PRODUTIVOS (dias com
   *  pares lançados na Ficha de Montadores), não dias com batida de ponto. */
  business_days_worked: number;
  absent_days: number;
  /** Pares do período (regime por par) — base do bruto. 0 nos demais regimes.
   *  Ficam gravados na folha porque holerite e recibo têm de mostrar o que foi
   *  PAGO, mesmo emitidos meses depois (mig 20261116120100). */
  pares_medio?: number;
  pares_dificil?: number;
  overtime_50_minutes: number;
  overtime_100_minutes: number;
  /** R$ de HE (colunas de 20260705120000 — existem no banco). */
  overtime_amount: number;
  /** R$ de descontos por atraso/falta (20260705120000). */
  deductions_amount: number;
  net_salary: number;
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
  status: 'rascunho' | 'aprovado' | 'pago' | 'cancelado';
  notes: string;
  /** Snapshot imutável usado por documentos de folhas aprovadas/pagas. */
  calculation_snapshot?: unknown;
  calculation_rule_version?: string | null;
  approved_at: string | null;
  approved_by?: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export function usePayrollRuns(period?: string) {
  return useQuery({
    queryKey: ['payroll_runs', period],
    queryFn: async () => {
      let q = supabase.from('payroll_runs').select('*').order('period', { ascending: false });
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
      const { id, created_at, updated_at, ...rest } = p;
      const payrollUpdate = rest as unknown as PayrollRunUpdate;
      const payrollInsert = rest as unknown as PayrollRunInsert;
      const { data: existing, error: existingErr } = await supabase
        .from('payroll_runs')
        .select('id,status')
        .eq('employee_id', p.employee_id)
        .eq('period', p.period)
        .neq('status', 'cancelado')
        .maybeSingle();
      if (existingErr) throw new Error(`Falha ao verificar folha existente: ${existingErr.message}`);
      if (existing && !['rascunho'].includes(existing.status)) {
        const label = existing.status === 'pago' ? 'paga'
          : 'aprovada';
        throw new Error(`Folha já ${label} — o histórico deste período não pode ser sobrescrito.`);
      }

      // Folhas canceladas permanecem como histórico, então a unicidade é
      // parcial e não pode ser usada por ON CONFLICT sem predicado no PostgREST.
      // Atualize o rascunho ativo pelo id ou crie a geração seguinte.
      if (existing) {
        const { data: updatedRows, error } = await supabase
          .from('payroll_runs')
          .update(payrollUpdate)
          .eq('id', existing.id)
          .eq('status', 'rascunho')
          .select('id');
        if (error) throw error;
        if (!updatedRows || updatedRows.length === 0) {
          throw new Error('Folha já aprovada ou paga por outro usuário — recarregue a página.');
        }
        return;
      }

      const { error } = await supabase
        .from('payroll_runs')
        .insert(payrollInsert);
      if (error) {
        if (error.code === '23505') {
          throw new Error('Outra folha ativa foi criada para esta competência — recarregue a página.');
        }
        throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll_runs'] });
    },
    onError: (err: unknown) => toast.error(`Erro ao salvar folha: ${errorMessage(err)}`),
  });
}

export function useCancelPayrollRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const normalizedReason = reason.trim();
      if (normalizedReason.length < 4) {
        throw new Error('Informe uma justificativa com pelo menos 4 caracteres.');
      }
      const { error } = await payrollCommandClient.rpc('cancel_payroll_run', {
        p_payroll_run_id: id,
        p_reason: normalizedReason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll_runs'] });
      qc.invalidateQueries({ queryKey: ['payroll_payments'] });
      qc.invalidateQueries({ queryKey: ['payroll_payment_summaries'] });
      qc.invalidateQueries({ queryKey: ['employee_advances'] });
      toast.success('Folha cancelada. A competência foi liberada para novo cálculo.');
    },
    onError: (err: unknown) => toast.error(`Erro ao cancelar folha: ${errorMessage(err)}`),
  });
}

export function useUpdatePayrollStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: PayrollRun['status'] }) => {
      const patch: PayrollRunUpdate = { status };
      // approved_at/approved_by/paid_at são carimbos do servidor. O cliente
      // solicita apenas a transição e nunca fornece relógio ou autoria.
      // Enforce valid predecessor so double-click or stale UI can't
      // double-stamp paid_at or reverse a terminal 'pago' state.
      const validPrev: string | null =
        status === 'aprovado' ? 'rascunho' :
        status === 'pago'     ? 'aprovado' :
        null;
      let q = supabase.from('payroll_runs').update(patch).eq('id', id);
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
    onError: (err: unknown) => toast.error(`Erro: ${errorMessage(err)}`),
  });
}
