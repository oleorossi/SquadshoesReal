import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  calculateOrderCost,
  listProfitability,
  type OrderCostResult,
} from "@/services/costingService";

export function useOrderCost(
  saleOrderId: string | undefined,
  saleOrderItemId?: string,
  enabled = true,
) {
  return useQuery<OrderCostResult>({
    queryKey: ["order-cost", saleOrderId, saleOrderItemId],
    queryFn: () => calculateOrderCost(saleOrderId!, saleOrderItemId, true),
    enabled: !!saleOrderId && enabled,
    staleTime: 30_000,
  });
}

export function useProfitability() {
  return useQuery({
    queryKey: ["profitability"],
    queryFn: () => listProfitability(200),
    staleTime: 60_000,
  });
}

export function useRecalcOrderCost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { saleOrderId: string; saleOrderItemId?: string }) =>
      calculateOrderCost(input.saleOrderId, input.saleOrderItemId, true),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profitability"] }),
  });
}
