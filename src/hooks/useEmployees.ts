import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { stripSearchNorm } from '@/lib/searchUtils';
import { normalizeEmployeeEmploymentState } from '@/lib/employeeEmployment';
import {
  type EmployeeAdvanceStatus,
} from '@/lib/employeeAdvances';

interface RhCommandRpcResult {
  data: unknown;
  error: { message: string } | null;
}

const rhCommandClient = supabase as unknown as {
  rpc: (name: string, args: Record<string, unknown>) => Promise<RhCommandRpcResult>;
};

async function runRhCommand(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await rhCommandClient.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

export interface Employee {
  id: string;
  name: string;
  cpf: string | null;
  external_id: string | null;
  phone: string;
  whatsapp: string;
  pix_key: string;
  pix_type: string;
  salary: number;
  hourly_rate: number | null;
  overtime_hourly_rate: number | null;
  overtime_multiplier: number;
  /** Regime de pagamento: mensalista (salário, desconta ponto), remoto (salário cheio,
   *  não bate ponto), diarista (paga por dia trabalhado, valor da diária) ou
   *  producao (paga por PAR produzido — soma a Ficha de Montadores, ignora
   *  salário e ponto). */
  payment_type: 'mensalista' | 'remoto' | 'diarista' | 'producao';
  /** Valor da diária (R$/dia) quando diarista. */
  daily_rate: number | null;
  /** R$/par por dificuldade quando producao (fonte única; snapshot no apontamento). */
  valor_par_medio: number | null;
  valor_par_dificil: number | null;
  work_schedule_id: string | null;
  /** Adicionais de HE por funcionário (regime contrato). 0 = hora simples.
   *  LEGADO (percentual) — substituídos por he_normal_rate/he_sunday_holiday_rate
   *  (R$/h absoluto) na reforma 2026-07-09; removidos na limpeza final. */
  overtime_50_pct: number;
  overtime_100_pct: number;
  night_bonus_pct: number;
  /** Valor da hora extra em R$/h (absoluto, negociado por funcionário — não-CLT).
   *  he_normal_rate cobre dia útil/sábado/noturno; he_sunday_holiday_rate cobre
   *  domingo/feriado (fallback pra he_normal_rate quando nulo). */
  he_normal_rate: number | null;
  he_sunday_holiday_rate: number | null;
  role: string;
  department: string;
  admission_date: string;
  // Último dia trabalhado (CLT). NULL = funcionário ativo.
  // Adicionado 2026-05-18: Timesheet usa pra cortar cálculo de horas esperadas
  // após essa data (sem isso, demitido recebia expected fantasma até fim do batch).
  termination_date: string | null;
  active: boolean;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface EmployeeAdvance {
  id: string;
  employee_id: string;
  amount: number;
  advance_date: string;
  time: string;
  description: string;
  receipt_url: string;
  status: EmployeeAdvanceStatus;
  payroll_run_id: string | null;
  settled_at?: string | null;
  settled_by?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  cancellation_reason?: string | null;
  created_at: string;
  updated_at: string;
}

/** Campos de remuneração/escala são opcionais no form: o cadastro simples
 *  (Employees.tsx) não os envia e o insert cai nos defaults do banco;
 *  no update, omitidos = não tocados. */
type EmployeePayKeys =
  | 'hourly_rate' | 'overtime_hourly_rate' | 'overtime_multiplier'
  | 'payment_type' | 'daily_rate' | 'work_schedule_id'
  | 'overtime_50_pct' | 'overtime_100_pct' | 'night_bonus_pct'
  | 'he_normal_rate' | 'he_sunday_holiday_rate'
  | 'valor_par_medio' | 'valor_par_dificil';
type EmployeeForm =
  Omit<Employee, 'id' | 'created_at' | 'updated_at' | EmployeePayKeys> &
  Partial<Pick<Employee, EmployeePayKeys>>;
type AdvanceForm = Omit<
  EmployeeAdvance,
  'id' | 'created_at' | 'updated_at' | 'status' | 'payroll_run_id'
>;
type CreateAdvanceInput = AdvanceForm & { idempotencyKey: string };

interface AdvanceLookupResult {
  data: {
    id: string;
    employee_id: string;
    amount: number;
    advance_date: string;
    time: string;
    description: string;
    receipt_url: string;
  } | null;
  error: { message: string } | null;
}

const advanceLookupClient = supabase as unknown as {
  from: (table: 'employee_advances') => {
    select: (columns: string) => {
      eq: (column: 'idempotency_key', value: string) => {
        maybeSingle: () => Promise<AdvanceLookupResult>;
      };
    };
  };
};

export function useEmployees() {
  return useQuery({
    queryKey: ['employees'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .order('name');
      if (error) throw error;
      // Cast via unknown: a Row do Supabase usa string|null em vários campos
      // (department, role, etc.) enquanto a interface Employee os trata como
      // string. Mapeamento conhecido e seguro.
      return data as unknown as Employee[];
    },
    staleTime: 5 * 60_000,
  });
}

export function useAddEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: EmployeeForm) => {
      if (!Number.isFinite(form.salary) || form.salary < 0) throw new Error('Salário deve ser um número não-negativo.');
      const paymentType = form.payment_type || 'mensalista';
      if ((paymentType === 'mensalista' || paymentType === 'diarista') && !String(form.external_id || '').trim()) {
        throw new Error('Informe o ID do relógio de ponto para prestadores avaliados por batidas.');
      }
      const payload = normalizeEmployeeEmploymentState(stripSearchNorm(form));
      const { error } = await supabase.from('employees').insert(payload);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employees'] }); toast.success('Funcionário cadastrado!'); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<EmployeeForm> }) => {
      if (data.salary !== undefined && (!Number.isFinite(data.salary) || data.salary < 0)) throw new Error('Salário deve ser um número não-negativo.');
      const payload = normalizeEmployeeEmploymentState(stripSearchNorm(data));
      const { error } = await supabase.from('employees').update(payload).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employees'] }); toast.success('Funcionário atualizado!'); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const [advRes, timeRes] = await Promise.all([
        supabase.from('employee_advances').select('id', { count: 'exact', head: true }).eq('employee_id', id),
        supabase.from('time_records').select('id', { count: 'exact', head: true }).eq('employee_id', id),
      ]);
      if (advRes.error) throw advRes.error;
      if (timeRes.error) throw timeRes.error;
      const blockers: string[] = [];
      if ((advRes.count ?? 0) > 0) blockers.push(`${advRes.count} ${advRes.count === 1 ? 'adiantamento' : 'adiantamentos'}`);
      if ((timeRes.count ?? 0) > 0) blockers.push(`${timeRes.count} ${timeRes.count === 1 ? 'registro' : 'registros'} de ponto`);
      if (blockers.length > 0) {
        throw new Error(`Não é possível excluir: funcionário tem ${blockers.join(' e ')} no histórico. Inative o cadastro em vez de excluir.`);
      }
      const { error } = await supabase.from('employees').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employees'] }); toast.success('Funcionário removido!'); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useEmployeeAdvances(employeeId: string | null = null) {
  return useQuery({
    queryKey: ['employee_advances', employeeId],
    queryFn: async () => {
      let query = supabase
        .from('employee_advances')
        .select('*')
        .order('advance_date', { ascending: false });

      if (employeeId) {
        query = query.eq('employee_id', employeeId);
      } else {
        query = query.limit(1000);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data as EmployeeAdvance[];
    },
  });
}

export function useAddAdvance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: CreateAdvanceInput) => {
      if (!Number.isFinite(form.amount) || form.amount <= 0) throw new Error('Valor do vale deve ser positivo.');
      if (!form.idempotencyKey) throw new Error('Não foi possível identificar esta tentativa de cadastro. Reabra o formulário.');
      try {
        await runRhCommand('create_employee_advance', {
          p_employee_id: form.employee_id,
          p_amount: form.amount,
          p_advance_date: form.advance_date,
          p_time: form.time,
          p_description: form.description,
          p_receipt_url: form.receipt_url,
          p_idempotency_key: form.idempotencyKey,
        });
      } catch (commandError) {
        // Se o COMMIT ocorreu e só a resposta se perdeu, a chave encontra a
        // linha definitiva e transforma o retry em sucesso, sem duplicar valor.
        const { data: committed, error: lookupError } = await advanceLookupClient
          .from('employee_advances')
          .select('id, employee_id, amount, advance_date, time, description, receipt_url')
          .eq('idempotency_key', form.idempotencyKey)
          .maybeSingle();
        if (committed?.id
          && committed.employee_id === form.employee_id
          && Number(committed.amount) === Number(form.amount)
          && committed.advance_date === form.advance_date
          && (committed.time || '') === (form.time || '')
          && (committed.description || '') === (form.description || '')
          && (committed.receipt_url || '') === (form.receipt_url || '')) return;
        if (lookupError) throw new Error(`Falha ao reconciliar o cadastro do vale: ${lookupError.message}`);
        throw commandError;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employee_advances'] }); toast.success('Vale registrado!'); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCancelAdvance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      if (!reason.trim()) throw new Error('Informe o motivo do cancelamento.');
      await runRhCommand('cancel_employee_advance', { p_id: id, p_reason: reason.trim() });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employee_advances'] }); toast.success('Vale cancelado com histórico preservado.'); },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Marca UM vale como acertado fora da folha. `deducted` é server-owned e
 *  `paid` continua sendo dinheiro entregue a descontar, portanto esta é a única
 *  baixa manual exposta pelo frontend. */
export function useMarkAdvanceExternallySettled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await runRhCommand('settle_employee_advance_external', { p_id: id });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee_advances'] });
      qc.invalidateQueries({ queryKey: ['payroll_pending_advances'] });
      qc.invalidateQueries({ queryKey: ['payroll-comp-advances'] });
      toast.success('Baixa externa registrada. Este vale não será descontado na folha.');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** 'YYYY-MM' → intervalo [1º dia do mês, 1º dia do mês seguinte).
 *  Meio-aberto de propósito: montar 'YYYY-MM-31' geraria data inválida em fevereiro. */
export function periodDateRange(period: string): { from: string; before: string } {
  const [y, m] = period.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { from: `${period}-01`, before: `${next}-01` };
}

/** Dá baixa EXTERNA nos vales em aberto de um funcionário dentro do período.
 *
 *  O filtro de data impede que a baixa externa de uma competência alcance vales
 *  futuros. `pending` e `paid` são igualmente abertos; ambos passam a
 *  `baixado_externo`, nunca a `deducted` (estado reservado ao servidor).
 *
 *  Retorna quantos foram baixados. */
export function useSettleEmployeeAdvancesExternally() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ employeeId, period }: { employeeId: string; period: string }) => {
      const { from, before } = periodDateRange(period);
      const data = await runRhCommand('settle_employee_advances_external', {
        p_employee_id: employeeId,
        p_from: from,
        p_before: before,
      });
      return { baixados: Number(data) || 0, period };
    },
    onSuccess: ({ baixados: n, period }) => {
      qc.invalidateQueries({ queryKey: ['employee_advances'] });
      qc.invalidateQueries({ queryKey: ['payroll_pending_advances'] });
      qc.invalidateQueries({ queryKey: ['payroll-comp-advances'] });
      toast.success(`${n} ${n === 1 ? 'vale baixado fora da folha' : 'vales baixados fora da folha'} em ${period}. Não serão descontados na folha.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
