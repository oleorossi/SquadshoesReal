import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface QualityDefectCatalogItem {
  id: string;
  code: string;
  name: string;
  category: 'material' | 'processo' | 'acabamento' | 'embalagem' | string;
  default_severity: 'minor' | 'major' | 'critical' | string;
  default_sector: string | null;
  can_rework: boolean;
  description: string | null;
  active: boolean;
  sort_order: number;
}

export interface QualityParetoBySector {
  sector: string | null;
  defect_code: string;
  defect_name: string;
  category: string;
  severity: string;
  occurrences: number;
  total_pairs_affected: number;
  total_cost_impact: number;
  open_count: number;
  cumulative_pairs: number;
  sector_total_pairs: number;
  cumulative_pct: number;
}

export function useQualityDefectCatalog() {
  return useQuery({
    queryKey: ['quality_defect_catalog'],
    queryFn: async (): Promise<QualityDefectCatalogItem[]> => {
      const { data, error } = await (supabase as any)
        .from('quality_defect_catalog')
        .select('*')
        .eq('active', true)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    staleTime: 10 * 60 * 1000,
  });
}

export function useQualityParetoBySector() {
  return useQuery({
    queryKey: ['v_quality_pareto_by_sector'],
    queryFn: async (): Promise<QualityParetoBySector[]> => {
      const { data, error } = await (supabase as any)
        .from('v_quality_pareto_by_sector')
        .select('*');
      if (error) throw error;
      return data || [];
    },
    staleTime: 60_000,
  });
}
