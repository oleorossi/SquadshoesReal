import { toast } from 'sonner';
import type { QueryClient } from '@tanstack/react-query';

/**
 * Finaliza OPs selecionadas no setor via o mesmo caminho do Kanban
 * (`finalizeSectorTask`). Toast + invalidação iguais em Montagem e Solagem.
 */
export async function finalizeSelectedSectorOrders(input: {
  orderIds: string[];
  stageName: string;
  /** Aceita a assinatura real de `useProductionTransitions().finalizeSectorTask`. */
  finalizeSectorTask: (
    orderId: string,
    stageName: string,
    opts?: { quantityProcessed?: number; operatorEmployeeId?: string | null },
  ) => Promise<{ success?: unknown } | null | undefined>;
  queryClient: QueryClient;
  onCleared?: () => void;
}): Promise<void> {
  const { orderIds, stageName, finalizeSectorTask, queryClient, onCleared } = input;
  if (orderIds.length === 0) return;

  const settled = await Promise.allSettled(
    orderIds.map((orderId) => finalizeSectorTask(orderId, stageName)),
  );
  const successCount = settled.filter(
    (s) => s.status === 'fulfilled' && Boolean((s.value as { success?: unknown } | null | undefined)?.success),
  ).length;
  const failedCount = orderIds.length - successCount;

  if (successCount > 0) {
    if (failedCount === 0) toast.success(`${stageName} finalizada para ${successCount} OP(s)!`);
    else toast.warning(`${stageName} finalizada para ${successCount} OP(s); ${failedCount} falhou(aram).`);
    onCleared?.();
    queryClient.invalidateQueries({ queryKey: ['order_stages'] });
    queryClient.invalidateQueries({ queryKey: ['orders'] });
  } else if (failedCount > 0) {
    toast.error(`Falha ao finalizar ${failedCount} OP(s).`);
  }
}
