import { supabase } from '@/integrations/supabase/client';
import { describePostgrestError } from '@/lib/postgrestErrors';

export type SaleOrderCommandAction =
  | 'update'
  | 'confirm'
  | 'promote'
  | 'resync'
  | 'cancel'
  | 'transition'
  | 'billing'
  | 'factoring';
export type SaleOrderCommandName = 'create' | SaleOrderCommandAction;

export interface SaleOrderCommandIssue {
  code: string;
  message: string;
  scope?: string | null;
  category?: string | null;
  item_id?: string | null;
  reference_id?: string | null;
  overrideable?: boolean;
  details?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface SaleOrderMaterialPlanSummary {
  revision_id?: string | null;
  source_hash?: string | null;
  items?: unknown[];
  issues?: SaleOrderCommandIssue[];
  warnings?: SaleOrderCommandIssue[];
  [key: string]: unknown;
}

export interface SaleOrderCommandReadiness {
  ready: boolean;
  blockers: SaleOrderCommandIssue[];
  warnings: SaleOrderCommandIssue[];
  order_version: number;
  material_plan_revision_id: string | null;
  source_hash?: string | null;
  gate_enabled?: boolean;
  expected_order_version?: number | null;
  override?: Record<string, unknown> | null;
  material_plan?: SaleOrderMaterialPlanSummary | null;
  [key: string]: unknown;
}

export interface SaleOrderCommandPreflight extends SaleOrderCommandReadiness {
  sale_order_id: string;
  command: SaleOrderCommandAction;
  override_id?: string | null;
}

export interface SaleOrderCommandReceipt<TResult = Record<string, unknown>> {
  ok: boolean;
  replayed: boolean;
  receipt_id: string;
  sale_order_id: string;
  command: SaleOrderCommandAction;
  previous_order_version: number;
  order_version: number;
  material_plan_revision_id: string | null;
  result: TResult;
  readiness: SaleOrderCommandReadiness;
  error?: {
    code?: string | null;
    message?: string | null;
    detail?: string | null;
  } | null;
}

export interface CreateSaleOrderCommandReceipt<TResult = Record<string, unknown>> {
  ok: boolean;
  replayed: boolean;
  receipt_id: string;
  sale_order_id: string;
  command: 'create';
  order_version: number;
  result: TResult;
  error?: SaleOrderCommandReceipt['error'];
}

interface ExecuteSaleOrderCommandInput {
  saleOrderId: string;
  command: SaleOrderCommandAction;
  expectedOrderVersion: number;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
  overrideId?: string | null;
}

interface PreflightSaleOrderCommandInput {
  saleOrderId: string;
  command: SaleOrderCommandAction;
  expectedOrderVersion?: number | null;
  overrideId?: string | null;
  payload?: Record<string, unknown>;
}

interface CreateSaleOrderCommandInput {
  header: Record<string, unknown>;
  items: unknown[];
  idempotencyKey: string;
  clientRequestId: string;
}

export class SaleOrderReadinessBlockedError extends Error {
  readonly preflight: SaleOrderCommandPreflight;

  constructor(preflight: SaleOrderCommandPreflight) {
    const summary = preflight.blockers
      .slice(0, 4)
      .map((issue) => issue.message)
      .join('; ');
    const remaining = Math.max(0, preflight.blockers.length - 4);
    super(
      `Pedido ainda não está pronto: ${summary || 'há pendências obrigatórias'}` +
      (remaining > 0 ? `; e mais ${remaining}.` : '.'),
    );
    this.name = 'SaleOrderReadinessBlockedError';
    this.preflight = preflight;
  }
}

export class SaleOrderCommandExecutionError extends Error {
  readonly receipt: SaleOrderCommandReceipt<unknown> | CreateSaleOrderCommandReceipt<unknown>;

  constructor(receipt: SaleOrderCommandReceipt<unknown> | CreateSaleOrderCommandReceipt<unknown>) {
    super(formatSaleOrderCommandFailureMessage(receipt));
    this.name = 'SaleOrderCommandExecutionError';
    this.receipt = receipt;
  }
}

/** Resumo do que o writer fez com itens removidos do payload. */
export interface SaleOrderFinalizeRemovedSummary {
  removed_items: number;
  preserved_items: number;
  cancelled_strap_demands: number;
  cancelled_purchase_contributions: number;
}

export function readFinalizeRemovedSummary(
  result: Record<string, unknown> | null | undefined,
): SaleOrderFinalizeRemovedSummary | null {
  if (!result) return null;
  const raw = result.finalize_removed;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const finalize = raw as Record<string, unknown>;
  return {
    removed_items: Number(finalize.removed_items) || 0,
    preserved_items: Number(finalize.preserved_items) || 0,
    cancelled_strap_demands: Number(finalize.cancelled_strap_demands) || 0,
    cancelled_purchase_contributions: Number(finalize.cancelled_purchase_contributions) || 0,
  };
}

/**
 * Quantos itens carregados sumiram do payload enviado.
 * Usado pra detectar regressão em que o cliente reanexa itens apagados
 * (PV-00169 / retainLoadedSaleOrderItemsForUpdate).
 */
export function countExpectedRemovedSaleOrderItems(
  loadedItemIds: readonly string[],
  payloadItemIds: readonly (string | null | undefined)[],
): number {
  const sent = new Set(
    payloadItemIds.filter((id): id is string => typeof id === 'string' && id.length > 0),
  );
  let missing = 0;
  for (const id of loadedItemIds) {
    if (typeof id === 'string' && id.length > 0 && !sent.has(id)) missing += 1;
  }
  return missing;
}

/**
 * Se o editor tirou N itens do payload mas o writer reportou 0 remoções/
 * preservações, o save mentiu — típico de reanexo silencioso no cliente.
 */
export function assertFinalizeAppliedExpectedRemovals(
  expectedRemoved: number,
  finalize: SaleOrderFinalizeRemovedSummary | null | undefined,
): void {
  const expected = Math.max(0, Number(expectedRemoved) || 0);
  if (expected <= 0) return;
  const applied = (finalize?.removed_items || 0) + (finalize?.preserved_items || 0);
  if (applied > 0) return;
  throw new Error(
    `Remoção de ${expected} modelo(s) não persistiu no servidor (finalize_removed=0/0). ` +
    'Recarregue o PV e tente novamente — o pedido NÃO refletiu a exclusão.',
  );
}

/** Toast de sucesso honesto: distingue hard-delete de retirada produtiva. */
export function formatSaleOrderUpdateSuccessMessage(
  finalize: SaleOrderFinalizeRemovedSummary | null | undefined,
): { title: string; description?: string } {
  if (!finalize || (finalize.removed_items === 0 && finalize.preserved_items === 0)) {
    return { title: 'Pedido atualizado e OPs sincronizadas!' };
  }
  const parts: string[] = [];
  if (finalize.removed_items > 0) {
    parts.push(
      `${finalize.removed_items} item${finalize.removed_items === 1 ? '' : 's'} removido${finalize.removed_items === 1 ? '' : 's'}`,
    );
  }
  if (finalize.preserved_items > 0) {
    parts.push(
      `${finalize.preserved_items} retirado${finalize.preserved_items === 1 ? '' : 's'} da produção (histórico de tira preservado)`,
    );
  }
  const extras: string[] = [];
  if (finalize.cancelled_strap_demands > 0) {
    extras.push(`${finalize.cancelled_strap_demands} demanda(s) de tira cancelada(s)`);
  }
  if (finalize.cancelled_purchase_contributions > 0) {
    extras.push(`${finalize.cancelled_purchase_contributions} contribuição(ões) de compra cancelada(s)`);
  }
  return {
    title: `Pedido atualizado — ${parts.join(' · ')}`,
    description: extras.length > 0 ? extras.join(' · ') : undefined,
  };
}

/**
 * Mensagem acionável a partir do receipt/erro cru (FK Postgres → pt-BR).
 * Inclui `detail` quando o MESSAGE_TEXT sozinho é opaco.
 */
export function formatSaleOrderCommandFailureMessage(
  receipt: SaleOrderCommandReceipt<unknown> | CreateSaleOrderCommandReceipt<unknown> | null | undefined,
  fallback?: string,
): string {
  const err = receipt?.error;
  const message = err?.message?.trim() || '';
  const detail = err?.detail?.trim() || '';
  const code = err?.code?.trim() || '';
  const haystack = `${message}\n${detail}\n${fallback || ''}`.toLowerCase();

  if (
    haystack.includes('sale_order_strap_demands')
    || haystack.includes('demanda de tira')
    || (code === '23503' && haystack.includes('strap_demand'))
  ) {
    return (
      'Não foi possível remover o(s) modelo(s): ainda há demanda de tira vinculada. ' +
      'O pedido NÃO foi salvo. Libere o compromisso de tira ou tente novamente após o processamento.'
    );
  }
  // Antes do match genérico de purchase_demand_contributions: o 23503 do DELETE
  // de purchase_order_items cita a tabela de contribuições no texto do FK.
  if (
    (code === '23503' && (
      haystack.includes('purchase_order_items')
      || haystack.includes('purchase_demand_contributions_purchase_order_item_id_fkey')
    ))
    || haystack.includes('purchase_order_item_id_fkey')
  ) {
    return (
      'Não foi possível remover o(s) modelo(s): a OC de tira ainda referencia a contribuição. ' +
      'O pedido NÃO foi salvo. Tente novamente após o processamento; se persistir, avise o suporte.'
    );
  }
  if (haystack.includes('itens e snapshots de oc aprovada sao imutaveis')) {
    return (
      'Não foi possível ajustar a OC de tira vinculada ao item removido (OC já travada). ' +
      'O pedido NÃO foi salvo.'
    );
  }
  if (
    haystack.includes('purchase_demand_contributions')
    || haystack.includes('contribuicao de compra')
    || haystack.includes('contribuição de compra')
  ) {
    return (
      'Não foi possível remover o(s) modelo(s): há contribuição de compra de tira ativa. ' +
      'O pedido NÃO foi salvo. Cancele a contribuição ou use a retirada produtiva.'
    );
  }
  if (message) {
    const withDetail = detail && !message.includes(detail) ? `${message} (${detail})` : message;
    return withDetail.startsWith('O pedido NÃO')
      ? withDetail
      : `O pedido NÃO foi salvo. ${withDetail}`;
  }
  return fallback || 'O servidor recusou a edição do pedido. Nenhuma alteração foi gravada.';
}

export function formatUnknownSaleOrderUpdateError(error: unknown): string {
  if (error instanceof SaleOrderCommandExecutionError) {
    return error.message;
  }
  if (error instanceof SaleOrderReadinessBlockedError) {
    return `O pedido NÃO foi salvo. ${error.message}`;
  }
  if (error instanceof Error && error.message.trim()) {
    return formatSaleOrderCommandFailureMessage(
      null,
      `O pedido NÃO foi salvo. ${error.message.trim()}`,
    );
  }
  // PostgREST devolve plain object { message, details, code } — não é Error.
  // Sem isto o modal de cancelar OPs mostra só "O servidor recusou a edição".
  const described = describePostgrestError(error, '').trim();
  if (described) {
    return formatSaleOrderCommandFailureMessage(
      null,
      `O pedido NÃO foi salvo. ${described}`,
    );
  }
  return 'O pedido NÃO foi salvo. O servidor recusou a edição.';
}

/**
 * O conflito pode ser detectado no preflight do navegador ou novamente pelo
 * writer, se outra transação vencer a corrida entre as duas chamadas.
 */
export function isStaleSaleOrderVersionError(error: unknown): boolean {
  if (error instanceof SaleOrderReadinessBlockedError) {
    return error.preflight.blockers.some(
      (blocker) => blocker.code === 'stale_order_version',
    );
  }
  if (
    error instanceof SaleOrderCommandExecutionError
    && 'readiness' in error.receipt
  ) {
    return error.receipt.readiness.blockers.some(
      (blocker) => blocker.code === 'stale_order_version',
    );
  }
  return false;
}

const asRecord = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
);

const asIssues = (value: unknown): SaleOrderCommandIssue[] => {
  if (!Array.isArray(value)) return [];
  return value.map((raw, index) => {
    const issue = asRecord(raw);
    return {
      ...issue,
      code: String(issue.code || `unknown_${index + 1}`),
      message: String(issue.message || issue.detail || issue.code || 'Pendência sem descrição'),
      scope: issue.scope == null ? null : String(issue.scope),
      category: issue.category == null ? null : String(issue.category),
      item_id: issue.item_id == null ? null : String(issue.item_id),
      reference_id: issue.reference_id == null ? null : String(issue.reference_id),
      overrideable: Boolean(issue.overrideable ?? issue.overridable),
      details: asRecord(issue.details),
    };
  });
};

export function normalizeSaleOrderReadiness(value: unknown): SaleOrderCommandReadiness {
  const raw = asRecord(value);
  const blockers = asIssues(raw.blockers);
  const warnings = asIssues(raw.warnings);
  const materialPlan = raw.material_plan == null ? null : asRecord(raw.material_plan);
  return {
    ...raw,
    // Readiness é autorização positiva do servidor. Envelope truncado/legado
    // sem `ready: true` nunca pode virar liberação só porque também perdeu a
    // lista de blockers.
    ready: raw.ready === true,
    blockers,
    warnings,
    order_version: Number(raw.order_version) || 0,
    material_plan_revision_id: raw.material_plan_revision_id || materialPlan?.revision_id
      ? String(raw.material_plan_revision_id || materialPlan?.revision_id)
      : null,
    source_hash: raw.source_hash || materialPlan?.source_hash
      ? String(raw.source_hash || materialPlan?.source_hash)
      : null,
    gate_enabled: raw.gate_enabled !== false,
    expected_order_version: raw.expected_order_version == null
      ? null
      : Number(raw.expected_order_version),
    override: raw.override == null ? null : asRecord(raw.override),
    material_plan: materialPlan == null
      ? null
      : {
        ...materialPlan,
        issues: asIssues(materialPlan.issues),
        warnings: asIssues(materialPlan.warnings),
      },
  };
}

export function normalizeSaleOrderCommandPreflight(
  value: unknown,
  fallback: Pick<PreflightSaleOrderCommandInput, 'saleOrderId' | 'command'>,
): SaleOrderCommandPreflight {
  const raw = asRecord(value);
  return {
    ...normalizeSaleOrderReadiness(raw.readiness ?? raw),
    sale_order_id: String(raw.sale_order_id || fallback.saleOrderId),
    command: (raw.command || fallback.command) as SaleOrderCommandAction,
    override_id: raw.override_id ? String(raw.override_id) : null,
  };
}

export function normalizeSaleOrderCommandReceipt<TResult = Record<string, unknown>>(
  value: unknown,
): SaleOrderCommandReceipt<TResult> {
  const raw = asRecord(value);
  const required = ['receipt_id', 'sale_order_id', 'command'];
  const missing = required.filter((field) => !raw[field]);
  if (missing.length > 0) {
    throw new Error(`Resposta inválida do comando de PV: faltando ${missing.join(', ')}.`);
  }
  const receiptError = raw.error == null ? null : asRecord(raw.error);

  return {
    // Recibo só é sucesso com confirmação positiva explícita. `undefined`
    // pode ser resposta truncada/proxy incompatível e deve falhar fechado.
    ok: raw.ok === true,
    replayed: Boolean(raw.replayed ?? raw.idempotent_replay),
    receipt_id: String(raw.receipt_id),
    sale_order_id: String(raw.sale_order_id),
    command: raw.command as SaleOrderCommandAction,
    previous_order_version: Number(raw.previous_order_version ?? raw.order_version_before) || 0,
    order_version: Number(raw.order_version ?? raw.order_version_after) || 0,
    material_plan_revision_id: raw.material_plan_revision_id
      ? String(raw.material_plan_revision_id)
      : null,
    result: asRecord(raw.result) as TResult,
    readiness: normalizeSaleOrderReadiness(raw.readiness ?? raw.preflight),
    error: receiptError == null ? null : {
      code: receiptError.code == null ? null : String(receiptError.code),
      message: receiptError.message == null ? null : String(receiptError.message),
      detail: receiptError.detail == null ? null : String(receiptError.detail),
    },
  };
}

export function normalizeCreateSaleOrderCommandReceipt<TResult = Record<string, unknown>>(
  value: unknown,
): CreateSaleOrderCommandReceipt<TResult> {
  const raw = asRecord(value);
  const required = ['receipt_id', 'command'];
  const missing = required.filter((field) => !raw[field]);
  if (missing.length > 0) {
    throw new Error(`Resposta inválida do comando create: faltando ${missing.join(', ')}.`);
  }
  const receiptError = raw.error == null ? null : asRecord(raw.error);
  const receipt: CreateSaleOrderCommandReceipt<TResult> = {
    ok: raw.ok === true,
    replayed: Boolean(raw.replayed ?? raw.idempotent_replay),
    receipt_id: String(raw.receipt_id),
    sale_order_id: raw.sale_order_id ? String(raw.sale_order_id) : '',
    command: 'create',
    order_version: Number(raw.order_version ?? raw.order_version_after) || 0,
    result: asRecord(raw.result) as TResult,
    error: receiptError == null ? null : {
      code: receiptError.code == null ? null : String(receiptError.code),
      message: receiptError.message == null ? null : String(receiptError.message),
      detail: receiptError.detail == null ? null : String(receiptError.detail),
    },
  };
  if (receipt.ok && !receipt.sale_order_id) {
    throw new Error('Resposta inválida do comando create: faltando sale_order_id.');
  }
  return receipt;
}

export async function preflightSaleOrderCommand(
  input: PreflightSaleOrderCommandInput,
): Promise<SaleOrderCommandPreflight> {
  const { data, error } = await supabase.rpc('preflight_sale_order_command' as never, {
    p_sale_order_id: input.saleOrderId,
    p_command: input.command,
    p_expected_order_version: input.expectedOrderVersion ?? null,
    p_override_id: input.overrideId ?? null,
    p_payload: input.payload ?? {},
  } as never);
  if (error) throw error;
  return normalizeSaleOrderCommandPreflight(data, input);
}

export async function executeSaleOrderCommand<TResult = Record<string, unknown>>(
  input: ExecuteSaleOrderCommandInput,
): Promise<SaleOrderCommandReceipt<TResult>> {
  const { data, error } = await supabase.rpc('execute_sale_order_command' as never, {
    p_sale_order_id: input.saleOrderId,
    p_command: input.command,
    p_expected_order_version: input.expectedOrderVersion,
    p_idempotency_key: input.idempotencyKey,
    p_payload: input.payload ?? {},
    p_override_id: input.overrideId ?? null,
  } as never);
  if (error) throw error;
  const receipt = normalizeSaleOrderCommandReceipt<TResult>(data);
  if (!receipt.ok) throw new SaleOrderCommandExecutionError(receipt);
  return receipt;
}

export async function createSaleOrderCommand<TResult = Record<string, unknown>>(
  input: CreateSaleOrderCommandInput,
): Promise<CreateSaleOrderCommandReceipt<TResult>> {
  const { data, error } = await supabase.rpc('create_sale_order_command' as never, {
    p_header: input.header,
    p_items: input.items,
    p_idempotency_key: input.idempotencyKey,
    p_client_request_id: input.clientRequestId,
  } as never);
  if (error) throw error;
  const receipt = normalizeCreateSaleOrderCommandReceipt<TResult>(data);
  if (!receipt.ok) throw new SaleOrderCommandExecutionError(receipt);
  return receipt;
}

export async function createSaleOrderReadinessOverride(input: {
  saleOrderId: string;
  command: SaleOrderCommandAction;
  justification: string;
}): Promise<string> {
  const justification = input.justification.trim();
  if (!justification) {
    throw new Error('A justificativa do override é obrigatória.');
  }

  const { data, error } = await supabase.rpc('create_sale_order_readiness_override' as never, {
    p_sale_order_id: input.saleOrderId,
    p_command: input.command,
    p_justification: justification,
  } as never);
  if (error) throw error;
  if (!data) throw new Error('O servidor não retornou o identificador do override.');
  return String(data);
}
