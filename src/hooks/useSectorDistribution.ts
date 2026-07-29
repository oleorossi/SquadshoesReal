import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface SectorLoadByRef {
  tech_sheet_id: string;
  week_start: string;
  total_qty: number;
  op_count: number;
  reference_code: string;
  reference_name: string;
  shoe_category: string | null;
  cap_corte_palmilha: number;
  cap_corte_forracao: number;
  cap_costura: number;
  cap_aviamento: number;
  cap_silk: number;
  cap_colagem: number;
  cap_montagem: number;
  cap_solagem: number;
  cap_acabamento: number;
  cap_expedicao: number;
  /** 'ficha' = cap configurada na ficha técnica; 'categoria' = veio do
   *  default_lead_times pelo shoe_category; 'nenhuma' = sem cap em lugar nenhum. */
  capacity_source: 'ficha' | 'categoria' | 'nenhuma';
}

export interface SectorDistributionRow {
  id: string;
  week_start: string;
  sector: string;
  tech_sheet_id: string;
  day_of_week: number;   // 1..5 = Seg..Sex
  pairs_planned: number;
  is_locked: boolean;
  source: 'auto' | 'manual';
  notes: string | null;
}

/**
 * ⚠ DEFASADA de propósito — NÃO trocar por `SECTOR_FLOW` (`@/lib/sectors`) sem
 * migration junto.
 *
 * A divisão da Costura (migration 20261001120000) NÃO chegou neste motor legado:
 * a view `v_sector_load_by_reference` ainda expõe só `cap_costura` (sem
 * `cap_costura_palmilha`/`cap_costura_cabedal`) e a tabela
 * `sector_distribution_plan` tem CHECK constraint com a `'Costura'` única.
 * Trocar a lista aqui sozinha quebra `SECTOR_CAP_FIELD` e o INSERT no plano.
 *
 * Consequência viva: um plano de distribuição feito pra "Costura" não casa com
 * os dois setores que o Kanban e o motor diário operam de fato. É o 3º motor de
 * PCP isolado — a saída é aposentá-lo (não remendá-lo), junto de
 * `SectorDistributionPlanner`/`CapacityDistribution`.
 */
export const SECTORS = [
  'Corte Palmilha', 'Corte Forração', 'Costura', 'Aviamento', 'Silk',
  'Colagem', 'Montagem', 'Solagem', 'Acabamento', 'Expedição',
] as const;

export type SectorName = typeof SECTORS[number];

/** Mapping sector → coluna de capacidade na view v_sector_load_by_reference. */
export const SECTOR_CAP_FIELD: Record<SectorName, keyof Pick<SectorLoadByRef,
  'cap_corte_palmilha' | 'cap_corte_forracao' | 'cap_costura' | 'cap_aviamento' |
  'cap_silk' | 'cap_colagem' | 'cap_montagem' | 'cap_solagem' | 'cap_acabamento' | 'cap_expedicao'
>> = {
  'Corte Palmilha': 'cap_corte_palmilha',
  'Corte Forração': 'cap_corte_forracao',
  'Costura':        'cap_costura',
  'Aviamento':      'cap_aviamento',
  'Silk':           'cap_silk',
  'Colagem':        'cap_colagem',
  'Montagem':       'cap_montagem',
  'Solagem':        'cap_solagem',
  'Acabamento':     'cap_acabamento',
  'Expedição':      'cap_expedicao',
};

/** Demanda da semana — uma row por (referência) com qty + capacidades por setor. */
export function useSectorLoadByReference(weekStartISO: string | null) {
  return useQuery<SectorLoadByRef[]>({
    queryKey: ['sector_load_by_ref', weekStartISO],
    enabled: !!weekStartISO,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('v_sector_load_by_reference')
        .select('*')
        .eq('week_start', weekStartISO);
      if (error) throw error;
      return (data ?? []) as SectorLoadByRef[];
    },
  });
}

/** Plano de distribuição diário existente pra semana. */
export function useSectorDistribution(weekStartISO: string | null) {
  return useQuery<SectorDistributionRow[]>({
    queryKey: ['sector_distribution_plan', weekStartISO],
    enabled: !!weekStartISO,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('sector_distribution_plan')
        .select('*')
        .eq('week_start', weekStartISO);
      if (error) throw error;
      return (data ?? []) as SectorDistributionRow[];
    },
  });
}

interface AutoFillResult {
  week_start: string;
  inserts: number;
  locked_preserved: number;
  bottlenecks: Array<{
    sector: string;
    tech_sheet_id: string;
    unallocated_pairs: number;
    requested_pairs: number;
    daily_capacity: number;
  }>;
  algorithm: string;
}

/** Auto-fill greedy: distribui demanda da semana nos 5 dias úteis. */
export function useAutoFillSectorDistribution() {
  const qc = useQueryClient();
  return useMutation<AutoFillResult, Error, string>({
    mutationFn: async (weekStartISO: string) => {
      const { data, error } = await (supabase as any).rpc('auto_fill_sector_distribution', {
        p_week_start: weekStartISO,
      });
      if (error) throw error;
      return data as AutoFillResult;
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['sector_distribution_plan', result.week_start] });
      const bn = result.bottlenecks?.length || 0;
      if (bn > 0) {
        toast.warning(`Plano gerado com ${bn} gargalo(s) — alguns pares não couberam na semana`);
      } else {
        toast.success(`Distribuição gerada: ${result.inserts} alocações`);
      }
    },
    onError: (err) => toast.error(`Falha ao distribuir: ${err.message}`),
  });
}

/** Update inline de uma célula (pairs_planned, is_locked, notes). Cria se não existe. */
export function useUpsertDistributionCell() {
  const qc = useQueryClient();
  return useMutation<void, Error, {
    week_start: string;
    sector: string;
    tech_sheet_id: string;
    day_of_week: number;
    pairs_planned: number;
    is_locked?: boolean;
  }>({
    mutationFn: async (payload) => {
      const { error } = await (supabase as any)
        .from('sector_distribution_plan')
        .upsert({
          week_start: payload.week_start,
          sector: payload.sector,
          tech_sheet_id: payload.tech_sheet_id,
          day_of_week: payload.day_of_week,
          pairs_planned: payload.pairs_planned,
          is_locked: payload.is_locked ?? false,
          source: 'manual',
        }, { onConflict: 'week_start,sector,tech_sheet_id,day_of_week' });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['sector_distribution_plan', vars.week_start] });
    },
    onError: (err) => toast.error(`Falha ao salvar: ${err.message}`),
  });
}

/** Retorna data da segunda-feira da semana ISO da data informada. */
export function isoWeekStart(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dow = d.getUTCDay() || 7;
  if (dow !== 1) d.setUTCDate(d.getUTCDate() - dow + 1);
  return d.toISOString().split('T')[0];
}
