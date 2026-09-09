import { supabase } from '@/integrations/supabase/client';
import {
  clientCommercialBlockMessage,
  fetchClientSalesContext,
} from './clientContext';
import {
  MOBILE_SALE_ORDER_DRAFT_STATUS,
  type PendingOrderPayload,
  type QueueFailureKind,
} from './offlineQueue';
import { createSaleOrderCommand } from '@/lib/saleOrderCommand';

export interface AtomicSaleOrderResult {
  order_id: string;
  item_ids: string[];
  idempotent_replay: boolean;
  receipt_warning?: string;
}

export class MobileOrderSubmissionError extends Error {
  readonly failureKind: QueueFailureKind;
  readonly code: string;

  constructor(message: string, failureKind: QueueFailureKind, code: string) {
    super(message);
    this.name = 'MobileOrderSubmissionError';
    this.failureKind = failureKind;
    this.code = code;
  }
}

export function mobileSaleOrderCreateIdempotencyKey(clientRequestId: string): string {
  return `pv:create:${clientRequestId}`;
}

const errorRecord = (error: unknown): Record<string, unknown> =>
  error && typeof error === 'object' ? error as Record<string, unknown> : {};

export function classifyMobileOrderError(error: unknown): QueueFailureKind {
  if (error instanceof MobileOrderSubmissionError) return error.failureKind;
  const record = errorRecord(error);
  const receipt = errorRecord(record.receipt);
  const receiptError = errorRecord(receipt.error);
  const code = String(record.code || receiptError.code || '').toUpperCase();
  const status = Number(record.status || record.statusCode || 0);
  const message = [
    error instanceof Error ? error.message : String(error || ''),
    record.message,
    record.details,
    record.hint,
    receiptError.message,
  ].filter(Boolean).join(' ').toLowerCase();

  if (error instanceof TypeError
      || /network|failed to fetch|fetch failed|offline|timeout|timed out|connection|socket/.test(message)
      || ['COMMAND_IN_PROGRESS', 'PGRST000', 'PGRST001', 'PGRST002', '57014', '53300'].includes(code)
      || [408, 425, 429, 500, 502, 503, 504].includes(status)) {
    return 'transient';
  }
  // Erro desconhecido não deve entrar em loop infinito: somente evidência de
  // transporte/indisponibilidade recebe retry automático.
  return 'permanent';
}

function wrapReadError(label: string, error: unknown): MobileOrderSubmissionError {
  const record = errorRecord(error);
  const detail = error instanceof Error
    ? error.message
    : String(record.message || record.details || error || 'erro desconhecido');
  return new MobileOrderSubmissionError(
    `${label}: ${detail}`,
    classifyMobileOrderError(error),
    'READINESS_UNAVAILABLE',
  );
}

/**
 * Revalida sessão, política, tabela, ficha publicada e variante imediatamente
 * antes do writer atômico. O replay offline passa pela mesma barreira do envio
 * online; cache local nunca vira autorização comercial.
 */
export async function assertMobileOrderReadiness(payload: PendingOrderPayload): Promise<void> {
  if (!payload.ownerId?.trim()) {
    throw new MobileOrderSubmissionError('Pedido sem proprietário autenticado.', 'permanent', 'OWNER_REQUIRED');
  }
  const clientId = payload.client_id || payload.order.client_id || null;
  if (!clientId) {
    throw new MobileOrderSubmissionError('Selecione um cliente cadastrado.', 'permanent', 'CLIENT_REQUIRED');
  }

  let currentUserId: string | null = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    currentUserId = data.user?.id || null;
  } catch (error) {
    throw wrapReadError('Não foi possível confirmar a sessão do vendedor', error);
  }
  if (!currentUserId || currentUserId !== payload.ownerId) {
    throw new MobileOrderSubmissionError(
      'A fila pertence a outro usuário. Entre com o vendedor que criou este rascunho.',
      'permanent',
      'OWNER_MISMATCH',
    );
  }

  try {
    const { commercialDefaults, priceLookup } = await fetchClientSalesContext(clientId);
    if (commercialDefaults.block_new_orders) {
      throw new MobileOrderSubmissionError(
        clientCommercialBlockMessage(commercialDefaults),
        'permanent',
        'CLIENT_BLOCKED',
      );
    }
    if (priceLookup.context && !priceLookup.context.effective) {
      throw new MobileOrderSubmissionError(
        `A tabela de preços “${priceLookup.context.name}” não está vigente. Corrija o cadastro antes de enviar o pedido.`,
        'permanent',
        'PRICE_LIST_INVALID',
      );
    }
  } catch (error) {
    if (error instanceof MobileOrderSubmissionError) throw error;
    throw wrapReadError('Não foi possível validar política e tabela de preços', error);
  }

  const referenceIds = [...new Set(payload.items.map((item) => item.reference_id).filter(Boolean))];
  if (referenceIds.length === 0) {
    throw new MobileOrderSubmissionError('Adicione ao menos uma referência.', 'permanent', 'REFERENCE_REQUIRED');
  }
  const { data: sheets, error: sheetsError } = await supabase
    .from('technical_sheets')
    .select('id, status_ficha')
    .in('id', referenceIds);
  if (sheetsError) throw wrapReadError('Não foi possível validar as fichas técnicas', sheetsError);
  const publishedIds = new Set(
    (sheets || [])
      .filter((sheet) => String(sheet.status_ficha || '').toLowerCase() === 'publicada')
      .map((sheet) => sheet.id),
  );
  const unavailableReference = referenceIds.find((referenceId) => !publishedIds.has(referenceId));
  if (unavailableReference) {
    throw new MobileOrderSubmissionError(
      'Uma referência do pedido não possui ficha publicada. Atualize o catálogo e revise os itens.',
      'permanent',
      'TECHNICAL_SHEET_NOT_PUBLISHED',
    );
  }

  const variantIds = [...new Set(payload.items
    .map((item) => item.material_variant_id)
    .filter(Boolean))] as string[];
  if (variantIds.length === 0) return; // material da própria ficha é escolha válida

  const { data: variants, error: variantsError } = await supabase
    .from('reference_material_variants')
    .select('id, reference_id, active')
    .in('id', variantIds);
  if (variantsError) throw wrapReadError('Não foi possível validar as variantes de material', variantsError);
  const variantById = new Map((variants || []).map((variant) => [variant.id, variant]));
  const invalidVariant = payload.items.find((item) => {
    if (!item.material_variant_id) return false;
    const variant = variantById.get(item.material_variant_id);
    return !variant || variant.active === false || variant.reference_id !== item.reference_id;
  });
  if (invalidVariant) {
    throw new MobileOrderSubmissionError(
      'Uma variante de material não está mais ativa ou não pertence à referência selecionada.',
      'permanent',
      'MATERIAL_VARIANT_INVALID',
    );
  }
}

/**
 * Único escritor do PV mobile, tanto online quanto no replay da fila. A RPC
 * confirma cabeçalho + todos os itens na mesma transação.
 */
export async function submitMobileSaleOrderAtomic(payload: PendingOrderPayload) {
  if (payload.order.status !== MOBILE_SALE_ORDER_DRAFT_STATUS) {
    throw new MobileOrderSubmissionError(
      'O writer mobile cria somente Rascunho; confirmação exige o comando canônico.',
      'permanent',
      'DRAFT_STATUS_REQUIRED',
    );
  }
  await assertMobileOrderReadiness(payload);
  const total = payload.items.reduce(
    (sum, item) => sum + (Number(item.unit_price) || 0) * (Number(item.quantity) || 0),
    0,
  );
  const header = {
    ...payload.order,
    total,
    client_id: payload.client_id ?? payload.order.client_id ?? null,
    representative_id: payload.representative_id ?? null,
  };
  const receipt = await createSaleOrderCommand<{ item_ids?: string[] }>({
    header,
    items: payload.items,
    idempotencyKey: mobileSaleOrderCreateIdempotencyKey(payload.order.client_request_id),
    clientRequestId: payload.order.client_request_id,
  });
  const itemIds = Array.isArray(receipt.result.item_ids) ? receipt.result.item_ids : [];
  const result: AtomicSaleOrderResult = {
    order_id: receipt.sale_order_id,
    item_ids: itemIds,
    idempotent_replay: receipt.replayed,
  };
  if (result.item_ids.length !== payload.items.length) {
    // `ok=true` + sale_order_id é recibo definitivo do CREATE transacional.
    // Divergência no resumo de ids é um problema de observabilidade, não licença
    // para reenfileirar/recriar com outro UUID (isso duplicaria o PV já commitado).
    result.receipt_warning =
      `O servidor confirmou o PV, mas resumiu ${result.item_ids.length} de ${payload.items.length} item(ns) no recibo.`;
    console.warn('[submitMobileSaleOrderAtomic]', result.receipt_warning);
  }
  return result;
}
