import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type AreaGeometryGap = {
  product_id: string;
  sku: string | null;
  product_name: string | null;
  unit: string | null;
  group_id: string | null;
  group_name: string | null;
  gap_kind: string;
  sheet_width: number | null;
  sheet_length: number | null;
  sheet_unit: string | null;
  group_width: number | null;
  group_length: number | null;
  group_unit: string | null;
};

export const areaGeometryGapsKey = ['area-geometry-gaps'] as const;

export function useAreaGeometryGaps(enabled = true) {
  return useQuery({
    queryKey: areaGeometryGapsKey,
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('list_area_geometry_gaps');
      if (error) throw error;
      return (data || []) as AreaGeometryGap[];
    },
  });
}
