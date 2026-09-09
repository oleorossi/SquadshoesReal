/** Replay FIFO da fila mobile, sempre no namespace do usuário autenticado. */
import {
  completeQueuedOrderCreate,
  listPendingOrders,
  MOBILE_SALE_ORDER_DRAFT_STATUS,
  markAttemptFailed,
  type QueuedOrder,
  type QueueFailureKind,
} from './offlineQueue';
import { classifyMobileOrderError, submitMobileSaleOrderAtomic } from './atomicSaleOrder';
import { confirmMobileSaleOrder } from './confirmSaleOrder';

const MAX_ATTEMPTS = 5;
export interface SyncResult {
  succeeded: number;
  failed: number;
  skipped: number;
  createdAsDraft: number;
  confirmationUnknown: number;
  errors: Array<{ client_request_id: string; error: string; failureKind: QueueFailureKind }>;
  confirmationErrors: Array<{
    client_request_id: string;
    order_id: string;
    error: string;
    outcome: 'draft' | 'unknown';
  }>;
}

let syncInFlight = false;

const processOne = async (
  q: QueuedOrder,
  ownerId: string,
): Promise<{
  outcome: 'success' | 'dedup' | 'created_draft' | 'created_unknown' | 'error';
  error?: string;
  failureKind?: QueueFailureKind;
  orderId?: string;
}> => {
  if (q.ownerId !== ownerId || q.payload?.ownerId !== ownerId) {
    const error = 'owner_mismatch: a fila pertence a outro usuário';
    // Se o envelope pertence ao usuário atual, registra a corrupção do payload.
    // Envelope de outro usuário nunca é tocado por esta sessão.
    if (q.ownerId === ownerId) {
      await markAttemptFailed(ownerId, q.client_request_id, error, 'permanent');
    }
    return { outcome: 'error', error, failureKind: 'permanent' };
  }
  try {
    // O payload não pode mudar entre tentativa e replay: o hash idempotente do
    // servidor inclui o cabeçalho. A fila já nasce Rascunho e rejeita qualquer
    // outro status na entrada.
    if (q.payload.order.status !== MOBILE_SALE_ORDER_DRAFT_STATUS) {
      throw Object.assign(new Error('A fila contém pedido fora de Rascunho.'), {
        failureKind: 'permanent' as const,
      });
    }
    const created = await submitMobileSaleOrderAtomic(q.payload);
    // O CREATE já comitou: remova sua fila antes da confirmação. Se o comando
    // seguinte falhar, jamais repita/mude o payload idempotente da criação.
    await completeQueuedOrderCreate(ownerId, q.client_request_id);
    try {
      await confirmMobileSaleOrder(created.order_id);
      return { outcome: created.idempotent_replay ? 'dedup' : 'success', orderId: created.order_id };
    } catch (confirmationError: unknown) {
      const error = confirmationError instanceof Error
        ? confirmationError.message
        : String(confirmationError);
      const transient = classifyMobileOrderError(confirmationError) === 'transient';
      return {
        outcome: transient ? 'created_unknown' : 'created_draft',
        error,
        orderId: created.order_id,
      };
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const failureKind = classifyMobileOrderError(error);
    await markAttemptFailed(ownerId, q.client_request_id, message, failureKind);
    return { outcome: 'error', error: message, failureKind };
  }
};

export const triggerSync = async (ownerId: string): Promise<SyncResult | null> => {
  if (!ownerId?.trim() || syncInFlight) return null;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null;
  syncInFlight = true;

  const result: SyncResult = {
    succeeded: 0,
    failed: 0,
    skipped: 0,
    createdAsDraft: 0,
    confirmationUnknown: 0,
    errors: [],
    confirmationErrors: [],
  };
  try {
    const pending = await listPendingOrders(ownerId);
    for (const q of pending) {
      if (q.ownerId !== ownerId || q.payload?.ownerId !== ownerId) {
        result.failed++;
        result.errors.push({
          client_request_id: q.client_request_id,
          error: 'owner_mismatch',
          failureKind: 'permanent',
        });
        continue;
      }
      if (q.failureKind === 'permanent' || q.attempts >= MAX_ATTEMPTS) {
        result.failed++;
        result.errors.push({
          client_request_id: q.client_request_id,
          error: q.failureKind === 'permanent' ? (q.lastError || 'permanent_failure') : 'max_attempts_exceeded',
          failureKind: 'permanent',
        });
        continue;
      }
      const processed = await processOne(q, ownerId);
      if (processed.outcome === 'success') result.succeeded++;
      else if (processed.outcome === 'dedup') result.skipped++;
      else if (processed.outcome === 'created_draft' || processed.outcome === 'created_unknown') {
        if (processed.outcome === 'created_draft') result.createdAsDraft++;
        else result.confirmationUnknown++;
        result.confirmationErrors.push({
          client_request_id: q.client_request_id,
          order_id: processed.orderId || '',
          error: processed.error || 'Falha ao confirmar o PV criado.',
          outcome: processed.outcome === 'created_draft' ? 'draft' : 'unknown',
        });
      }
      else {
        result.failed++;
        result.errors.push({
          client_request_id: q.client_request_id,
          error: processed.error || 'unknown_error',
          failureKind: processed.failureKind || 'permanent',
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  } finally {
    syncInFlight = false;
  }
  return result;
};

export const installAutoSync = (
  ownerId: string,
  onResult?: (result: SyncResult) => void,
) => {
  if (typeof window === 'undefined' || !ownerId?.trim()) return () => {};
  const handler = () => {
    void triggerSync(ownerId).then((result) => {
      if (result) onResult?.(result);
    });
  };
  const visibilityHandler = () => {
    if (document.visibilityState === 'visible') handler();
  };
  window.addEventListener('online', handler);
  document.addEventListener('visibilitychange', visibilityHandler);
  const initialSyncTimer = window.setTimeout(handler, 1500);
  return () => {
    window.clearTimeout(initialSyncTimer);
    window.removeEventListener('online', handler);
    document.removeEventListener('visibilitychange', visibilityHandler);
  };
};
