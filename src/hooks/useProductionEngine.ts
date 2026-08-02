// =============================================================================
// Hooks do MOTOR DINÂMICO DE PRODUÇÃO (specs/remodelagem-producao.md)
//
// Camada ÚNICA de leitura/escrita do motor (R2.7): Planejamento, Kanban,
// Estouro e Análises leem daqui — nenhuma tela mantém cálculo próprio.
// O recálculo acontece no servidor (recompute_production_schedule) via
// triggers; o frontend só invalida as query keys e, ao montar as telas de
// produção, garante a virada do dia com recompute_production_schedule_if_stale.
// =============================================================================
import { useQuery, useMutation, useQueryClient, QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface SectorSetting {
  sector: string;
  flow_order: number;
  enabled: boolean;
  parallel_group: string | null;
  daily_capacity_pairs: number;
  team_size: number | null;
  team_notes: string | null;
  check_prev_sector_limit: boolean;
  check_material_reserved: boolean;
  ficha_capacity_column: string | null;
  updated_at: string;
}

export interface ScheduleGridCell {
  sector: string;
  date: string;
  planned_pairs: number;
  carryover_pairs: number;
  capacity_pairs: number;
  /** Fração do dia que o motor usou (1.0 = dia cheio) — comparar por AQUI, não por pares×capacidade global */
  utilization: number;
  /** Capacidade do mix real do dia (rates de ficha ponderados); = global quando não há override */
  effective_capacity_pairs: number;
  ops: number;
  ops_ficha_override: number;
  flow_order: number;
  enabled: boolean;
  parallel_group: string | null;
}

export interface QueueDetailRow {
  order_id: string;
  order_number: string;
  reference_id: string | null;
  reference_name: string | null;
  reference_photo_url: string | null;
  color: string | null;
  quantity: number;
  order_status: string;
  sale_order_id: string | null;
  sale_order_number: string | null;
  client_name: string | null;
  /** Nome fantasia e grupo econômico do cliente — existem pra BUSCA (mig
   *  `20261101120000`). A razão social (`client_name`) segue sendo o que
   *  etiqueta/ficha exibem; estes dois só ampliam o que a busca acha. */
  client_fantasia: string | null;
  client_group_name: string | null;
  due_date: string | null;
  pinned_position: number | null;
  pinned_by: string | null;
  pinned_at: string | null;
  queue_status: string;
  projected_completion: string | null;
  next_scheduled_date: string | null;
  has_ficha_override: boolean;
  carryover_total: number;
  remaining_pairs: number;
  late_days: number;
  queue_position: number;
}

export interface OverloadRow {
  kind: 'late_op' | 'no_due' | 'sem_agenda';
  order_id: string;
  order_number: string;
  reference_name: string | null;
  color: string | null;
  quantity: number;
  sale_order_id: string | null;
  sale_order_number: string | null;
  client_name: string | null;
  due_date: string | null;
  projected_completion: string | null;
  late_days: number;
  carryover_total: number;
  remaining_pairs: number;
}

export interface ScheduleOpRow {
  order_id: string;
  sector: string;
  date: string;
  planned_pairs: number;
  carryover_pairs: number;
  capacity_source: 'global' | 'ficha_override';
}

export interface EngineRun {
  run_id: string;
  ran_at: string;
  ran_on: string;
  duration_ms: number | null;
  queue_size: number | null;
  scheduled_pairs: number | null;
  horizon_end: string | null;
  triggered_by: string | null;
}

export const ENGINE_QUERY_KEYS = [
  ['sector_settings'],
  ['production_schedule_grid'],
  ['production_schedule_ops'],
  ['production_queue_detail'],
  ['production_overloads'],
  ['production_engine_runs'],
] as const;

export function invalidateEngineCaches(qc: QueryClient) {
  ENGINE_QUERY_KEYS.forEach(key => qc.invalidateQueries({ queryKey: [...key] }));
  // O motor deriva de order_stages — telas que mostram os dois precisam concordar
  qc.invalidateQueries({ queryKey: ['order_stages'] });
}

// ── Leitura ──────────────────────────────────────────────────────────────────

export function useSectorSettings() {
  return useQuery({
    queryKey: ['sector_settings'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sector_settings')
        .select('*')
        .order('flow_order');
      if (error) throw error;
      return (data || []) as SectorSetting[];
    },
  });
}

export function useProductionScheduleGrid(fromISO: string, toISO: string) {
  return useQuery({
    queryKey: ['production_schedule_grid', fromISO, toISO],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_production_schedule_grid')
        .select('*')
        .gte('date', fromISO)
        .lte('date', toISO)
        .order('date');
      if (error) throw error;
      return (data || []) as ScheduleGridCell[];
    },
  });
}

/** Agenda detalhada de um setor×dia (drill-down da grade / explicabilidade R2.8). */
export function useScheduleOps(sector: string | null, dateISO: string | null) {
  return useQuery({
    queryKey: ['production_schedule_ops', sector, dateISO],
    enabled: !!sector && !!dateISO,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_schedule')
        .select('order_id, sector, date, planned_pairs, carryover_pairs, capacity_source')
        .eq('sector', sector!)
        .eq('date', dateISO!)
        .order('planned_pairs', { ascending: false });
      if (error) throw error;
      return (data || []) as ScheduleOpRow[];
    },
  });
}

/** Agenda completa de UMA OP (popover "como cheguei nisso" do card/fila). */
export function useOpSchedule(orderId: string | null) {
  return useQuery({
    queryKey: ['production_schedule_ops', 'op', orderId],
    enabled: !!orderId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_schedule')
        .select('order_id, sector, date, planned_pairs, carryover_pairs, capacity_source')
        .eq('order_id', orderId!)
        .order('date');
      if (error) throw error;
      return (data || []) as ScheduleOpRow[];
    },
  });
}

export function useProductionQueueDetail() {
  return useQuery({
    queryKey: ['production_queue_detail'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_production_queue_detail')
        .select('*')
        .order('queue_position');
      if (error) throw error;
      return (data || []) as QueueDetailRow[];
    },
  });
}

export function useProductionOverloads() {
  return useQuery({
    queryKey: ['production_overloads'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_production_overloads')
        .select('*')
        .order('late_days', { ascending: false });
      if (error) throw error;
      return (data || []) as OverloadRow[];
    },
  });
}

export function useLastEngineRun() {
  return useQuery({
    queryKey: ['production_engine_runs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_engine_runs')
        .select('*')
        .order('ran_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data || null) as EngineRun | null;
    },
  });
}

// ── Escrita ──────────────────────────────────────────────────────────────────

export function useUpdateSectorSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: Partial<SectorSetting> & { sector: string }) => {
      const { sector, ...fields } = p;
      const { error } = await supabase
        .from('sector_settings')
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('sector', sector);
      if (error) throw error;
    },
    onSuccess: () => {
      // O trigger do banco já recalculou TODAS as OPs abertas (R1.4)
      invalidateEngineCaches(qc);
      toast.success('Setor atualizado — fila recalculada.');
    },
    onError: (err: Error) => toast.error(`Erro ao salvar setor: ${err.message}`),
  });
}

/** Pin manual da fila (R2.5). position=null despina. */
export function usePinOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { orderId: string; position: number | null }) => {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('production_queue')
        .update({
          pinned_position: p.position,
          pinned_by: p.position === null ? null : (userData?.user?.id ?? null),
          pinned_at: p.position === null ? null : new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('order_id', p.orderId);
      if (error) throw error;
    },
    onSuccess: (_d, p) => {
      invalidateEngineCaches(qc);
      toast.success(p.position === null ? 'OP despinada — volta pra ordenação por prazo.' : 'Prioridade fixada.');
    },
    onError: (err: Error) => toast.error(`Erro ao priorizar: ${err.message}`),
  });
}

/**
 * Pin por drag (R2.5): fixa a OP NA posição onde foi solta. O RPC renumera o
 * bloco de pins (pinadas sempre vêm antes na fila do motor) — gravar
 * queue_position cru em pinned_position colocava a OP na posição errada.
 */
export function usePinOrderAt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { orderId: string; position: number }) => {
      const { error } = await supabase.rpc('pin_order_at', {
        p_order_id: p.orderId,
        p_target_position: p.position,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateEngineCaches(qc);
      toast.success('OP fixada na posição — fila recalculada.');
    },
    onError: (err: Error) => toast.error(`Erro ao priorizar: ${err.message}`),
  });
}

/** Aceitar um estouro (R4.3) — some da lista ativa, fica registrado com autoria. */
export function useAcceptOverload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { scopeKey: string; orderId?: string; sector?: string; reason?: string }) => {
      const { error } = await supabase.from('overload_acknowledgements').insert({
        scope_key: p.scopeKey,
        order_id: p.orderId ?? null,
        sector: p.sector ?? null,
        reason: p.reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production_overloads'] });
      toast.success('Atraso aceito — registrado com sua autoria.');
    },
    onError: (err: Error) => toast.error(`Erro ao aceitar: ${err.message}`),
  });
}

export function useRecomputeSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('recompute_production_schedule', {
        p_triggered_by: 'manual',
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateEngineCaches(qc);
      toast.success('Fila recalculada.');
    },
    onError: (err: Error) => toast.error(`Erro no recálculo: ${err.message}`),
  });
}

/**
 * Virada do dia sem cron (R2.3/R2.6): ao montar qualquer tela de produção,
 * garante que existe um run de HOJE — se não, o saldo de ontem rola agora.
 */
export function useEnsureFreshSchedule() {
  const qc = useQueryClient();
  useEffect(() => {
    supabase.rpc('recompute_production_schedule_if_stale').then(({ data, error }) => {
      if (!error && (data as { recomputed?: boolean } | null)?.recomputed) {
        invalidateEngineCaches(qc);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
