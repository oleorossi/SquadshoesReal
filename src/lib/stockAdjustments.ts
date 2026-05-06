import { supabase } from '@/integrations/supabase/client';

export interface AdjustStockParams {
  productId: string;
  expectedPrevious: number;
  newQty: number;
  reason: string;
  orderId?: string | null;
  newGrade?: Record<string, unknown> | null;
}

export interface AdjustStockResult {
  success: boolean;
  currentQty: number;
  errorMessage?: string;
}

/**
 * Atomic stock adjustment via the `adjust_stock` RPC. Wraps SELECT FOR UPDATE
 * concurrency check + stock_movements log emission so callers don't race.
 * Returns the result instead of throwing so the caller can choose how to
 * surface concurrency failures (toast, retry, …).
 */
export async function adjustStockSafe(params: AdjustStockParams): Promise<AdjustStockResult> {
  const delta = params.newQty - params.expectedPrevious;
  const { data, error } = await supabase.rpc('adjust_stock' as any, {
    p_product_id: params.productId,
    p_expected_previous_qty: params.expectedPrevious,
    p_new_qty: params.newQty,
    p_delta: delta,
    p_reason: params.reason,
    p_new_grade: params.newGrade ?? null,
    p_order_id: params.orderId ?? null,
  });
  if (error) {
    return { success: false, currentQty: params.expectedPrevious, errorMessage: error.message };
  }
  const result = Array.isArray(data) ? data[0] : data;
  if (!result) {
    return { success: false, currentQty: params.expectedPrevious, errorMessage: 'Resposta vazia da RPC adjust_stock' };
  }
  if (result.success === false) {
    return {
      success: false,
      currentQty: Number(result.current_db_qty ?? params.expectedPrevious),
      errorMessage: result.error_message === 'CONCURRENCY_ERROR'
        ? 'Estoque foi alterado por outro usuário. Recarregue e tente novamente.'
        : result.error_message === 'NEGATIVE_QTY_NOT_ALLOWED'
          ? 'Quantidade negativa não permitida.'
          : (result.error_message || 'Falha ao ajustar estoque'),
    };
  }
  return { success: true, currentQty: params.newQty };
}
