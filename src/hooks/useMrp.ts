import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listMrpNeeds,
  generatePurchaseOrdersFromMrp,
  type MrpNeed,
} from "@/services/mrpService";
import { toast } from "sonner";

export function useMrpNeeds() {
  return useQuery<MrpNeed[]>({
    queryKey: ["mrp-needs"],
    queryFn: listMrpNeeds,
    refetchInterval: 60_000,
    staleTime: 60_000,
  });
}

export function useGeneratePOFromMrp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (productIds?: string[]) =>
      generatePurchaseOrdersFromMrp(productIds),
    onSuccess: (ids) => {
      toast.success(`Gerada(s) ${ids.length} ordem(ns) de compra`);
      qc.invalidateQueries({ queryKey: ["mrp-needs"] });
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
