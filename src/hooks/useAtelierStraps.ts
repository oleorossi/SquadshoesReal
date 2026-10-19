/**
 * Ateliê → aba Tiras (specs/tira-material-de-estoque.md R16–R18).
 * RPCs: list_atelier_strap_shortages / generate_atelier_strap_purchase_and_service /
 * register_atelier_strap_received / register_atelier_strap_produced / list_atelier_strap_jobs.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { strapGroupYieldsKey } from '@/hooks/useStrapGroupYields';

interface UntypedQueryResult {
  data: unknown;
  error: unknown;
}

interface UntypedSupabaseClient {
  rpc: (name: string, params?: Record<string, unknown>) => PromiseLike<UntypedQueryResult>;
}

const db = supabase as unknown as UntypedSupabaseClient;

export interface AtelierStrapShortage {
  sale_order_id: string;
  order_number: string;
  client_name: string | null;
  product_id: string;
  product_name: string;
  group_id: string;
  group_name: string;
  origin: 'fabrica' | 'prestador' | string;
  color: string | null;
  napa_group_id: string | null;
  napa_group_name: string | null;
  needed_m: number;
  reserved_m: number;
  shortage_m: number;
  in_progress_m: number;
  to_produce_m: number;
  yield_m_per_m: number | null;
  labor_cost_per_m: number | null;
  default_contractor_id: string | null;
  default_contractor_name: string | null;
  napa_product_id: string | null;
  napa_product_name: string | null;
  napa_stock_m: number | null;
  napa_unit_price: number | null;
  napa_supplier_name: string | null;
  napa_in_purchase_m?: number | null;
}

export interface AtelierStrapJob {
  id: string;
  sale_order_id: string | null;
  order_number: string | null;
  product_id: string;
  product_name: string;
  origin: string;
  strap_m: number;
  received_m: number;
  pending_m: number;
  napa_product_name: string | null;
  napa_m: number | null;
  contractor_name: string | null;
  labor_cost_per_m: number | null;
  purchase_order_id: string | null;
  purchase_order_number: string | null;
  purchase_order_status: string | null;
  service_order_id: string | null;
  service_order_number: string | null;
  napa_settled: boolean;
  status: string;
  created_at: string;
}

const SHORTAGES_KEY = ['atelier-strap-shortages'] as const;
const JOBS_KEY = ['atelier-strap-jobs'] as const;

function errMsg(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'Erro desconhecido';
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapShortage(row: Record<string, unknown>): AtelierStrapShortage {
  return {
    sale_order_id: String(row.sale_order_id ?? ''),
    order_number: String(row.order_number ?? ''),
    client_name: row.client_name != null ? String(row.client_name) : null,
    product_id: String(row.product_id ?? ''),
    product_name: String(row.product_name ?? ''),
    group_id: String(row.group_id ?? ''),
    group_name: String(row.group_name ?? ''),
    origin: String(row.origin ?? ''),
    color: row.color != null ? String(row.color) : null,
    napa_group_id: row.napa_group_id != null ? String(row.napa_group_id) : null,
    napa_group_name: row.napa_group_name != null ? String(row.napa_group_name) : null,
    needed_m: num(row.needed_m),
    reserved_m: num(row.reserved_m),
    shortage_m: num(row.shortage_m),
    in_progress_m: num(row.in_progress_m),
    to_produce_m: num(row.to_produce_m),
    yield_m_per_m: numOrNull(row.yield_m_per_m),
    labor_cost_per_m: numOrNull(row.labor_cost_per_m),
    default_contractor_id: row.default_contractor_id != null ? String(row.default_contractor_id) : null,
    default_contractor_name: row.default_contractor_name != null ? String(row.default_contractor_name) : null,
    napa_product_id: row.napa_product_id != null ? String(row.napa_product_id) : null,
    napa_product_name: row.napa_product_name != null ? String(row.napa_product_name) : null,
    napa_stock_m: numOrNull(row.napa_stock_m),
    napa_unit_price: numOrNull(row.napa_unit_price),
    napa_supplier_name: row.napa_supplier_name != null ? String(row.napa_supplier_name) : null,
    napa_in_purchase_m: numOrNull(row.napa_in_purchase_m),
  };
}

function mapJob(row: Record<string, unknown>): AtelierStrapJob {
  return {
    id: String(row.id ?? ''),
    sale_order_id: row.sale_order_id != null ? String(row.sale_order_id) : null,
    order_number: row.order_number != null ? String(row.order_number) : null,
    product_id: String(row.product_id ?? ''),
    product_name: String(row.product_name ?? ''),
    origin: String(row.origin ?? ''),
    strap_m: num(row.strap_m),
    received_m: num(row.received_m),
    pending_m: num(row.pending_m),
    napa_product_name: row.napa_product_name != null ? String(row.napa_product_name) : null,
    napa_m: numOrNull(row.napa_m),
    contractor_name: row.contractor_name != null ? String(row.contractor_name) : null,
    labor_cost_per_m: numOrNull(row.labor_cost_per_m),
    purchase_order_id: row.purchase_order_id != null ? String(row.purchase_order_id) : null,
    purchase_order_number: row.purchase_order_number != null ? String(row.purchase_order_number) : null,
    purchase_order_status: row.purchase_order_status != null ? String(row.purchase_order_status) : null,
    service_order_id: row.service_order_id != null ? String(row.service_order_id) : null,
    service_order_number: row.service_order_number != null ? String(row.service_order_number) : null,
    napa_settled: Boolean(row.napa_settled),
    status: String(row.status ?? ''),
    created_at: String(row.created_at ?? ''),
  };
}

function invalidateAtelierStraps(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: SHORTAGES_KEY });
  qc.invalidateQueries({ queryKey: JOBS_KEY });
}

export function useAtelierStrapShortages(enabled = true) {
  return useQuery({
    queryKey: SHORTAGES_KEY,
    enabled,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await db.rpc('list_atelier_strap_shortages');
      if (error) throw error;
      return (Array.isArray(data) ? data : []).map((r) => mapShortage(r as Record<string, unknown>));
    },
  });
}

export function useAtelierStrapJobs(includeClosed = false, enabled = true) {
  return useQuery({
    queryKey: [...JOBS_KEY, includeClosed],
    enabled,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await db.rpc('list_atelier_strap_jobs', {
        p_include_closed: includeClosed,
      });
      if (error) throw error;
      return (Array.isArray(data) ? data : []).map((r) => mapJob(r as Record<string, unknown>));
    },
  });
}

export function useGenerateAtelierStrapPurchaseAndService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      saleOrderId: string;
      productId: string;
      strapM: number;
      napaProductId?: string | null;
      contractorId?: string | null;
      laborCostPerM?: number | null;
    }) => {
      const { data, error } = await db.rpc('generate_atelier_strap_purchase_and_service', {
        p_sale_order_id: input.saleOrderId,
        p_product_id: input.productId,
        p_strap_m: input.strapM,
        p_napa_product_id: input.napaProductId ?? null,
        p_contractor_id: input.contractorId ?? null,
        p_labor_cost_per_m: input.laborCostPerM ?? null,
      });
      if (error) throw error;
      return data as Record<string, unknown>;
    },
    onSuccess: (data) => {
      invalidateAtelierStraps(qc);
      const po = data?.purchase_order_number ? String(data.purchase_order_number) : null;
      toast.success(
        po
          ? `OC ${po} e OS geradas em rascunho. Napa entrega no prestador — não entra no estoque da fábrica.`
          : 'OC da napa e OS geradas em rascunho.',
      );
    },
    onError: (err: unknown) => toast.error(errMsg(err)),
  });
}

export function useRegisterAtelierStrapReceived() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      jobId: string;
      receivedM: number;
      close?: boolean;
    }) => {
      const { data, error } = await db.rpc('register_atelier_strap_received', {
        p_job_id: input.jobId,
        p_received_m: input.receivedM,
        p_close: input.close ?? false,
      });
      if (error) throw error;
      return data as Record<string, unknown>;
    },
    onSuccess: () => {
      invalidateAtelierStraps(qc);
      toast.success('Tira recebida — entrou no estoque. Napa da OC liquidada (não fica na fábrica).');
    },
    onError: (err: unknown) => toast.error(errMsg(err)),
  });
}

export function useRegisterAtelierStrapProduced() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      saleOrderId: string;
      productId: string;
      strapM: number;
      napaProductId: string;
      napaM: number;
    }) => {
      const { data, error } = await db.rpc('register_atelier_strap_produced', {
        p_sale_order_id: input.saleOrderId,
        p_product_id: input.productId,
        p_strap_m: input.strapM,
        p_napa_product_id: input.napaProductId,
        p_napa_m: input.napaM,
      });
      if (error) throw error;
      return data as Record<string, unknown>;
    },
    onSuccess: () => {
      invalidateAtelierStraps(qc);
      toast.success('Tira produzida: napa debitada e tira entrou no estoque.');
    },
    onError: (err: unknown) => toast.error(errMsg(err)),
  });
}

/** R18: rendimento inline no Ateliê grava no grupo e libera as ações. */
export function useAtelierSetStrapYield() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      strapGroupId: string;
      napaGroupId: string;
      yieldMPerM: number;
    }) => {
      const { error } = await db.rpc('set_strap_group_napa_yield', {
        p_strap_group_id: input.strapGroupId,
        p_napa_group_id: input.napaGroupId,
        p_yield_m_per_m: input.yieldMPerM,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      invalidateAtelierStraps(qc);
      qc.invalidateQueries({ queryKey: strapGroupYieldsKey(vars.strapGroupId) });
      toast.success(`Rendimento ${vars.yieldMPerM} m/m gravado no grupo.`);
    },
    onError: (err: unknown) => toast.error(errMsg(err)),
  });
}
