import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { BenefitsConfig } from '@/lib/benefitsConfig';

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

// Banco de horas REMOVIDO (reforma Gestão de Pessoas 2026-07-09): hooks de
// movimentos/saldo descontinuados junto com as tabelas bank_hours_*.

/** Guard compartilhado: lança erro se existir folha NÃO-rascunho cujo período
 *  ('YYYY-MM' ou intervalo 'YYYY-MM-DD_YYYY-MM-DD') cubra a data informada. */
async function assertNoClosedPayroll(employeeId: string, dateISO: string, acao: string) {
  const { data: runs, error } = await (supabase as any)
    .from('payroll_runs')
    .select('id, status, period')
    .eq('employee_id', employeeId)
    .neq('status', 'rascunho');
  if (error) throw new Error(`Falha ao verificar folha de pagamento: ${error.message}`);
  const d = dateISO.slice(0, 10);
  const run = (runs || []).find((r: any) => {
    const p = String(r.period || '');
    if (/^\d{4}-\d{2}$/.test(p)) return d.slice(0, 7) === p;
    const mInt = p.match(/^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/);
    if (mInt) return d >= mInt[1] && d <= mInt[2];
    return false;
  });
  if (run) throw new Error(`Folha do período ${run.period} já ${run.status === 'pago' ? 'paga' : 'aprovada'} — desfaça antes de ${acao}.`);
}

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
  paid: boolean;
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
      await assertNoClosedPayroll(a.employee_id, a.start_date, 'alterar ausências');
      if (id) {
        const { error } = await (supabase as any).from('employee_absences').update(rest).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from('employee_absences').insert(rest);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee_absences'] });
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
      await assertNoClosedPayroll(abs.employee_id, abs.start_date as string, 'remover ausência');
      const { error } = await (supabase as any).from('employee_absences').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee_absences'] });
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
  business_days_worked: number;
  absent_days: number;
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
