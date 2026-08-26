import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Registro de pagamento da folha (2026-07-01).
 *
 * Uma folha (`payroll_runs`) pode ter 1+ pagamentos do seu saldo líquido.
 * Adiantamentos pertencem exclusivamente a `employee_advances` e não são
 * registrados nesta tabela. Cada pagamento guarda valor/data/método e, opcionalmente, o RECIBO ASSINADO
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

export function createPayrollPaymentIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, token => {
    const value = Math.floor(Math.random() * 16);
    return (token === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });
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
  idempotency_key?: string | null;
  reversed_at?: string | null;
  reversed_by?: string | null;
  reversal_reason?: string | null;
}

interface PayrollCommandRpcResult {
  data: unknown;
  error: { message: string } | null;
}

type PayrollPaymentIdempotencyRow = Pick<PayrollPayment,
  'id' | 'payroll_run_id' | 'employee_id' | 'amount' | 'method' | 'paid_on' |
  'reference' | 'notes' | 'receipt_path' | 'receipt_name' | 'receipt_size' | 'receipt_mime'>;

interface PayrollPaymentLookupResult {
  data: PayrollPaymentIdempotencyRow | null;
  error: { message: string } | null;
}

interface PayrollPaymentLookupQuery {
  select: (columns: string) => {
    eq: (column: 'idempotency_key', value: string) => {
      maybeSingle: () => Promise<PayrollPaymentLookupResult>;
    };
  };
}

interface PayrollPaymentsReadQuery<Row> extends PromiseLike<{
  data: Row[] | null;
  error: { message: string } | null;
}> {
  eq: (column: string, value: unknown) => PayrollPaymentsReadQuery<Row>;
  in: (column: string, values: readonly unknown[]) => PayrollPaymentsReadQuery<Row>;
  gte: (column: string, value: unknown) => PayrollPaymentsReadQuery<Row>;
  lte: (column: string, value: unknown) => PayrollPaymentsReadQuery<Row>;
  order: (column: string, options?: { ascending?: boolean }) => PayrollPaymentsReadQuery<Row>;
  limit: (count: number) => PayrollPaymentsReadQuery<Row>;
}

interface PayrollPaymentsReadTable {
  select: <Row>(columns: string) => PayrollPaymentsReadQuery<Row>;
}

const payrollCommandClient = supabase as unknown as {
  rpc: (name: string, args: Record<string, unknown>) => Promise<PayrollCommandRpcResult>;
  from: (table: 'payroll_payments') => PayrollPaymentLookupQuery;
};

// Colunas de idempotência/estorno vieram em migration posterior ao arquivo de
// tipos gerados. Este adaptador é somente de leitura e deve sair na regeneração.
const payrollPaymentsReadClient = supabase as unknown as {
  from: (table: 'payroll_payments') => PayrollPaymentsReadTable;
};

async function runPayrollCommand(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await payrollCommandClient.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

function findPayrollPaymentByIdempotencyKey(key: string): Promise<PayrollPaymentLookupResult> {
  return payrollCommandClient
    .from('payroll_payments')
    .select('id,payroll_run_id,employee_id,amount,method,paid_on,reference,notes,receipt_path,receipt_name,receipt_size,receipt_mime')
    .eq('idempotency_key', key)
    .maybeSingle();
}

interface ExpectedReceipt {
  path: string;
  name: string;
  size: number | null;
  mime: string;
}

function assertIdempotentPaymentMatches(
  existing: PayrollPaymentIdempotencyRow,
  input: RegisterPaymentInput,
  receipt: ExpectedReceipt,
): void {
  const differs = existing.payroll_run_id !== input.payrollRunId
    || existing.employee_id !== input.employeeId
    || Math.round(Number(existing.amount) * 100) !== Math.round(input.amount * 100)
    || existing.method !== input.method
    || existing.paid_on !== input.paidOn
    || (existing.reference || '') !== (input.reference || '')
    || (existing.notes || '') !== (input.notes || '')
    || (existing.receipt_path || '') !== receipt.path
    || (existing.receipt_name || '') !== receipt.name
    || existing.receipt_size !== receipt.size
    || (existing.receipt_mime || '') !== receipt.mime;

  if (differs) {
    throw new Error(
      'Esta tentativa já foi concluída com dados diferentes. Feche e abra o pagamento para iniciar uma nova operação.',
    );
  }
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
      const { data, error } = await payrollPaymentsReadClient
        .from('payroll_payments')
        .select<PayrollPayment>('*')
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
      const { data, error } = await payrollPaymentsReadClient
        .from('payroll_payments')
        .select<Pick<PayrollPayment, 'payroll_run_id' | 'amount' | 'paid_on' | 'receipt_path' | 'reversed_at'>>(
          'payroll_run_id, amount, paid_on, receipt_path, reversed_at',
        )
        .in('payroll_run_id', runIds);
      if (error) throw error;
      const map: Record<string, PaymentSummary> = {};
      for (const row of data || []) {
        if (row.reversed_at) continue;
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
      let q = payrollPaymentsReadClient
        .from('payroll_payments')
        // pares_* e business_days_worked entram porque o recibo reimpresso daqui
        // precisa descrever PRODUÇÃO pra quem é pago por par (mig 20261116120100).
        .select<PayrollPaymentWithRefs>('*, employee:employees(id, name, role, department, cpf), run:payroll_runs(id, period, total_liquido, status, pares_medio, pares_dificil, business_days_worked)')
        .order('paid_on', { ascending: false })
        .limit(1000);
      if (employeeId) q = q.eq('employee_id', employeeId);
      if (from) q = q.gte('paid_on', from);
      if (to)   q = q.lte('paid_on', to);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
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
  /** Mantida entre tentativas do mesmo envio para evitar pagamento duplicado. */
  idempotencyKey: string;
}

export function useRegisterPayrollPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RegisterPaymentInput) => {
      if (!Number.isFinite(input.amount) || input.amount <= 0) {
        throw new Error('Informe um valor de pagamento maior que zero.');
      }

      let receipt: ExpectedReceipt = { path: '', name: '', size: null, mime: '' };
      if (input.file) {
        const file = input.file;
        if (!ALLOWED_RECEIPT_TYPES.includes(file.type)) {
          throw new Error('Recibo deve ser PDF, JPG, PNG ou WEBP.');
        }
        if (file.size > MAX_RECEIPT_BYTES) throw new Error('Recibo deve ter no máximo 10MB.');
        const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        receipt = {
          path: `${input.payrollRunId}/${input.idempotencyKey}_${safeName}`,
          name: file.name,
          size: file.size,
          mime: file.type,
        };
      }

      // Retry seguro: se o COMMIT anterior ocorreu e só a resposta se perdeu,
      // confirma o payload integral antes de aceitar a tentativa como concluída.
      const { data: existing, error: existingError } = await findPayrollPaymentByIdempotencyKey(input.idempotencyKey);
      if (existingError) throw new Error(`Falha ao reconciliar tentativa anterior: ${existingError.message}`);
      if (existing?.id) {
        assertIdempotentPaymentMatches(existing, input, receipt);
        return;
      }

      // 1) Upload do recibo (se houver) ANTES do insert, pra ter o path.
      if (input.file) {
        const { error: upErr } = await supabase.storage
          .from(RECEIPTS_BUCKET)
          // A policy permite upsert apenas enquanto o path ainda é órfão. Após
          // o RPC referenciá-lo, UPDATE/DELETE do blob ficam negados.
          .upload(receipt.path, input.file, { contentType: receipt.mime, upsert: true });
        if (upErr) {
          const { data: committed, error: lookupError } = await findPayrollPaymentByIdempotencyKey(input.idempotencyKey);
          if (lookupError) throw new Error(`Falha ao reconciliar pagamento: ${lookupError.message}`);
          if (committed?.id) {
            assertIdempotentPaymentMatches(committed, input, receipt);
            return;
          }
          throw new Error(`Falha ao enviar o recibo: ${upErr.message}`);
        }
      }

      // 2) Comando atômico: autoria, saldo, idempotência e status são validados
      // pelo servidor. O frontend não tem grant de INSERT na tabela financeira.
      try {
        await runPayrollCommand('register_payroll_payment', {
          p_payroll_run_id: input.payrollRunId,
          p_employee_id: input.employeeId,
          p_amount: input.amount,
          p_method: input.method,
          p_paid_on: input.paidOn,
          p_reference: input.reference || '',
          p_notes: input.notes || '',
          p_receipt_path: receipt.path,
          p_receipt_name: receipt.name,
          p_receipt_size: receipt.size,
          p_receipt_mime: receipt.mime,
          p_idempotency_key: input.idempotencyKey,
        });
      } catch (commandError) {
        // Uma queda de rede pode acontecer depois do COMMIT. Confere pela chave
        // antes de repetir. O recibo nunca é apagado/substituído pelo cliente.
        const { data: committed, error: lookupError } = await findPayrollPaymentByIdempotencyKey(input.idempotencyKey);
        if (lookupError) throw new Error(`Falha ao reconciliar pagamento: ${lookupError.message}`);
        if (committed?.id) {
          assertIdempotentPaymentMatches(committed, input, receipt);
          return;
        }
        throw commandError;
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

export function useReversePayrollPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      if (!reason.trim()) throw new Error('Informe o motivo do estorno.');
      await runPayrollCommand('reverse_payroll_payment', { p_id: id, p_reason: reason.trim() });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll_payments'] });
      qc.invalidateQueries({ queryKey: ['payroll_payment_summaries'] });
      qc.invalidateQueries({ queryKey: ['payroll_payments_history'] });
      qc.invalidateQueries({ queryKey: ['payroll_runs'] });
      toast.success('Pagamento estornado; registro e recibo foram preservados.');
    },
    onError: (e: Error) => toast.error(`Erro ao estornar: ${e.message}`),
  });
}
