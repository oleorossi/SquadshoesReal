import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { CabedalPrepSector } from '@/lib/cabedalPrep';
import { scheduleAllocation, validateDistribution } from '@/lib/cabedalPrep';

export const cabedalPrepKeys = {
  all: ['cabedal-prep'] as const,
  demands: (filters?: Record<string, string | null>) =>
    [...cabedalPrepKeys.all, 'demands', filters ?? {}] as const,
  capacities: (sheetId?: string | null) =>
    [...cabedalPrepKeys.all, 'capacities', sheetId ?? 'all'] as const,
  contractors: () => [...cabedalPrepKeys.all, 'contractors'] as const,
};

export interface CabedalPrepDemandRow {
  id: string;
  sale_order_id: string;
  sale_order_item_id: string;
  technical_sheet_id: string | null;
  reference_code: string | null;
  color: string | null;
  pairs: number;
  billing_week: string | null;
  billing_start_date: string | null;
  assembly_capacity_per_day: number | null;
  assembly_days: number | null;
  ready_date: string | null;
  requires_cut: boolean;
  requires_sewing: boolean;
  requires_aviamento: boolean;
  status: string;
  plan_locked_at: string | null;
  stale_reason: string | null;
  sale_orders?: { order_number: string; client_name: string; billing_week: string | null } | null;
  cabedal_prep_allocations?: CabedalPrepAllocationRow[] | null;
}

export interface CabedalPrepAllocationRow {
  id: string;
  demand_id: string;
  contractor_id: string;
  sector: string;
  pairs: number;
  pairs_per_day: number;
  leave_date: string;
  start_date: string | null;
  end_date: string | null;
  work_days: number | null;
  package_group_id: string | null;
  service_order_id: string | null;
  is_factory_overtime: boolean;
  notes: string | null;
  contractors?: { id: string; name: string } | null;
}

export interface CabedalPrepFilters {
  color?: string | null;
  billingWeek?: string | null;
  materialType?: string | null;
  view?: 'deadline' | 'contractor' | 'pv';
}

export function useCabedalPrepDemands(filters: CabedalPrepFilters = {}) {
  return useQuery({
    queryKey: cabedalPrepKeys.demands(filters as Record<string, string | null>),
    queryFn: async () => {
      let q = supabase
        .from('cabedal_prep_demands' as never)
        .select(`
          *,
          sale_orders!inner(order_number, client_name, billing_week),
          cabedal_prep_allocations(
            *,
            contractors(id, name)
          )
        `)
        .neq('status', 'cancelled')
        .order('ready_date', { ascending: true, nullsFirst: false });

      if (filters.color) q = q.ilike('color', filters.color);
      if (filters.billingWeek) q = q.eq('billing_week', filters.billingWeek);

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as CabedalPrepDemandRow[];
    },
    staleTime: 30_000,
  });
}

export function useCabedalPrepContractors() {
  return useQuery({
    queryKey: cabedalPrepKeys.contractors(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contractors')
        .select('id, name, payment_days')
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useContractorModelCapacities(sheetId?: string | null) {
  return useQuery({
    queryKey: cabedalPrepKeys.capacities(sheetId),
    enabled: true,
    queryFn: async () => {
      let q = supabase
        .from('contractor_model_capacities' as never)
        .select('*, contractors(id, name), technical_sheets(id, reference)')
        .order('updated_at', { ascending: false });
      if (sheetId) q = q.eq('technical_sheet_id', sheetId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export interface SaveAllocationInput {
  demandId: string;
  contractorId: string;
  sector: CabedalPrepSector | 'package';
  pairs: number;
  pairsPerDay: number;
  leaveDate: string;
  packageGroupId?: string | null;
  isFactoryOvertime?: boolean;
  notes?: string | null;
}

export function useSaveCabedalPrepAllocations() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      demandId: string;
      demandPairs: number;
      readyDate: string | null;
      rows: SaveAllocationInput[];
      lockPlan?: boolean;
    }) => {
      const validation = validateDistribution({
        demandPairs: params.demandPairs,
        readyDate: params.readyDate,
        allocations: params.rows.map((r) => ({
          contractorId: r.contractorId,
          sector: r.sector === 'package' ? 'corte_cabedal' : r.sector,
          pairs: r.pairs,
          pairsPerDay: r.pairsPerDay,
          leaveDate: r.leaveDate,
          packageGroupId: r.packageGroupId,
        })),
      });
      if (!validation.ok && validation.errors.some((e) => e.includes('excede'))) {
        throw new Error(validation.errors.join('; '));
      }

      const { error: delErr } = await supabase
        .from('cabedal_prep_allocations' as never)
        .delete()
        .eq('demand_id', params.demandId);
      if (delErr) throw delErr;

      if (params.rows.length > 0) {
        const payload = params.rows.map((r) => {
          const sched = scheduleAllocation({
            contractorId: r.contractorId,
            sector: r.sector === 'package' ? 'corte_cabedal' : r.sector,
            pairs: r.pairs,
            pairsPerDay: r.pairsPerDay,
            leaveDate: r.leaveDate,
          });
          return {
            demand_id: params.demandId,
            contractor_id: r.contractorId,
            sector: r.sector,
            pairs: r.pairs,
            pairs_per_day: r.pairsPerDay,
            leave_date: r.leaveDate,
            start_date: sched?.startDate ?? null,
            end_date: sched?.endDate ?? null,
            work_days: sched?.workDays ?? null,
            package_group_id: r.packageGroupId ?? null,
            is_factory_overtime: r.isFactoryOvertime ?? false,
            notes: r.notes ?? null,
          };
        });
        const { error: insErr } = await supabase
          .from('cabedal_prep_allocations' as never)
          .insert(payload as never);
        if (insErr) throw insErr;
      }

      const status = params.lockPlan
        ? (validation.pendingPairs > 0 ? 'planned' : 'planned')
        : 'open';
      const { error: updErr } = await supabase
        .from('cabedal_prep_demands' as never)
        .update({
          status,
          plan_locked_at: params.lockPlan ? new Date().toISOString() : null,
          stale_reason: null,
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', params.demandId);
      if (updErr) throw updErr;

      return { validation, lockPlan: Boolean(params.lockPlan) };
    },
    onSuccess: ({ validation, lockPlan }) => {
      qc.invalidateQueries({ queryKey: cabedalPrepKeys.all });
      if (lockPlan) {
        toast.success('Plano de preparação travado');
      } else if (validation.pendingPairs > 0) {
        toast.success(`Rascunho salvo · ${validation.pendingPairs} pares pendentes`);
      } else {
        toast.success('Rascunho salvo');
      }
    },
    onError: (e: Error) => toast.error(e.message || 'Erro ao salvar plano'),
  });
}

export function useReadjustCabedalPrepPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (demandId: string) => {
      const { data: demand, error } = await supabase
        .from('cabedal_prep_demands' as never)
        .select('*, cabedal_prep_allocations(*)')
        .eq('id', demandId)
        .single();
      if (error) throw error;
      const d = demand as unknown as CabedalPrepDemandRow;
      const allocs = d.cabedal_prep_allocations ?? [];
      const totalAlloc = allocs.reduce((s, a) => s + Number(a.pairs), 0);
      const scale = totalAlloc > 0 ? Number(d.pairs) / totalAlloc : 1;

      if (allocs.length && Math.abs(scale - 1) > 1e-6) {
        for (const a of allocs) {
          const newPairs = Math.max(0, Math.round(Number(a.pairs) * scale * 100) / 100);
          const sched = scheduleAllocation({
            contractorId: a.contractor_id,
            sector: (a.sector === 'package' ? 'corte_cabedal' : a.sector) as CabedalPrepSector,
            pairs: newPairs,
            pairsPerDay: Number(a.pairs_per_day),
            leaveDate: a.leave_date,
          });
          const { error: uErr } = await supabase
            .from('cabedal_prep_allocations' as never)
            .update({
              pairs: newPairs,
              start_date: sched?.startDate ?? null,
              end_date: sched?.endDate ?? null,
              work_days: sched?.workDays ?? null,
              updated_at: new Date().toISOString(),
            } as never)
            .eq('id', a.id);
          if (uErr) throw uErr;
        }
      }

      const { error: dErr } = await supabase
        .from('cabedal_prep_demands' as never)
        .update({
          status: 'planned',
          stale_reason: null,
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', demandId);
      if (dErr) throw dErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: cabedalPrepKeys.all });
      toast.success('Plano reajustado mantendo prestadores');
    },
    onError: (e: Error) => toast.error(e.message || 'Erro ao reajustar'),
  });
}

export function useUpsertContractorModelCapacity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: {
      contractorId: string;
      technicalSheetId: string;
      sector: CabedalPrepSector;
      capacityPairsPerDay: number;
      notes?: string | null;
    }) => {
      const { error } = await supabase
        .from('contractor_model_capacities' as never)
        .upsert(
          {
            contractor_id: row.contractorId,
            technical_sheet_id: row.technicalSheetId,
            sector: row.sector,
            capacity_pairs_per_day: row.capacityPairsPerDay,
            notes: row.notes ?? null,
            updated_at: new Date().toISOString(),
          } as never,
          { onConflict: 'contractor_id,technical_sheet_id,sector' },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: cabedalPrepKeys.capacities() });
      toast.success('Capacidade do prestador salva');
    },
    onError: (e: Error) => toast.error(e.message || 'Erro ao salvar capacidade'),
  });
}

export function useGenerateCabedalPrepServiceOrders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (allocationIds: string[]) => {
      if (!allocationIds.length) throw new Error('Selecione linhas do plano');
      const { data, error } = await supabase.rpc(
        'generate_cabedal_prep_service_orders' as never,
        { p_allocation_ids: allocationIds } as never,
      );
      if (error) throw error;
      return data as { created?: number; message?: string };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: cabedalPrepKeys.all });
      toast.success(
        data?.created
          ? `${data.created} OS gerada(s) a partir do plano`
          : (data?.message ?? 'OS geradas'),
      );
    },
    onError: (e: Error) => toast.error(e.message || 'Erro ao gerar OS'),
  });
}

/** Sincroniza demandas a partir dos PVs Aprovado/Em Produção (não gera OC). */
export function useBackfillCabedalPrepDemands() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc(
        'backfill_cabedal_prep_demands' as never,
        { p_sale_order_id: null } as never,
      );
      if (error) throw error;
      return data as {
        ok?: boolean;
        orders_scanned?: number;
        demands_upserted?: number;
        orders_skipped?: number;
      };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: cabedalPrepKeys.all });
      const n = data?.demands_upserted ?? 0;
      const scanned = data?.orders_scanned ?? 0;
      toast.success(
        n > 0
          ? `${n} demanda(s) sincronizada(s) em ${scanned} PV(s)`
          : scanned > 0
            ? 'Nenhuma demanda nova — PVs sem cabedal/aviamento'
            : 'Nenhum PV Aprovado/Em Produção para sincronizar',
      );
    },
    onError: (e: Error) => toast.error(e.message || 'Erro ao sincronizar demandas'),
  });
}
