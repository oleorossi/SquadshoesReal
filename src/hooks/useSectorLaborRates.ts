import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Valor-hora (R$/h) por setor produtivo — fonte da calculadora manual de custo
 * de MO (aba "Mão de Obra" em /pricing-calculator). Chave = SectorKey canônico
 * de src/lib/sectors.ts. Ver migration 20260613130000_sector-labor-rates.
 */

const QUERY_KEY = ['sector-labor-rates'] as const;

/** Mapa sector_key → valor-hora (R$/h). */
export function useSectorLaborRates() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sector_labor_rates')
        .select('sector_key, hourly_rate');
      if (error) throw error;
      const map: Record<string, number> = {};
      for (const r of data ?? []) map[r.sector_key] = Number(r.hourly_rate) || 0;
      return map;
    },
    staleTime: 60_000,
  });
}

/** Upsert do valor-hora de um setor. */
export function useUpsertSectorLaborRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ sectorKey, hourlyRate }: { sectorKey: string; hourlyRate: number }) => {
      const { error } = await supabase
        .from('sector_labor_rates')
        .upsert(
          { sector_key: sectorKey, hourly_rate: hourlyRate, updated_at: new Date().toISOString() },
          { onConflict: 'sector_key' },
        );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}
