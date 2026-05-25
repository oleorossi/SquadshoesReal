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
import { supabase } from '@/integrations/supabase/client';
import {
  listPendingOrders,
  removeFromQueue,
  markAttemptFailed,
  type QueuedOrder,
} from './offlineQueue';

const MAX_ATTEMPTS = 5;
const SUPABASE_DUPLICATE_CODE = '23505'; // unique_violation

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
    const { order, items, client_id, representative_id } = q.payload;

    // Insert PV
    const total = items.reduce((s, i) => s + (Number(i.unit_price) || 0) * (Number(i.quantity) || 0), 0);
    const insertData: any = {
      ...order,
      total,
      client_id: client_id ?? null,
      representative_id: representative_id ?? null,
    };
    const { data: created, error: pvError } = await supabase
      .from('sale_orders')
      .insert(insertData)
      .select()
      .single();

    if (pvError) {
      // Duplicata por client_request_id UNIQUE — server já tem
      if (pvError.code === SUPABASE_DUPLICATE_CODE && pvError.message?.includes('client_request_id')) {
        return 'dedup';
      }
      await markAttemptFailed(q.client_request_id, pvError.message);
      return 'error';
    }

    // Insert items
    if (items.length > 0 && created?.id) {
      const itemsToInsert = items.map(it => ({
        ...it,
        sale_order_id: created.id,
      }));
      const { error: itemsError } = await supabase
        .from('sale_order_items')
        .insert(itemsToInsert);
      if (itemsError) {
        // PV criou mas items falharam — situação delicada. Logamos e mantemos
        // na fila pra retry manual (admin precisa intervir — não tentamos
        // deletar PV pra não cascatear danos).
        await markAttemptFailed(q.client_request_id, `Items insert: ${itemsError.message}`);
        return 'error';
      }
    }

    await removeFromQueue(q.client_request_id);
    return 'success';
  } catch (e: any) {
    await markAttemptFailed(q.client_request_id, e?.message ?? String(e));
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
  window.addEventListener('online', handler);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') handler();
  });
  // Tenta logo na inicialização caso já tenha itens pendentes de sessão anterior
  setTimeout(handler, 1500);
  return () => {
    window.removeEventListener('online', handler);
    // visibilitychange listener fica — é cheap
  };
};
