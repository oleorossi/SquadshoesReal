import { supabase } from '@/integrations/supabase/client';
import { planFromMotorSnapshot, type MotorApplyPlan } from '@/lib/cabedalMotorApply';

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Com a chave desligada não chama as funções que escrevem. */
export async function refreshCabedalMotorAfterInbound(): Promise<{ applied: boolean }> {
  const { data, error } = await supabase.rpc('list_cabedal_motor_purchase_snapshot' as never);
  if (error) throw error;
  const raw = (data ?? {}) as { motor_enabled?: boolean };
  if (raw.motor_enabled !== true) return { applied: false };
  const plan = planFromMotorSnapshot(raw, todayIso());
  await persistCabedalMotorPlan(plan);
  return { applied: true };
}

export async function persistCabedalMotorPlan(plan: MotorApplyPlan): Promise<void> {
  const reservations = await supabase.rpc('apply_cabedal_motor_soft_reservations' as never, {
    p_moves: plan.reservations.map((row) => ({
      sale_order_item_id: row.saleOrderItemId,
      product_id: row.productId,
      quantity: row.quantity,
    })),
  } as never);
  if (reservations.error) throw reservations.error;
  const holds = await supabase.rpc('apply_cabedal_motor_holds' as never, {
    p_holds: plan.holds.map((row) => ({
      sale_order_item_id: row.saleOrderItemId,
      status: row.status,
      reason: row.reason,
      departure_on: row.departureOn,
    })),
  } as never);
  if (holds.error) throw holds.error;
}
