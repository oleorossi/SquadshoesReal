import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { AtelierPipelineStatus, AtelierSector } from '@/lib/atelier';

export const atelierKeys = {
  all: ['atelier'] as const,
  catalog: (sector?: string | null) =>
    [...atelierKeys.all, 'catalog', sector ?? 'all'] as const,
  jobs: (filters?: Record<string, string | null>) =>
    [...atelierKeys.all, 'jobs', filters ?? {}] as const,
  prepDebits: (saleOrderIds: string[]) =>
    [...atelierKeys.all, 'prep-debits', [...saleOrderIds].sort().join(',')] as const,
  sheetsLite: () => [...atelierKeys.all, 'sheets-lite'] as const,
};

export interface AtelierCatalogRow {
  id: string;
  reference_id: string;
  sector: AtelierSector;
  active: boolean;
  notes: string | null;
  created_at: string;
  technical_sheets?: {
    id: string;
    code: string | null;
    model: string | null;
    name: string | null;
  } | null;
}

export interface AtelierJobRow {
  id: string;
  demand_id: string;
  sale_order_id: string;
  sale_order_item_id: string | null;
  technical_sheet_id: string | null;
  sector: AtelierSector;
  pairs: number;
  color: string | null;
  reference_code: string | null;
  pipeline_status: AtelierPipelineStatus;
  service_order_id: string | null;
  atelier_service_number: string | null;
  contractor_id: string | null;
  debited_at: string | null;
  sent_at: string | null;
  received_at: string | null;
  ready_date?: string | null;
  sale_orders?: {
    order_number: string;
    client_name: string | null;
    billing_week: string | null;
  } | null;
  contractors?: { id: string; name: string } | null;
}

export interface AtelierPrepDebitRow {
  id: string;
  sale_order_id: string;
  sale_order_item_id: string | null;
  product_id: string;
  quantity: number;
  sector: string | null;
  job_id: string | null;
  created_at: string;
  products?: { id: string; name: string; unit: string | null } | null;
  cabedal_prep_jobs?: {
    id: string;
    pipeline_status: AtelierPipelineStatus;
    sector: string;
    atelier_service_number: string | null;
    reference_code: string | null;
    color: string | null;
  } | null;
}

export function useAtelierCatalog(sector?: AtelierSector | null) {
  return useQuery({
    queryKey: atelierKeys.catalog(sector),
    queryFn: async () => {
      let q = supabase
        .from('atelier_complex_references' as never)
        .select(
          'id, reference_id, sector, active, notes, created_at, technical_sheets(id, code, model, name)',
        )
        .eq('active', true)
        .order('created_at', { ascending: false });
      if (sector) q = q.eq('sector', sector);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as AtelierCatalogRow[];
    },
  });
}

export function useTechnicalSheetsLiteForAtelier() {
  return useQuery({
    queryKey: atelierKeys.sheetsLite(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('technical_sheets')
        .select('id, code, model, name')
        .order('code')
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });
}

export function useAddAtelierReference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { referenceId: string; sector: AtelierSector; notes?: string }) => {
      const { data, error } = await supabase
        .from('atelier_complex_references' as never)
        .upsert(
          {
            reference_id: input.referenceId,
            sector: input.sector,
            active: true,
            notes: input.notes ?? null,
            updated_at: new Date().toISOString(),
          } as never,
          { onConflict: 'reference_id,sector' },
        )
        .select('id')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: atelierKeys.all });
      toast.success('Referência adicionada ao Ateliê');
    },
    onError: (e: Error) => toast.error(e.message || 'Falha ao adicionar'),
  });
}

export function useRemoveAtelierReference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('atelier_complex_references' as never)
        .update({ active: false, updated_at: new Date().toISOString() } as never)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: atelierKeys.all });
      toast.success('Referência removida do Ateliê');
    },
    onError: (e: Error) => toast.error(e.message || 'Falha ao remover'),
  });
}

export function useAtelierJobs(sector?: AtelierSector | null) {
  return useQuery({
    queryKey: atelierKeys.jobs({ sector: sector ?? null }),
    queryFn: async () => {
      let q = supabase
        .from('cabedal_prep_jobs' as never)
        .select(
          `id, demand_id, sale_order_id, sale_order_item_id, technical_sheet_id,
           sector, pairs, color, reference_code, pipeline_status, service_order_id,
           atelier_service_number, contractor_id, debited_at, sent_at, received_at,
           sale_orders(order_number, client_name, billing_week),
           contractors(id, name)`,
        )
        .neq('pipeline_status', 'cancelled')
        .order('updated_at', { ascending: false })
        .limit(400);
      if (sector) q = q.eq('sector', sector);
      const { data, error } = await q;
      if (error) throw error;
      const jobs = (data ?? []) as unknown as AtelierJobRow[];
      const demandIds = [...new Set(jobs.map((j) => j.demand_id).filter(Boolean))];
      let readyByDemand = new Map<string, string | null>();
      if (demandIds.length) {
        const { data: demands } = await supabase
          .from('cabedal_prep_demands' as never)
          .select('id, ready_date')
          .in('id', demandIds);
        readyByDemand = new Map(
          ((demands ?? []) as { id: string; ready_date: string | null }[]).map((d) => [
            d.id,
            d.ready_date,
          ]),
        );
      }
      return jobs.map((row) => ({
        ...row,
        ready_date: readyByDemand.get(row.demand_id) ?? null,
      }));
    },
  });
}

export function useConfirmAtelierDebit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) => {
      const { data, error } = await supabase.rpc(
        'atelier_confirm_job_debit' as never,
        { p_job_id: jobId } as never,
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: atelierKeys.all });
      toast.success('Material debitado — prep de cabedal');
    },
    onError: (e: Error) => toast.error(e.message || 'Falha ao debitar'),
  });
}

export function useMarkAtelierSent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { jobId: string; contractorId?: string | null }) => {
      const { data, error } = await supabase.rpc(
        'atelier_mark_job_sent' as never,
        {
          p_job_id: input.jobId,
          p_contractor_id: input.contractorId ?? null,
        } as never,
      );
      if (error) throw error;
      return data as { atelier_service_number?: string } | null;
    },
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: atelierKeys.all });
      toast.success(
        data?.atelier_service_number
          ? `Enviado · ${data.atelier_service_number}`
          : 'Marcado como enviado ao prestador',
      );
    },
    onError: (e: Error) => toast.error(e.message || 'Falha ao marcar envio'),
  });
}

export function useMarkAtelierReceived() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) => {
      const { data, error } = await supabase.rpc(
        'atelier_mark_job_received' as never,
        { p_job_id: jobId } as never,
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: atelierKeys.all });
      toast.success('Recebido na fábrica');
    },
    onError: (e: Error) => toast.error(e.message || 'Falha ao marcar recebimento'),
  });
}

export function useReapplyAtelierEligibility() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('reapply_atelier_eligibility' as never);
      if (error) throw error;
      return data as { cancelled_demands?: number; sale_orders_touched?: number };
    },
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: atelierKeys.all });
      void qc.invalidateQueries({ queryKey: ['cabedal-prep'] });
      toast.success(
        `Ateliê reaplicado · ${data?.cancelled_demands ?? 0} fora · ${data?.sale_orders_touched ?? 0} PVs`,
      );
    },
    onError: (e: Error) => toast.error(e.message || 'Falha ao reaplicar'),
  });
}

/** Débitos Ateliê + jobs com status ≥ debited — para o bloco Consumo do PV. */
export function useAtelierPrepConsumption(saleOrderIds: string[]) {
  const ids = saleOrderIds.filter(Boolean);
  return useQuery({
    queryKey: atelierKeys.prepDebits(ids),
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cabedal_prep_stock_debits' as never)
        .select(
          `id, sale_order_id, sale_order_item_id, product_id, quantity, sector, job_id, created_at,
           products(id, name, unit),
           cabedal_prep_jobs(id, pipeline_status, sector, atelier_service_number, reference_code, color)`,
        )
        .in('sale_order_id', ids)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as unknown as AtelierPrepDebitRow[];
      // Só exibe no Consumo após débito confirmado (job ≥ debited)
      return rows.filter((r) => {
        const st = r.cabedal_prep_jobs?.pipeline_status;
        return st === 'debited' || st === 'sent_to_contractor' || st === 'received_at_factory';
      });
    },
  });
}
