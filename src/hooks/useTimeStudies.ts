import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Cronoanálise (time study) — captura ciclos cronometrados de uma operação e
 * deriva o tempo-padrão (ritmo + tolerância PF&D). Colunas calculadas no banco
 * (normal_time_minutes, standard_time_minutes, cost_per_minute, cost_per_pair).
 *
 * O resultado alimenta bom_operations.standard_time_minutes via RPC
 * apply_time_study_to_bom — mantendo calculate_order_cost como fonte única do MOD.
 */

export interface TimeStudy {
  id: string;
  sheet_id: string;
  bom_operation_id: string | null;
  operation_name: string;
  stage: string;
  cycles_seconds: number[];
  observed_avg_seconds: number;
  rating_pct: number;
  allowance_pct: number;
  cost_per_hour: number;
  // gerados
  sample_size: number;
  normal_time_minutes: number;
  standard_time_minutes: number;
  cost_per_minute: number;
  cost_per_pair: number;
  observed_by: string;
  observed_at: string;
  notes: string;
  active: boolean;
}

export interface TimeStudyFormData {
  sheet_id: string;
  bom_operation_id?: string | null;
  operation_name: string;
  stage: string;
  cycles_seconds: number[];
  rating_pct: number;
  allowance_pct: number;
  cost_per_hour: number;
  observed_by?: string;
  notes?: string;
}

export interface SectorCostPerMinute {
  stage: string;
  study_count: number;
  avg_cost_per_minute: number;
  avg_standard_time_minutes: number;
  avg_cost_per_pair: number;
  avg_rating_pct: number;
  avg_allowance_pct: number;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Deriva o tempo-padrão no cliente (espelha as fórmulas das colunas geradas). */
export function deriveTimeStudy(cyclesSeconds: number[], ratingPct: number, allowancePct: number, costPerHour: number) {
  const observedAvgSeconds = avg(cyclesSeconds);
  const normalMin = (observedAvgSeconds * ratingPct / 100) / 60;
  const standardMin = normalMin * (1 + allowancePct / 100);
  const costPerMinute = costPerHour / 60;
  const costPerPair = standardMin * costPerMinute;
  return { observedAvgSeconds, normalMin, standardMin, costPerMinute, costPerPair };
}

export function useTimeStudies(sheetId?: string | null) {
  return useQuery({
    queryKey: ['time_studies', sheetId ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('time_studies' as any).select('*').order('created_at', { ascending: false });
      if (sheetId) q = q.eq('sheet_id', sheetId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as TimeStudy[];
    },
  });
}

export function useSectorCostPerMinute() {
  return useQuery({
    queryKey: ['v_sector_cost_per_minute'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_sector_cost_per_minute' as any).select('*').order('stage');
      if (error) throw error;
      return (data ?? []) as unknown as SectorCostPerMinute[];
    },
  });
}

function validate(data: TimeStudyFormData) {
  if (!data.sheet_id) throw new Error('Selecione a referência (ficha técnica).');
  if (!data.operation_name.trim()) throw new Error('Informe o nome da operação.');
  if (!data.stage) throw new Error('Selecione o setor.');
  if (!data.cycles_seconds.length) throw new Error('Cronometre ao menos um ciclo.');
  if (data.cycles_seconds.some((c) => !Number.isFinite(c) || c <= 0)) throw new Error('Ciclos devem ser segundos positivos.');
  if (!Number.isFinite(data.rating_pct) || data.rating_pct <= 0) throw new Error('Ritmo deve ser um percentual positivo.');
  if (!Number.isFinite(data.allowance_pct) || data.allowance_pct < 0) throw new Error('Tolerância deve ser ≥ 0.');
  if (!Number.isFinite(data.cost_per_hour) || data.cost_per_hour < 0) throw new Error('Custo/hora deve ser ≥ 0.');
}

function toRow(data: TimeStudyFormData) {
  return {
    sheet_id: data.sheet_id,
    bom_operation_id: data.bom_operation_id ?? null,
    operation_name: data.operation_name.trim(),
    stage: data.stage,
    cycles_seconds: data.cycles_seconds,
    observed_avg_seconds: avg(data.cycles_seconds),
    rating_pct: data.rating_pct,
    allowance_pct: data.allowance_pct,
    cost_per_hour: data.cost_per_hour,
    observed_by: data.observed_by ?? '',
    notes: data.notes ?? '',
  };
}

export function useAddTimeStudy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: TimeStudyFormData) => {
      validate(data);
      const { error } = await supabase.from('time_studies' as any).insert(toRow(data) as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['time_studies'] });
      qc.invalidateQueries({ queryKey: ['v_sector_cost_per_minute'] });
      toast.success('Cronoanálise registrada!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateTimeStudy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: TimeStudyFormData }) => {
      validate(data);
      const { error } = await supabase.from('time_studies' as any).update(toRow(data) as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['time_studies'] });
      qc.invalidateQueries({ queryKey: ['v_sector_cost_per_minute'] });
      toast.success('Cronoanálise atualizada!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteTimeStudy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('time_studies' as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['time_studies'] });
      qc.invalidateQueries({ queryKey: ['v_sector_cost_per_minute'] });
      toast.success('Cronoanálise removida!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

/** Aplica o tempo-padrão derivado de volta no bom_operations (fonte do custeio). */
export function useApplyTimeStudyToBom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (studyId: string) => {
      const { error } = await supabase.rpc('apply_time_study_to_bom' as any, { p_study_id: studyId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['time_studies'] });
      qc.invalidateQueries({ queryKey: ['bom_operations'] });
      toast.success('Tempo-padrão aplicado ao BOM — custeio atualizado.');
    },
    onError: (err: Error) => toast.error(`Erro ao aplicar: ${err.message}`),
  });
}
