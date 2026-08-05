import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Registro de pagamento da folha (2026-07-01).
 *
 * Uma folha (`payroll_runs`) pode ter 1+ pagamentos (adiantamento + saldo).
 * Cada pagamento guarda valor/data/método e, opcionalmente, o RECIBO ASSINADO
 * escaneado — arquivo no bucket privado `employee-receipts`, acessado por
 * signed URL (bucket não é público). O status da folha (pago/aprovado) é
 * derivado no banco pelo trigger `tg_sync_payroll_paid`, não aqui.
 */

export const PAYMENT_METHODS = [
  { value: 'pix',           label: 'Pix' },
  { value: 'transferencia', label: 'Transferência' },
  { value: 'dinheiro',      label: 'Dinheiro' },
  { value: 'cheque',        label: 'Cheque' },
  { value: 'outro',         label: 'Outro' },
] as const;

export type PaymentMethod = typeof PAYMENT_METHODS[number]['value'];

export function paymentMethodLabel(m: string): string {
  return PAYMENT_METHODS.find(x => x.value === m)?.label ?? m;
}

const MESES_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/**
 * Humaniza o `period` da folha (que vem como 'YYYY-MM' ou intervalo
 * 'YYYY-MM-DD_YYYY-MM-DD') pra exibição — ex.: "junho/2026" ou "01 a 18/06/2026".
 */
export function formatPayrollPeriod(period: string): string {
  if (!period) return '';
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (m) {
    const mes = MESES_PT[Number(m[2]) - 1] ?? m[2];
    return `${mes}/${m[1]}`;
  }
  const r = /^(\d{4})-(\d{2})-(\d{2})_(\d{4})-(\d{2})-(\d{2})$/.exec(period);
  if (r) {
    const sameMonth = r[1] === r[4] && r[2] === r[5];
    return sameMonth
      ? `${r[3]} a ${r[6]}/${r[5]}/${r[4]}`
      : `${r[3]}/${r[2]}/${r[1]} a ${r[6]}/${r[5]}/${r[4]}`;
  }
  return period;
}

const RECEIPTS_BUCKET = 'employee-receipts';
const ALLOWED_RECEIPT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

export interface PayrollPayment {
  id: string;
  payroll_run_id: string;
  employee_id: string;
  paid_on: string;
  amount: number;
  method: string;
  reference: string;
  notes: string;
  receipt_path: string;
  receipt_name: string;
  receipt_size: number | null;
  receipt_mime: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Linha da histórico com o funcionário e o período da folha embutidos. */
export interface PayrollPaymentWithRefs extends PayrollPayment {
  employee: { id: string; name: string; role: string | null; department: string | null; cpf: string | null } | null;
  run: {
    id: string; period: string; total_liquido: number; status: string;
    /** Regime por par: pares do período e dias produtivos — base do recibo. */
    pares_medio?: number | null;
    pares_dificil?: number | null;
    business_days_worked?: number | null;
  } | null;
}

/** Pagamentos de UMA folha (usado no dialog de registro). */
export function usePayrollPayments(runId: string | null) {
  return useQuery({
    queryKey: ['payroll_payments', runId],
    enabled: !!runId,
    queryFn: async () => {
      // payroll_payments ainda não está nos tipos gerados → supabase as any.
      const { data, error } = await (supabase as any)
        .from('payroll_payments')
        .select('*')
        .eq('payroll_run_id', runId!)
        .order('paid_on', { ascending: true });
      if (error) throw error;
      return (data || []) as PayrollPayment[];
    },
  });
}

export interface PaymentSummary {
  paidTotal: number;
  count: number;
  hasReceipt: boolean;
  lastPaidOn: string | null;
}

/**
 * Resumo por folha (runId → {pago, nº pagamentos, tem recibo}). Usado na tabela
 * da folha pra mostrar "parcial" e o clipe de recibo sem N queries por linha.
 */
export function usePayrollPaymentSummaries(runIds: string[]) {
  const key = [...runIds].sort().join(',');
  return useQuery({
    queryKey: ['payroll_payment_summaries', key],
    enabled: runIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('payroll_payments')
        .select('payroll_run_id, amount, paid_on, receipt_path')
        .in('payroll_run_id', runIds);
      if (error) throw error;
      const map: Record<string, PaymentSummary> = {};
      for (const row of (data || []) as Pick<PayrollPayment, 'payroll_run_id' | 'amount' | 'paid_on' | 'receipt_path'>[]) {
        const s = map[row.payroll_run_id] ?? { paidTotal: 0, count: 0, hasReceipt: false, lastPaidOn: null };
        s.paidTotal += Number(row.amount) || 0;
        s.count += 1;
        if (row.receipt_path) s.hasReceipt = true;
        if (!s.lastPaidOn || row.paid_on > s.lastPaidOn) s.lastPaidOn = row.paid_on;
        map[row.payroll_run_id] = s;
      }
      return map;
    },
    staleTime: 15_000,
  });
}

/** Histórico completo pra tela "Pagamentos" (puxar depois). */
export function usePayrollPaymentsHistory(filters?: { employeeId?: string | null; from?: string | null; to?: string | null }) {
  const employeeId = filters?.employeeId || null;
  const from = filters?.from || null;
  const to = filters?.to || null;
  return useQuery({
    queryKey: ['payroll_payments_history', employeeId, from, to],
    queryFn: async () => {
      let q = (supabase as any)
        .from('payroll_payments')
        // pares_* e business_days_worked entram porque o recibo reimpresso daqui
        // precisa descrever PRODUÇÃO pra quem é pago por par (mig 20261116120100).
        .select('*, employee:employees(id, name, role, department, cpf), run:payroll_runs(id, period, total_liquido, status, pares_medio, pares_dificil, business_days_worked)')
        .order('paid_on', { ascending: false })
        .limit(1000);
      if (employeeId) q = q.eq('employee_id', employeeId);
      if (from) q = q.gte('paid_on', from);
      if (to)   q = q.lte('paid_on', to);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as PayrollPaymentWithRefs[];
    },
    staleTime: 15_000,
  });
}

/** Signed URL temporária pra abrir/baixar um recibo do bucket privado. */
export async function getReceiptSignedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(RECEIPTS_BUCKET).createSignedUrl(path, 60 * 5);
  if (error) throw error;
  return data.signedUrl;
}

export interface RegisterPaymentInput {
  payrollRunId: string;
  employeeId: string;
  amount: number;
  method: PaymentMethod;
  paidOn: string;               // ISO YYYY-MM-DD
  reference?: string;
  notes?: string;
  file?: File | null;           // recibo assinado escaneado (opcional)
}

export function useRegisterPayrollPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RegisterPaymentInput) => {
      if (!Number.isFinite(input.amount) || input.amount <= 0) {
        throw new Error('Informe um valor de pagamento maior que zero.');
      }

      // 1) Upload do recibo (se houver) ANTES do insert, pra ter o path.
      let receipt_path = '';
      let receipt_name = '';
      let receipt_size: number | null = null;
      let receipt_mime = '';
      if (input.file) {
        const f = input.file;
        if (!ALLOWED_RECEIPT_TYPES.includes(f.type)) {
          throw new Error('Recibo deve ser PDF, JPG, PNG ou WEBP.');
        }
        if (f.size > MAX_RECEIPT_BYTES) throw new Error('Recibo deve ter no máximo 10MB.');
        const safeName = f.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        const path = `${input.payrollRunId}/${Date.now()}_${safeName}`;
        const { error: upErr } = await supabase.storage
          .from(RECEIPTS_BUCKET)
          .upload(path, f, { contentType: f.type });
        if (upErr) throw new Error(`Falha ao enviar o recibo: ${upErr.message}`);
        receipt_path = path;
        receipt_name = f.name;
        receipt_size = f.size;
        receipt_mime = f.type;
      }

      // 2) Insert do pagamento (o trigger sincroniza o status da folha).
      const { data: { user } } = await supabase.auth.getUser();
      const { error: insErr } = await (supabase as any).from('payroll_payments').insert({
        payroll_run_id: input.payrollRunId,
        employee_id: input.employeeId,
        amount: input.amount,
        method: input.method,
        paid_on: input.paidOn,
        reference: input.reference || '',
        notes: input.notes || '',
        receipt_path, receipt_name, receipt_size, receipt_mime,
        created_by: user?.id || null,
      } as never);
      if (insErr) {
        // rollback do blob órfão
        if (receipt_path) await supabase.storage.from(RECEIPTS_BUCKET).remove([receipt_path]);
        throw insErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll_payments'] });
      qc.invalidateQueries({ queryKey: ['payroll_payment_summaries'] });
      qc.invalidateQueries({ queryKey: ['payroll_payments_history'] });
      qc.invalidateQueries({ queryKey: ['payroll_runs'] });
      toast.success('Pagamento registrado.');
    },
    onError: (e: Error) => toast.error(`Erro ao registrar pagamento: ${e.message}`),
  });
}

export function useDeletePayrollPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payment: Pick<PayrollPayment, 'id'>) => {
      // Apaga a linha primeiro e relê o receipt_path do row deletado (evita
      // IDOR: não confia num path vindo do cliente pra remover blobs).
      const { data: deleted, error } = await (supabase as any)
        .from('payroll_payments')
        .delete()
        .eq('id', payment.id)
        .select('receipt_path');
      if (error) throw error;
      if (!deleted || deleted.length === 0) throw new Error('Pagamento não encontrado ou sem permissão.');
      const path = (deleted[0] as { receipt_path: string }).receipt_path;
      if (path) {
        const { error: stErr } = await supabase.storage.from(RECEIPTS_BUCKET).remove([path]);
        if (stErr) console.warn('Recibo órfão no storage:', stErr.message);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll_payments'] });
      qc.invalidateQueries({ queryKey: ['payroll_payment_summaries'] });
      qc.invalidateQueries({ queryKey: ['payroll_payments_history'] });
      qc.invalidateQueries({ queryKey: ['payroll_runs'] });
      toast.success('Pagamento removido.');
    },
    onError: (e: Error) => toast.error(`Erro ao remover: ${e.message}`),
  });
}
