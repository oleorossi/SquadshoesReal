import { useQuery } from '@tanstack/react-query';
import { Warning as AlertTriangle } from '@phosphor-icons/react';
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
  /** sale_orders.costs_dirty_at — não-nulo = custos do PV pendentes de recálculo. */
  costs_dirty_at: string | null;
};

/**
 * Hook: status de propagação ficha técnica → PV
 * Polling a cada 30s pra refletir o housekeeping do flag pelo cron
 * (process_outdated_reservations, a cada 2min — o auto-refresh foi aposentado
 * em 2026-06; reservas são atualizadas no fluxo de usuário aprovado).
 *
 * D7 (audit PV 2026-06): também lê sale_orders.costs_dirty_at — a view
 * v_pv_outdated_status NÃO expõe essa coluna, então buscamos direto do PV.
 */
export function usePvOutdatedStatus(saleOrderId: string | null) {
  return useQuery({
    queryKey: ['pv_outdated_status', saleOrderId],
    enabled: !!saleOrderId,
    staleTime: 30_000,
    refetchInterval: 30_000,
    queryFn: async (): Promise<OutdatedStatus | null> => {
      const [viewRes, soRes] = await Promise.all([
        supabase
          .from('v_pv_outdated_status' as any)
          .select('status_label, reservations_outdated_at, has_outdated_snapshot, oldest_snapshot_outdated_at')
          .eq('sale_order_id', saleOrderId!)
          .maybeSingle(),
        supabase
          .from('sale_orders')
          .select('costs_dirty_at')
          .eq('id', saleOrderId!)
          .maybeSingle(),
      ]);
      if (viewRes.error) throw viewRes.error;
      const costsDirtyAt = (soRes.data as any)?.costs_dirty_at ?? null;
      const base = (viewRes.data as any) || null;
      if (!base && !costsDirtyAt) return null;
      return {
        status_label: base?.status_label ?? 'in_sync',
        reservations_outdated_at: base?.reservations_outdated_at ?? null,
        has_outdated_snapshot: base?.has_outdated_snapshot ?? false,
        oldest_snapshot_outdated_at: base?.oldest_snapshot_outdated_at ?? null,
        costs_dirty_at: costsDirtyAt,
      };
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
    text: 'Ficha/itens editados após reservar',
    tooltip:
      'A ficha técnica ou os itens deste PV foram editados depois que as reservas foram feitas. ' +
      'O sistema preservou as OPs e reservas existentes. Revise o impacto e use "Resync OPs" ' +
      'somente se a alteração realmente deve substituir o plano atual.',
    severity: 'warn',
  },
  snapshot_outdated: {
    text: 'Ficha técnica alterada após produção iniciar',
    tooltip:
      'A ficha técnica foi modificada depois que esta OP entrou em produção. ' +
      'O snapshot congelado continua válido para auditoria; qualquer correção após fato físico ' +
      'deve ser compensatória, não um resync destrutivo.',
    severity: 'warn',
  },
  reservations_and_snapshot_outdated: {
    text: 'Ficha modificada — snapshot e reservas desatualizados',
    tooltip:
      'A ficha técnica foi editada após algumas OPs entrarem em produção. ' +
      'As OPs e reservas foram preservadas. Revise as pré-produção antes de um resync explícito; ' +
      'nas OPs com fato físico, use movimento compensatório.',
    severity: 'warn',
  },
};

/**
 * Badge inline: mostra alerta visual quando ficha técnica do PV foi editada
 * de forma que pode afetar reservas, snapshots de OPs em produção, etc.
 */
export function PvOutdatedBadge({ saleOrderId }: { saleOrderId: string | null }) {
  const { data } = usePvOutdatedStatus(saleOrderId);
  if (!data) return null;
  const meta = data.status_label !== 'in_sync' ? labelMap[data.status_label] : null;
  const showSyncBadge = !!meta?.text;
  const showCostsBadge = !!data.costs_dirty_at;
  if (!showSyncBadge && !showCostsBadge) return null;

  return (
    <TooltipProvider delayDuration={200}>
      {showSyncBadge && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className="bg-amber-500/10 text-amber-700 border-amber-500/40 gap-1.5 cursor-help"
            >
              <AlertTriangle className="h-3 w-3" />
              <span className="text-xs font-medium">{meta!.text}</span>
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="text-xs leading-relaxed">{meta!.tooltip}</p>
          </TooltipContent>
        </Tooltip>
      )}
      {showCostsBadge && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className="bg-amber-500/10 text-amber-700 border-amber-500/40 gap-1.5 cursor-help"
            >
              <AlertTriangle className="h-3 w-3" />
              <span className="text-xs font-medium">Custos desatualizados</span>
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="text-xs leading-relaxed">
              Algo que afeta o custo deste PV mudou (ficha técnica, preços ou itens).
              O recálculo roda automaticamente em background — ou rode agora via
              "Calcular Custos" no PV.
            </p>
          </TooltipContent>
        </Tooltip>
      )}
    </TooltipProvider>
  );
}
