import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface SopPlan {
  id: string;
  period_month: string;
  scenario: 'conservador' | 'base' | 'agressivo';
  status: 'rascunho' | 'aprovado' | 'arquivado';
  notes: string | null;
  created_at: string;
}

export interface SopPlanItem {
  id: string;
  plan_id: string;
  reference_id: string;
  reference_code: string;
  reference_name: string;
  color: string;
  forecast_pairs: number;
  confirmed_pairs: number;
  adjustment_pairs: number;
  planned_pairs: number;
  notes: string | null;
}

export interface SopSectorLoad {
  sector: string;
  flow_order: number;
  planned_pairs: number;
  daily_capacity_pairs: number;
  business_days: number;
  capacity_pairs: number;
  utilization_pct: number;
  open_order_pairs: number;
}

export interface SectorDailyManagement {
  sector: string;
  flow_order: number;
  planned_pairs: number;
  pointed_pairs: number;
  adherence_pct: number | null;
  open_ops: number;
  wip_pairs: number;
  oldest_due_date: string | null;
  priority_order_id: string | null;
}

export function useSopPlans() {
  return useQuery({
    queryKey: ['sop_plans'],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabelas novas até a regeneração dos tipos Supabase
      const { data, error } = await (supabase as any).from('sop_plans').select('*').order('period_month', { ascending: false }).order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as SopPlan[];
    },
  });
}

export function useSopPlanItems(planId: string | null) {
  return useQuery({ enabled: !!planId, queryKey: ['sop_plan_items', planId], queryFn: async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- view nova até a regeneração dos tipos Supabase
    const { data, error } = await (supabase as any).from('v_sop_plan_items').select('*').eq('plan_id', planId).order('reference_code').order('color');
    if (error) throw error;
    return (data || []) as SopPlanItem[];
  }});
}

export function useSopSectorLoad(planId: string | null) {
  return useQuery({ enabled: !!planId, queryKey: ['sop_sector_load', planId], queryFn: async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC nova até a regeneração dos tipos Supabase
    const { data, error } = await (supabase as any).rpc('get_sop_sector_load', { p_plan_id: planId });
    if (error) throw error;
    return (data || []) as SopSectorLoad[];
  }});
}

export function useSectorDailyManagement(date: string) {
  return useQuery({ queryKey: ['sector_daily_management', date], queryFn: async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC nova até a regeneração dos tipos Supabase
    const { data, error } = await (supabase as any).rpc('get_sector_daily_management', { p_date: date });
    if (error) throw error;
    return (data || []) as SectorDailyManagement[];
  }});
}

export function useCreateSopPlan() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: async (input: { periodMonth: string; scenario: SopPlan['scenario']; notes?: string }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC nova até a regeneração dos tipos Supabase
    const { data, error } = await (supabase as any).rpc('create_sop_plan', { p_period_month: input.periodMonth, p_scenario: input.scenario, p_notes: input.notes || null });
    if (error) throw error;
    return data as string;
  }, onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['sop_plans'] }); toast.success('Plano S&OP criado.'); }, onError: (error: Error) => toast.error(error.message || 'Não foi possível criar o plano S&OP.') });
}

export function useSaveSopPlanItem() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: async (item: SopPlanItem) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC nova até a regeneração dos tipos Supabase
    const { error } = await (supabase as any).rpc('upsert_sop_plan_item', { p_plan_id: item.plan_id, p_reference_id: item.reference_id, p_color: item.color, p_forecast_pairs: item.forecast_pairs, p_confirmed_pairs: item.confirmed_pairs, p_adjustment_pairs: item.adjustment_pairs, p_notes: item.notes });
    if (error) throw error;
  }, onSuccess: (_, item) => { queryClient.invalidateQueries({ queryKey: ['sop_plan_items', item.plan_id] }); queryClient.invalidateQueries({ queryKey: ['sop_sector_load', item.plan_id] }); toast.success('Linha S&OP atualizada.'); }, onError: (error: Error) => toast.error(error.message || 'Não foi possível salvar a linha.') });
}

export function useApproveSopPlan() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: async (planId: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC nova até a regeneração dos tipos Supabase
    const { error } = await (supabase as any).rpc('approve_sop_plan', { p_plan_id: planId });
    if (error) throw error;
  }, onSuccess: (_, planId) => { queryClient.invalidateQueries({ queryKey: ['sop_plans'] }); queryClient.invalidateQueries({ queryKey: ['sop_plan_items', planId] }); toast.success('Plano S&OP aprovado e bloqueado para edição.'); }, onError: (error: Error) => toast.error(error.message || 'Não foi possível aprovar o plano.') });
}
