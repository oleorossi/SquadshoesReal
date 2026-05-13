import { useQuery } from '@tanstack/react-query';
import { Warning as AlertTriangle, ArrowsClockwise as RefreshCw } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';

type OutdatedStatus = {
  status_label:
    | 'in_sync'
    | 'reservations_outdated'
    | 'snapshot_outdated'
    | 'reservations_and_snapshot_outdated';
  reservations_outdated_at: string | null;
  has_outdated_snapshot: boolean;
  oldest_snapshot_outdated_at: string | null;
};

/**
 * Hook: status de propagação ficha técnica → PV
 * Polling a cada 30s pra refletir cron auto-refresh-reservations (a cada 2min).
 */
export function usePvOutdatedStatus(saleOrderId: string | null) {
  return useQuery({
    queryKey: ['pv_outdated_status', saleOrderId],
    enabled: !!saleOrderId,
    staleTime: 30_000,
    refetchInterval: 30_000,
    queryFn: async (): Promise<OutdatedStatus | null> => {
      const { data, error } = await supabase
        .from('v_pv_outdated_status' as any)
        .select('status_label, reservations_outdated_at, has_outdated_snapshot, oldest_snapshot_outdated_at')
        .eq('sale_order_id', saleOrderId!)
        .maybeSingle();
      if (error) throw error;
      return (data as any) || null;
    },
  });
}

const labelMap: Record<OutdatedStatus['status_label'], { text: string; tooltip: string; severity: 'warn' | 'info' }> = {
  in_sync: {
    text: '',
    tooltip: '',
    severity: 'info',
  },
  reservations_outdated: {
    text: 'Reservas pendentes de atualização',
    tooltip:
      'A ficha técnica foi editada e as reservas serão recalculadas automaticamente em até 2 minutos. ' +
      'Se houver OPs já em produção, o estoque consumido NÃO muda.',
    severity: 'warn',
  },
  snapshot_outdated: {
    text: 'Ficha técnica alterada após produção iniciar',
    tooltip:
      'A ficha técnica foi modificada depois que esta OP entrou em produção. ' +
      'O snapshot congelado em produção continua válido (audit trail), mas considere ' +
      'rodar "Resync OPs" se a mudança foi corretiva.',
    severity: 'warn',
  },
  reservations_and_snapshot_outdated: {
    text: 'Ficha modificada — snapshot e reservas desatualizados',
    tooltip:
      'A ficha técnica foi editada após algumas OPs entrarem em produção. ' +
      'Reservas pré-produção serão recalculadas em até 2 minutos. ' +
      'Pra OPs já em produção, considere "Resync OPs" se a mudança foi corretiva.',
    severity: 'warn',
  },
};

/**
 * Badge inline: mostra alerta visual quando ficha técnica do PV foi editada
 * de forma que pode afetar reservas, snapshots de OPs em produção, etc.
 */
export function PvOutdatedBadge({ saleOrderId }: { saleOrderId: string | null }) {
  const { data } = usePvOutdatedStatus(saleOrderId);
  if (!data || data.status_label === 'in_sync') return null;
  const meta = labelMap[data.status_label];
  if (!meta.text) return null;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className="bg-amber-500/10 text-amber-700 border-amber-500/40 gap-1.5 cursor-help"
          >
            <AlertTriangle className="h-3 w-3" />
            <span className="text-[10px] font-medium">{meta.text}</span>
            {data.status_label === 'reservations_outdated' && (
              <RefreshCw className="h-3 w-3 animate-spin opacity-60" />
            )}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p className="text-xs leading-relaxed">{meta.tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
