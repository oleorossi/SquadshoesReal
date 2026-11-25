// =============================================================================
// Gestão · Setores — leitura única do panorama (RPC get_sector_panorama).
//
// Uma ida ao servidor traz fila do motor + agenda setor×dia + etapas abertas +
// gate de material + jobs do Ateliê. Somente leitura. A key `sector_panorama`
// está em ENGINE_QUERY_KEYS / KANBAN_ENGINE_CACHE_KEYS: apontamento, realtime,
// pin e recálculo invalidam este painel junto com o quadro.
// =============================================================================
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { queueRowVisibleOperationally } from '@/lib/operationalScope';
import { useEngineRefetchInterval } from '@/hooks/useProductionEngine';
import type { SectorPanoramaData } from '@/lib/sectorPanorama';

export const SECTOR_PANORAMA_RPC = 'get_sector_panorama';
export const SECTOR_PANORAMA_KEY = 'sector_panorama';

export function useSectorPanorama(days = 28, enabled = true) {
  const refetchInterval = useEngineRefetchInterval();
  return useQuery({
    queryKey: [SECTOR_PANORAMA_KEY, days],
    enabled,
    refetchInterval,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
    placeholderData: prev => prev,
    queryFn: async (): Promise<SectorPanoramaData> => {
      const { data, error } = await supabase.rpc(
        SECTOR_PANORAMA_RPC as never,
        { p_from: null, p_days: days } as never,
      );
      if (error) throw error;
      const raw = (data ?? {}) as Partial<SectorPanoramaData>;
      const ops = (raw.ops ?? []).filter(op => queueRowVisibleOperationally({
        orderStatus: op.order_status,
        saleOrderStatus: op.sale_order_id ? op.sale_order_status : null,
        saleOrderDeletedAt: op.sale_order_id ? op.sale_order_deleted_at : null,
      }));
      const visible = new Set(ops.map(o => o.order_id));
      return {
        from: raw.from ?? new Date().toISOString().slice(0, 10),
        to: raw.to ?? new Date().toISOString().slice(0, 10),
        generated_at: raw.generated_at ?? new Date().toISOString(),
        last_run: raw.last_run ?? null,
        sectors: raw.sectors ?? [],
        ops,
        schedule: (raw.schedule ?? []).filter(r => visible.has(r.order_id)),
        forecast: raw.forecast ?? [],
      };
    },
  });
}
