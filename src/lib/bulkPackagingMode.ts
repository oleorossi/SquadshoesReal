/**
 * Troca de embalagem em lote na lista de Pedidos.
 *
 * Decisão do dono (29/09/2026): seletor na barra de seleção para corrigir
 * PVs gravados como Colméia quando o físico é Individual + Fitilho. Em
 * Produção entra; Faturado/Cancelado/terminais ficam de fora. Um Confirmar
 * força cancel_op_ids quando há OP avançada — prioridade é destravar
 * etiqueta individual, aceitando risco de desajuste de estoque de caixa.
 */
import { supabase } from '@/integrations/supabase/client';
import type { PackagingMode } from '@/hooks/useSaleOrders';
import { PACKAGING_MODE_CANONICAL } from '@/hooks/useSaleOrders';
import {
  executeSaleOrderCommand,
  preflightSaleOrderCommand,
  SaleOrderReadinessBlockedError,
} from '@/lib/saleOrderCommand';

export const BULK_PACKAGING_PROTECTED_STATUSES = [
  'Faturado',
  'Finalizado s/ NF',
  'Expedido',
  'Cancelado',
  'Concluído',
] as const;

/** Status de OP que o writer exige em cancel_op_ids ao rematerializar. */
export const BULK_PACKAGING_ADVANCED_OP_STATUSES = [
  'Em Produção',
  'Concluída',
  'Finalizado',
] as const;

export const BULK_PACKAGING_MODE_OPTIONS: PackagingMode[] = [...PACKAGING_MODE_CANONICAL];

export function isBulkPackagingEligibleStatus(status: string): boolean {
  return !(BULK_PACKAGING_PROTECTED_STATUSES as readonly string[]).includes(status);
}

export function filterBulkPackagingEligibleIds(
  orders: { id: string; status: string }[],
  selectedIds: Iterable<string>,
): { eligibleIds: string[]; skipped: number } {
  const selected = new Set(selectedIds);
  const eligibleIds = orders
    .filter((o) => selected.has(o.id) && isBulkPackagingEligibleStatus(o.status))
    .map((o) => o.id);
  return { eligibleIds, skipped: selected.size - eligibleIds.length };
}

export function isCanonicalPackagingMode(value: string): value is PackagingMode {
  return (BULK_PACKAGING_MODE_OPTIONS as string[]).includes(value);
}

async function loadAdvancedOpIds(saleOrderId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('id')
    .eq('sale_order_id', saleOrderId)
    .in('status', [...BULK_PACKAGING_ADVANCED_OP_STATUSES]);
  if (error) throw error;
  return (data || []).map((row) => row.id);
}

/**
 * Aplica packaging_mode em série pelo mesmo command boundary da edição
 * individual. Já inclui cancel_op_ids das OPs avançadas (força, sem segunda
 * confirmação por PV).
 */
export async function applyBulkPackagingModeChange(input: {
  orderIds: string[];
  packagingMode: PackagingMode;
  labelFor?: (orderId: string) => string;
}): Promise<{ updatedCount: number; failures: string[] }> {
  if (!isCanonicalPackagingMode(input.packagingMode)) {
    throw new Error(`Modo de embalagem inválido: ${input.packagingMode}`);
  }

  let updatedCount = 0;
  const failures: string[] = [];
  const labelFor = input.labelFor ?? ((id: string) => id.slice(0, 8));

  for (const orderId of input.orderIds) {
    try {
      const [{ data: header, error: headerError }, { data: items, error: itemsError }] = await Promise.all([
        supabase.from('sale_orders').select('*').eq('id', orderId).single(),
        supabase.from('sale_order_items').select('*').eq('sale_order_id', orderId).order('created_at'),
      ]);
      if (headerError || !header) throw headerError || new Error('PV não encontrado');
      if (itemsError) throw itemsError;
      if (!items?.length) throw new Error('PV sem itens não pode ser atualizado');
      if (!isBulkPackagingEligibleStatus(header.status)) {
        throw new Error(`status mudou para ${header.status}`);
      }
      if (header.packaging_mode === input.packagingMode) {
        updatedCount += 1;
        continue;
      }

      const expectedOrderVersion = Number(
        (header as { order_version?: number | null }).order_version,
      ) || 0;
      const cancelOpIds = await loadAdvancedOpIds(orderId);
      const payload = {
        header: { ...header, packaging_mode: input.packagingMode },
        items,
        teardown_op_ids: [] as string[],
        cancel_op_ids: cancelOpIds,
      };

      const preflight = await preflightSaleOrderCommand({
        saleOrderId: orderId,
        command: 'update',
        expectedOrderVersion,
        payload,
      });
      if (!preflight.ready) throw new SaleOrderReadinessBlockedError(preflight);

      await executeSaleOrderCommand({
        saleOrderId: orderId,
        command: 'update',
        expectedOrderVersion,
        idempotencyKey: `pv:${orderId}:bulk-packaging:${crypto.randomUUID()}`,
        payload,
      });
      updatedCount += 1;
    } catch (error) {
      failures.push(
        `${labelFor(orderId)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { updatedCount, failures };
}
