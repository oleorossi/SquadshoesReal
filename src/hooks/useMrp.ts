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
      toast.success(`${ids.length === 1 ? 'Gerada 1 ordem' : `Geradas ${ids.length} ordens`} de compra`);
      qc.invalidateQueries({ queryKey: ["mrp-needs"] });
      qc.invalidateQueries({ queryKey: ["purchase_orders"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
