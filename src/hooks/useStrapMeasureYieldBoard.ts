/**
 * Board de rendimento por medida × geometria (Hub Configuração).
 * Fonte: list_strap_measure_yield_board + set_strap_measure_geometry_yield.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface UntypedQueryResult {
  data: unknown;
  error: unknown;
}

interface UntypedSupabaseClient {
  rpc: (name: string, params?: Record<string, unknown>) => PromiseLike<UntypedQueryResult>;
}

const db = supabase as unknown as UntypedSupabaseClient;

export interface StrapMeasureYieldFamily {
  napa_group_id: string;
  napa_group_name: string;
  width_mm: number;
  length_mm: number;
  yield_m_per_m: number | null;
  geom_min_mm: number;
  geom_max_mm: number;
}

export interface StrapMeasureYieldGeometry {
  geom_min_mm: number;
  geom_max_mm: number;
  yield_m_per_m: number | null;
  family_count: number;
  family_names: string[];
  has_yield: boolean;
}

export interface StrapMeasureYieldBoardRow {
  measure_id: string;
  type_id: string;
  type_name: string;
  display_name: string;
  finished_width_mm: number;
  measure_active: boolean;
  strap_group_id: string | null;
  strap_group_name: string | null;
  uses_napa: boolean;
  cut_band_width_mm: number | null;
  strap_origin: string | null;
  strap_labor_cost_per_m: number | null;
  has_yield: boolean;
  sample_yield_m_per_m: number | null;
  missing_yield: boolean;
  families: StrapMeasureYieldFamily[];
  geometries: StrapMeasureYieldGeometry[];
}

export const strapMeasureYieldBoardKey = ['strap-measure-yield-board'] as const;

function errMsg(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'Erro desconhecido';
}

function parseBoard(data: unknown): StrapMeasureYieldBoardRow[] {
  const rows = Array.isArray(data) ? data : [];
  return rows.map((raw) => {
    const r = raw as Record<string, unknown>;
    const families = Array.isArray(r.families) ? r.families : [];
    const geometries = Array.isArray(r.geometries) ? r.geometries : [];
    return {
      measure_id: String(r.measure_id ?? ''),
      type_id: String(r.type_id ?? ''),
      type_name: String(r.type_name ?? ''),
      display_name: String(r.display_name ?? ''),
      finished_width_mm: Number(r.finished_width_mm) || 0,
      measure_active: r.measure_active !== false,
      strap_group_id: r.strap_group_id ? String(r.strap_group_id) : null,
      strap_group_name: r.strap_group_name ? String(r.strap_group_name) : null,
      uses_napa: r.uses_napa !== false,
      cut_band_width_mm: r.cut_band_width_mm != null ? Number(r.cut_band_width_mm) : null,
      strap_origin: r.strap_origin != null ? String(r.strap_origin) : null,
      strap_labor_cost_per_m: r.strap_labor_cost_per_m != null
        ? Number(r.strap_labor_cost_per_m)
        : null,
      has_yield: r.has_yield === true,
      sample_yield_m_per_m: r.sample_yield_m_per_m != null
        ? Number(r.sample_yield_m_per_m)
        : null,
      missing_yield: r.missing_yield === true,
      families: families.map((f) => {
        const row = f as Record<string, unknown>;
        return {
          napa_group_id: String(row.napa_group_id ?? ''),
          napa_group_name: String(row.napa_group_name ?? ''),
          width_mm: Number(row.width_mm) || 0,
          length_mm: Number(row.length_mm) || 0,
          yield_m_per_m: row.yield_m_per_m != null ? Number(row.yield_m_per_m) : null,
          geom_min_mm: Number(row.geom_min_mm) || 0,
          geom_max_mm: Number(row.geom_max_mm) || 0,
        };
      }),
      geometries: geometries.map((g) => {
        const row = g as Record<string, unknown>;
        const names = Array.isArray(row.family_names)
          ? row.family_names.map((n) => String(n))
          : [];
        return {
          geom_min_mm: Number(row.geom_min_mm) || 0,
          geom_max_mm: Number(row.geom_max_mm) || 0,
          yield_m_per_m: row.yield_m_per_m != null ? Number(row.yield_m_per_m) : null,
          family_count: Number(row.family_count) || names.length,
          family_names: names,
          has_yield: row.has_yield === true,
        };
      }),
    };
  }).filter((row) => row.measure_id);
}

export function useStrapMeasureYieldBoard(enabled = true) {
  return useQuery({
    queryKey: strapMeasureYieldBoardKey,
    enabled,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await db.rpc('list_strap_measure_yield_board');
      if (error) throw error;
      return parseBoard(data);
    },
  });
}

export function useSetStrapMeasureGeometryYield() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      measureId: string;
      yieldMPerM: number;
      cutBandWidthMm?: number | null;
      geometryWidthMm?: number | null;
      geometryLengthMm?: number | null;
    }) => {
      const params: Record<string, unknown> = {
        p_measure_id: input.measureId,
        p_yield_m_per_m: input.yieldMPerM,
      };
      if (input.cutBandWidthMm != null) params.p_cut_band_width_mm = input.cutBandWidthMm;
      if (input.geometryWidthMm != null) params.p_geometry_width_mm = input.geometryWidthMm;
      if (input.geometryLengthMm != null) params.p_geometry_length_mm = input.geometryLengthMm;
      const { data, error } = await db.rpc('set_strap_measure_geometry_yield', params);
      if (error) throw error;
      return data as Record<string, unknown>;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: strapMeasureYieldBoardKey });
      const count = Number(data?.applied_count) || 0;
      const yieldVal = Number(data?.yield_m_per_m) || 0;
      toast.success(
        `Rendimento ${yieldVal.toLocaleString('pt-BR')} m/m gravado em ${count} famíli${count === 1 ? 'a' : 'as'}.`,
      );
    },
    onError: (err: unknown) => toast.error(`Erro ao gravar rendimento: ${errMsg(err)}`),
  });
}
