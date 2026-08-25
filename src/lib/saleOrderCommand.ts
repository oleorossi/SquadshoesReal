import { supabase } from '@/integrations/supabase/client';

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
    const serverMessage = receipt.error?.message?.trim();
    super(serverMessage || `O comando ${receipt.command} do pedido foi recusado pelo servidor.`);
    this.name = 'SaleOrderCommandExecutionError';
    this.receipt = receipt;
  }
}

const asRecord = (value: unknown): Record<string, any> => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
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
    error: raw.error == null ? null : {
      code: raw.error.code == null ? null : String(raw.error.code),
      message: raw.error.message == null ? null : String(raw.error.message),
      detail: raw.error.detail == null ? null : String(raw.error.detail),
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
  const receipt: CreateSaleOrderCommandReceipt<TResult> = {
    ok: raw.ok === true,
    replayed: Boolean(raw.replayed ?? raw.idempotent_replay),
    receipt_id: String(raw.receipt_id),
    sale_order_id: raw.sale_order_id ? String(raw.sale_order_id) : '',
    command: 'create',
    order_version: Number(raw.order_version ?? raw.order_version_after) || 0,
    result: asRecord(raw.result) as TResult,
    error: raw.error == null ? null : {
      code: raw.error.code == null ? null : String(raw.error.code),
      message: raw.error.message == null ? null : String(raw.error.message),
      detail: raw.error.detail == null ? null : String(raw.error.detail),
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
  const { data, error } = await (supabase as any).rpc('preflight_sale_order_command', {
    p_sale_order_id: input.saleOrderId,
    p_command: input.command,
    p_expected_order_version: input.expectedOrderVersion ?? null,
    p_override_id: input.overrideId ?? null,
    p_payload: input.payload ?? {},
  });
  if (error) throw error;
  return normalizeSaleOrderCommandPreflight(data, input);
}

export async function executeSaleOrderCommand<TResult = Record<string, unknown>>(
  input: ExecuteSaleOrderCommandInput,
): Promise<SaleOrderCommandReceipt<TResult>> {
  const { data, error } = await (supabase as any).rpc('execute_sale_order_command', {
    p_sale_order_id: input.saleOrderId,
    p_command: input.command,
    p_expected_order_version: input.expectedOrderVersion,
    p_idempotency_key: input.idempotencyKey,
    p_payload: input.payload ?? {},
    p_override_id: input.overrideId ?? null,
  });
  if (error) throw error;
  const receipt = normalizeSaleOrderCommandReceipt<TResult>(data);
  if (!receipt.ok) throw new SaleOrderCommandExecutionError(receipt);
  return receipt;
}

export async function createSaleOrderCommand<TResult = Record<string, unknown>>(
  input: CreateSaleOrderCommandInput,
): Promise<CreateSaleOrderCommandReceipt<TResult>> {
  const { data, error } = await (supabase as any).rpc('create_sale_order_command', {
    p_header: input.header,
    p_items: input.items,
    p_idempotency_key: input.idempotencyKey,
    p_client_request_id: input.clientRequestId,
  });
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

  const { data, error } = await (supabase as any).rpc('create_sale_order_readiness_override', {
    p_sale_order_id: input.saleOrderId,
    p_command: input.command,
    p_justification: justification,
  });
  if (error) throw error;
  if (!data) throw new Error('O servidor não retornou o identificador do override.');
  return String(data);
}
