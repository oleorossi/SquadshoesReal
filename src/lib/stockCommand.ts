import { supabase } from '@/integrations/supabase/client';

export type StockGrade = Record<string, unknown>;

export interface StockCommandResponse {
  success: boolean;
  replayed: boolean;
  receipt_id: string;
  client_request_id: string;
  command: string;
  applied?: number;
  product_id?: string;
  errors?: StockCommandErrorItem[];
  results?: Array<Record<string, unknown>>;
}

export interface StockCommandErrorItem {
  product_id?: string | null;
  ready_stock_id?: string | null;
  error: string;
  current_db_qty?: number | null;
}

export interface ProductStockAdjustment {
  product_id: string;
  expected_previous_qty: number;
  new_qty: number;
  reason: string;
  expected_grade?: StockGrade | null;
  new_grade?: StockGrade | null;
  order_id?: string | null;
  enforce_reserved?: boolean;
  lot_number?: string | null;
  responsible?: string | null;
  occurred_at?: string | null;
}

export interface CreateProductWithStockInput {
  [key: string]: unknown;
  name: string;
  sku: string;
  category: string;
  unit: string;
  location?: string;
  quantity: number;
  unit_price?: number;
  min_stock?: number;
  max_stock?: number;
  group_id?: string | null;
  supplier_id?: string | null;
  color?: string | null;
  purchase_unit?: string | null;
  conversion_rate?: number | null;
  reason: string;
  stock_grade?: StockGrade | null;
}

export interface ProductGradeConfiguration {
  product_id: string;
  expected_previous_qty: number;
  expected_grade: StockGrade | null;
  new_grade: StockGrade;
  reason: string;
}

export type ReadyStockOperation =
  | {
      action: 'delta';
      reference_id: string;
      material_variant_id?: string | null;
      color: string;
      size: string;
      delta: number;
      expected_quantity: number;
      location?: string | null;
      notes?: string | null;
      reason?: string;
    }
  | {
      action: 'set';
      id: string;
      quantity: number;
      expected_quantity: number;
      location?: string | null;
      notes?: string | null;
      reason?: string;
    }
  | {
      action: 'delete';
      id: string;
      expected_quantity: number;
      reason?: string;
    };

function commandRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  throw new Error('O navegador não oferece UUID seguro para o comando de estoque.');
}

export async function executeStockCommand(
  command: 'adjust_products' | 'create_product' | 'configure_product_grades' | 'ready_stock',
  payload: Record<string, unknown>,
  expectedSnapshot: Record<string, unknown> = {},
  requestId = commandRequestId(),
): Promise<StockCommandResponse> {
  // A RPC entrou depois da última geração de types.ts. O cast fica restrito a
  // esta borda; callers continuam tipados e não conseguem montar argumentos
  // físicos arbitrários para products/ledger/reservas/pronta-entrega.
  const { data, error } = await supabase.rpc('execute_stock_command' as never, {
    p_command: command,
    p_payload: payload,
    p_request_id: requestId,
    p_expected_snapshot: expectedSnapshot,
  } as never);
  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Resposta inválida do comando de estoque.');
  }
  return data as StockCommandResponse;
}

export async function adjustProductsStock(
  items: ProductStockAdjustment[],
  requestId?: string,
): Promise<StockCommandResponse> {
  if (items.length === 0) throw new Error('Informe ao menos um produto para ajustar.');
  return executeStockCommand(
    'adjust_products',
    { items },
    {
      products: items.map((item) => ({
        product_id: item.product_id,
        quantity: item.expected_previous_qty,
        ...(item.expected_grade !== undefined ? { stock_grade: item.expected_grade } : {}),
      })),
    },
    requestId,
  );
}

export async function createProductWithStock(
  product: CreateProductWithStockInput,
  requestId?: string,
): Promise<StockCommandResponse> {
  return executeStockCommand('create_product', { product }, { product_absent_sku: product.sku }, requestId);
}

export async function createProductsWithStock(
  products: CreateProductWithStockInput[],
  requestId?: string,
): Promise<StockCommandResponse> {
  if (products.length === 0) throw new Error('Informe ao menos um produto para criar.');
  if (products.length === 1) return createProductWithStock(products[0], requestId);
  return executeStockCommand(
    'create_product',
    { products },
    { product_absent_skus: products.map((product) => product.sku) },
    requestId,
  );
}

export async function configureProductGrades(
  items: ProductGradeConfiguration[],
  requestId?: string,
): Promise<StockCommandResponse> {
  if (items.length === 0) throw new Error('Informe ao menos uma grade para configurar.');
  return executeStockCommand(
    'configure_product_grades',
    { items },
    {
      products: items.map((item) => ({
        product_id: item.product_id,
        quantity: item.expected_previous_qty,
        stock_grade: item.expected_grade,
      })),
    },
    requestId,
  );
}

export async function mutateReadyStock(
  operations: ReadyStockOperation[],
  requestId?: string,
): Promise<StockCommandResponse> {
  if (operations.length === 0) throw new Error('Informe ao menos uma operação de pronta-entrega.');
  return executeStockCommand(
    'ready_stock',
    { operations },
    {
      ready_stock: operations.map((operation) => ({
        ...(operation.action === 'delta'
          ? {
              reference_id: operation.reference_id,
              material_variant_id: operation.material_variant_id ?? null,
              color: operation.color,
              size: operation.size,
            }
          : { id: operation.id }),
        quantity: operation.expected_quantity,
      })),
    },
    requestId,
  );
}
