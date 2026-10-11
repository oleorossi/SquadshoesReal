import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import InboundAllocationDialog from '@/components/inventory/InboundAllocationDialog';
import { invalidateProductSupply } from '@/hooks/useProductSupplySummary';
import {
  closeInboundAllocationReview,
  getInboundAllocationReviewState,
  subscribeInboundAllocationReview,
  subscribeInboundEntry,
} from '@/lib/inboundAllocationReviewStore';

/**
 * Host global da tela de rateio da entrada (`openInboundAllocationReview`).
 * Montar uma vez no `AppLayout`. Inerte (não renderiza nada) até uma entrada
 * de estoque quitar falta de algum PV.
 *
 * Também é quem invalida Falta / Em compra / selo de material dos PVs a cada
 * entrada (`subscribeInboundEntry`) e ao fechar o rateio — "Manter" inclusive.
 */
export default function InboundAllocationHost() {
  const qc = useQueryClient();
  const { request } = useSyncExternalStore(
    subscribeInboundAllocationReview,
    getInboundAllocationReviewState,
    getInboundAllocationReviewState,
  );

  useEffect(() => subscribeInboundEntry(() => invalidateProductSupply(qc)), [qc]);

  const handleOpenChange = useCallback((open: boolean) => {
    if (open) return;
    closeInboundAllocationReview();
    invalidateProductSupply(qc);
  }, [qc]);

  if (!request) return null;
  return (
    <InboundAllocationDialog
      open
      onOpenChange={handleOpenChange}
      productIds={request.productIds}
      since={request.since}
    />
  );
}
