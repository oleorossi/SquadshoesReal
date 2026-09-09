import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  createSaleOrderReadinessOverride,
  preflightSaleOrderCommand,
  type SaleOrderCommandAction,
} from '@/lib/saleOrderCommand';

export const saleOrderCommandPreflightKey = (
  saleOrderId: string | null,
  command: SaleOrderCommandAction,
  expectedOrderVersion?: number | null,
) => ['sale-order-command-preflight', saleOrderId, command, expectedOrderVersion ?? null] as const;

export function useSaleOrderCommandPreflight(input: {
  saleOrderId: string | null;
  command: SaleOrderCommandAction;
  expectedOrderVersion?: number | null;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: saleOrderCommandPreflightKey(
      input.saleOrderId,
      input.command,
      input.expectedOrderVersion,
    ),
    enabled: Boolean(input.saleOrderId) && input.enabled !== false,
    queryFn: () => preflightSaleOrderCommand({
      saleOrderId: input.saleOrderId!,
      command: input.command,
      expectedOrderVersion: input.expectedOrderVersion,
    }),
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
  });
}

export function useCreateSaleOrderReadinessOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createSaleOrderReadinessOverride,
    onSuccess: (_overrideId, vars) => {
      qc.invalidateQueries({
        queryKey: ['sale-order-command-preflight', vars.saleOrderId, vars.command],
      });
      toast.success('Override administrativo registrado com justificativa.');
    },
    onError: (error: Error) => {
      toast.error(`Não foi possível registrar o override: ${error.message}`);
    },
  });
}
