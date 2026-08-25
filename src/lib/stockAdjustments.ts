import { adjustProductsStock } from '@/lib/stockCommand';

export interface AdjustStockParams {
  productId: string;
  expectedPrevious: number;
  newQty: number;
  reason: string;
  orderId?: string | null;
  newGrade?: Record<string, unknown> | null;
  expectedGrade?: Record<string, unknown> | null;
  enforceReserved?: boolean;
  lotNumber?: string | null;
  responsible?: string | null;
  occurredAt?: string | null;
}

export interface AdjustStockResult {
  success: boolean;
  currentQty: number;
  errorMessage?: string;
}

/**
 * Atomic stock adjustment via the canonical stock command. It wraps ordered
 * row locking, optimistic snapshot validation, receipt idempotency and the
 * stock_movements ledger so callers cannot race or bypass the audit trail.
 * Returns the result instead of throwing so the caller can choose how to
 * surface concurrency failures (toast, retry, …).
 */
export async function adjustStockSafe(params: AdjustStockParams): Promise<AdjustStockResult> {
  let result;
  try {
    result = await adjustProductsStock([{
      product_id: params.productId,
      expected_previous_qty: params.expectedPrevious,
      new_qty: params.newQty,
      reason: params.reason,
      expected_grade: params.expectedGrade,
      new_grade: params.newGrade ?? null,
      order_id: params.orderId ?? null,
      enforce_reserved: params.enforceReserved ?? false,
      lot_number: params.lotNumber ?? null,
      responsible: params.responsible ?? null,
      occurred_at: params.occurredAt ?? null,
    }]);
  } catch (error) {
    return {
      success: false,
      currentQty: params.expectedPrevious,
      errorMessage: error instanceof Error ? error.message : 'Falha ao executar comando de estoque',
    };
  }
  if (result.success === false) {
    const firstError = result.errors?.[0];
    const errorCode = firstError?.error;
    return {
      success: false,
      currentQty: Number(firstError?.current_db_qty ?? params.expectedPrevious),
      errorMessage: errorCode === 'CONCURRENCY_ERROR'
        ? 'Estoque foi alterado por outro usuário. Recarregue e tente novamente.'
        : errorCode === 'NEGATIVE_QTY_NOT_ALLOWED'
          ? 'Quantidade negativa não permitida.'
          : errorCode === 'RESERVADO_PARA_OP'
            ? 'A baixa deixaria o estoque abaixo do que já está reservado pra OP aberta.'
            : (errorCode || 'Falha ao ajustar estoque'),
    };
  }
  return { success: true, currentQty: params.newQty };
}
