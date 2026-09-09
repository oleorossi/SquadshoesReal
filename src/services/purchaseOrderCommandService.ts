import { supabase } from '@/integrations/supabase/client';

export type PurchaseOrderCommandName =
  | 'create'
  | 'append'
  | 'edit'
  | 'update'
  | 'cancel'
  | 'receive';

type PurchaseOrderAuxiliaryCommandName =
  | 'quotation'
  | 'quotation-winner'
  | 'mrp'
  | 'force-delete-product';

export interface PurchaseOrderCommandEnvelope {
  command: PurchaseOrderCommandName | PurchaseOrderAuxiliaryCommandName;
  payload: Record<string, unknown>;
  clientRequestId: string;
  purchaseOrderId: string | null;
  expectedUpdatedAt: string | null;
}

export interface ExecutePurchaseOrderCommandInput {
  command: PurchaseOrderCommandName;
  payload?: Record<string, unknown>;
  purchaseOrderId?: string | null;
  expectedUpdatedAt?: string | null;
  /** Chave da tentativa lógica. Enquanto não houver resposta confirmada, o
   * envelope inteiro fica no storage e sobrevive a reload/retry. */
  logicalKey: string;
}

export interface PurchaseOrderCommandResult {
  purchase_order_id: string;
  purchase_order?: Record<string, unknown>;
  receipt_id: string;
  client_request_id: string;
  request_hash: string;
  replayed: boolean;
  deduplicated?: boolean;
  items?: Array<Record<string, unknown>>;
  received_items?: Array<Record<string, unknown>>;
  movement_ids?: string[];
  complete?: boolean;
  payables_created?: number;
}

export interface PurchaseOrderBatchCommandResult {
  purchase_order_ids: string[];
  receipt_id: string;
  client_request_id: string;
  request_hash: string;
  replayed: boolean;
}

const STORAGE_KEY = 'squad.purchase-order-command.pending.v1';
const memoryPending = new Map<string, PurchaseOrderCommandEnvelope>();

function randomUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (token) => {
    const value = Math.floor(Math.random() * 16);
    const nibble = token === 'x' ? value : (value & 0x3) | 0x8;
    return nibble.toString(16);
  });
}

function readStored(): Record<string, PurchaseOrderCommandEnvelope> {
  if (typeof window === 'undefined') return Object.fromEntries(memoryPending);
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as Record<string, PurchaseOrderCommandEnvelope> : {};
  } catch {
    return {};
  }
}

function writeStored(value: Record<string, PurchaseOrderCommandEnvelope>): void {
  if (typeof window === 'undefined') {
    memoryPending.clear();
    for (const [key, envelope] of Object.entries(value)) memoryPending.set(key, envelope);
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage indisponível não impede o comando na sessão atual.
  }
}

function pendingEnvelope(
  logicalKey: string,
  input: Omit<ExecutePurchaseOrderCommandInput, 'command'> & {
    command: PurchaseOrderCommandName | PurchaseOrderAuxiliaryCommandName;
  },
): PurchaseOrderCommandEnvelope {
  const stored = readStored();
  const existing = stored[logicalKey];
  if (existing) {
    const sameCommand = existing.command === input.command;
    const samePayload = JSON.stringify(existing.payload) === JSON.stringify(input.payload ?? {});
    const samePurchaseOrder = existing.purchaseOrderId === (input.purchaseOrderId ?? null);
    const sameVersion = existing.expectedUpdatedAt === (input.expectedUpdatedAt ?? null);
    if (!sameCommand || !samePayload || !samePurchaseOrder || !sameVersion) {
      throw new Error(
        'Há uma tentativa pendente diferente para esta ação. Recarregue os dados antes de reenviar.',
      );
    }
    return existing;
  }
  const envelope: PurchaseOrderCommandEnvelope = {
    command: input.command,
    payload: input.payload ?? {},
    clientRequestId: randomUuid(),
    purchaseOrderId: input.purchaseOrderId ?? null,
    expectedUpdatedAt: input.expectedUpdatedAt ?? null,
  };
  stored[logicalKey] = envelope;
  writeStored(stored);
  return envelope;
}

function acknowledge(logicalKey: string): void {
  const stored = readStored();
  if (!(logicalKey in stored)) return;
  delete stored[logicalKey];
  writeStored(stored);
}

function throwCommandError(logicalKey: string, error: { code?: string }): never {
  // SQLSTATE confirma resposta/rollback do servidor; erro sem code pode ser
  // perda de resposta depois do commit e precisa preservar o mesmo UUID.
  if (typeof error?.code === 'string' && error.code.length > 0) {
    acknowledge(logicalKey);
  }
  throw error;
}

export async function executePurchaseOrderCommand(
  input: ExecutePurchaseOrderCommandInput,
): Promise<PurchaseOrderCommandResult> {
  const envelope = pendingEnvelope(input.logicalKey, input);
  const { data, error } = await supabase.rpc('execute_purchase_order_command' as never, {
    p_command: envelope.command,
    p_payload: envelope.payload,
    p_client_request_id: envelope.clientRequestId,
    p_purchase_order_id: envelope.purchaseOrderId,
    p_expected_updated_at: envelope.expectedUpdatedAt,
  } as never);
  if (error) {
    // Um erro PostgREST com SQLSTATE confirma que o servidor respondeu e que a
    // transação abortou: liberar o envelope permite corrigir payload/CAS. Falha
    // de transporte sem code permanece pendente e reusa o mesmo request UUID.
    throwCommandError(input.logicalKey, error);
  }
  acknowledge(input.logicalKey);
  return data as PurchaseOrderCommandResult;
}

export async function createPurchaseOrderFromQuotation(
  quotationId: string,
): Promise<PurchaseOrderCommandResult> {
  const logicalKey = purchaseOrderLogicalKey('quotation', quotationId);
  const envelope = pendingEnvelope(logicalKey, {
    command: 'quotation',
    payload: { quotation_id: quotationId },
    logicalKey,
  });
  const { data, error } = await supabase.rpc(
    'create_po_from_quotation_command' as never,
    {
      p_quotation_id: quotationId,
      p_client_request_id: envelope.clientRequestId,
    } as never,
  );
  if (error) throwCommandError(logicalKey, error);
  acknowledge(logicalKey);
  return data as PurchaseOrderCommandResult;
}

export async function generatePurchaseOrdersFromMrpCommand(
  productIds?: string[],
): Promise<PurchaseOrderBatchCommandResult> {
  const normalizedIds = [...new Set(productIds ?? [])].sort();
  const logicalKey = purchaseOrderLogicalKey(
    'mrp',
    normalizedIds.length > 0 ? normalizedIds.join(',') : 'all',
  );
  const envelope = pendingEnvelope(logicalKey, {
    command: 'mrp',
    payload: { product_ids: normalizedIds.length > 0 ? normalizedIds : null },
    logicalKey,
  });
  const { data, error } = await supabase.rpc(
    'generate_purchase_orders_from_mrp' as never,
    {
      p_product_ids: normalizedIds.length > 0 ? normalizedIds : null,
      p_client_request_id: envelope.clientRequestId,
    } as never,
  );
  if (error) throwCommandError(logicalKey, error);
  acknowledge(logicalKey);
  return data as PurchaseOrderBatchCommandResult;
}

export async function selectPurchaseQuotationWinner(input: {
  quotationId: string;
  responseId: string;
  expectedStatus: string;
  expectedSupplierId: string | null;
}): Promise<Record<string, unknown>> {
  const logicalKey = purchaseOrderLogicalKey(
    'quotation-winner',
    input.quotationId,
    input.responseId,
  );
  const envelope = pendingEnvelope(logicalKey, {
    command: 'quotation-winner',
    payload: {
      quotation_id: input.quotationId,
      response_id: input.responseId,
      expected_status: input.expectedStatus,
      expected_supplier_id: input.expectedSupplierId,
    },
    logicalKey,
  });
  const { data, error } = await supabase.rpc(
    'select_purchase_quotation_winner_command' as never,
    {
      p_quotation_id: input.quotationId,
      p_response_id: input.responseId,
      p_client_request_id: envelope.clientRequestId,
      p_expected_status: input.expectedStatus,
      p_expected_supplier_id: input.expectedSupplierId,
    } as never,
  );
  if (error) throwCommandError(logicalKey, error);
  acknowledge(logicalKey);
  return data as Record<string, unknown>;
}

export async function forceDeleteProductCommand(input: {
  productId: string;
  expectedUpdatedAt: string;
}): Promise<Record<string, unknown>> {
  const logicalKey = purchaseOrderLogicalKey('force-delete-product', input.productId);
  const envelope = pendingEnvelope(logicalKey, {
    command: 'force-delete-product',
    payload: {
      product_id: input.productId,
      expected_updated_at: input.expectedUpdatedAt,
    },
    logicalKey,
  });
  const { data, error } = await supabase.rpc(
    'force_delete_product_command' as never,
    {
      p_product_id: input.productId,
      p_client_request_id: envelope.clientRequestId,
      p_expected_updated_at: input.expectedUpdatedAt,
    } as never,
  );
  if (error) throwCommandError(logicalKey, error);
  acknowledge(logicalKey);
  return data as Record<string, unknown>;
}

export function purchaseOrderLogicalKey(
  action: string,
  ...parts: Array<string | number | boolean | null | undefined>
): string {
  return ['po', action, ...parts.map((part) => String(part ?? ''))].join(':');
}
