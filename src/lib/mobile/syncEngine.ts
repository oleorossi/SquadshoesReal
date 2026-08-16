/**
 * Sync engine: processa fila de PVs offline em ordem FIFO quando rede
 * volta. Idempotente — server dedup via `sale_orders.client_request_id`
 * UNIQUE index (mig 20260629260000).
 *
 * Disparado por:
 *   - `online` event (rede volta)
 *   - `visibilitychange` quando app vira foreground (cobre iOS quirks
 *     onde `online` demora)
 *   - chamada manual via `triggerSync()` (botão "Sincronizar agora")
 */
import {
  listPendingOrders,
  removeFromQueue,
  markAttemptFailed,
  type QueuedOrder,
} from './offlineQueue';
import { submitMobileSaleOrderAtomic } from './atomicSaleOrder';

const MAX_ATTEMPTS = 5;
interface SyncResult {
  succeeded: number;
  failed: number;
  skipped: number; // já existia no servidor (idempotência)
  errors: Array<{ client_request_id: string; error: string }>;
}

let syncInFlight = false;

/**
 * Processa um item da fila. Trata 3 cenários:
 *   1. Sucesso: insert OK → remove da fila
 *   2. Duplicata (23505): server já tem esse client_request_id → remove
 *      da fila (foi enviado antes em retry anterior, server salvou)
 *   3. Erro real: incrementa attempts, mantém na fila
 */
const processOne = async (q: QueuedOrder): Promise<'success' | 'dedup' | 'error'> => {
  try {
    const created = await submitMobileSaleOrderAtomic(q.payload);
    await removeFromQueue(q.client_request_id);
    return created.idempotent_replay ? 'dedup' : 'success';
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await markAttemptFailed(q.client_request_id, message);
    return 'error';
  }
};

export const triggerSync = async (): Promise<SyncResult | null> => {
  if (syncInFlight) return null;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null;
  syncInFlight = true;

  const result: SyncResult = { succeeded: 0, failed: 0, skipped: 0, errors: [] };
  try {
    const pending = await listPendingOrders();
    for (const q of pending) {
      if (q.attempts >= MAX_ATTEMPTS) {
        result.failed++;
        result.errors.push({ client_request_id: q.client_request_id, error: 'max_attempts_exceeded' });
        continue;
      }
      const outcome = await processOne(q);
      if (outcome === 'success') result.succeeded++;
      else if (outcome === 'dedup') result.skipped++;
      else result.failed++;

      // Pequeno delay entre items pra não saturar a rede móvel
      await new Promise(r => setTimeout(r, 200));
    }
  } finally {
    syncInFlight = false;
  }
  return result;
};

/**
 * Instala listeners globais que disparam sync automaticamente.
 * Chamar uma vez no boot do app mobile (MobileLayout.tsx).
 */
export const installAutoSync = () => {
  if (typeof window === 'undefined') return () => {};
  const handler = () => { void triggerSync(); };
  const visibilityHandler = () => {
    if (document.visibilityState === 'visible') handler();
  };
  window.addEventListener('online', handler);
  document.addEventListener('visibilitychange', visibilityHandler);
  // Tenta logo na inicialização caso já tenha itens pendentes de sessão anterior
  setTimeout(handler, 1500);
  return () => {
    window.removeEventListener('online', handler);
    document.removeEventListener('visibilitychange', visibilityHandler);
  };
};
