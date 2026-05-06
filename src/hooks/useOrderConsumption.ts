// =============================================================================
// useOrderConsumption.ts
// Hook React Query que expõe o consumo calculado para um pedido.
// =============================================================================
import { useQuery } from '@tanstack/react-query';
import {
  calculateConsumption,
  validateConsumption,
  groupByComponent,
  type ConsumptionSummary,
} from '@/services/consumptionService';

export function useOrderConsumption(params: {
  referenceId?: string | null;
  quantity?: number | null;
  color?: string | null;
  size?: number | null;
  materialVariantId?: string | null;
  enabled?: boolean;
}) {
  const { referenceId, quantity, color, size, materialVariantId, enabled = true } = params;

  const query = useQuery<ConsumptionSummary>({
    queryKey: ['order-consumption', referenceId, quantity, color ?? '', size ?? null, materialVariantId ?? null],
    enabled: Boolean(enabled && referenceId && quantity && quantity > 0),
    queryFn: async () => {
      return calculateConsumption({
        referenceId: referenceId!,
        quantity: quantity!,
        color,
        size,
        materialVariantId,
      });
    },
    staleTime: 15_000,
  });

  const summary = query.data;
  const validation = summary ? validateConsumption(summary) : { ok: false, errors: [] };
  const grouped = summary ? groupByComponent(summary.lines) : {};

  return { ...query, summary, validation, grouped };
}
