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
    // persist=false: apenas EXIBE o custo (recalculado com preços vivos), sem
    // regravar `order_costs`. Antes era `true`, então só ABRIR o card de margem
    // reescrevia o snapshot congelado com os preços atuais — uma edição de preço
    // na ficha alterava o histórico de custo silenciosamente na próxima
    // visualização. A persistência do snapshot agora só acontece nos caminhos
    // EXPLÍCITOS: salvar o PV (SaleOrderForm) e o botão "Calcular Custos"
    // (useRecalcOrderCost).
    queryFn: () => calculateOrderCost(saleOrderId!, saleOrderItemId, false),
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
