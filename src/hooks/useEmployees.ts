import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface Employee {
  id: string;
  name: string;
  external_id: string | null;
  phone: string;
  whatsapp: string;
  pix_key: string;
  pix_type: string;
  salary: number;
  overtime_hourly_rate: number | null;
  work_schedule_id: string | null;
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
  status: string;
  created_at: string;
  updated_at: string;
}

type EmployeeForm = Omit<Employee, 'id' | 'created_at' | 'updated_at'>;
type AdvanceForm = Omit<EmployeeAdvance, 'id' | 'created_at' | 'updated_at'>;

export function useEmployees() {
  return useQuery({
    queryKey: ['employees'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .order('name');
      if (error) throw error;
      return data as Employee[];
    },
    staleTime: 5 * 60_000,
  });
}

export function useAddEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: EmployeeForm) => {
      if (!Number.isFinite(form.salary) || form.salary < 0) throw new Error('Salário deve ser um número não-negativo.');
      const { error } = await supabase.from('employees').insert(form as any);
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
      const { error } = await supabase.from('employees').update(data as any).eq('id', id);
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
      // time_records não tem employee_id (FK pra employees) — tabela linka
      // por employee_external_id (matricula REP) e employee_name. Antes
      // quebrava a query inteira; agora resolvemos external_id + name pra
      // contar registros vinculados.
      const empMeta = await supabase
        .from('employees')
        .select('external_id, name')
        .eq('id', id)
        .single();
      const extId = (empMeta.data as any)?.external_id || null;
      const empName = (empMeta.data as any)?.name || '';
      let timeQ = supabase.from('time_records').select('id', { count: 'exact', head: true });
      if (extId) {
        timeQ = timeQ.or(`employee_external_id.eq.${extId},employee_name.ilike.${empName}`);
      } else if (empName) {
        timeQ = timeQ.ilike('employee_name', empName);
      } else {
        // Sem chaves pra match — assume 0 registros
        timeQ = timeQ.eq('id', '00000000-0000-0000-0000-000000000000');
      }
      const [advRes, timeRes] = await Promise.all([
        supabase.from('employee_advances').select('id', { count: 'exact', head: true }).eq('employee_id', id),
        timeQ,
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
    mutationFn: async (form: AdvanceForm) => {
      if (!Number.isFinite((form as any).amount) || (form as any).amount <= 0) throw new Error('Valor do vale deve ser positivo.');
      const { error } = await supabase.from('employee_advances').insert(form as any);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employee_advances'] }); toast.success('Vale registrado!'); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteAdvance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data: adv, error: advErr } = await supabase.from('employee_advances').select('employee_id, advance_date').eq('id', id).single();
      if (advErr) throw new Error(`Falha ao carregar vale: ${advErr.message}`);
      const period = (adv.advance_date as string).slice(0, 7);
      const { data: pr, error: prErr } = await (supabase as any).from('payroll_runs').select('id, status').eq('employee_id', adv.employee_id).eq('period', period).maybeSingle();
      if (prErr) throw new Error(`Falha ao verificar folha de pagamento: ${prErr.message}`);
      if (pr && pr.status !== 'rascunho') throw new Error(`Folha do período ${period} já ${pr.status === 'pago' ? 'paga' : 'aprovada'} — desfaça antes de remover o vale.`);
      const { error } = await supabase.from('employee_advances').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employee_advances'] }); toast.success('Vale removido!'); },
    onError: (e: Error) => toast.error(e.message),
  });
}
